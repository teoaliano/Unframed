export interface PixelSize {
  readonly w: number;
  readonly h: number;
}

const ascii = (bytes: Uint8Array, at: number, length: number): string => String.fromCharCode(...bytes.subarray(at, at + length));

const positive = (w: number, h: number): PixelSize | undefined => (w > 0 && h > 0 ? { w, h } : undefined);

const png = (bytes: Uint8Array, view: DataView): PixelSize | undefined =>
  bytes.length >= 24 && ascii(bytes, 12, 4) === "IHDR" ? positive(view.getUint32(16), view.getUint32(20)) : undefined;

const gif = (view: DataView): PixelSize | undefined => (view.byteLength >= 10 ? positive(view.getUint16(6, true), view.getUint16(8, true)) : undefined);

const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

const jpeg = (bytes: Uint8Array, view: DataView): PixelSize | undefined => {
  let at = 2;
  while (at + 1 < bytes.length) {
    if (bytes[at] !== 0xff) return undefined;
    let marker = bytes[at + 1]!;
    // Fill bytes before a marker.
    while (marker === 0xff && at + 2 < bytes.length) marker = bytes[++at + 1]!;
    at += 2;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (marker === 0xd9 || at + 2 > bytes.length) return undefined;
    const length = view.getUint16(at);
    if (SOF.has(marker)) return at + 7 <= bytes.length ? positive(view.getUint16(at + 5), view.getUint16(at + 3)) : undefined;
    at += length;
  }
  return undefined;
};

const webp = (bytes: Uint8Array, view: DataView): PixelSize | undefined => {
  const chunk = ascii(bytes, 12, 4);
  if (chunk === "VP8 " && bytes.length >= 30) return positive(view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff);
  if (chunk === "VP8L" && bytes.length >= 25) {
    const bits = view.getUint32(21, true);
    return positive((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
  }
  if (chunk === "VP8X" && bytes.length >= 30) {
    const w = bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16);
    const h = bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16);
    return positive(w + 1, h + 1);
  }
  return undefined;
};

const svgLength = (value: string | undefined): number | undefined => {
  const match = value === undefined ? null : /^\s*([\d.]+)\s*(px)?\s*$/.exec(value);
  const number = match ? Number(match[1]) : Number.NaN;
  return Number.isFinite(number) && number > 0 ? number : undefined;
};

const svg = (bytes: Uint8Array): PixelSize | undefined => {
  const text = new TextDecoder().decode(bytes.subarray(0, 64 * 1024));
  const tag = /<svg\b([^>]*)>/i.exec(text)?.[1];
  if (tag === undefined) return undefined;
  const attribute = (name: string) => new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(tag)?.[1];
  const w = svgLength(attribute("width"));
  const h = svgLength(attribute("height"));
  if (w !== undefined && h !== undefined) return { w, h };
  const box = attribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
  if (box?.length === 4 && box.every(Number.isFinite)) return positive(box[2]!, box[3]!);
  return undefined;
};

/** An image's pixel width and height from its first bytes: PNG, JPEG, WebP, GIF or SVG. */
export const imageDimensions = (bytes: Uint8Array): PixelSize | undefined => {
  if (bytes.length < 4) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes[0] === 0x89 && ascii(bytes, 1, 3) === "PNG") return png(bytes, view);
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return jpeg(bytes, view);
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return webp(bytes, view);
  if (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a") return gif(view);
  return svg(bytes);
};
