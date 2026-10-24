/*
 * Cấu hình. doc_id lấy từ bundle loc.dev/messages-downloader (capture HAR 24/10/2026).
 * Khi Facebook đổi doc_id → tool báo lỗi GraphQL: mở DevTools > Network, lọc "graphqlbatch",
 * tìm request có query_params tương ứng rồi thay doc_id mới vào đây, Reload extension.
 */
var FBMD_CONFIG = {
  // Danh sách hội thoại: thử query legacy `q=viewer(){...}` trước, lỗi thì fallback doc_id này.
  threadListDocId: '1475048592613093',
  // Tin nhắn của 1 thread (graphqlbatch). Facebook giới hạn tối đa 499 tin / request.
  threadMessagesDocId: '1526314457427586',
  threadListPageSize: 500,
  messagesPageSize: 499,
  delayMs: 1200, // nghỉ giữa các batch để tránh rate-limit / checkpoint
  jitterMs: 800,
  maxRetries: 3,
  timeZone: 'Asia/Ho_Chi_Minh',
  shortNames: true, // "Phan Thành Công" -> "Công" trong file Markdown
};

if (typeof module !== 'undefined') module.exports = FBMD_CONFIG;
