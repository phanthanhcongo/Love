// Chạy: bun test tools/fb-msg-downloader/test
const { test, expect } = require('bun:test');
const Exporter = require('../lib/exporter.js');
const MiniZip = require('../lib/zip.js');

const thread = {
  id: '100001',
  name: 'Giang Nguyễn',
  type: '1:1',
  participants: [
    { id: '1', name: 'Phan Thành Công' },
    { id: '2', name: 'Nguyễn Hương Giang' },
  ],
};

// 2026-10-03 23:57:40 +07:00 = 16:57:40Z
const T0 = Date.UTC(2026, 9, 3, 16, 57, 40);
const nodes = [
  { __typename: 'UserMessage', message_id: 'm3', message_sender: { id: '2' }, timestamp_precise: String(T0 + 60_000), message: { text: 'Dạ chưa' },
    replied_to_message: { message: { message_id: 'm2', message_sender: { id: '1' }, message: { text: 'cốc cốc' } } } },
  { __typename: 'UserMessage', message_id: 'm1', message_sender: { id: '1' }, timestamp_precise: String(T0), message: { text: null },
    sticker: { id: 's1', url: 'https://x/s.png', label: 'hi' } },
  { __typename: 'UserMessage', message_id: 'm2', message_sender: { id: '1' }, timestamp_precise: String(T0 + 15_000), message: { text: 'cốc cốc\nsốp ngủ chưa ta😗' } },
  { __typename: 'UserMessage', message_id: 'm4', message_sender: { id: '2' }, timestamp_precise: String(T0 + 3 * 3600_000), message: { text: '' },
    blob_attachments: [{ __typename: 'MessageImage', large_preview: { uri: 'https://x/a.jpg' } }] },
  { __typename: 'GenericAdminTextMessage', message_id: 'm5', message_sender: { id: '2' }, timestamp_precise: String(T0 + 3 * 3600_000 + 1), snippet: 'Giang đã đổi chủ đề.' },
];

test('buildExport tạo raw.json, index.md và file theo ngày (theo giờ VN)', () => {
  const { files, stats } = Exporter.buildExport({ thread, nodes, exportedAt: T0 });
  expect(files.map((f) => f.name)).toEqual(['raw.json', 'index.md', 'days/2026-10-03.md', 'days/2026-10-04.md']);
  expect(stats).toEqual({ messages: 5, days: 2 });

  const raw = JSON.parse(files[0].data);
  expect(raw.messages.map((m) => m.id)).toEqual(['m1', 'm2', 'm3', 'm4', 'm5']);
  expect(raw.messages[0].sender).toBe('Phan Thành Công');
  expect(raw.messages[4].kind).toBe('event');
});

test('Markdown ngày đúng format thư mục days/', () => {
  const { files } = Exporter.buildExport({ thread, nodes, exportedAt: T0 });
  const day1 = files[2].data;
  expect(day1).toContain('# 💬 Lịch sử trò chuyện - Ngày 03/10/2026');
  expect(day1).toContain('> 📅 **Thứ**: Thứ Bảy  ');
  expect(day1).toContain('> 📊 **Thống kê**: 3 tin nhắn (Công: 2 | Giang: 1)  ');
  expect(day1).toContain('- **[23:57:40] Công**: [Sticker](https://x/s.png)');
  expect(day1).toContain('- **[23:57:55] Công**: cốc cốc  \n  > sốp ngủ chưa ta😗');
  expect(day1).toContain('↪️ _Trả lời Công: "cốc cốc"_');
  expect(day1).toContain('[Ngày 04/10/2026 ➡️](2026-10-04.md)');

  const day2 = files[3].data;
  expect(day2).toContain('- **[02:57:40] Giang**: [Ảnh](https://x/a.jpg)');
  expect(day2).toContain('_Giang đã đổi chủ đề._');
  expect(day2).toContain('[⬅️ Ngày 03/10/2026](2026-10-03.md)');
});

test('zipName bỏ dấu tiếng Việt', () => {
  expect(Exporter.zipName(thread, 'Asia/Ho_Chi_Minh', T0)).toBe('messenger-giang-nguyen-2026-10-03.zip');
});

test('MiniZip: CRC32 chuẩn và cấu trúc ZIP hợp lệ', () => {
  expect(MiniZip.crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  const zip = MiniZip.create([{ name: 'a.txt', data: 'xin chào' }, { name: 'days/b.md', data: '# hi' }]);
  const v = new DataView(zip.buffer);
  expect(v.getUint32(0, true)).toBe(0x04034b50);
  const end = zip.length - 22;
  expect(v.getUint32(end, true)).toBe(0x06054b50);
  expect(v.getUint16(end + 10, true)).toBe(2);
});
