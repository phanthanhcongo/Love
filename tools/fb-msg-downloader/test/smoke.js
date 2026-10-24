// Sinh zip mẫu để kiểm bằng Expand-Archive + parse cú pháp các file browser-only.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const MiniZip = require(path.join(root, 'lib/zip.js'));

const zip = MiniZip.create([
  { name: 'raw.json', data: '{"ok":true}' },
  { name: 'days/2026-10-03.md', data: '# 💬 Ngày 03/10/2026\n- cốc cốc' },
]);
const out = process.argv[2];
fs.writeFileSync(out, zip);
console.log('zip written', zip.length, 'bytes');

for (const f of ['lib/fb-api.js', 'content.js', 'popup.js', 'config.js']) {
  new Function(fs.readFileSync(path.join(root, f), 'utf8')); // ném SyntaxError nếu hỏng
  console.log('syntax ok', f);
}
JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
console.log('manifest ok');
