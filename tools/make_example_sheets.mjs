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

const COL = {
  rust: [168, 85, 43, 255],
  rustDark: [122, 58, 34, 255],
  rustLight: [217, 124, 58, 255],
  dark: [18, 23, 28, 255],
  iron: [74, 78, 82, 255],
  eye: [191, 233, 227, 255],
};

function rect(buf, bw, bh, x, y, w, h, c) {
  for (let j = y; j < y + h; j++) {
    for (let i = x; i < x + w; i++) {
      if (i < 0 || j < 0 || i >= bw || j >= bh) continue;
      const o = (j * bw + i) * 4;
      buf[o] = c[0];
      buf[o + 1] = c[1];
      buf[o + 2] = c[2];
      buf[o + 3] = c[3];
    }
  }
}

/** 画一只 4 方向 × 2 帧的锈壳鼠（32×24 单元，脚底贴到单元底边） */
function drawRat(buf, bw, bh, dir, frame) {
  const oy = 6; // 把内容下移，避免精灵悬空
  const bob = frame === 0 ? 0 : 1;
  if (dir === 0 || dir === 2) {
    // 正面 / 背面
    rect(buf, bw, bh, 10, oy + 8 + bob, 12, 7, COL.rustDark);
    rect(buf, bw, bh, 11, oy + 6 + bob, 10, 4, COL.rust);
    rect(buf, bw, bh, 12, oy + 5 + bob, 8, 2, COL.rustLight);
    if (dir === 0) {
      rect(buf, bw, bh, 12, oy + 8 + bob, 2, 2, COL.eye);
      rect(buf, bw, bh, 18, oy + 8 + bob, 2, 2, COL.eye);
    } else {
      // 背面：大尾巴 + 背脊高光，明显区别于正面
      rect(buf, bw, bh, 15, oy + 12, 2, 8, COL.rustDark);
      rect(buf, bw, bh, 14, oy + 3, 4, 2, COL.rustLight);
    }
    // 耳朵
    rect(buf, bw, bh, 10, oy + 4 + bob, 3, 3, COL.rust);
    rect(buf, bw, bh, 19, oy + 4 + bob, 3, 3, COL.rust);
    // 腿
    const off = frame === 0 ? 0 : 1;
    rect(buf, bw, bh, 11 + off, oy + 15, 3, 3, COL.dark);
    rect(buf, bw, bh, 18 - off, oy + 15, 3, 3, COL.dark);
  } else {
    // 侧面（朝右）
    rect(buf, bw, bh, 8, oy + 9 + bob, 15, 6, COL.rustDark);
    rect(buf, bw, bh, 9, oy + 7 + bob, 12, 3, COL.rust);
    rect(buf, bw, bh, 9, oy + 6 + bob, 9, 2, COL.rustLight);
    // 头
    rect(buf, bw, bh, 21, oy + 8 + bob, 5, 5, COL.rust);
    rect(buf, bw, bh, 25, oy + 9 + bob, 2, 3, COL.rustDark);
    rect(buf, bw, bh, 23, oy + 9 + bob, 2, 2, COL.eye);
    // 尾巴
    const tw = frame === 0 ? 4 : 6;
    rect(buf, bw, bh, 8 - tw, oy + 10 + bob, tw, 2, COL.rustDark);
    // 腿
    const off = frame === 0 ? 0 : 2;
    rect(buf, bw, bh, 11 + off, oy + 14, 3, 4, COL.dark);
    rect(buf, bw, bh, 18, oy + 14 + (frame === 0 ? 1 : 0), 3, 4, COL.dark);
  }
}

function mirror(cell, w, h) {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < Math.floor(w / 2); x++) {
      const a = (y * w + x) * 4;
      const b = (y * w + (w - 1 - x)) * 4;
      for (let k = 0; k < 4; k++) {
        const t = cell[a + k];
        cell[a + k] = cell[b + k];
        cell[b + k] = t;
      }
    }
  }
}

/** 泵工：4 方向 × 2 帧，24×40 单元 */
function drawPump(buf, bw, bh, dir, frame) {
  const off = frame === 0 ? 0 : 1;
  if (dir === 0) {
    // 正面
    rect(buf, bw, bh, 7, 31, 4, 8, COL.dark);
    rect(buf, bw, bh, 13, 31, 4, 8, COL.dark);
    rect(buf, bw, bh, 6, 38, 6, 2, COL.iron);
    rect(buf, bw, bh, 12, 38, 6, 2, COL.iron);
    rect(buf, bw, bh, 5, 14, 14, 17, COL.iron);
    rect(buf, bw, bh, 7, 16, 10, 6, COL.rust);
    rect(buf, bw, bh, 16, 15, 5, 9, [31, 58, 61, 255]);
    rect(buf, bw, bh, 17, 16, 3, 7, [73, 198, 192, 255]);
    rect(buf, bw, bh, 2, 17, 4, 10, COL.iron);
    rect(buf, bw, bh, 18, 20, 4, 10, COL.iron);
    rect(buf, bw, bh, 7, 5, 10, 9, COL.rustDark);
    rect(buf, bw, bh, 8, 7, 8, 3, [191, 233, 227, 255]);
    rect(buf, bw, bh, 9, 8, 6, 1, [73, 198, 192, 255]);
    rect(buf, bw, bh, 19, 28, 2, 9, [143, 149, 150, 255]);
    rect(buf, bw, bh, 17, 35, 6, 3, [143, 149, 150, 255]);
  } else if (dir === 2) {
    // 背面：大气罐
    rect(buf, bw, bh, 7, 31, 4, 8, COL.dark);
    rect(buf, bw, bh, 13, 31, 4, 8, COL.dark);
    rect(buf, bw, bh, 5, 14, 14, 17, COL.iron);
    rect(buf, bw, bh, 8, 13, 8, 13, [31, 58, 61, 255]);
    rect(buf, bw, bh, 9, 14, 6, 10, [43, 143, 138, 255]);
    rect(buf, bw, bh, 2, 17, 4, 10, COL.iron);
    rect(buf, bw, bh, 18, 17, 4, 10, COL.iron);
    rect(buf, bw, bh, 7, 5, 10, 9, COL.rustDark);
  } else {
    // 侧面（朝右）
    rect(buf, bw, bh, 8 + off, 31, 3, 8, COL.dark);
    rect(buf, bw, bh, 14, 31 + off, 3, 8, COL.dark);
    rect(buf, bw, bh, 6, 14, 12, 17, COL.iron);
    rect(buf, bw, bh, 7, 16, 6, 6, COL.rust);
    rect(buf, bw, bh, 3, 15, 5, 10, [31, 58, 61, 255]);
    rect(buf, bw, bh, 4, 16, 3, 8, [73, 198, 192, 255]);
    rect(buf, bw, bh, 12, 17, 3, 10, COL.iron);
    rect(buf, bw, bh, 13, 5, 8, 9, COL.rustDark);
    rect(buf, bw, bh, 16, 7, 5, 3, [191, 233, 227, 255]);
    rect(buf, bw, bh, 17, 28, 2, 9, [143, 149, 150, 255]);
    rect(buf, bw, bh, 15, 35, 6, 3, [143, 149, 150, 255]);
  }
}

function makePumpSheet() {
  const cw = 24;
  const ch = 40;
  const dirs = 4;
  const frames = 2;
  const w = cw * frames;
  const h = ch * dirs;
  const buf = Buffer.alloc(w * h * 4);
  for (let d = 0; d < dirs; d++) {
    for (let f = 0; f < frames; f++) {
      const cell = Buffer.alloc(cw * ch * 4);
      if (d === 3) {
        drawPump(cell, cw, ch, 1, f);
        mirror(cell, cw, ch);
      } else {
        drawPump(cell, cw, ch, d, f);
      }
      for (let y = 0; y < ch; y++) {
        const src = y * cw * 4;
        const dst = ((d * ch + y) * w + f * cw) * 4;
        cell.copy(buf, dst, src, src + cw * 4);
      }
    }
  }
  writePng('public/art/sprites/_example_pump_sheet.png', w, h, buf);
}

function makeRatSheet() {
  const cw = 32;
  const ch = 24;
  const dirs = 4;
  const frames = 2;
  const w = cw * frames;
  const h = ch * dirs;
  const buf = Buffer.alloc(w * h * 4);
  for (let d = 0; d < dirs; d++) {
    for (let f = 0; f < frames; f++) {
      const cell = Buffer.alloc(cw * ch * 4);
      if (d === 3) {
        drawRat(cell, cw, ch, 1, f);
        mirror(cell, cw, ch);
      } else {
        drawRat(cell, cw, ch, d, f);
      }
      for (let y = 0; y < ch; y++) {
        const src = y * cw * 4;
        const dst = ((d * ch + y) * w + f * cw) * 4;
        cell.copy(buf, dst, src, src + cw * 4);
      }
    }
  }
  writePng('public/art/sprites/_example_rat_sheet.png', w, h, buf);
}

/** 画一把 4 帧的手枪（128×96 单元，横向排列）：0 待机，1–3 后坐 */
function makeSidearmSheet() {
  const cw = 128;
  const ch = 96;
  const frames = 4;
  const w = cw * frames;
  const h = ch;
  const buf = Buffer.alloc(w * h * 4);
  const shifts = [0, -3, -6, -3];
  for (let f = 0; f < frames; f++) {
    const cell = Buffer.alloc(cw * ch * 4);
    const s = shifts[f];
    // 手
    rect(cell, cw, ch, 84, 66, 26, 30, [42, 47, 53, 255]);
    rect(cell, cw, ch, 86, 68, 22, 12, [59, 66, 73, 255]);
    rect(cell, cw, ch, 88, 72, 18, 4, COL.rustDark);
    // 枪身
    rect(cell, cw, ch, 52, 44 + s, 46, 14, COL.iron);
    rect(cell, cw, ch, 54, 40 + s, 40, 5, [143, 149, 150, 255]);
    rect(cell, cw, ch, 92, 46 + s, 12, 8, COL.dark);
    // 握把
    rect(cell, cw, ch, 58, 58 + s, 14, 22, COL.iron);
    rect(cell, cw, ch, 58, 58 + s, 14, 6, COL.rust);
    rect(cell, cw, ch, 60, 64 + s, 10, 14, [35, 40, 46, 255]);
    // 准星
    rect(cell, cw, ch, 50, 50 + s, 4, 4, [73, 198, 192, 255]);
    for (let y = 0; y < ch; y++) {
      const src = y * cw * 4;
      const dst = (y * w + f * cw) * 4;
      cell.copy(buf, dst, src, src + cw * 4);
    }
  }
  writePng('public/art/weapons/_example_sidearm_sheet.png', w, h, buf);
}

makeRatSheet();
makePumpSheet();
makeSidearmSheet();
