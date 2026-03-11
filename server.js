require('dotenv').config();

const express = require('express');
const crypto = require('crypto');
const { messagingApi, middleware } = require('@line/bot-sdk');
const { convertToCareRecord, formatRecordForLine } = require('./ai-converter');
const db = require('./database');

const lineConfig = {
  channelSecret: process.env.LINE_CHANNEL_SECRET,
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN
};

const client = new messagingApi.MessagingApiClient({
  channelAccessToken: lineConfig.channelAccessToken
});

const app = express();

// 管理画面の静的ファイル
app.use(express.static('public'));

// APIルートにはJSONパーサーを使用
app.use('/api', express.json());

// === 認証 ===

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';
const authTokens = new Set();

app.post('/api/login', (req, res) => {
  const { password } = req.body;
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'パスワードが正しくありません' });
  }
  const token = crypto.randomBytes(32).toString('hex');
  authTokens.add(token);
  res.json({ success: true, token });
});

function requireAuth(req, res, next) {
  const token = req.headers['authorization']?.replace('Bearer ', '');
  if (!token || !authTokens.has(token)) {
    return res.status(401).json({ error: '認証が必要です' });
  }
  next();
}

// 管理画面APIには認証を必須にする（login・webhook・statsは除外）
app.use('/api/records', requireAuth);
app.use('/api/clients', requireAuth);
app.use('/api/memos', requireAuth);

// LINE Webhook（raw bodyが必要なので個別にパース）
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  console.log('=== Webhook受信 ===');
  const signature = req.headers['x-line-signature'];
  console.log('署名あり:', !!signature);

  if (!verifySignature(req.body, signature)) {
    console.log('署名検証NG - チャネルシークレットを確認してください');
    return res.status(403).json({ error: 'Invalid signature' });
  }
  console.log('署名検証OK');

  const body = JSON.parse(req.body.toString());
  const events = body.events || [];

  for (const event of events) {
    if (event.type === 'message' && event.message.type === 'text') {
      await handleTextMessage(event);
    }
  }

  res.status(200).json({ status: 'ok' });
});

function verifySignature(body, signature) {
  if (!lineConfig.channelSecret || !signature) return false;
  const hash = crypto
    .createHmac('SHA256', lineConfig.channelSecret)
    .update(body)
    .digest('base64');
  return hash === signature;
}

const pendingRecords = new Map();

async function handleTextMessage(event) {
  const userId = event.source.userId;
  const message = event.message.text;

  try {
    // 利用者選択の返答かチェック
    const pending = pendingRecords.get(userId);
    if (pending) {
      const num = parseInt(message);
      if (num >= 1 && num <= pending.candidates.length) {
        pending.record.clientName = pending.candidates[num - 1].name;
        pendingRecords.delete(userId);
        const recordId = db.insertRecord({
          lineUserId: userId,
          staffName: pending.staffName,
          clientName: pending.record.clientName,
          serviceDate: pending.record.serviceDate,
          serviceType: pending.record.serviceType,
          observation: pending.record.observation,
          notes: pending.record.notes,
          rawMessage: pending.rawMessage
        });
        const replyText = formatRecordForLine(pending.record, recordId);
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: replyText }]
        });
        return;
      } else {
        pendingRecords.delete(userId);
      }
    }

    // スタッフ名の取得・登録
    let staffName = db.getStaffName(userId);
    if (!staffName) {
      try {
        const profile = await client.getProfile(userId);
        staffName = profile.displayName;
        db.upsertStaff(userId, staffName);
      } catch {
        staffName = '不明';
      }
    }

    // AI変換
    const record = await convertToCareRecord(message);

    // 利用者マスタで名前をフルネームに正規化
    let candidates = [];
    if (record.clientName) {
      candidates = db.findMatchingClients(record.clientName);
    }
    if (candidates.length === 0) {
      const clients = db.getClients();
      for (const c of clients) {
        const surname = c.name.replace(/[\s　]/g, '').substring(0, 2);
        if (surname && (message.includes(surname) || (c.name_kana && message.includes(c.name_kana.substring(0, 3))))) {
          candidates.push(c);
        }
      }
    }

    if (candidates.length === 1) {
      record.clientName = candidates[0].name;
    } else if (candidates.length >= 2) {
      pendingRecords.set(userId, { record, staffName, rawMessage: message, candidates });
      const list = candidates.map((c, i) => `${i + 1}. ${c.name}（${c.name_kana || ''}）`).join('\n');
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: `同じ名字の利用者が複数います。\n番号で選んでください：\n\n${list}` }]
      });
      return;
    }

    // DB保存
    const recordId = db.insertRecord({
      lineUserId: userId,
      staffName,
      clientName: record.clientName,
      serviceDate: record.serviceDate,
      serviceType: record.serviceType,
      observation: record.observation,
      notes: record.notes,
      rawMessage: message
    });

    // LINE返信
    const replyText = formatRecordForLine(record, recordId);
    await client.replyMessage({
      replyToken: event.replyToken,
      messages: [{ type: 'text', text: replyText }]
    });

  } catch (error) {
    console.error('メッセージ処理エラー:', error);
    try {
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{
          type: 'text',
          text: '申し訳ございません。記録の変換中にエラーが発生しました。もう一度お試しください。'
        }]
      });
    } catch (replyError) {
      console.error('返信エラー:', replyError);
    }
  }
}

// === 管理画面API ===

app.get('/api/records', (req, res) => {
  const { status, client_name, date, date_from, date_to, month, limit, offset } = req.query;
  const result = db.getRecords({
    status,
    clientName: client_name,
    date,
    dateFrom: date_from,
    dateTo: date_to,
    month,
    limit: parseInt(limit) || 20,
    offset: parseInt(offset) || 0
  });
  res.json(result);
});

app.get('/api/records/:id', (req, res) => {
  const record = db.getRecordById(parseInt(req.params.id));
  if (!record) return res.status(404).json({ error: '記録が見つかりません' });
  res.json(record);
});

app.patch('/api/records/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const record = db.getRecordById(id);
  if (!record) return res.status(404).json({ error: '記録が見つかりません' });

  const { client_name, service_type, observation, notes } = req.body;
  if (client_name !== undefined || service_type !== undefined || observation !== undefined || notes !== undefined) {
    db.updateRecord(id, {
      clientName: client_name ?? record.client_name,
      serviceType: service_type ?? record.service_type,
      observation: observation ?? record.observation,
      notes: notes ?? record.notes
    });
  }

  res.json({ success: true });
});

app.post('/api/records/:id/approve', (req, res) => {
  const id = parseInt(req.params.id);
  const record = db.getRecordById(id);
  if (!record) return res.status(404).json({ error: '記録が見つかりません' });

  db.updateRecordStatus(id, 'approved');
  res.json({ success: true, status: 'approved' });
});

app.post('/api/records/:id/reject', (req, res) => {
  const id = parseInt(req.params.id);
  const record = db.getRecordById(id);
  if (!record) return res.status(404).json({ error: '記録が見つかりません' });

  db.updateRecordStatus(id, 'rejected');
  res.json({ success: true, status: 'rejected' });
});

app.delete('/api/records/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const record = db.getRecordById(id);
  if (!record) return res.status(404).json({ error: '記録が見つかりません' });

  db.deleteRecord(id);
  res.json({ success: true });
});

app.get('/api/stats', (req, res) => {
  res.json(db.getStats());
});

// === 日報メモ ===

app.get('/api/memos', (req, res) => {
  const date = req.query.date;
  if (!date) return res.status(400).json({ error: '日付が必要です' });
  res.json(db.getDailyMemos(date));
});

app.post('/api/memos', (req, res) => {
  const { date, category, content } = req.body;
  if (!date || !category || !content) {
    return res.status(400).json({ error: '日付・カテゴリ・内容は必須です' });
  }
  const id = db.insertDailyMemo({ date, category, content });
  res.json({ success: true, id });
});

app.patch('/api/memos/:id', (req, res) => {
  const { content } = req.body;
  db.updateDailyMemo(parseInt(req.params.id), content);
  res.json({ success: true });
});

app.delete('/api/memos/:id', (req, res) => {
  db.deleteDailyMemo(parseInt(req.params.id));
  res.json({ success: true });
});

// === CSVエクスポート ===

app.get('/api/export/csv', requireAuth, (req, res) => {
  const { status, client_name, date, date_from, date_to } = req.query;
  const result = db.getRecords({
    status: status || 'approved',
    clientName: client_name,
    date,
    dateFrom: date_from,
    dateTo: date_to,
    limit: 10000,
    offset: 0
  });

  const BOM = '\uFEFF';
  const header = 'ID,日付,利用者名,スタッフ名,サービス内容,様子・観察,特記事項,ステータス,作成日時';
  const csvRows = result.rows.map(r => {
    const fields = [
      r.id,
      r.service_date,
      r.client_name,
      r.staff_name,
      r.service_type,
      r.observation,
      r.notes,
      r.status === 'approved' ? '承認済み' : r.status === 'rejected' ? '差し戻し' : '未承認',
      r.created_at
    ];
    return fields.map(f => `"${String(f || '').replace(/"/g, '""')}"`).join(',');
  });

  const csv = BOM + header + '\n' + csvRows.join('\n');
  const dateStr = new Date().toISOString().split('T')[0];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="care_records_${dateStr}.csv"`);
  res.send(csv);
});

// === 利用者マスタAPI ===

app.get('/api/clients', (req, res) => {
  res.json(db.getClients());
});

app.post('/api/clients', (req, res) => {
  const { name, name_kana, notes } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: '利用者名は必須です' });
  }
  try {
    const id = db.insertClient({ name: name.trim(), nameKana: name_kana, notes });
    res.status(201).json({ success: true, id });
  } catch (e) {
    if (e.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'この利用者名は既に登録されています' });
    }
    throw e;
  }
});

app.patch('/api/clients/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const existing = db.getClientById(id);
  if (!existing) return res.status(404).json({ error: '利用者が見つかりません' });

  const { name, name_kana, notes } = req.body;
  db.updateClient(id, {
    name: name ?? existing.name,
    nameKana: name_kana ?? existing.name_kana,
    notes: notes ?? existing.notes
  });
  res.json({ success: true });
});

app.delete('/api/clients/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const existing = db.getClientById(id);
  if (!existing) return res.status(404).json({ error: '利用者が見つかりません' });

  db.deleteClient(id);
  res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`介護記録システム起動: http://localhost:${PORT}`);
  console.log(`管理画面: http://localhost:${PORT}`);
  console.log(`LINE Webhook: http://localhost:${PORT}/webhook`);
});
