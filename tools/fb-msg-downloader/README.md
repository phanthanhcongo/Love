# Messenger Downloader (GraphQL)

Chrome extension tải lịch sử 1 hội thoại Messenger → `.zip` gồm:

```
raw.json              toàn bộ tin nhắn đã chuẩn hoá (id, ts, sender, text, sticker, attachments, replyTo, reactions)
index.md              mục lục + thống kê
days/YYYY-MM-DD.md    hội thoại theo ngày, cùng format thư mục days/ của repo
```

## Cài đặt
1. Mở `chrome://extensions` → bật **Developer mode**.
2. **Load unpacked** → chọn thư mục `tools/fb-msg-downloader`.
3. Mở `https://www.facebook.com` (đã đăng nhập) → bấm icon extension.

## Cơ chế (giống L.O.C — đối chiếu từ bundle loc.dev trong HAR)
- Chạy trong tab facebook.com nên dùng luôn cookie phiên; lấy `fb_dtsg`/`lsd` từ HTML trang.
- Danh sách hội thoại: `POST /api/graphql/` với query legacy `q=viewer(){message_threads{...}}`,
  lỗi thì fallback `graphqlbatch` doc_id `1475048592613093`.
- Tin nhắn: `POST /api/graphqlbatch/` doc_id `1526314457427586`,
  `{id, message_limit: 499, before}` → lùi dần theo `timestamp_precise` của tin cũ nhất
  tới khi `page_info.has_previous_page = false`. Nghỉ 1.2–2s giữa các batch.
- Mọi xử lý + nén zip làm ngay trong trình duyệt, không gửi dữ liệu đi đâu.

## Giới hạn
- **Chat 1-1 đã bật mã hoá đầu-cuối (E2EE)**: GraphQL không trả nội dung → tool báo lỗi.
- Facebook đổi `doc_id` định kỳ. Khi hỏng: DevTools → Network → lọc `graphqlbatch` → copy doc_id mới
  vào [config.js](config.js) → Reload extension.
- Chỉ lưu URL ảnh/sticker (link fbcdn có hạn dùng), không tải file media.

## Test
```
bun test tools/fb-msg-downloader/test
```
