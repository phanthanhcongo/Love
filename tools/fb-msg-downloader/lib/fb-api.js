/*
 * Gọi API GraphQL nội bộ Facebook bằng phiên đăng nhập của trình duyệt.
 * Chạy trong content script trên facebook.com / messenger.com (same-origin, cookie tự đính kèm).
 */
var FBApi = (() => {
  const CFG = FBMD_CONFIG;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  class FBError extends Error {
    constructor(message, { retryable = false, details = null } = {}) {
      super(message);
      this.name = 'FBError';
      this.retryable = retryable;
      this.details = details;
    }
  }

  // ---------- Token ----------
  let tokens = null;

  function scrapeTokens() {
    const html = document.documentElement.innerHTML;
    const pick = (patterns) => {
      for (const re of patterns) {
        const m = html.match(re);
        if (m) return m[1];
      }
      return null;
    };
    return {
      fb_dtsg: pick([
        /"DTSGInitialData",\[\],\{"token":"([^"]+)"/,
        /"DTSGInitData",\[\],\{"token":"([^"]+)"/,
        /name="fb_dtsg" value="([^"]+)"/,
        /"dtsg":\{"token":"([^"]+)"/,
      ]),
      lsd: pick([/"LSD",\[\],\{"token":"([^"]+)"/, /name="lsd" value="([^"]+)"/]),
      userId:
        (document.cookie.match(/(?:^|;\s*)c_user=(\d+)/) || [])[1] ||
        pick([/"USER_ID":"(\d+)"/, /"actorID":"(\d+)"/]),
    };
  }

  async function getTokens(force = false) {
    if (tokens && !force) return tokens;
    const t = scrapeTokens();
    if (!t.fb_dtsg) {
      // Fallback: endpoint trả token mới dạng for (;;);{"payload":{"token":"..."}}
      try {
        const res = await fetch(`${location.origin}/ajax/dtsg/?__a=1`, { credentials: 'include' });
        const json = JSON.parse((await res.text()).replace(/^for \(;;\);/, ''));
        t.fb_dtsg = json?.payload?.token || null;
      } catch (_) {
        /* bỏ qua, báo lỗi bên dưới */
      }
    }
    if (!t.userId) throw new FBError('Chưa đăng nhập Facebook (không thấy cookie c_user).');
    if (!t.fb_dtsg) throw new FBError('Không lấy được fb_dtsg. Hãy tải lại trang Facebook rồi thử lại.');
    tokens = t;
    return t;
  }

  // ---------- Parse ----------
  /** Response graphqlbatch là nhiều JSON nối nhau (+ tiền tố for (;;);). Tách theo độ sâu ngoặc. */
  function parseJsonStream(text) {
    text = text.replace(/^\s*for \(;;\);/, '');
    const out = [];
    let depth = 0;
    let start = -1;
    let inStr = false;
    let esc = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === '{') {
        if (depth === 0) start = i;
        depth++;
      } else if (c === '}') {
        depth--;
        if (depth === 0 && start >= 0) {
          try {
            out.push(JSON.parse(text.slice(start, i + 1)));
          } catch (_) {
            /* bỏ object hỏng */
          }
          start = -1;
        }
      }
    }
    return out;
  }

  // ---------- Request ----------
  async function post(path, fields) {
    const t = await getTokens();
    const body = new URLSearchParams({ ...fields, fb_dtsg: t.fb_dtsg, __user: t.userId, __a: '1' });
    if (t.lsd) body.set('lsd', t.lsd);

    let lastErr;
    for (let attempt = 0; attempt <= CFG.maxRetries; attempt++) {
      try {
        const res = await fetch(`${location.origin}${path}`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body,
        });
        if (!res.ok) throw new FBError(`HTTP ${res.status}`, { retryable: res.status >= 500 || res.status === 429 });
        const objs = parseJsonStream(await res.text());
        const top = objs.find((o) => o.error);
        if (top) {
          // 1357001/1357004: phiên hết hạn → lấy token mới rồi thử lại 1 lần
          if ([1357001, 1357004].includes(top.error) && attempt === 0) {
            await getTokens(true);
            body.set('fb_dtsg', tokens.fb_dtsg);
            throw new FBError('Token hết hạn', { retryable: true });
          }
          throw new FBError(`Facebook lỗi ${top.error}: ${top.errorSummary || top.errorDescription || ''}`, { details: top });
        }
        return objs;
      } catch (e) {
        lastErr = e;
        const retryable = e instanceof FBError ? e.retryable : true; // lỗi mạng → retry
        if (!retryable || attempt === CFG.maxRetries) break;
        await sleep(1500 * 2 ** attempt);
      }
    }
    throw lastErr;
  }

  async function batchQuery(docId, queryParams) {
    const objs = await post('/api/graphqlbatch/', {
      batch_name: 'MessengerGraphQLThreadFetcher',
      queries: JSON.stringify({ o0: { doc_id: docId, query_params: queryParams } }),
    });
    const o0 = objs.find((o) => o.o0)?.o0;
    if (!o0) throw new FBError('Response không có o0 — doc_id có thể đã hết hạn (xem config.js).', { details: objs });
    if (o0.errors?.length && !o0.data) {
      throw new FBError(`GraphQL lỗi: ${o0.errors[0].message || JSON.stringify(o0.errors[0])} — kiểm tra doc_id trong config.js.`, {
        details: o0.errors,
      });
    }
    return o0;
  }

  // ---------- Threads ----------
  function threadIdOf(n) {
    if (n.id) {
      try {
        const decoded = atob(n.id).split(':')[1];
        if (decoded) return decoded;
      } catch (_) {
        /* id không phải base64 */
      }
    }
    const k = n.thread_key || {};
    return n.thread_type === 'ONE_TO_ONE' ? k.other_user_id : k.thread_fbid || k.other_user_id;
  }

  function normalizeThread(n, selfId) {
    const participants = (n.all_participants?.nodes || []).map((p) => {
      const a = p.messaging_actor || p;
      return { id: String(a.id), name: a.name || 'Facebook User', shortName: a.short_name || null };
    });
    const nicknames = n.customization_info?.participant_customizations || [];
    for (const c of nicknames) {
      const p = participants.find((x) => x.id === String(c.participant_id));
      if (p && c.nickname) p.nickname = c.nickname;
    }
    const others = participants.filter((p) => p.id !== String(selfId));
    const isOneToOne = n.thread_type === 'ONE_TO_ONE' || (!n.thread_key?.thread_fbid && n.thread_key?.other_user_id);
    return {
      id: String(threadIdOf(n)),
      type: isOneToOne ? '1:1' : 'group',
      name: n.name || others.map((p) => p.name).join(', ') || participants.map((p) => p.name).join(', ') || 'Không tên',
      messageCount: n.messages_count ?? null,
      updatedAt: Number(n.updated_time_precise) || null,
      participants,
    };
  }

  /** Cách 1 (giống L.O.C): query legacy `q=`, trả hết trong 1 lần. */
  async function listThreadsLegacy(selfId) {
    const objs = await post('/api/graphql/', {
      q:
        'viewer(){message_threads{count,nodes{customization_info{emoji,outgoing_bubble_color,' +
        'participant_customizations{participant_id,nickname}},all_participants{nodes{messaging_actor' +
        '{name,id,profile_picture}}},thread_type,name,messages_count,image,id}}}',
    });
    const nodes = objs.find((o) => o.viewer)?.viewer?.message_threads?.nodes;
    if (!nodes?.length) throw new FBError('legacy query rỗng');
    return nodes.map((n) => normalizeThread(n, selfId));
  }

  /** Cách 2: graphqlbatch, phân trang theo updated_time_precise. */
  async function listThreadsBatch(selfId, onProgress) {
    const all = new Map();
    let before = Date.now();
    for (let page = 0; page < 50; page++) {
      const o0 = await batchQuery(CFG.threadListDocId, {
        limit: CFG.threadListPageSize,
        before,
        tags: ['INBOX'],
        includeDeliveryReceipts: true,
        includeSeqID: false,
      });
      const nodes = o0.data?.viewer?.message_threads?.nodes || [];
      for (const n of nodes) {
        const t = normalizeThread(n, selfId);
        if (t.id) all.set(t.id, t);
      }
      onProgress?.(all.size);
      if (nodes.length <= 1) break;
      const next = Number(nodes[nodes.length - 1].updated_time_precise);
      if (!next || next >= before) break;
      before = next;
      await sleep(CFG.delayMs);
    }
    return [...all.values()];
  }

  async function listThreads(onProgress) {
    const { userId } = await getTokens();
    let threads;
    try {
      threads = await listThreadsLegacy(userId);
    } catch (_) {
      threads = await listThreadsBatch(userId, onProgress);
    }
    return threads.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  // ---------- Messages ----------
  /**
   * Lấy toàn bộ tin nhắn 1 thread, lùi dần theo thời gian (before = timestamp tin cũ nhất).
   * @returns {Promise<object[]>} node GraphQL thô, chưa sắp xếp
   */
  async function fetchAllMessages(threadId, { signal, onProgress, total } = {}) {
    const seen = new Map();
    let before = Date.now();
    for (let page = 0; ; page++) {
      if (signal?.aborted) throw new DOMException('Đã huỷ', 'AbortError');
      const o0 = await batchQuery(CFG.threadMessagesDocId, {
        id: String(threadId),
        message_limit: CFG.messagesPageSize,
        load_messages: true,
        load_read_receipts: true,
        before,
      });
      const thread = o0.data?.message_thread;
      if (!thread) {
        if (page === 0) throw new FBError('Không tìm thấy hội thoại (ID sai, hoặc chat 1-1 đã bật mã hoá đầu-cuối).');
        break;
      }
      const msgs = thread.messages || {};
      const nodes = msgs.nodes || [];
      let added = 0;
      for (const n of nodes) {
        const id = n.message_id || `${n.timestamp_precise}-${n.message_sender?.id}`;
        if (!seen.has(id)) {
          seen.set(id, n);
          added++;
        }
      }
      onProgress?.({ fetched: seen.size, total: total ?? thread.messages_count ?? null, page });

      const oldest = nodes.length ? Number(nodes[0].timestamp_precise) : NaN;
      if (!msgs.page_info?.has_previous_page || added === 0 || !oldest || oldest >= before) break;
      before = oldest;
      await sleep(CFG.delayMs + Math.random() * CFG.jitterMs);
    }
    return [...seen.values()];
  }

  async function tokenStatus() {
    try {
      const t = await getTokens();
      return { ok: true, userId: t.userId };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  return { getTokens, tokenStatus, listThreads, fetchAllMessages, parseJsonStream, FBError };
})();
