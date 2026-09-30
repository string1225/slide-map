const { deflateSync } = require('node:zlib');
const { writeFileSync, mkdirSync } = require('node:fs');
const path = require('node:path');
function png(width, height, pixels) {
  function crc(buffer) {
    let c = 0xffffffff;
    for (const b of buffer) {
      c ^= b;
      for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
    }
    return (c ^ 0xffffffff) >>> 0;
  }
  function chunk(name, data) {
    const type = Buffer.from(name),
      size = Buffer.alloc(4),
      sum = Buffer.alloc(4);
    size.writeUInt32BE(data.length);
    sum.writeUInt32BE(crc(Buffer.concat([type, data])));
    return Buffer.concat([size, type, data, sum]);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++)
    pixels.copy(rows, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
function generateIcons(directory) {
  mkdirSync(directory, { recursive: true });
  for (const name of ['explore', 'add', 'person', 'marker'])
    for (const active of name === 'marker' ? [true] : [false, true]) {
      const w = 64,
        h = name === 'marker' ? 80 : 64,
        p = Buffer.alloc(w * h * 4),
        color = active ? [32, 91, 70] : [131, 139, 128];
      function dot(x, y, r, c = color) {
        for (let yy = Math.max(0, Math.floor(y - r)); yy < Math.min(h, y + r + 1); yy++)
          for (let xx = Math.max(0, Math.floor(x - r)); xx < Math.min(w, x + r + 1); xx++)
            if ((xx - x) ** 2 + (yy - y) ** 2 <= r * r) {
              const i = (yy * w + xx) * 4;
              p[i] = c[0];
              p[i + 1] = c[1];
              p[i + 2] = c[2];
              p[i + 3] = 255;
            }
      }
      function line(x1, y1, x2, y2, r = 2.5, c = color) {
        const length = Math.hypot(x2 - x1, y2 - y1);
        for (let s = 0; s <= length; s += 0.4)
          dot(x1 + ((x2 - x1) * s) / length, y1 + ((y2 - y1) * s) / length, r, c);
      }
      function ring(x, y, r) {
        for (let a = 0; a < Math.PI * 2; a += 0.025) dot(x + Math.cos(a) * r, y + Math.sin(a) * r, 2.2);
      }
      if (name === 'explore') {
        ring(32, 32, 23);
        line(24, 40, 28, 24);
        line(28, 24, 42, 21);
        line(42, 21, 36, 38);
        line(36, 38, 24, 40);
      }
      if (name === 'add') {
        ring(32, 32, 23);
        line(32, 20, 32, 44);
        line(20, 32, 44, 32);
      }
      if (name === 'person') {
        ring(32, 22, 10);
        for (let a = Math.PI; a < Math.PI * 2; a += 0.03)
          dot(32 + Math.cos(a) * 20, 55 + Math.sin(a) * 19, 2.5);
        line(12, 55, 52, 55);
      }
      if (name === 'marker') {
        dot(32, 29, 27, [255, 254, 249]);
        dot(32, 29, 23);
        for (let y = 38; y < 75; y++) line(32 - (75 - y) * 0.58, y, 32 + (75 - y) * 0.58, y, 1);
        line(22, 43, 22, 21, 2.5, [242, 200, 102]);
        line(22, 21, 31, 21, 3, [242, 200, 102]);
        line(31, 21, 40, 39, 3, [242, 200, 102]);
        line(40, 39, 47, 40, 3, [242, 200, 102]);
        line(16, 31, 23, 31, 2, [242, 200, 102]);
        line(16, 40, 23, 40, 2, [242, 200, 102]);
      }
      writeFileSync(
        path.join(directory, name + (active && name !== 'marker' ? '-active' : '') + '.png'),
        png(w, h, p),
      );
    }
}
module.exports = { generateIcons };
