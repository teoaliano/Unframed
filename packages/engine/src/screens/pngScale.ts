import { promisify } from "node:util";
import { crc32, deflate, inflate } from "node:zlib";

const inflated = promisify(inflate);
const deflated = promisify(deflate);

const ROWS_PER_TURN = 64;

const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

export interface Pixels {
  readonly width: number;
  readonly height: number;
  readonly channels: number;
  readonly data: Uint8Array;
}

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const paeth = (a: number, b: number, c: number): number => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

export const decodePng = async (png: Buffer): Promise<Pixels> => {
  if (!png.subarray(0, 8).equals(SIGNATURE)) throw new Error("not a PNG");
  let width = 0;
  let height = 0;
  let channels = 0;
  const compressed: Buffer[] = [];
  for (let at = 8; at < png.length; ) {
    const length = png.readUInt32BE(at);
    const type = png.toString("latin1", at + 4, at + 8);
    const body = png.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const [depth, colour, , , interlace] = [body[8], body[9], body[10], body[11], body[12]];
      if (depth !== 8 || interlace !== 0 || (colour !== 2 && colour !== 6)) throw new Error(`a PNG of depth ${depth}, colour type ${colour} and interlace ${interlace} cannot be scaled`);
      channels = colour === 6 ? 4 : 3;
    } else if (type === "IDAT") compressed.push(body);
    else if (type === "IEND") break;
    at += length + 12;
  }
  const stride = width * channels;
  const raw = await inflated(Buffer.concat(compressed));
  const data = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    if (y % ROWS_PER_TURN === ROWS_PER_TURN - 1) await turn();
    const filter = raw[y * (stride + 1)]!;
    const line = y * (stride + 1) + 1;
    const row = y * stride;
    const above = row - stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? data[row + x - channels]! : 0;
      const b = y > 0 ? data[above + x]! : 0;
      const c = x >= channels && y > 0 ? data[above + x - channels]! : 0;
      const value = raw[line + x]!;
      data[row + x] = (filter === 0 ? value : filter === 1 ? value + a : filter === 2 ? value + b : filter === 3 ? value + ((a + b) >> 1) : value + paeth(a, b, c)) & 255;
    }
  }
  return { width, height, channels, data };
};

const chunk = (type: string, body: Buffer): Buffer => {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, "latin1");
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, tail]);
};

const encode = async ({ width, height, channels, data }: Pixels): Promise<Buffer> => {
  const stride = width * channels;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) raw.set(data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = channels === 4 ? 6 : 2;
  return Buffer.concat([SIGNATURE, chunk("IHDR", header), chunk("IDAT", await deflated(raw)), chunk("IEND", Buffer.alloc(0))]);
};

const shrink = async (source: Pixels, width: number): Promise<Pixels> => {
  const height = Math.max(1, Math.round((source.height * width) / source.width));
  const { channels } = source;
  const data = new Uint8Array(width * height * channels);
  const sum = new Array<number>(channels);
  for (let y = 0; y < height; y++) {
    if (y % 8 === 7) await turn();
    const top = Math.floor((y * source.height) / height);
    const bottom = Math.max(top + 1, Math.floor(((y + 1) * source.height) / height));
    for (let x = 0; x < width; x++) {
      const left = Math.floor((x * source.width) / width);
      const right = Math.max(left + 1, Math.floor(((x + 1) * source.width) / width));
      sum.fill(0);
      for (let sy = top; sy < bottom; sy++) {
        for (let sx = left; sx < right; sx++) {
          const at = (sy * source.width + sx) * channels;
          for (let channel = 0; channel < channels; channel++) sum[channel]! += source.data[at + channel]!;
        }
      }
      const count = (bottom - top) * (right - left);
      const at = (y * width + x) * channels;
      for (let channel = 0; channel < channels; channel++) data[at + channel] = Math.round(sum[channel]! / count);
    }
  }
  return { width, height, channels, data };
};

export const scalePngs = async (png: Buffer, widths: ReadonlyArray<number>): Promise<Buffer[]> => {
  const source = await decodePng(png);
  const scaled: Buffer[] = [];
  for (const width of widths) scaled.push(width >= source.width ? png : await encode(await shrink(source, width)));
  return scaled;
};
