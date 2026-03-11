const SYSTEM_PROMPT = `あなたは介護記録の専門家です。
デイサービスの介護スタッフから送られてくる日本語の自由文を、介護記録様式に変換してください。

必ず以下のJSON形式で出力してください。余計なテキストは含めないでください：
{
  "client_name": "利用者名（「さん」「様」は除去。文中に名前がなければ空文字）",
  "service_type": "サービス内容（入浴介助、食事介助、排泄介助、レクリエーション、送迎、バイタル測定、口腔ケア、機能訓練、その他 から最も近いものを選択）",
  "observation": "様子・観察内容（箇条書きではなく簡潔な文章にまとめる。専門的な介護記録表現に変換する）",
  "notes": "特記事項（注意すべき点、医療職への申し送り事項など。なければ空文字）"
}

変換ルール：
- 口語的な表現を介護記録にふさわしい専門的な表現に変換する
- 「元気だった」→「活気あり」、「食べた」→「摂取」、「歩いた」→「歩行」など
- バイタルの数値があればそのまま記載する
- 体調の変化があれば特記事項に記載する
- 転倒やケガの報告があれば特記事項に必ず記載する
- スタッフが入力した時間表現（「今朝」「昼食時」「午後」「お迎え時」など）はそのまま保持すること。勝手に「本日午前中」等に言い換えない
- 情報の出所（「お嬢様より」「ご家族より」など）もスタッフの入力通りに保持すること。勝手に変えない
- 事実関係や伝聞内容を改変・追加しないこと。スタッフが書いた内容を忠実に専門表現へ変換する`;

function todayISO() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function isoToJapanese(iso) {
  const m = iso.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}年${parseInt(m[2])}月${parseInt(m[3])}日`;
  return iso;
}

// --- OpenAI プロバイダ ---

async function openaiConvert(message) {
  const OpenAI = require('openai');
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: message }
    ],
    temperature: 0.3,
    response_format: { type: 'json_object' }
  });

  const content = response.choices[0].message.content;
  return JSON.parse(content);
}

// --- Google Gemini プロバイダ（無料枠あり・推奨） ---

async function geminiConvert(message) {
  const { GoogleGenerativeAI } = require('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: {
      temperature: 0.3,
      responseMimeType: 'application/json'
    }
  });

  const prompt = SYSTEM_PROMPT + '\n\n以下のスタッフ入力を変換してください：\n' + message;
  const result = await model.generateContent(prompt);
  const text = result.response.text();
  return JSON.parse(text);
}

// --- Dify プロバイダ ---

async function difyConvert(message) {
  const apiKey = process.env.DIFY_API_KEY;
  const baseUrl = process.env.DIFY_BASE_URL || 'https://api.dify.ai/v1';

  const res = await fetch(`${baseUrl}/chat-messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      inputs: {},
      query: message,
      response_mode: 'blocking',
      user: 'care-system'
    })
  });

  const data = await res.json();
  return JSON.parse(data.answer);
}

// --- 公開インターフェース ---

const providers = { gemini: geminiConvert, openai: openaiConvert, dify: difyConvert };

async function convertToCareRecord(message) {
  const provider = process.env.AI_PROVIDER || 'openai';
  const convertFn = providers[provider];
  if (!convertFn) {
    throw new Error(`未対応のAIプロバイダ: ${provider}`);
  }

  try {
    const parsed = await convertFn(message);
    return {
      serviceDate: todayISO(),
      clientName: parsed.client_name || '',
      serviceType: parsed.service_type || 'その他',
      observation: parsed.observation || '',
      notes: parsed.notes || ''
    };
  } catch (error) {
    console.error('AI変換エラー:', error.message);
    return {
      serviceDate: todayISO(),
      clientName: '',
      serviceType: 'その他',
      observation: message,
      notes: 'AI変換に失敗しました。原文をそのまま記録しています。'
    };
  }
}

function formatRecordForLine(record, recordId) {
  const displayDate = isoToJapanese(record.serviceDate);
  const lines = [
    `📋 介護記録 #${recordId}`,
    `━━━━━━━━━━━━━━`,
    `📅 日付：${displayDate}`,
  ];

  if (record.clientName) {
    lines.push(`👤 利用者：${record.clientName} 様`);
  }

  lines.push(
    `🏥 サービス：${record.serviceType}`,
    ``,
    `【様子・観察】`,
    record.observation
  );

  if (record.notes) {
    lines.push(``, `【特記事項】`, record.notes);
  }

  lines.push(
    `━━━━━━━━━━━━━━`,
    `✅ 管理画面で確認・承認できます`
  );

  return lines.join('\n');
}

module.exports = { convertToCareRecord, formatRecordForLine };
