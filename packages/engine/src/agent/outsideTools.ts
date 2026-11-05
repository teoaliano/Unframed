import { randomUUID } from "node:crypto";
import { constants, existsSync } from "node:fs";
import { copyFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { mediaFileName, OUTSIDE_CHAT_NOTE_DESCRIPTION, OUTSIDE_FILE_ADD_DESCRIPTION, sidecarFileName, sidecarText } from "@unframed/domain";
import type { McpBinding, McpTool, ToolAnswer } from "./mcp.ts";
import { refusal } from "./mcp.ts";

export const CHAT_NOTE = "chat_note";
export const FILE_ADD = "file_add";

/** The longest note an outside agent may post (spec 14, "The outside chat"). */
export const CHAT_NOTE_LIMIT = 2000;

/** The largest file `file_add` copies: 25 MB, spec 04's video limit. */
export const FILE_ADD_LIMIT = 25 * 1_048_576;

const MEDIA: Record<string, { readonly mime: string; readonly kind: "image" | "video" }> = {
  ".png": { mime: "image/png", kind: "image" },
  ".jpg": { mime: "image/jpeg", kind: "image" },
  ".jpeg": { mime: "image/jpeg", kind: "image" },
  ".gif": { mime: "image/gif", kind: "image" },
  ".webp": { mime: "image/webp", kind: "image" },
  ".avif": { mime: "image/avif", kind: "image" },
  ".mp4": { mime: "video/mp4", kind: "video" },
  ".mov": { mime: "video/quicktime", kind: "video" },
  ".webm": { mime: "video/webm", kind: "video" },
};

export const NOTE_EMPTY = "The note is empty. Write the summary the person should read.";
export const noteTooLong = (length: number) => `Keep a note to ${CHAT_NOTE_LIMIT} characters; this one has ${length}. Say less, or post two notes.`;
export const NO_ROOTS =
  "Your MCP client reports no working folder (MCP roots), so Unframed cannot tell which files are yours to share. Save the file into the project folder yourself if you can, or use a client that reports its roots.";
export const outsideRoots = (path: string, roots: ReadonlyArray<string>) =>
  `${path} is outside your working folder (${roots.join(", ")}). Unframed copies only files inside the folders your MCP client reports.`;
export const noFile = (path: string) => `There is no file at ${path}.`;
export const notAFile = (path: string) => `${path} is not a file.`;
export const tooLarge = (path: string, bytes: number) =>
  `${basename(path)} is ${(bytes / 1_048_576).toFixed(1)} MB; file_add copies files up to ${FILE_ADD_LIMIT / 1_048_576} MB.`;
export const unsupported = (path: string) =>
  `${basename(path)} is not a file the board can show. file_add takes PNG, JPEG, GIF, WebP and AVIF images and MP4, MOV and WebM videos.`;

export interface OutsideToolDeps {
  /** Posts an assistant message into the binding's outside chat, under its open turn. */
  readonly note: (binding: McpBinding, text: string) => Promise<void>;
  /** The project folder of the binding's project. */
  readonly folder: (project: string) => Promise<string>;
}

/** The local folder a root names: a `file:` URI, or a plain absolute path. */
const rootPath = (uri: string): string | undefined => {
  try {
    if (uri.startsWith("file:")) return fileURLToPath(uri);
  } catch {
    return undefined;
  }
  return isAbsolute(uri) ? uri : undefined;
};

const inside = (path: string, root: string): boolean => {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
};

const realRoots = async (roots: ReadonlyArray<string>): Promise<string[]> => {
  const found: string[] = [];
  for (const root of roots) {
    const path = rootPath(root);
    if (path === undefined) continue;
    const real = await realpath(path).catch(() => undefined);
    if (real !== undefined) found.push(real);
  }
  return found;
};

/**
 * The outside-only tools that speak for the agent in its chat and bring its files in (spec 14):
 * `chat_note` posts a short message under the open outside turn, and `file_add` copies a file from
 * inside the client's roots into the project as a new file, under the new-file rule.
 */
export const outsideAgentTools = (deps: OutsideToolDeps): McpTool[] => [
  {
    name: CHAT_NOTE,
    description: OUTSIDE_CHAT_NOTE_DESCRIPTION,
    workLogRow: false,
    inputSchema: {
      type: "object",
      properties: { text: { type: "string", description: `The message, plain text or Markdown, at most ${CHAT_NOTE_LIMIT} characters.` } },
      required: ["text"],
      additionalProperties: false,
    },
    call: async (binding, args): Promise<ToolAnswer> => {
      const text = typeof args.text === "string" ? args.text.trim() : "";
      if (text === "") return refusal(NOTE_EMPTY);
      if (text.length > CHAT_NOTE_LIMIT) return refusal(noteTooLong(text.length));
      await deps.note(binding, text);
      return { value: { posted: true } };
    },
  },
  {
    name: FILE_ADD,
    description: OUTSIDE_FILE_ADD_DESCRIPTION,
    inputSchema: {
      type: "object",
      properties: { path: { type: "string", description: "The file's path, absolute or relative to your working folder." } },
      required: ["path"],
      additionalProperties: false,
    },
    call: async (binding, args): Promise<ToolAnswer> => {
      const asked = typeof args.path === "string" ? args.path.trim() : "";
      if (asked === "") return refusal("Name the file to add with path.");
      const roots = binding.roots ?? [];
      const reals = await realRoots(roots);
      if (reals.length === 0) return refusal(NO_ROOTS);
      const absolute = resolve(reals[0]!, asked);
      const lexical = await realpath(dirname(absolute)).then((parent) => join(parent, basename(absolute)), () => absolute);
      if (!reals.some((root) => inside(lexical, root))) return refusal(outsideRoots(asked, reals));
      const real = await realpath(absolute).catch(() => undefined);
      if (real === undefined) return refusal(noFile(asked));
      if (!reals.some((root) => inside(real, root))) return refusal(outsideRoots(asked, reals));
      const info = await stat(real);
      if (!info.isFile()) return refusal(notAFile(asked));
      const media = MEDIA[extname(real).toLowerCase()];
      if (media === undefined) return refusal(unsupported(asked));
      if (info.size > FILE_ADD_LIMIT) return refusal(tooLarge(asked, info.size));
      if (info.size === 0) return refusal(`${basename(asked)} is empty.`);
      const folder = await deps.folder(binding.project);
      const temp = join(folder, `.upload-${randomUUID()}.tmp`);
      const originalName = basename(real);
      try {
        await copyFile(real, temp, constants.COPYFILE_EXCL);
        const file = mediaFileName({ originalName, mime: media.mime, now: Date.now(), exists: (name) => existsSync(join(folder, name)) || existsSync(join(folder, sidecarFileName(name))) });
        await rename(temp, join(folder, file));
        await writeFile(
          join(folder, sidecarFileName(file)),
          sidecarText({ source: "outside-agent", fileName: originalName, mime: media.mime, bytes: info.size, at: new Date().toISOString(), of: real, chat: binding.chatId }),
        );
        return { value: { file, fileName: originalName, kind: media.kind, mime: media.mime, bytes: info.size, place: `canvas_write create with kind "${media.kind}" and props.file "${file}"` } };
      } catch (error) {
        await rm(temp, { force: true });
        throw error;
      }
    },
  },
];
