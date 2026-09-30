/** Test media made in the test process: real PNG files of any size, and a short WebM clip. */
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

const crc32 = (bytes: Buffer): number => {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

const chunk = (type: string, data: Buffer): Buffer => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
};

/** A `width` × `height` RGB PNG: a gradient, so previews and originals differ visibly. */
export const pngBytes = (width: number, height: number, seed = 0): Buffer => {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  const row = Buffer.alloc(1 + width * 3);
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y++) {
    row[0] = 0;
    for (let x = 0; x < width; x++) {
      row[1 + x * 3] = (x * 255) / Math.max(1, width - 1) + seed;
      row[2 + x * 3] = (y * 255) / Math.max(1, height - 1);
      row[3 + x * 3] = 128 + seed;
    }
    rows.push(Buffer.from(row));
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(rows), { level: 1 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
};

/**
 * A large `width` × `height` PNG of one colour with a darker band across the middle. It
 * decodes to as many pixels as any photo of that size but stays small on disk.
 */
export const flatPngBytes = (width: number, height: number, rgb: [number, number, number]): Buffer => {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const row = (shade: number) => {
    const bytes = Buffer.alloc(1 + width * 3);
    for (let x = 0; x < width; x++) {
      bytes[1 + x * 3] = rgb[0] * shade;
      bytes[2 + x * 3] = rgb[1] * shade;
      bytes[3 + x * 3] = rgb[2] * shade;
    }
    return bytes;
  };
  const light = row(1);
  const dark = row(0.6);
  const band = { from: Math.floor(height * 0.45), to: Math.floor(height * 0.55) };
  const raw = Buffer.alloc((1 + width * 3) * height);
  for (let y = 0; y < height; y++) (y >= band.from && y < band.to ? dark : light).copy(raw, y * light.length);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
};

export const sha = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");
