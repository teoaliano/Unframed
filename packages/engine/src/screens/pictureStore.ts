import { createHash } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { PICTURE_KEY, partExtension, pictureFile, pictureFileName } from "@unframed/domain";

export const PICTURE_FOLDER = join(".cache", "pictures");
export const PART_LIMIT = 8 * 1_048_576;

export interface PictureRasters {
  readonly png: Buffer;
  readonly w384: Buffer;
  readonly w128: Buffer;
}

const hashOf = (content: Buffer | string): string => createHash("sha256").update(content).digest("hex").slice(0, 40);

const exists = (path: string) =>
  stat(path).then(
    (info) => info.isFile(),
    () => false,
  );

let written = 0;

const writeOnce = async (path: string, content: Buffer | string): Promise<void> => {
  if (await exists(path)) return;
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${++written}.tmp`;
  await writeFile(temp, content);
  await rename(temp, path);
};

export class PictureStore {
  private readonly folder: (project: string) => Promise<string | undefined>;

  constructor(folder: (project: string) => Promise<string | undefined>) {
    this.folder = folder;
  }

  private async dir(project: string): Promise<string | undefined> {
    const folder = await this.folder(project);
    return folder === undefined ? undefined : join(folder, PICTURE_FOLDER);
  }

  async putPart(project: string, bytes: Buffer, type: string): Promise<string | undefined> {
    const extension = partExtension(type);
    const dir = await this.dir(project);
    if (extension === undefined || dir === undefined || bytes.length > PART_LIMIT) return undefined;
    const name = `${hashOf(bytes)}.${extension}`;
    await writeOnce(join(dir, "parts", name), bytes);
    return name;
  }

  async putPicture(project: string, picture: PictureRasters & { readonly html?: string | undefined }): Promise<string | undefined> {
    const dir = await this.dir(project);
    if (dir === undefined) return undefined;
    const key = hashOf(picture.html ?? picture.png);
    if (picture.html !== undefined) await writeOnce(join(dir, pictureFile(key, "html")), picture.html);
    await writeOnce(join(dir, pictureFile(key, "w128")), picture.w128);
    await writeOnce(join(dir, pictureFile(key, "w384")), picture.w384);
    await writeOnce(join(dir, pictureFile(key, "full")), picture.png);
    return key;
  }

  async has(project: string, key: string): Promise<boolean> {
    const dir = await this.dir(project);
    if (dir === undefined || !PICTURE_KEY.test(key)) return false;
    const found = await Promise.all((["full", "w384", "w128"] as const).map((variant) => exists(join(dir, pictureFile(key, variant)))));
    return found.every(Boolean);
  }

  async keyFor(project: string, signature: string): Promise<string | undefined> {
    const dir = await this.dir(project);
    if (dir === undefined) return undefined;
    const key = await readFile(join(dir, "signatures", hashOf(signature)), "utf8").catch(() => undefined);
    return key !== undefined && PICTURE_KEY.test(key) ? key : undefined;
  }

  async remember(project: string, signature: string, key: string): Promise<void> {
    const dir = await this.dir(project);
    if (dir === undefined || !PICTURE_KEY.test(key)) return;
    const path = join(dir, "signatures", hashOf(signature));
    if ((await readFile(path, "utf8").catch(() => undefined)) === key) return;
    await mkdir(dirname(path), { recursive: true });
    const temp = `${path}.${process.pid}.${++written}.tmp`;
    await writeFile(temp, key);
    await rename(temp, path);
  }

  async path(project: string, name: string): Promise<string | undefined> {
    const dir = await this.dir(project);
    return dir === undefined || pictureFileName(name) === undefined ? undefined : join(dir, name);
  }

  async read(project: string, name: string): Promise<Buffer | undefined> {
    const path = await this.path(project, name);
    return path === undefined ? undefined : readFile(path).catch(() => undefined);
  }
}

export const pictureKey = hashOf;

const PART_TYPES: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  avif: "image/avif",
  woff2: "font/woff2",
  woff: "font/woff",
  ttf: "font/ttf",
  otf: "font/otf",
};

export const pictureContentType = (name: string): string => {
  if (name.endsWith(".html")) return "text/html; charset=utf-8";
  const extension = /\.([a-z0-9]+)$/.exec(name)?.[1];
  return (extension === undefined ? undefined : PART_TYPES[extension]) ?? "application/octet-stream";
};
