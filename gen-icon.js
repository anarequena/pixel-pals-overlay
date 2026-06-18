'use strict';
// One-off generator for assets/icon.png (a cute pixel cat). Run with: node gen-icon.js
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

const PAL = {
  '.': null,
  O: [58, 42, 90, 255],
  B: [202, 166, 255, 255],
  E: [26, 19, 32, 255],
  P: [255, 158, 196, 255],
};

const GRID = [
  '................',
  '.OO........OO...',
  '.OBO......OBO...',
  '.OBBO....OBBO...',
  '.OBBBOOOOBBBBO..',
  '.OBBBBBBBBBBBO..',
  '.OBBBBBBBBBBBO..',
  '.OBEBBBBBBEBBO..',
  '.OBEBBBBBBEBBO..',
  '.OBBBBBPBBBBBO..',
  '.OBBBBPPPBBBBO..',
  '.OBBBBBBBBBBBO..',
  '.OOBBBBBBBBBOO..',
  '..OOOOOOOOOO....',
  '................',
  '................',
];

const W = 16;
const SCALE = 2;
const OW = W * SCALE;
const OH = GRID.length * SCALE;

function px(r, c) {
  let row = GRID[r] || '';
  if (row.length < W) row = row + '.'.repeat(W - row.length);
  return PAL[row[c]] || [0, 0, 0, 0];
}

// Build raw RGBA scanlines with filter byte 0.
const raw = Buffer.alloc((OW * 4 + 1) * OH);
let off = 0;
for (let y = 0; y < OH; y++) {
  raw[off++] = 0;
  for (let x = 0; x < OW; x++) {
    const [r, g, b, a] = px(Math.floor(y / SCALE), Math.floor(x / SCALE));
    raw[off++] = r; raw[off++] = g; raw[off++] = b; raw[off++] = a;
  }
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(OW, 0);
ihdr.writeUInt32BE(OH, 4);
ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const idat = zlib.deflateSync(raw);
const png = Buffer.concat([
  sig,
  chunk('IHDR', ihdr),
  chunk('IDAT', idat),
  chunk('IEND', Buffer.alloc(0)),
]);

const outDir = path.join(__dirname, 'assets');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'icon.png'), png);
console.log('Wrote assets/icon.png', OW + 'x' + OH, png.length + ' bytes');
