// ==============================================================================
// RSSMindly — Minimal Pure-Node PNG Generator (Zero External Dependencies)
// Uses Node's built-in zlib to create valid PNG charts without node-canvas/libcairo.
// ==============================================================================

import zlib from 'zlib';

function crc32(buf) {
  let table = [];
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c;
  }
  let crc = 0 ^ (-1);
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xFF];
  }
  return (crc ^ (-1)) >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const typeAndData = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([len, typeAndData, crc]);
}

/**
 * Creates a raw PNG buffer from a pixel buffer (RGBA, width x height)
 */
export function encodePng(width, height, pixels) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // 8-bit depth
  ihdr[9] = 6;  // RGBA
  ihdr[10] = 0; // deflate compression
  ihdr[11] = 0; // filter: none
  ihdr[12] = 0; // interlace: none

  const scanlines = [];
  for (let y = 0; y < height; y++) {
    scanlines.push(0); // filter type 0
    const rowOffset = y * width * 4;
    for (let x = 0; x < width * 4; x++) {
      scanlines.push(pixels[rowOffset + x]);
    }
  }

  const compressed = zlib.deflateSync(Buffer.from(scanlines), { level: 9 });
  const idat = makeChunk('IDAT', compressed);
  const iend = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([sig, makeChunk('IHDR', ihdr), idat, iend]);
}

/**
 * Basic 5x7 bitmap font for rendering text labels on canvas
 */
const FONT_5X7 = {
  '0': [0x1F, 0x11, 0x11, 0x11, 0x1F],
  '1': [0x00, 0x02, 0x1F, 0x00, 0x00],
  '2': [0x17, 0x15, 0x15, 0x15, 0x1D],
  '3': [0x11, 0x15, 0x15, 0x15, 0x1F],
  '4': [0x07, 0x04, 0x04, 0x1F, 0x04],
  '5': [0x1D, 0x15, 0x15, 0x15, 0x17],
  '6': [0x1F, 0x15, 0x15, 0x15, 0x17],
  '7': [0x01, 0x01, 0x19, 0x05, 0x03],
  '8': [0x1F, 0x15, 0x15, 0x15, 0x1F],
  '9': [0x1D, 0x15, 0x15, 0x15, 0x1F],
  '.': [0x00, 0x00, 0x18, 0x18, 0x00],
  '%': [0x19, 0x1A, 0x04, 0x0B, 0x13],
  '-': [0x04, 0x04, 0x04, 0x04, 0x04],
  ':': [0x00, 0x00, 0x14, 0x00, 0x00],
  ' ': [0x00, 0x00, 0x00, 0x00, 0x00],
  'A': [0x1E, 0x05, 0x05, 0x05, 0x1E],
  'B': [0x1F, 0x15, 0x15, 0x15, 0x0A],
  'C': [0x0E, 0x11, 0x11, 0x11, 0x0A],
  'D': [0x1F, 0x11, 0x11, 0x11, 0x0E],
  'E': [0x1F, 0x15, 0x15, 0x15, 0x11],
  'F': [0x1F, 0x05, 0x05, 0x05, 0x01],
  'G': [0x0E, 0x11, 0x15, 0x15, 0x0D],
  'H': [0x1F, 0x04, 0x04, 0x04, 0x1F],
  'I': [0x11, 0x11, 0x1F, 0x11, 0x11],
  'L': [0x1F, 0x10, 0x10, 0x10, 0x10],
  'M': [0x1F, 0x02, 0x04, 0x02, 0x1F],
  'N': [0x1F, 0x02, 0x04, 0x08, 0x1F],
  'O': [0x0E, 0x11, 0x11, 0x11, 0x0E],
  'P': [0x1F, 0x05, 0x05, 0x05, 0x02],
  'R': [0x1F, 0x05, 0x0D, 0x15, 0x02],
  'S': [0x12, 0x15, 0x15, 0x15, 0x09],
  'T': [0x01, 0x01, 0x1F, 0x01, 0x01],
  'U': [0x0F, 0x10, 0x10, 0x10, 0x0F],
  'V': [0x07, 0x08, 0x10, 0x08, 0x07],
  'W': [0x1F, 0x08, 0x04, 0x08, 0x1F],
  'X': [0x1B, 0x04, 0x04, 0x04, 0x1B],
  'Y': [0x03, 0x04, 0x18, 0x04, 0x03]
};

export class SimpleCanvas {
  constructor(width, height, bg = [255, 255, 255, 255]) {
    this.width = width;
    this.height = height;
    this.pixels = Buffer.alloc(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      this.pixels[i * 4] = bg[0];
      this.pixels[i * 4 + 1] = bg[1];
      this.pixels[i * 4 + 2] = bg[2];
      this.pixels[i * 4 + 3] = bg[3];
    }
  }

  setPixel(x, y, r, g, b, a = 255) {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return;
    const idx = (y * this.width + x) * 4;
    this.pixels[idx] = r;
    this.pixels[idx + 1] = g;
    this.pixels[idx + 2] = b;
    this.pixels[idx + 3] = a;
  }

  drawLine(x0, y0, x1, y1, color, thickness = 1) {
    x0 = Math.round(x0);
    y0 = Math.round(y0);
    x1 = Math.round(x1);
    y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;

    while (true) {
      for (let tx = -Math.floor(thickness / 2); tx <= Math.floor(thickness / 2); tx++) {
        for (let ty = -Math.floor(thickness / 2); ty <= Math.floor(thickness / 2); ty++) {
          this.setPixel(x0 + tx, y0 + ty, color[0], color[1], color[2], color[3] || 255);
        }
      }
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x0 += sx;
      }
      if (e2 < dx) {
        err += dx;
        y0 += sy;
      }
    }
  }

  drawRect(x, y, w, h, color, fill = true) {
    for (let py = y; py < y + h; py++) {
      for (let px = x; px < x + w; px++) {
        if (fill || px === x || px === x + w - 1 || py === y || py === y + h - 1) {
          this.setPixel(px, py, color[0], color[1], color[2], color[3] || 255);
        }
      }
    }
  }

  drawText(text, startX, startY, color, scale = 1) {
    const upper = text.toUpperCase();
    let curX = startX;
    for (let i = 0; i < upper.length; i++) {
      const char = upper[i];
      const glyph = FONT_5X7[char] || FONT_5X7[' '];
      for (let col = 0; col < 5; col++) {
        const bits = glyph[col] || 0;
        for (let row = 0; row < 7; row++) {
          if ((bits >> row) & 1) {
            for (let sx = 0; sx < scale; sx++) {
              for (let sy = 0; sy < scale; sy++) {
                this.setPixel(curX + col * scale + sx, startY + row * scale + sy, color[0], color[1], color[2], color[3] || 255);
              }
            }
          }
        }
      }
      curX += 6 * scale;
    }
  }

  toBuffer() {
    return encodePng(this.width, this.height, this.pixels);
  }
}
