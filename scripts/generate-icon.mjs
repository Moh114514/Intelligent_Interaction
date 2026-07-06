import { deflateSync } from 'node:zlib';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const size = 512, scale = 2, width = size * scale;
const data = new Uint8Array(width * width * 4);
const colors = { cream: [255, 248, 225, 255], orange: [249, 115, 22, 255], light: [251, 146, 60, 255] };
function blendPixel(x, y, color) { const i = (y * width + x) * 4; for (let c = 0; c < 4; c++) data[i + c] = color[c]; }
for (let y = 0; y < width; y++) for (let x = 0; x < width; x++) blendPixel(x, y, colors.cream);
function circle(cx, cy, radius, color) {
  cx *= scale; cy *= scale; radius *= scale;
  const minX = Math.max(0, Math.floor(cx - radius)), maxX = Math.min(width - 1, Math.ceil(cx + radius));
  const minY = Math.max(0, Math.floor(cy - radius)), maxY = Math.min(width - 1, Math.ceil(cy + radius));
  const r2 = radius * radius;
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r2) blendPixel(x, y, color);
}
circle(256, 310, 105, colors.orange); circle(128, 202, 58, colors.orange); circle(225, 145, 58, colors.orange); circle(327, 153, 58, colors.orange); circle(407, 226, 58, colors.orange); circle(256, 310, 63, colors.light);
const pixels = new Uint8Array(size * size * 4);
for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
  const out = (y * size + x) * 4;
  for (let c = 0; c < 4; c++) {
    let sum = 0; for (let yy = 0; yy < scale; yy++) for (let xx = 0; xx < scale; xx++) sum += data[(((y * scale + yy) * width + x * scale + xx) * 4) + c];
    pixels[out + c] = Math.round(sum / (scale * scale));
  }
}
const table = new Uint32Array(256);
for (let n = 0; n < 256; n++) { let value = n; for (let k = 0; k < 8; k++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1; table[n] = value >>> 0; }
function crc(buffer) { let value = 0xffffffff; for (const byte of buffer) value = table[(value ^ byte) & 0xff] ^ (value >>> 8); return (value ^ 0xffffffff) >>> 0; }
function chunk(type, payload) { const name = Buffer.from(type); const length = Buffer.alloc(4); length.writeUInt32BE(payload.length); const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc(Buffer.concat([name, payload]))); return Buffer.concat([length, name, payload, checksum]); }
const header = Buffer.alloc(13); header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
const raw = Buffer.alloc((size * 4 + 1) * size);
for (let y = 0; y < size; y++) { const offset = y * (size * 4 + 1); raw[offset] = 0; Buffer.from(pixels.buffer, y * size * 4, size * 4).copy(raw, offset + 1); }
const png = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
await writeFile(resolve('build-resources/icon.png'), png);
console.log('Generated build-resources/icon.png');