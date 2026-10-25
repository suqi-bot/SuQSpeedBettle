import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';

function crc32(buf) {
  let c;
  let crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

function writePng(file, w, h, rgba) {
  const rows = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(1 + w * 4);
    row[0] = 0;
    rgba.copy(row, 1, y * w * 4, (y + 1) * w * 4);
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, png);
  console.log('wrote', file, `${w}x${h}`, png.length, 'bytes');
}

// 从 palette.ts 里解析色板，保证与实际量化表一致
const src = fs.readFileSync('src/game/palette.ts', 'utf8');
const colors = [...src.matchAll(/\[(\d+),\s*(\d+),\s*(\d+)\]/g)].map((m) => [
  Number(m[1]),
  Number(m[2]),
  Number(m[3]),
]);

const SCALE = 8;
const w = colors.length * SCALE;
const h = 16;
const buf = Buffer.alloc(w * h * 4);
for (let y = 0; y < h; y++) {
  for (let i = 0; i < colors.length; i++) {
    const [r, g, b] = colors[i];
    for (let sx = 0; sx < SCALE; sx++) {
      const o = (y * w + i * SCALE + sx) * 4;
      buf[o] = r;
      buf[o + 1] = g;
      buf[o + 2] = b;
      buf[o + 3] = 255;
    }
  }
}
writePng('public/art/palette.png', w, h, buf);
