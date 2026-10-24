/*
 * Content script: nhận lệnh từ popup, chạy job tải trong tab (popup đóng vẫn chạy tiếp),
 * hiện overlay tiến trình nhỏ ở góc màn hình, cuối cùng tải file .zip.
 */
(() => {
  if (window.__FBMD_LOADED__) return;
  window.__FBMD_LOADED__ = true;

  const CFG = FBMD_CONFIG;
  const job = { state: 'idle', threadId: null, threadName: null, fetched: 0, total: null, message: '', error: null };
  let threadsCache = [];
  let abortCtrl = null;

  // ---------- Overlay ----------
  const overlay = (() => {
    let host, root;
    function ensure() {
      if (host) return;
      host = document.createElement('div');
      host.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:2147483647;';
      root = host.attachShadow({ mode: 'open' });
      root.innerHTML = `
        <style>
          .box{font:13px/1.4 system-ui,'Segoe UI',sans-serif;color:#f5f3ff;width:280px;padding:14px 16px;border-radius:14px;
               background:rgba(24,20,38,.92);backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,.08);
               box-shadow:0 12px 40px rgba(0,0,0,.45)}
          .t{font-weight:600;margin-bottom:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
          .bar{height:6px;border-radius:99px;background:rgba(255,255,255,.1);overflow:hidden}
          .fill{height:100%;width:0;background:linear-gradient(90deg,#ff5fa2,#8b5cf6);transition:width .3s}
          .m{margin-top:8px;opacity:.75;font-size:12px}
          .err .fill{background:#ef4444}.done .fill{background:#22c55e}
          button{all:unset;cursor:pointer;float:right;opacity:.6}button:hover{opacity:1}
        </style>
        <div class="box"><button title="Ẩn">✕</button><div class="t"></div><div class="bar"><div class="fill"></div></div><div class="m"></div></div>`;
      root.querySelector('button').onclick = () => host.remove();
      document.documentElement.appendChild(host);
    }
    return {
      update() {
        ensure();
        if (!host.isConnected) document.documentElement.appendChild(host);
        const box = root.querySelector('.box');
        box.className = `box ${job.state === 'error' ? 'err' : job.state === 'done' ? 'done' : ''}`;
        root.querySelector('.t').textContent = `💌 ${job.threadName || ''}`;
        const pct = job.state === 'done' ? 100 : job.total ? Math.min(100, (job.fetched / job.total) * 100) : 5;
        root.querySelector('.fill').style.width = `${pct}%`;
        root.querySelector('.m').textContent = job.error || job.message;
      },
    };
  })();

  function setJob(patch) {
    Object.assign(job, patch);
    overlay.update();
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  // ---------- Job ----------
  async function runDownload(thread) {
    abortCtrl = new AbortController();
    setJob({
      state: 'running',
      threadId: thread.id,
      threadName: thread.name || thread.id,
      fetched: 0,
      total: thread.messageCount ?? null,
      message: 'Đang bắt đầu…',
      error: null,
    });
    try {
      const nodes = await FBApi.fetchAllMessages(thread.id, {
        signal: abortCtrl.signal,
        total: thread.messageCount ?? null,
        onProgress: ({ fetched, total }) =>
          setJob({ fetched, total: total ?? job.total, message: `Đã lấy ${fetched}${total ? ` / ${total}` : ''} tin nhắn…` }),
      });
      if (!nodes.length) {
        throw new Error('Không lấy được tin nhắn nào. Nếu đây là chat 1-1 đã bật mã hoá đầu-cuối (E2EE), API GraphQL không trả nội dung.');
      }
      setJob({ message: 'Đang tạo file…' });
      const { files, stats } = Exporter.buildExport({ thread, nodes, timeZone: CFG.timeZone, shortNames: CFG.shortNames });
      downloadBlob(new Blob([MiniZip.create(files)], { type: 'application/zip' }), Exporter.zipName(thread, CFG.timeZone));
      setJob({ state: 'done', fetched: stats.messages, message: `Xong! ${stats.messages} tin nhắn · ${stats.days} ngày.` });
    } catch (e) {
      const cancelled = e.name === 'AbortError';
      setJob({ state: cancelled ? 'cancelled' : 'error', error: cancelled ? 'Đã huỷ.' : e.message });
      console.error('[fb-msg-downloader]', e, e.details || '');
    } finally {
      abortCtrl = null;
    }
  }

  // ---------- Messaging ----------
  async function handle(msg) {
    switch (msg.type) {
      case 'ping':
        return { tokens: await FBApi.tokenStatus() };
      case 'status':
        return { job };
      case 'listThreads':
        if (!threadsCache.length || msg.refresh) threadsCache = await FBApi.listThreads();
        return { threads: threadsCache };
      case 'startDownload': {
        if (job.state === 'running') throw new Error('Đang có một lượt tải chạy, hãy đợi hoặc huỷ.');
        const known = threadsCache.find((t) => t.id === String(msg.threadId));
        runDownload(known || { id: String(msg.threadId), name: `Thread ${msg.threadId}`, participants: [] });
        return { job };
      }
      case 'cancel':
        abortCtrl?.abort();
        return { job };
      default:
        throw new Error(`Lệnh không hợp lệ: ${msg.type}`);
    }
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    handle(msg)
      .then((res) => sendResponse({ ok: true, ...res }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true; // giữ kênh mở cho phản hồi async
  });
})();
