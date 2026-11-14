#!/usr/bin/env node
'use strict';
// Draws icon.png (512 x 512): the board's three lights, gold, blue and green, on its dark tile, as the page header shows
// them. No dependencies: a small PNG writer over zlib. Usage: node scripts/make-icon.js [out.png]
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const SIZE = 512, SS = 4; // 4 x 4 samples per pixel for smooth edges
const out = path.resolve(process.argv[2] || path.join(__dirname, '..', 'icon.png'));

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const TILE_TOP = hex('#161c28'), TILE_BOTTOM = hex('#0b0e14'), RADIUS = 112;
const LIGHTS = [{ x: 140, c: hex('#f4c34f'), glow: 0.55 }, { x: 256, c: hex('#5b9cf8'), glow: 0.3 }, { x: 372, c: hex('#3ccf8e'), glow: 0.3 }];
const DOT = 50, Y = 256;

function insideTile(x, y) { // a rounded square
  const r = RADIUS, cx = Math.min(Math.max(x, r), SIZE - r), cy = Math.min(Math.max(y, r), SIZE - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}
function sample(x, y) { // one sample: [r, g, b, a] in 0..1
  if (!insideTile(x, y)) return [0, 0, 0, 0];
  const t = y / SIZE; let col = TILE_TOP.map((v, i) => (v * (1 - t) + TILE_BOTTOM[i] * t) / 255);
  for (const L of LIGHTS) { // soft glow first, then the dot
    const d = Math.hypot(x - L.x, y - Y), g = L.glow * Math.exp(-(((d - DOT) / 34) ** 2)) * (d > DOT ? 1 : 0);
    col = col.map((v, i) => v + (L.c[i] / 255 - v) * g);
  }
  for (const L of LIGHTS) if (Math.hypot(x - L.x, y - Y) <= DOT) col = L.c.map((v) => v / 255);
  return col.concat(1);
}

const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0; // filter: none
  for (let x = 0; x < SIZE; x++) {
    let acc = [0, 0, 0, 0];
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const s = sample(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS);
      acc = [acc[0] + s[0] * s[3], acc[1] + s[1] * s[3], acc[2] + s[2] * s[3], acc[3] + s[3]];
    }
    const a = acc[3] / (SS * SS), o = y * (SIZE * 4 + 1) + 1 + x * 4;
    raw[o] = a ? Math.round((acc[0] / acc[3]) * 255) : 0; raw[o + 1] = a ? Math.round((acc[1] / acc[3]) * 255) : 0;
    raw[o + 2] = a ? Math.round((acc[2] / acc[3]) * 255) : 0; raw[o + 3] = Math.round(a * 255);
  }
}
const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const t = Buffer.from(type), len = Buffer.alloc(4), crc = Buffer.alloc(4); len.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, crc]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(SIZE, 0); ihdr.writeUInt32BE(SIZE, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
fs.writeFileSync(out, png);
console.log(`Wrote ${out} (${SIZE} x ${SIZE}, ${Math.round(png.length / 1024)} kB).`);
