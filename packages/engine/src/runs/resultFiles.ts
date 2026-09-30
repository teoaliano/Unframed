import { existsSync } from "node:fs";
import { open, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { projectSlug } from "@unframed/domain";

/** The ISO time with `:` and `.` replaced by `-`, as every generated file name starts. */
export const fileStamp = (epochMs: number): string => new Date(epochMs).toISOString().replace(/[:.]/g, "-");

/** The extension from the answer's type (the subtype before any `+`), else `png`. */
export const extensionFor = (mediaType: string | undefined, outputFormat: string | undefined): string => {
  const type = mediaType ?? `image/${outputFormat ?? "png"}`;
  const subtype = (type.split(";")[0]!.split("/")[1] ?? "").split("+")[0]!.trim().toLowerCase();
  return /^[a-z0-9]+$/.test(subtype) ? subtype : "png";
};

/** `<stamp>-<slug of the prompt, or "image">[-<runIndex>]`: the base of a result file. */
export const resultBase = (input: { readonly startedAt: number; readonly prompt: string; readonly runIndex: number; readonly runCount: number }): string =>
  `${fileStamp(input.startedAt)}-${projectSlug(input.prompt) || "image"}${input.runCount > 1 ? `-${input.runIndex}` : ""}`;

const MAX_NAMES = 5;

/**
 * Writes `bytes` as `<base>.<ext>`, never over another file: a name whose file or sidecar
 * exists is taken, and the write retries as `<base>-2` up to `<base>-5`. Answers the final
 * base. Rejects when every name is taken or the write fails.
 */
export const writeResultFile = async (folder: string, base: string, ext: string, bytes: Uint8Array): Promise<string> => {
  let failure: unknown;
  for (let attempt = 1; attempt <= MAX_NAMES; attempt++) {
    const name = attempt === 1 ? base : `${base}-${attempt}`;
    const path = join(folder, `${name}.${ext}`);
    if (existsSync(join(folder, `${name}.json`))) {
      failure = new Error(`${name}.json already exists`);
      continue;
    }
    let handle;
    try {
      handle = await open(path, "wx");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      failure = error;
      continue;
    }
    try {
      await handle.writeFile(bytes);
    } finally {
      await handle.close();
    }
    return name;
  }
  throw failure;
};

/**
 * Writes a sidecar that stands alone (a text call's), never over another file: the name
 * retries as `<base>-2` up to `<base>-5`. Answers the final file name.
 */
export const writeLoneSidecar = async (folder: string, base: string, value: unknown): Promise<string> => {
  let failure: unknown;
  for (let attempt = 1; attempt <= MAX_NAMES; attempt++) {
    const name = `${attempt === 1 ? base : `${base}-${attempt}`}.json`;
    try {
      await writeFile(join(folder, name), `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
      return name;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      failure = error;
    }
  }
  throw failure;
};

/** A sidecar is written beside its file, never over another one. */
export const writeSidecar = (folder: string, base: string, value: unknown): Promise<void> =>
  writeFile(join(folder, `${base}.json`), `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });

/** The bare name of a reference file: any path in it is stripped. */
export const referenceName = (file: string): string => basename(file.replaceAll("\\", "/"));

const MIME_BY_EXTENSION: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
};

/** The type a project file is inlined with, from its extension. */
export const mimeForFile = (file: string): string => MIME_BY_EXTENSION[extname(file).toLowerCase()] ?? "application/octet-stream";
