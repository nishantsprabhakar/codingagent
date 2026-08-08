#!/usr/bin/env node
/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 *
 * Generates public/icon-512.png — a simple corner-bracket mark (matching the
 * tactical theme's own panel-frame motif) on an onyx background, for
 * apple-touch-icon and the web manifest. Hand-rolled PNG encoding using only
 * Node's built-in zlib — this is a single flat-color geometric icon, not
 * worth a rendering dependency for.
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const SIZE = 512;
const BG = [0x03, 0x03, 0x03, 0xff];
const ACCENT = [0x00, 0xf0, 0xff, 0xff];

const pixels = new Uint8Array(SIZE * SIZE * 4);
for (let i = 0; i < SIZE * SIZE; i++) {
  pixels[i * 4] = BG[0];
  pixels[i * 4 + 1] = BG[1];
  pixels[i * 4 + 2] = BG[2];
  pixels[i * 4 + 3] = BG[3];
}

function fillRect(x0, y0, w, h, color) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) continue;
      const i = (y * SIZE + x) * 4;
      pixels[i] = color[0];
      pixels[i + 1] = color[1];
      pixels[i + 2] = color[2];
      pixels[i + 3] = color[3];
    }
  }
}

const MARGIN = 116;
const ARM = 132;
const THICK = 36;

// Top-left corner bracket.
fillRect(MARGIN, MARGIN, ARM, THICK, ACCENT);
fillRect(MARGIN, MARGIN, THICK, ARM, ACCENT);

// Bottom-right corner bracket (mirrored).
fillRect(SIZE - MARGIN - ARM, SIZE - MARGIN - THICK, ARM, THICK, ACCENT);
fillRect(SIZE - MARGIN - THICK, SIZE - MARGIN - ARM, THICK, ARM, ACCENT);

// ---------- Minimal PNG encoder ----------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const ihdrData = Buffer.alloc(13);
ihdrData.writeUInt32BE(SIZE, 0);
ihdrData.writeUInt32BE(SIZE, 4);
ihdrData[8] = 8; // bit depth
ihdrData[9] = 6; // color type: RGBA
ihdrData[10] = 0;
ihdrData[11] = 0;
ihdrData[12] = 0;
const ihdr = chunk("IHDR", ihdrData);

const raw = Buffer.alloc(SIZE * (1 + SIZE * 4));
for (let y = 0; y < SIZE; y++) {
  const rowStart = y * (1 + SIZE * 4);
  raw[rowStart] = 0; // filter type: none
  pixels.copyWithin && Buffer.from(pixels.buffer, y * SIZE * 4, SIZE * 4).copy(raw, rowStart + 1);
}
const idat = chunk("IDAT", zlib.deflateSync(raw));
const iend = chunk("IEND", Buffer.alloc(0));

const png = Buffer.concat([signature, ihdr, idat, iend]);
const outPath = path.join(__dirname, "..", "public", "icon-512.png");
fs.writeFileSync(outPath, png);
console.log(`Wrote ${outPath} (${png.length} bytes)`);
