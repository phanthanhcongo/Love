/* Popup: chỉ là UI điều khiển — mọi việc nặng chạy trong content script của tab Facebook. */
const CONTENT_FILES = ['config.js', 'lib/zip.js', 'lib/exporter.js', 'lib/fb-api.js', 'content.js'];
const FB_URL = /^https:\/\/www\.(facebook|messenger)\.com\//;

const $ = (s) => document.querySelector(s);
let tabId = null;
let threads = [];
let pollTimer = null;

function send(msg) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, msg, (res) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!res) return reject(new Error('Không có phản hồi từ trang.'));
      res.ok ? resolve(res) : reject(new Error(res.error));
    });
  });
}

/** Tab mở trước khi cài extension sẽ chưa có content script → inject thủ công. */
async function connect() {
  try {
    return await send({ type: 'ping' });
  } catch (_) {
    await chrome.scripting.executeScript({ target: { tabId }, files: CONTENT_FILES });
    return send({ type: 'ping' });
  }
}

function notice(text) {
  $('#notice').textContent = text;
  $('#notice').classList.toggle('hidden', !text);
}

// ---------- Threads ----------
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmtDate = (ts) => (ts ? new Date(ts).toLocaleDateString('vi-VN') : '');

function renderThreads() {
  const q = $('#q').value.trim().toLowerCase();
  const list = threads.filter((t) => !q || t.name.toLowerCase().includes(q) || t.id.includes(q));
  const ul = $('#threads');
  if (!list.length) {
    ul.innerHTML = `<li class="empty">${threads.length ? 'Không có kết quả' : 'Không có hội thoại nào'}</li>`;
    return;
  }
  ul.innerHTML = list
    .map(
      (t) => `
      <li class="thread ${t.type === 'group' ? 'group' : ''}">
        <div class="avatar">${esc((t.name[0] || '?').toUpperCase())}</div>
        <div class="meta">
          <div class="name" title="${esc(t.name)}">${esc(t.name)}</div>
          <div class="sub"><span class="tag">${t.type === 'group' ? 'Nhóm' : '1-1'}</span>${
            t.messageCount != null ? `${t.messageCount.toLocaleString('vi-VN')} tin` : ''
          }${t.updatedAt ? ` · ${fmtDate(t.updatedAt)}` : ''}</div>
        </div>
        <button class="btn sm" data-id="${esc(t.id)}" id="dl-${esc(t.id)}">Tải</button>
      </li>`,
    )
    .join('');
}

async function loadThreads(refresh = false) {
  $('#threads').innerHTML = '<li class="loading"><div class="spinner"></div>Đang lấy danh sách hội thoại…</li>';
  try {
    threads = (await send({ type: 'listThreads', refresh })).threads;
    renderThreads();
  } catch (e) {
    $('#threads').innerHTML = `<li class="empty">Lỗi: ${esc(e.message)}</li>`;
  }
}

// ---------- Job ----------
function renderJob(job) {
  const box = $('#job');
  if (!job || job.state === 'idle') return box.classList.add('hidden');
  box.classList.remove('hidden');
  box.className = `card job ${job.state}`;
  $('#job-title').textContent = job.threadName || job.threadId;
  const pct = job.state === 'done' ? 100 : job.total ? Math.min(100, (job.fetched / job.total) * 100) : 5;
  $('#job-bar').style.width = `${pct}%`;
  $('#job-msg').textContent = job.error || job.message;
  $('#btn-cancel').classList.toggle('hidden', job.state !== 'running');
  document.querySelectorAll('.thread .btn, #btn-manual').forEach((b) => (b.disabled = job.state === 'running'));
}

function startPolling() {
  clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    try {
      const { job } = await send({ type: 'status' });
      renderJob(job);
      if (job.state !== 'running') clearInterval(pollTimer);
    } catch (_) {
      clearInterval(pollTimer);
    }
  }, 700);
}

async function startDownload(threadId) {
  if (!threadId) return;
  try {
    const { job } = await send({ type: 'startDownload', threadId });
    renderJob(job);
    startPolling();
  } catch (e) {
    notice(e.message);
  }
}

// ---------- Init ----------
async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || !FB_URL.test(tab.url)) {
    $('#who').textContent = 'Chưa mở Facebook';
    return notice('Hãy mở tab www.facebook.com hoặc www.messenger.com (đã đăng nhập) rồi bấm lại icon extension.');
  }
  tabId = tab.id;

  let ping;
  try {
    ping = await connect();
  } catch (e) {
    $('#who').textContent = 'Lỗi kết nối';
    return notice(`Không kết nối được với trang: ${e.message}. Thử tải lại tab Facebook.`);
  }
  if (!ping.tokens.ok) {
    $('#who').textContent = 'Chưa sẵn sàng';
    return notice(ping.tokens.error);
  }
  $('#who').textContent = `Đã kết nối · UID ${ping.tokens.userId}`;
  $('#main').classList.remove('hidden');

  const { job } = await send({ type: 'status' });
  renderJob(job);
  if (job.state === 'running') startPolling();
  loadThreads();
}

$('#q').addEventListener('input', renderThreads);
$('#threads').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-id]');
  if (btn) startDownload(btn.dataset.id);
});
$('#btn-manual').addEventListener('click', () => startDownload($('#manual-id').value.trim()));
$('#btn-cancel').addEventListener('click', () => send({ type: 'cancel' }).catch(() => {}));
$('#btn-refresh').addEventListener('click', () => tabId && loadThreads(true));

init();
