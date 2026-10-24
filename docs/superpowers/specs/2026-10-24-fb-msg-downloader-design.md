# FB Messenger Downloader — Design

## Mục tiêu
Chrome extension (MV3, JS thuần, không build) tải lịch sử 1 hội thoại Messenger bằng API GraphQL nội bộ của Facebook,
xuất `.zip` gồm `raw.json` + `index.md` + `days/YYYY-MM-DD.md` (cùng format thư mục `days/` của repo).

## Phạm vi / Giới hạn (đã chấp nhận)
- Chỉ dùng GraphQL (`/api/graphqlbatch/`). Chat 1-1 bật E2EE **không** lấy được nội dung → báo lỗi rõ ràng.
- Dữ liệu: text, thời gian chính xác (ms), sender, sticker/attachment URL, reply (nếu API trả về).
- Không tải file media về máy.
- `doc_id` nằm trong `config.js` để người dùng tự cập nhật khi Facebook đổi.

## Kiến trúc (`tools/fb-msg-downloader/`)
| File | Trách nhiệm |
|---|---|
| `manifest.json` | MV3, host `facebook.com`/`messenger.com`, `scripting` để inject lại |
| `config.js` | doc_id, page size, delay, timezone |
| `lib/fb-api.js` | Lấy token (`fb_dtsg`, `lsd`, `c_user`), gọi graphqlbatch, parse stream JSON, retry, phân trang |
| `lib/exporter.js` | Chuẩn hoá message, sinh JSON/Markdown (thuần, test bằng Node) |
| `lib/zip.js` | ZIP store-only tối giản (CRC32), test bằng Node |
| `content.js` | Nhận lệnh từ popup, chạy job tải nền trong tab, overlay tiến trình, trigger download |
| `popup.*` | UI: danh sách hội thoại, tìm kiếm, tải thêm, nhập ID thủ công, tiến trình, huỷ |

## Luồng
popup → ping/inject content script → `listThreads` → chọn thread → `startDownload` →
content script lặp `fetchThreadMessages(before=oldest_ts)` (dedupe theo `message_id`, delay + jitter) →
`Exporter.buildExport` → `MiniZip.create` → `<a download>`. Popup poll `status` mỗi 700ms.

## Lỗi
- HTTP/network: retry tối đa 3 lần, backoff mũ.
- GraphQL `errors` / không có `o0`: không retry, gợi ý cập nhật `doc_id`.
- 0 tin nhắn: báo khả năng E2EE.
- Huỷ: AbortController.

## Test
`node --test tools/fb-msg-downloader/test` cho exporter + zip. Phần API kiểm tra thủ công trên trình duyệt.
