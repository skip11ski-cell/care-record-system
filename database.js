const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// 本番環境（Render等）では DATABASE_PATH で永続化ディスクを指定可能
const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, 'care_records.db');

let db;

function getDb() {
  if (!db) {
    const dir = path.dirname(DB_PATH);
    if (!path.isAbsolute(DB_PATH) && dir !== '.' && !fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    initTables();
  }
  return db;
}

function initTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      line_user_id TEXT NOT NULL,
      staff_name TEXT DEFAULT '',
      client_name TEXT DEFAULT '',
      service_date TEXT NOT NULL,
      service_type TEXT DEFAULT '',
      observation TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      raw_message TEXT NOT NULL,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS staff (
      line_user_id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      registered_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS daily_memos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memo_date TEXT NOT NULL,
      category TEXT NOT NULL CHECK(category IN ('event','meeting')),
      content TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      name_kana TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );
  `);
}

function insertRecord({ lineUserId, staffName, clientName, serviceDate, serviceType, observation, notes, rawMessage }) {
  const stmt = getDb().prepare(`
    INSERT INTO records (line_user_id, staff_name, client_name, service_date, service_type, observation, notes, raw_message)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(lineUserId, staffName, clientName, serviceDate, serviceType, observation, notes, rawMessage);
  return result.lastInsertRowid;
}

function getRecords({ status, clientName, date, dateFrom, dateTo, month, limit = 20, offset = 0 }) {
  let where = [];
  let params = [];

  if (status) {
    where.push('status = ?');
    params.push(status);
  }
  if (clientName) {
    where.push('client_name LIKE ?');
    params.push(`%${clientName}%`);
  }
  if (dateFrom && dateTo) {
    where.push('service_date >= ? AND service_date <= ?');
    params.push(dateFrom, dateTo);
  } else if (date) {
    where.push('service_date = ?');
    params.push(date);
  } else if (month) {
    where.push("service_date >= ? AND service_date < ?");
    params.push(`${month}-01`);
    const [y, m] = month.split('-').map(Number);
    const nextMonth = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
    params.push(`${nextMonth}-01`);
  }

  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const useKanaSort = !status || status === 'approved';
  const total = getDb().prepare(
    `SELECT COUNT(*) as count FROM records ${whereClause}`
  ).get(...params).count;

  let query;
  if (useKanaSort) {
    const allRows = getDb().prepare(
      `SELECT * FROM records ${whereClause} ORDER BY service_date DESC, created_at DESC`
    ).all(...params);
    const sorted = allRows
      .map(r => ({ ...r, _sortKana: getSortKanaForClient(r.client_name) }))
      .sort((a, b) => {
        if (a.service_date !== b.service_date) return a.service_date > b.service_date ? -1 : 1;
        const ka = (a._sortKana || a.client_name || '').localeCompare(b._sortKana || b.client_name || '', 'ja');
        if (ka !== 0) return ka;
        return (b.created_at || '').localeCompare(a.created_at || '');
      })
      .map(({ _sortKana, ...r }) => r);
    const rows = sorted.slice(offset, offset + limit);
    return { rows, total };
  }
  const rows = getDb().prepare(
    `SELECT * FROM records ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset);
  return { rows, total };
}

function getRecordById(id) {
  return getDb().prepare('SELECT * FROM records WHERE id = ?').get(id);
}

function updateRecordStatus(id, status) {
  getDb().prepare(
    `UPDATE records SET status = ?, updated_at = datetime('now','localtime') WHERE id = ?`
  ).run(status, id);
}

function deleteRecord(id) {
  getDb().prepare('DELETE FROM records WHERE id = ?').run(id);
}

function updateRecord(id, { clientName, serviceType, observation, notes }) {
  getDb().prepare(`
    UPDATE records
    SET client_name = ?, service_type = ?, observation = ?, notes = ?, updated_at = datetime('now','localtime')
    WHERE id = ?
  `).run(clientName, serviceType, observation, notes, id);
}

function upsertStaff(lineUserId, displayName) {
  getDb().prepare(`
    INSERT INTO staff (line_user_id, display_name)
    VALUES (?, ?)
    ON CONFLICT(line_user_id) DO UPDATE SET display_name = excluded.display_name
  `).run(lineUserId, displayName);
}

function getStaffName(lineUserId) {
  const row = getDb().prepare('SELECT display_name FROM staff WHERE line_user_id = ?').get(lineUserId);
  return row ? row.display_name : null;
}

function getStats() {
  const total = getDb().prepare('SELECT COUNT(*) as count FROM records').get().count;
  const pending = getDb().prepare("SELECT COUNT(*) as count FROM records WHERE status = 'pending'").get().count;
  const approved = getDb().prepare("SELECT COUNT(*) as count FROM records WHERE status = 'approved' AND service_date = date('now','localtime')").get().count;
  const today = getDb().prepare(
    "SELECT COUNT(*) as count FROM records WHERE service_date = date('now','localtime')"
  ).get().count;
  return { total, pending, approved, today };
}

// === 利用者マスタ ===

function getClients() {
  return getDb().prepare('SELECT * FROM clients ORDER BY name').all();
}

function getClientById(id) {
  return getDb().prepare('SELECT * FROM clients WHERE id = ?').get(id);
}

function insertClient({ name, nameKana, notes }) {
  const stmt = getDb().prepare('INSERT INTO clients (name, name_kana, notes) VALUES (?, ?, ?)');
  const result = stmt.run(name, nameKana || '', notes || '');
  return result.lastInsertRowid;
}

function updateClient(id, { name, nameKana, notes }) {
  getDb().prepare(`
    UPDATE clients SET name = ?, name_kana = ?, notes = ? WHERE id = ?
  `).run(name, nameKana || '', notes || '', id);
}

function deleteClient(id) {
  getDb().prepare('DELETE FROM clients WHERE id = ?').run(id);
}

function resolveClientName(rawName) {
  if (!rawName) return rawName;
  const matches = findMatchingClients(rawName);
  if (matches.length === 1) return matches[0].name;
  return rawName;
}

function findMatchingClients(rawName) {
  if (!rawName) return [];
  const cleaned = rawName.replace(/[さんちゃん様氏\s　]/g, '').trim();
  if (!cleaned) return [];

  const exact = getDb().prepare(
    "SELECT * FROM clients WHERE name = ? OR name_kana = ? OR REPLACE(REPLACE(name, ' ', ''), char(12288), '') = ?"
  ).all(cleaned, cleaned, cleaned);
  if (exact.length > 0) return exact;

  const partial = getDb().prepare(
    "SELECT * FROM clients WHERE name LIKE ? OR name_kana LIKE ? OR REPLACE(REPLACE(name, ' ', ''), char(12288), '') LIKE ?"
  ).all('%' + cleaned + '%', '%' + cleaned + '%', '%' + cleaned + '%');
  return partial;
}

function getSortKanaForClient(clientName) {
  const matches = findMatchingClients(clientName || '');
  if (matches.length === 0) return clientName || '';
  const cleaned = (clientName || '').replace(/[さんちゃん様氏\s　]/g, '').trim();
  const exact = matches.find(m => m.name === cleaned || m.name.replace(/[\s　]/g, '') === cleaned);
  const best = exact || matches.sort((a, b) => a.name.length - b.name.length)[0];
  return (best.name_kana || best.name).replace(/[\s　]/g, '');
}

// === 日報メモ ===

function getDailyMemos(date) {
  return getDb().prepare(
    'SELECT * FROM daily_memos WHERE memo_date = ? ORDER BY category, created_at'
  ).all(date);
}

function insertDailyMemo({ date, category, content }) {
  const stmt = getDb().prepare(
    'INSERT INTO daily_memos (memo_date, category, content) VALUES (?, ?, ?)'
  );
  return stmt.run(date, category, content).lastInsertRowid;
}

function updateDailyMemo(id, content) {
  getDb().prepare(
    "UPDATE daily_memos SET content = ?, updated_at = datetime('now','localtime') WHERE id = ?"
  ).run(content, id);
}

function deleteDailyMemo(id) {
  getDb().prepare('DELETE FROM daily_memos WHERE id = ?').run(id);
}

module.exports = {
  getDb,
  insertRecord,
  getRecords,
  getRecordById,
  updateRecordStatus,
  updateRecord,
  deleteRecord,
  upsertStaff,
  getStaffName,
  getStats,
  getClients,
  getClientById,
  insertClient,
  updateClient,
  deleteClient,
  resolveClientName,
  findMatchingClients,
  getDailyMemos,
  insertDailyMemo,
  updateDailyMemo,
  deleteDailyMemo
};
