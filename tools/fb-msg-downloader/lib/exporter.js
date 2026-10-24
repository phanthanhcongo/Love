/*
 * Chuẩn hoá node GraphQL → message gọn, rồi sinh raw.json + index.md + days/YYYY-MM-DD.md.
 * Không đụng DOM/chrome API để có thể test bằng Node.
 */
var Exporter = (() => {
  const WEEKDAYS = { Sun: 'Chủ Nhật', Mon: 'Thứ Hai', Tue: 'Thứ Ba', Wed: 'Thứ Tư', Thu: 'Thứ Năm', Fri: 'Thứ Sáu', Sat: 'Thứ Bảy' };
  const ATTACH_LABEL = { image: 'Ảnh', gif: 'GIF', video: 'Video', audio: 'Ghi âm', file: 'File', link: 'Link', other: 'Đính kèm' };

  // ---------- Thời gian ----------
  const fmtCache = new Map();
  function dateParts(ts, timeZone) {
    let f = fmtCache.get(timeZone);
    if (!f) {
      f = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        weekday: 'short',
        hourCycle: 'h23',
      });
      fmtCache.set(timeZone, f);
    }
    const p = Object.fromEntries(f.formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
    return { y: p.year, m: p.month, d: p.day, hh: p.hour === '24' ? '00' : p.hour, mm: p.minute, ss: p.second, weekday: WEEKDAYS[p.weekday] };
  }
  const vnDate = (p) => `${p.d}/${p.m}/${p.y}`;
  const isoDate = (p) => `${p.y}-${p.m}-${p.d}`;

  // ---------- Tên ----------
  function buildNames(participants, shortNames) {
    const full = new Map();
    const short = new Map();
    const lastWord = (s) => String(s).trim().split(/\s+/).pop();
    for (const p of participants) full.set(String(p.id), p.name || String(p.id));
    const candidate = (p) => p.shortName || lastWord(p.name || p.id);
    const counts = {};
    for (const p of participants) counts[candidate(p)] = (counts[candidate(p)] || 0) + 1;
    for (const p of participants) {
      const c = candidate(p);
      short.set(String(p.id), shortNames && counts[c] === 1 ? c : full.get(String(p.id)));
    }
    const fallback = (id) => (id ? `User ${id}` : 'Hệ thống');
    return {
      full: (id) => full.get(String(id)) || fallback(id),
      display: (id) => short.get(String(id)) || fallback(id),
    };
  }

  // ---------- Chuẩn hoá ----------
  function attachmentOf(b) {
    const name = b.filename || null;
    switch (b.__typename) {
      case 'MessageImage':
        return { type: 'image', url: b.large_preview?.uri || b.preview?.uri || b.thumbnail?.uri || null, name };
      case 'MessageAnimatedImage':
        return { type: 'gif', url: b.animated_image?.uri || b.preview_image?.uri || null, name };
      case 'MessageVideo':
        return { type: 'video', url: b.playable_url || b.large_image?.uri || null, name };
      case 'MessageAudio':
        return { type: 'audio', url: b.playable_url || null, name };
      case 'MessageFile':
        return { type: 'file', url: b.url || null, name };
      default:
        return { type: 'other', url: b.url || b.playable_url || b.preview?.uri || null, name: name || b.__typename || null };
    }
  }

  function normalizeMessage(n) {
    const isUser = !n.__typename || n.__typename === 'UserMessage';
    const attachments = (n.blob_attachments || []).map(attachmentOf);
    const story = n.extensible_attachment?.story_attachment;
    if (story) {
      attachments.push({
        type: 'link',
        url: story.url || story.media?.image?.uri || null,
        name: story.title_with_entities?.text || story.description?.text || null,
      });
    }
    const r = n.replied_to_message?.message;
    return {
      id: n.message_id || null,
      ts: Number(n.timestamp_precise) || null,
      senderId: n.message_sender?.id ? String(n.message_sender.id) : null,
      kind: isUser ? 'message' : 'event',
      eventType: isUser ? null : n.__typename,
      text: (isUser ? n.message?.text : n.snippet) || null,
      sticker: n.sticker ? { id: n.sticker.id || null, url: n.sticker.url || null, label: n.sticker.label || null } : null,
      attachments,
      replyTo: r ? { id: r.message_id || null, senderId: r.message_sender?.id ? String(r.message_sender.id) : null, text: r.message?.text || null } : null,
      reactions: (n.message_reactions || []).map((x) => ({ reaction: x.reaction, userId: x.user?.id ? String(x.user.id) : null })),
    };
  }

  // ---------- Markdown ----------
  const truncate = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

  function renderMessage(m, p, names) {
    const parts = [];
    if (m.text) parts.push(m.kind === 'event' ? `_${m.text}_` : m.text);
    if (m.sticker) parts.push(`[Sticker](${m.sticker.url || ''})`);
    for (const a of m.attachments) {
      const label = a.type === 'file' || a.type === 'link' ? `${ATTACH_LABEL[a.type]}${a.name ? `: ${a.name}` : ''}` : ATTACH_LABEL[a.type];
      parts.push(`[${label.replace(/[[\]]/g, '')}](${a.url || ''})`);
    }
    if (!parts.length) parts.push('_(không có nội dung)_');

    const lines = parts.join(' ').split(/\r?\n/);
    let out = `- **[${p.hh}:${p.mm}:${p.ss}] ${names.display(m.senderId)}**: ${lines[0]}`;
    if (lines.length > 1) out += '  ' + lines.slice(1).map((l) => `\n  > ${l}`).join('');
    if (m.replyTo) {
      const who = m.replyTo.senderId ? names.display(m.replyTo.senderId) : '?';
      const txt = m.replyTo.text ? `"${truncate(m.replyTo.text.replace(/\s+/g, ' '), 80)}"` : '(tin nhắn)';
      out += `\n  ↪️ _Trả lời ${who}: ${txt}_`;
    }
    return out;
  }

  function countBySender(messages, names) {
    const counts = new Map();
    for (const m of messages) {
      const k = names.display(m.senderId);
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    return [...counts].map(([k, v]) => `${k}: ${v}`).join(' | ');
  }

  function navLine(days, i) {
    const items = [];
    if (i > 0) items.push(`[⬅️ Ngày ${days[i - 1].label}](${days[i - 1].key}.md)`);
    items.push('[🏠 Mục lục](../index.md)');
    if (i < days.length - 1) items.push(`[Ngày ${days[i + 1].label} ➡️](${days[i + 1].key}.md)`);
    return `🧭 **Điều hướng**: ${items.join(' | ')}`;
  }

  function renderDay(days, i, names) {
    const day = days[i];
    const nav = navLine(days, i);
    return [
      `# 💬 Lịch sử trò chuyện - Ngày ${day.label}`,
      '',
      `> 📅 **Thứ**: ${day.weekday}  `,
      `> 📊 **Thống kê**: ${day.messages.length} tin nhắn (${countBySender(day.messages, names)})  `,
      '> ',
      `> ${nav}`,
      '',
      '---',
      '',
      '### Danh sách tin nhắn',
      '',
      ...day.messages.map((m) => renderMessage(m, m._p, names)),
      '',
      '---',
      '',
      nav,
      '',
    ].join('\n');
  }

  function renderIndex(thread, messages, days, names, exportedAt, timeZone) {
    const first = days[0];
    const last = days[days.length - 1];
    const ex = dateParts(exportedAt, timeZone);
    return [
      `# 💬 ${thread.name || thread.id}`,
      '',
      `> 👥 **Thành viên**: ${(thread.participants || []).map((p) => p.name).join(', ') || '—'}  `,
      `> 📊 **Tổng**: ${messages.length} tin nhắn trong ${days.length} ngày (${countBySender(messages, names)})  `,
      `> 🗓️ **Khoảng thời gian**: ${first ? first.label : '—'} → ${last ? last.label : '—'}  `,
      `> 🕒 **Xuất lúc**: ${ex.hh}:${ex.mm} ${vnDate(ex)} (${timeZone})`,
      '',
      '---',
      '',
      '| Ngày | Thứ | Số tin |',
      '|---|---|---|',
      ...days.map((d) => `| [${d.label}](days/${d.key}.md) | ${d.weekday} | ${d.messages.length} |`),
      '',
    ].join('\n');
  }

  // ---------- Public ----------
  /**
   * @param {{thread: object, nodes: object[], timeZone?: string, shortNames?: boolean, exportedAt?: number}} opts
   * @returns {{files: {name: string, data: string}[], stats: {messages: number, days: number}}}
   */
  function buildExport({ thread, nodes, timeZone = 'Asia/Ho_Chi_Minh', shortNames = true, exportedAt = Date.now() }) {
    const participants = [...(thread.participants || [])];
    const messages = nodes
      .map(normalizeMessage)
      .filter((m) => m.ts)
      .sort((a, b) => a.ts - b.ts);

    // Sender không có trong danh sách participants (đã rời nhóm…) vẫn cần tên dự phòng.
    for (const m of messages) {
      if (m.senderId && !participants.some((p) => String(p.id) === m.senderId)) {
        participants.push({ id: m.senderId, name: `User ${m.senderId}` });
      }
    }
    const names = buildNames(participants, shortNames);

    const byDay = new Map();
    for (const m of messages) {
      const p = dateParts(m.ts, timeZone);
      const key = isoDate(p);
      if (!byDay.has(key)) byDay.set(key, { key, label: vnDate(p), weekday: p.weekday, messages: [] });
      byDay.get(key).messages.push(Object.assign(m, { _p: p }));
    }
    const days = [...byDay.values()];

    const raw = {
      exportedAt: new Date(exportedAt).toISOString(),
      tool: 'fb-msg-downloader',
      timeZone,
      thread: { id: thread.id, name: thread.name || null, type: thread.type || null, participants },
      messageCount: messages.length,
      messages: messages.map(({ _p, ...m }) => ({ ...m, sender: names.full(m.senderId), iso: new Date(m.ts).toISOString() })),
    };

    const files = [
      { name: 'raw.json', data: JSON.stringify(raw, null, 2) },
      { name: 'index.md', data: renderIndex(thread, messages, days, names, exportedAt, timeZone) },
      ...days.map((d, i) => ({ name: `days/${d.key}.md`, data: renderDay(days, i, names) })),
    ];
    return { files, stats: { messages: messages.length, days: days.length } };
  }

  function slugify(s) {
    return (
      String(s)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[đĐ]/g, 'd')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'thread'
    );
  }

  function zipName(thread, timeZone = 'Asia/Ho_Chi_Minh', now = Date.now()) {
    return `messenger-${slugify(thread.name || thread.id)}-${isoDate(dateParts(now, timeZone))}.zip`;
  }

  return { buildExport, normalizeMessage, zipName, slugify, dateParts };
})();

if (typeof module !== 'undefined') module.exports = Exporter;
