import { describe, expect, it } from "vitest";
import { imageDimensions } from "../src/index.ts";

const bytes = (...parts: Array<number[] | string>): Uint8Array =>
  Uint8Array.from(parts.flatMap((part) => (typeof part === "string" ? [...part].map((char) => char.charCodeAt(0)) : part)));

const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const be16 = (n: number) => [(n >>> 8) & 255, n & 255];
const le16 = (n: number) => [n & 255, (n >>> 8) & 255];
const le24 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255];

const png = (w: number, h: number) => bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], be32(13), "IHDR", be32(w), be32(h), [8, 2, 0, 0, 0]);

const jpeg = (w: number, h: number, sof = 0xc0) =>
  bytes(
    [0xff, 0xd8],
    [0xff, 0xe0],
    be16(16),
    "JFIF",
    [0, 1, 1, 0, 0, 1, 0, 1, 0, 0],
    [0xff, 0xdb],
    be16(5),
    [0, 1, 2],
    [0xff, 0xff, sof],
    be16(17),
    [8],
    be16(h),
    be16(w),
    [3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1],
  );

const webpLossy = (w: number, h: number) =>
  bytes("RIFF", [0, 0, 0, 0], "WEBP", "VP8 ", [0, 0, 0, 0], [0, 0, 0], [0x9d, 0x01, 0x2a], le16(w), le16(h));

const webpLossless = (w: number, h: number) => {
  const bits = (w - 1) | ((h - 1) << 14);
  return bytes("RIFF", [0, 0, 0, 0], "WEBP", "VP8L", [0, 0, 0, 0], [0x2f], [bits & 255, (bits >>> 8) & 255, (bits >>> 16) & 255, (bits >>> 24) & 255]);
};

const webpExtended = (w: number, h: number) => bytes("RIFF", [0, 0, 0, 0], "WEBP", "VP8X", [10, 0, 0, 0], [0, 0, 0, 0], le24(w - 1), le24(h - 1));

const gif = (w: number, h: number) => bytes("GIF89a", le16(w), le16(h), [0, 0, 0]);

const svg = (text: string) => new TextEncoder().encode(text);

describe("an image's pixel size from its first bytes", () => {
  it.each<[string, Uint8Array, { w: number; h: number } | undefined]>([
    ["PNG", png(1024, 1536), { w: 1024, h: 1536 }],
    ["baseline JPEG", jpeg(640, 480), { w: 640, h: 480 }],
    ["progressive JPEG", jpeg(3000, 2000, 0xc2), { w: 3000, h: 2000 }],
    ["lossy WebP", webpLossy(800, 600), { w: 800, h: 600 }],
    ["lossless WebP", webpLossless(333, 777), { w: 333, h: 777 }],
    ["extended WebP", webpExtended(4000, 3000), { w: 4000, h: 3000 }],
    ["GIF", gif(320, 200), { w: 320, h: 200 }],
    ["SVG with width and height", svg('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80px"></svg>'), { w: 120, h: 80 }],
    ["SVG with a viewBox only", svg('<svg viewBox="0 0 300 150" xmlns="http://www.w3.org/2000/svg"/>'), { w: 300, h: 150 }],
    ["SVG with a percentage size falls back to the viewBox", svg('<svg width="100%" height="100%" viewBox="0,0,50,25"></svg>'), { w: 50, h: 25 }],
    ["SVG with no size at all", svg("<svg></svg>"), undefined],
    ["a truncated PNG", png(10, 10).slice(0, 20), undefined],
    ["something else", bytes("hello, not an image"), undefined],
    ["nothing", new Uint8Array(0), undefined],
  ])("%s", (_case, input, size) => {
    expect(imageDimensions(input)).toEqual(size);
  });
});
