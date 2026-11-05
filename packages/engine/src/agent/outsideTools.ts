import { constants } from "node:fs";
import { open, realpath, type FileHandle } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { boardMediaType, OUTSIDE_CHAT_NOTE_DESCRIPTION, OUTSIDE_FILE_ADD_DESCRIPTION } from "@unframed/domain";
import type { McpBinding, McpTool, ToolAnswer } from "./mcp.ts";
import { refusal } from "./mcp.ts";

export const CHAT_NOTE = "chat_note";
export const FILE_ADD = "file_add";
export const CHAT_NOTE_LIMIT = 2000;
export const FILE_ADD_LIMIT = 25 * 1_048_576;

export const NOTE_EMPTY = "The note is empty. Write the summary the person should read.";
export const noteTooLong = (length: number) => `Keep a note to ${CHAT_NOTE_LIMIT} characters; this one has ${length}. Say less, or post two notes.`;
export const NO_ROOTS =
  "Your MCP client reports no working folder (MCP roots), so Unframed cannot tell which files are yours to share. Save the file into the project folder yourself if you can, or use a client that reports its roots.";
export const firstRootMissing = (root: string) =>
  `Your first working folder (${root}) does not exist, so a relative path has nothing to start from. Give the file's absolute path inside one of your working folders.`;
export const outsideRoots = (path: string, roots: ReadonlyArray<string>) =>
  `${path} is outside your working folder (${roots.join(", ")}). Unframed copies only files inside the folders your MCP client reports.`;
export const noFile = (path: string) => `There is no file at ${path}.`;
export const notAFile = (path: string) => `${path} is not a file.`;
export const tooLarge = (path: string, bytes: number) =>
  `${basename(path)} is ${(bytes / 1_048_576).toFixed(1)} MB; file_add copies files up to ${FILE_ADD_LIMIT / 1_048_576} MB.`;
export const unsupported = (path: string) =>
  `${basename(path)} is not a file the board can show. file_add takes PNG, JPEG, GIF, WebP and AVIF images and MP4, MOV and WebM videos.`;
const CHANGED = (path: string) => `${path} changed while Unframed was reading it. Try again.`;

export interface OutsideToolDeps {
  readonly note: (binding: McpBinding, text: string) => Promise<void>;
  readonly save: (
    project: string,
    input: { originalName: string; mime: string; body: AsyncIterable<Buffer>; source: "outside-agent"; of: string; chat: string },
  ) => Promise<{ file: string; bytes: number }>;
}

class TooLarge extends Error {
  readonly bytes: number;
  constructor(bytes: number) {
    super("too large");
    this.bytes = bytes;
  }
}

const reportedPath = (uri: string): string | undefined => {
  try {
    if (uri.startsWith("file:")) return fileURLToPath(uri);
  } catch {
    return undefined;
  }
  return isAbsolute(uri) ? uri : undefined;
};

const inside = (path: string, root: string): boolean => {
  const rel = relative(root, path);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
};

const canonical = async (path: string): Promise<string> => {
  let existing = path;
  const rest: string[] = [];
  for (;;) {
    const real = await realpath(existing).catch(() => undefined);
    if (real !== undefined) return rest.length === 0 ? real : join(real, ...rest.reverse());
    const parent = dirname(existing);
    if (parent === existing) return path;
    rest.push(basename(existing));
    existing = parent;
  }
};

async function* capped(handle: FileHandle): AsyncIterable<Buffer> {
  let read = 0;
  for await (const chunk of handle.createReadStream({ autoClose: false })) {
    const bytes = chunk as Buffer;
    read += bytes.length;
    if (read > FILE_ADD_LIMIT) throw new TooLarge(read);
    yield bytes;
  }
}

const copyIn = async (deps: OutsideToolDeps, binding: McpBinding, asked: string): Promise<ToolAnswer> => {
  const reported = (binding.roots ?? []).flatMap((uri) => {
    const path = reportedPath(uri);
    return path === undefined ? [] : [path];
  });
  if (reported.length === 0) return refusal(NO_ROOTS);
  const resolvedRoots = await Promise.all(reported.map((path) => realpath(path).catch(() => undefined)));
  if (!isAbsolute(asked) && resolvedRoots[0] === undefined) return refusal(firstRootMissing(reported[0]!));
  const roots = resolvedRoots.filter((root): root is string => root !== undefined);
  if (roots.length === 0) return refusal(NO_ROOTS);
  const requested = await canonical(isAbsolute(asked) ? resolve(asked) : resolve(roots[0]!, asked));
  if (!roots.some((root) => inside(requested, root))) return refusal(outsideRoots(asked, reported));
  const target = await realpath(requested).catch(() => undefined);
  if (target === undefined) return refusal(noFile(asked));
  if (!roots.some((root) => inside(target, root))) return refusal(outsideRoots(asked, reported));

  let handle: FileHandle;
  try {
    handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return refusal(noFile(asked));
    if (code === "ELOOP") return refusal(CHANGED(asked));
    throw error;
  }
  try {
    const info = await handle.stat();
    if (!info.isFile()) return refusal(notAFile(asked));
    const mime = boardMediaType(target);
    if (mime === undefined) return refusal(unsupported(asked));
    if (info.size > FILE_ADD_LIMIT) return refusal(tooLarge(asked, info.size));
    if (info.size === 0) return refusal(`${basename(asked)} is empty.`);
    const originalName = basename(target);
    let saved: { file: string; bytes: number };
    try {
      saved = await deps.save(binding.project, { originalName, mime, body: capped(handle), source: "outside-agent", of: originalName, chat: binding.chatId });
    } catch (error) {
      if (error instanceof TooLarge) return refusal(tooLarge(asked, error.bytes));
      throw error;
    }
    const kind = mime.startsWith("video/") ? "video" : "image";
    return { value: { file: saved.file, fileName: originalName, kind, mime, bytes: saved.bytes, place: `canvas_write create with kind "${kind}" and props.file "${saved.file}"` } };
  } finally {
    await handle.close().catch(() => undefined);
  }
};

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
      properties: { path: { type: "string", description: "The file's path, absolute or relative to your first working folder." } },
      required: ["path"],
      additionalProperties: false,
    },
    call: async (binding, args): Promise<ToolAnswer> => {
      const asked = typeof args.path === "string" ? args.path.trim() : "";
      if (asked === "") return refusal("Name the file to add with path.");
      return copyIn(deps, binding, asked);
    },
  },
];
