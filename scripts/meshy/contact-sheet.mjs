#!/usr/bin/env node
// Contact sheet of images (e.g. Meshy preview thumbnails or QA renders) for side-by-side review.
//   node scripts/meshy/contact-sheet.mjs <out.png> [--cols 3] [--tile 420 | --tile 900x300] <image> <label> [<image> <label> ...]
import sharp from 'sharp';

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const rest = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
const [out, ...pairs] = rest;
if (!out || pairs.length < 2) {
  console.log('usage: contact-sheet.mjs <out.png> [--cols 3] [--tile 420] <image> <label> ...');
  process.exit(1);
}
const [TW, TH = TW] = String(opt('tile', 420)).split('x').map(Number);
const C = +opt('cols', 3);
const items = [];
for (let i = 0; i < pairs.length; i += 2) items.push({ file: pairs[i], label: pairs[i + 1] ?? '' });
const R = Math.ceil(items.length / C);
const esc = (s) => s.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c]);
const comps = [];
for (let i = 0; i < items.length; i++) {
  const x = (i % C) * TW, y = Math.floor(i / C) * (TH + 24);
  const img = await sharp(items[i].file).resize(TW, TH, { fit: 'contain', background: '#333' }).png().toBuffer();
  const svg = `<svg width="${TW}" height="24"><rect width="100%" height="100%" fill="#111"/><text x="5" y="17" font-size="15" fill="#eee" font-family="Arial">${esc(items[i].label)}</text></svg>`;
  comps.push({ input: Buffer.from(svg), left: x, top: y }, { input: img, left: x, top: y + 24 });
}
await sharp({ create: { width: C * TW, height: R * (TH + 24), channels: 3, background: '#000' } }).composite(comps).png().toFile(out);
console.log(`wrote ${out}`);
