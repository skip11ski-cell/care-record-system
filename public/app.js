let currentRecordId = null;
let currentClientId = null;
let currentPage = 0;
const PAGE_SIZE = 20;
let authToken = sessionStorage.getItem('authToken') || null;
let currentMonth = null;

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatDate(isoDate) {
  if (!isoDate) return '';
  const m = isoDate.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}年${parseInt(m[2])}月${parseInt(m[3])}日`;
  return isoDate;
}

function formatTime(datetime) {
  if (!datetime) return '';
  const m = datetime.match(/(\d{1,2}):(\d{2})/);
  if (m) return `${m[1]}:${m[2]}`;
  return '';
}

function authHeaders() {
  const h = { 'Content-Type': 'application/json' };
  if (authToken) h['Authorization'] = `Bearer ${authToken}`;
  return h;
}

function authFetch(url, opts = {}) {
  opts.headers = { ...authHeaders(), ...(opts.headers || {}) };
  return fetch(url, opts).then(res => {
    if (res.status === 401) { logout(); throw new Error('認証切れ'); }
    return res;
  });
}

// === 認証 ===

async function login() {
  const pw = document.getElementById('loginPassword').value;
  const errEl = document.getElementById('loginError');
  errEl.textContent = '';

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw })
    });
    const data = await res.json();
    if (!res.ok) {
      errEl.textContent = data.error || 'ログインに失敗しました';
      return;
    }
    authToken = data.token;
    sessionStorage.setItem('authToken', authToken);
    showMainApp();
  } catch (e) {
    errEl.textContent = '通信エラーが発生しました';
  }
}

function logout() {
  authToken = null;
  sessionStorage.removeItem('authToken');
  document.getElementById('mainApp').style.display = 'none';
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('loginPassword').value = '';
  document.getElementById('loginError').textContent = '';
}

async function showMainApp() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('mainApp').style.display = 'block';
  loadStats();
  loadRecords();
}

document.addEventListener('DOMContentLoaded', () => {
  if (authToken) {
    authFetch('/api/records?limit=1')
      .then(res => { if (res.ok) showMainApp(); })
      .catch(() => {});
  }
});

// === タブ切替 ===

function switchTab(tab) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById('tabRecords').style.display = tab === 'records' ? 'block' : 'none';
  document.getElementById('tabMemos').style.display = tab === 'memos' ? 'block' : 'none';
  document.getElementById('tabClients').style.display = tab === 'clients' ? 'block' : 'none';
  event.target.classList.add('active');
  if (tab === 'clients') loadClients();
  if (tab === 'memos') { initMemoDate(); loadMemos(); }
}

// === データ読み込み ===

async function loadStats() {
  try {
    const res = await fetch('/api/stats');
    const data = await res.json();
    document.getElementById('statToday').textContent = data.today;
    document.getElementById('statPending').textContent = data.pending;
    document.getElementById('statApproved').textContent = data.approved;
    document.getElementById('statTotal').textContent = data.total;
  } catch (e) {
    console.error('統計取得エラー:', e);
  }
}

function getTodayStr() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getCurrentMonthStr() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function updateMonthLabel() {
  if (!currentMonth) return;
  const [y, m] = currentMonth.split('-').map(Number);
  document.getElementById('monthLabel').textContent = `${y}年${m}月`;
}

function changeMonth(delta) {
  if (!currentMonth) return;
  const [y, m] = currentMonth.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  currentMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  updateMonthLabel();
  loadRecords(0);
}

function showMonthSelector(show) {
  document.getElementById('monthSelector').style.display = show ? 'flex' : 'none';
}

function clearDateFilters() {
  document.getElementById('filterDateFrom').value = '';
  document.getElementById('filterDateTo').value = '';
}

function filterBystat(type) {
  const statusEl = document.getElementById('filterStatus');

  if (type === 'today') {
    statusEl.value = '';
    const today = getTodayStr();
    document.getElementById('filterDateFrom').value = today;
    document.getElementById('filterDateTo').value = today;
    currentMonth = null;
    showMonthSelector(false);
  } else if (type === 'todayApproved') {
    statusEl.value = 'approved';
    const today = getTodayStr();
    document.getElementById('filterDateFrom').value = today;
    document.getElementById('filterDateTo').value = today;
    currentMonth = null;
    showMonthSelector(false);
  } else if (type === '') {
    statusEl.value = '';
    clearDateFilters();
    currentMonth = getCurrentMonthStr();
    updateMonthLabel();
    showMonthSelector(true);
  } else {
    statusEl.value = type;
    clearDateFilters();
    currentMonth = null;
    showMonthSelector(false);
  }
  loadRecords(0);
}

async function loadRecords(page) {
  if (page !== undefined) currentPage = page;
  const status = document.getElementById('filterStatus').value;
  const clientName = document.getElementById('filterClient').value;
  const dateFrom = document.getElementById('filterDateFrom').value;
  const dateTo = document.getElementById('filterDateTo').value;

  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (clientName) params.set('client_name', clientName);
  if (dateFrom && dateTo) {
    params.set('date_from', dateFrom);
    params.set('date_to', dateTo);
  } else if (dateFrom) {
    params.set('date', dateFrom);
  } else if (currentMonth) {
    params.set('month', currentMonth);
  }
  params.set('limit', PAGE_SIZE);
  params.set('offset', currentPage * PAGE_SIZE);

  try {
    const res = await authFetch(`/api/records?${params}`);
    const data = await res.json();
    renderRecords(data.rows || []);
    renderPagination(data.total || 0);
  } catch (e) {
    console.error('記録取得エラー:', e);
  }
}

function formatDateWithDay(isoDate) {
  if (!isoDate) return '';
  const m = isoDate.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!m) return isoDate;
  const days = ['日', '月', '火', '水', '木', '金', '土'];
  const d = new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]));
  return `${m[1]}年${parseInt(m[2])}月${parseInt(m[3])}日（${days[d.getDay()]}）`;
}

async function renderRecords(records) {
  const container = document.getElementById('recordsList');

  if (records.length === 0) {
    container.innerHTML = '<p class="empty-message">該当する記録がありません。</p>';
    return;
  }

  const dates = [...new Set(records.map(r => r.service_date))];
  const memoCache = {};
  await Promise.all(dates.map(async d => {
    try {
      const res = await authFetch(`/api/memos?date=${d}`);
      memoCache[d] = await res.json();
    } catch { memoCache[d] = []; }
  }));

  let html = '';
  let lastDate = '';

  records.forEach(r => {
    if (r.service_date !== lastDate) {
      lastDate = r.service_date;
      const memos = memoCache[r.service_date] || [];
      const events = memos.filter(m => m.category === 'event').map(m => escapeHtml(m.content));
      const meetings = memos.filter(m => m.category === 'meeting').map(m => escapeHtml(m.content));
      let memoHtml = '';
      if (events.length > 0 || meetings.length > 0) {
        memoHtml = '<div class="date-memos">';
        if (events.length > 0) {
          memoHtml += `<span class="date-memo event">🎯 ${events.join('、')}</span>`;
        }
        if (meetings.length > 0) {
          memoHtml += `<span class="date-memo meeting">📋 ${meetings.join('、')}</span>`;
        }
        memoHtml += '</div>';
      }
      html += `<div class="date-header">${formatDateWithDay(r.service_date)}${memoHtml}</div>`;
    }

    const statusLabel = { pending: '未承認', approved: '承認済み', rejected: '差し戻し' };
    const safeStatus = escapeHtml(r.status);
    html += `
      <div class="record-card ${safeStatus}" onclick="openRecord(${parseInt(r.id)})">
        <div class="record-info">
          <h4>${escapeHtml(r.client_name) || '利用者名未設定'} 様 — ${escapeHtml(r.service_type)}</h4>
          <div class="record-meta">
            <span>📅 ${formatDate(r.service_date)} ${formatTime(r.created_at)}</span>
            <span>👤 ${escapeHtml(r.staff_name) || '不明'}</span>
            <span>#${parseInt(r.id)}</span>
          </div>
          <div class="record-observation">${escapeHtml(r.observation)}</div>
          ${r.notes ? `<div class="record-notes">【特記事項】${escapeHtml(r.notes)}</div>` : ''}
        </div>
        <span class="status-badge ${safeStatus}">${escapeHtml(statusLabel[r.status] || r.status)}</span>
      </div>
    `;
  });

  container.innerHTML = html;
}

function renderPagination(total) {
  const container = document.getElementById('pagination');
  const totalPages = Math.ceil(total / PAGE_SIZE);
  if (totalPages <= 1) { container.innerHTML = ''; return; }

  let html = '<div class="page-nav">';
  if (currentPage > 0) {
    html += `<button class="btn btn-page" onclick="loadRecords(${currentPage - 1})">前へ</button>`;
  }
  html += `<span class="page-info">${currentPage + 1} / ${totalPages} ページ（全${total}件）</span>`;
  if (currentPage < totalPages - 1) {
    html += `<button class="btn btn-page" onclick="loadRecords(${currentPage + 1})">次へ</button>`;
  }
  html += '</div>';
  container.innerHTML = html;
}

// === 記録操作 ===

async function openRecord(id) {
  try {
    const res = await authFetch(`/api/records/${id}`);
    const record = await res.json();
    currentRecordId = id;

    document.getElementById('editRaw').textContent = record.raw_message;
    document.getElementById('editClient').value = record.client_name || '';
    document.getElementById('editServiceType').value = record.service_type || 'その他';
    document.getElementById('editObservation').value = record.observation || '';
    document.getElementById('editNotes').value = record.notes || '';

    document.getElementById('editModal').classList.add('open');
  } catch (e) {
    console.error('記録取得エラー:', e);
  }
}

function closeModal() {
  document.getElementById('editModal').classList.remove('open');
  currentRecordId = null;
}

async function saveFields(id) {
  await authFetch(`/api/records/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      client_name: document.getElementById('editClient').value,
      service_type: document.getElementById('editServiceType').value,
      observation: document.getElementById('editObservation').value,
      notes: document.getElementById('editNotes').value
    })
  });
}

async function saveRecord() {
  if (!currentRecordId) return;
  try {
    await saveFields(currentRecordId);
    closeModal();
    loadRecords();
    loadStats();
  } catch (e) {
    console.error('保存エラー:', e);
    alert('保存に失敗しました');
  }
}

async function approveRecord() {
  if (!currentRecordId) return;

  const id = currentRecordId;
  try {
    await saveFields(id);
    await authFetch(`/api/records/${id}/approve`, { method: 'POST' });
    closeModal();
    document.getElementById('filterStatus').value = '';
    loadRecords(0);
    loadStats();
  } catch (e) {
    console.error('承認エラー:', e);
    alert('承認に失敗しました');
  }
}

async function deleteRecord() {
  if (!currentRecordId) return;
  if (!confirm('この記録を完全に削除しますか？この操作は取り消せません。')) return;

  const id = currentRecordId;
  try {
    await authFetch(`/api/records/${id}`, { method: 'DELETE' });
    closeModal();
    loadRecords(0);
    loadStats();
  } catch (e) {
    console.error('削除エラー:', e);
    alert('削除に失敗しました');
  }
}

async function rejectRecord() {
  if (!currentRecordId) return;
  if (!confirm('この記録を差し戻しますか？')) return;

  const id = currentRecordId;
  try {
    await authFetch(`/api/records/${id}/reject`, { method: 'POST' });
    closeModal();
    document.getElementById('filterStatus').value = '';
    loadRecords(0);
    loadStats();
  } catch (e) {
    console.error('差し戻しエラー:', e);
    alert('差し戻しに失敗しました');
  }
}

document.getElementById('editModal').addEventListener('click', (e) => {
  if (e.target.id === 'editModal') closeModal();
});

// === CSVエクスポート ===

function exportCsv() {
  const status = document.getElementById('filterStatus').value;
  const clientName = document.getElementById('filterClient').value;
  const dateFrom = document.getElementById('filterDateFrom').value;
  const dateTo = document.getElementById('filterDateTo').value;

  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (clientName) params.set('client_name', clientName);
  if (dateFrom) params.set('date_from', dateFrom);
  if (dateTo) params.set('date_to', dateTo);

  const a = document.createElement('a');
  a.href = `/api/export/csv?${params}`;
  const xhr = new XMLHttpRequest();
  xhr.open('GET', `/api/export/csv?${params}`, true);
  xhr.setRequestHeader('Authorization', `Bearer ${authToken}`);
  xhr.responseType = 'blob';
  xhr.onload = function () {
    if (xhr.status === 200) {
      const url = URL.createObjectURL(xhr.response);
      const a = document.createElement('a');
      a.href = url;
      a.download = `care_records_${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } else {
      alert('CSVエクスポートに失敗しました');
    }
  };
  xhr.send();
}

// === 利用者マスタ ===

async function loadClients() {
  try {
    const res = await authFetch('/api/clients');
    const clients = await res.json();
    renderClients(clients);
  } catch (e) {
    console.error('利用者取得エラー:', e);
  }
}

function renderClients(clients) {
  const container = document.getElementById('clientList');

  if (clients.length === 0) {
    container.innerHTML = '<p class="empty-message">利用者が登録されていません。「新規登録」から追加してください。</p>';
    return;
  }

  container.innerHTML = clients.map(c => `
    <div class="client-card" onclick="openClientModal(${parseInt(c.id)})">
      <div class="client-info">
        <h4>${escapeHtml(c.name)}</h4>
        ${c.name_kana ? `<span class="client-kana">${escapeHtml(c.name_kana)}</span>` : ''}
        ${c.notes ? `<p class="client-notes">${escapeHtml(c.notes)}</p>` : ''}
      </div>
    </div>
  `).join('');
}

async function openClientModal(id) {
  currentClientId = id || null;
  document.getElementById('clientName').value = '';
  document.getElementById('clientKana').value = '';
  document.getElementById('clientNotes').value = '';
  document.getElementById('clientDeleteBtn').style.display = 'none';

  if (id) {
    document.getElementById('clientModalTitle').textContent = '利用者編集';
    try {
      const res = await authFetch(`/api/clients`);
      const clients = await res.json();
      const c = clients.find(cl => cl.id === id);
      if (c) {
        document.getElementById('clientName').value = c.name || '';
        document.getElementById('clientKana').value = c.name_kana || '';
        document.getElementById('clientNotes').value = c.notes || '';
        document.getElementById('clientDeleteBtn').style.display = 'block';
      }
    } catch (e) {
      console.error('利用者取得エラー:', e);
    }
  } else {
    document.getElementById('clientModalTitle').textContent = '利用者登録';
  }

  document.getElementById('clientModal').classList.add('open');
}

function closeClientModal() {
  document.getElementById('clientModal').classList.remove('open');
  currentClientId = null;
}

document.getElementById('clientModal').addEventListener('click', (e) => {
  if (e.target.id === 'clientModal') closeClientModal();
});

async function saveClient() {
  const name = document.getElementById('clientName').value.trim();
  if (!name) { alert('利用者名を入力してください'); return; }

  const body = {
    name,
    name_kana: document.getElementById('clientKana').value.trim(),
    notes: document.getElementById('clientNotes').value.trim()
  };

  try {
    if (currentClientId) {
      await authFetch(`/api/clients/${currentClientId}`, {
        method: 'PATCH',
        body: JSON.stringify(body)
      });
    } else {
      const res = await authFetch('/api/clients', {
        method: 'POST',
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!res.ok) { alert(data.error); return; }
    }
    closeClientModal();
    loadClients();
  } catch (e) {
    console.error('保存エラー:', e);
    alert('保存に失敗しました');
  }
}

async function deleteClientRecord() {
  if (!currentClientId) return;
  if (!confirm('この利用者を削除しますか？')) return;

  try {
    await authFetch(`/api/clients/${currentClientId}`, { method: 'DELETE' });
    closeClientModal();
    loadClients();
  } catch (e) {
    console.error('削除エラー:', e);
    alert('削除に失敗しました');
  }
}

// === 管理者メモ ===

let memoDate = null;

function initMemoDate() {
  if (!memoDate) memoDate = getTodayStr();
  updateMemoDateLabel();
}

function updateMemoDateLabel() {
  document.getElementById('memoDateLabel').textContent = formatDateWithDay(memoDate);
}

function changeMemoDate(delta) {
  const [y, m, d] = memoDate.split('-').map(Number);
  const dt = new Date(y, m - 1, d + delta);
  memoDate = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  updateMemoDateLabel();
  loadMemos();
}

async function loadMemos() {
  try {
    const res = await authFetch(`/api/memos?date=${memoDate}`);
    const memos = await res.json();
    const events = memos.filter(m => m.category === 'event');
    const meetings = memos.filter(m => m.category === 'meeting');
    renderMemoList('memoEventList', events);
    renderMemoList('memoMeetingList', meetings);
  } catch (e) {
    console.error('メモ取得エラー:', e);
  }
}

function renderMemoList(containerId, memos) {
  const container = document.getElementById(containerId);
  if (memos.length === 0) {
    container.innerHTML = '<p class="empty-message">まだ記入がありません</p>';
    return;
  }
  container.innerHTML = memos.map(m => `
    <div class="memo-item">
      <span class="memo-content" onclick="editMemo(this, ${m.id})">${escapeHtml(m.content)}</span>
      <button class="memo-delete" onclick="deleteMemo(${m.id})" title="削除">&times;</button>
    </div>
  `).join('');
}

async function addMemo(category) {
  const inputId = category === 'event' ? 'memoEventInput' : 'memoMeetingInput';
  const input = document.getElementById(inputId);
  const content = input.value.trim();
  if (!content) return;

  try {
    await authFetch('/api/memos', {
      method: 'POST',
      body: JSON.stringify({ date: memoDate, category, content })
    });
    input.value = '';
    loadMemos();
  } catch (e) {
    console.error('メモ追加エラー:', e);
    alert('メモの追加に失敗しました');
  }
}

function editMemo(el, id) {
  const current = el.textContent;
  const input = document.createElement('input');
  input.type = 'text';
  input.value = current;
  input.className = 'memo-edit-input';
  
  async function save() {
    const newVal = input.value.trim();
    if (newVal && newVal !== current) {
      await authFetch(`/api/memos/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ content: newVal })
      });
    }
    loadMemos();
  }

  input.addEventListener('blur', save);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') { input.value = current; input.blur(); }
  });

  el.replaceWith(input);
  input.focus();
  input.select();
}

async function deleteMemo(id) {
  try {
    await authFetch(`/api/memos/${id}`, { method: 'DELETE' });
    loadMemos();
  } catch (e) {
    console.error('メモ削除エラー:', e);
  }
}
