import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type http from "node:http";
import { basename, extname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import type { Route } from "./api.ts";
import { sendError } from "./respond.ts";

const FILE_PREFIX = "/api/file/";

/**
 * Anything a browser could run as a document or script is served as plain text: a page
 * is never rendered from the app's origin.
 */
const CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".json": "application/json; charset=utf-8",
  ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".html": "text/plain; charset=utf-8",
  ".htm": "text/plain; charset=utf-8",
  ".xhtml": "text/plain; charset=utf-8",
  ".js": "text/plain; charset=utf-8",
  ".mjs": "text/plain; charset=utf-8",
  ".css": "text/plain; charset=utf-8",
};

export const contentTypeFor = (name: string): string =>
  CONTENT_TYPES[extname(name).toLowerCase()] ?? "application/octet-stream";

type ByteRange = { start: number; end: number } | "unsatisfiable" | undefined;

/** One `bytes=` range. Anything else (several ranges, other units) serves the whole file. */
export const parseRange = (header: string | undefined, size: number): ByteRange => {
  const match = header === undefined ? null : /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return undefined;
  const [, first = "", last = ""] = match;
  if (first === "" && last === "") return undefined;
  let start: number;
  let end: number;
  if (first === "") {
    const suffix = Number(last);
    if (suffix === 0) return "unsatisfiable";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(first);
    end = last === "" ? size - 1 : Math.min(Number(last), size - 1);
  }
  if (start >= size || start > end) return "unsatisfiable";
  return { start, end };
};

const fileNotFound = (res: http.ServerResponse) => sendError(res, 404, "File not found.");

/**
 * `GET /api/file/<project>/<name>` (and `HEAD`). The project is slugged and the name
 * reduced to its basename by `resolve`, so neither can escape the project folder.
 */
export const projectFileRoute =
  (projectFolder: (project: string) => Promise<string | undefined>): Route =>
  async (req, res, url) => {
    if (!url.pathname.startsWith(FILE_PREFIX)) return false;
    if (req.method !== "GET" && req.method !== "HEAD") {
      sendError(res, 405, "Only GET and HEAD are allowed here.");
      return true;
    }
    const rest = url.pathname.slice(FILE_PREFIX.length);
    const slash = rest.indexOf("/");
    if (slash < 0) {
      fileNotFound(res);
      return true;
    }
    let project: string;
    let name: string;
    try {
      project = decodeURIComponent(rest.slice(0, slash));
      name = basename(decodeURIComponent(rest.slice(slash + 1)));
    } catch {
      fileNotFound(res);
      return true;
    }
    const folder = await projectFolder(project);
    if (folder === undefined || name === "" || name === "." || name === "..") {
      fileNotFound(res);
      return true;
    }
    const path = join(folder, name);
    const info = await stat(path).catch(() => undefined);
    if (!info?.isFile()) {
      fileNotFound(res);
      return true;
    }

    const headers: http.OutgoingHttpHeaders = {
      "content-type": contentTypeFor(name),
      "cache-control": "no-cache",
      "x-content-type-options": "nosniff",
      "accept-ranges": "bytes",
      // Opened as a document, the file gets no script and no origin.
      "content-security-policy": "sandbox",
    };
    const range = parseRange(req.headers.range, info.size);
    if (range === "unsatisfiable") {
      res.writeHead(416, { ...headers, "content-range": `bytes */${info.size}` });
      res.end();
      return true;
    }
    const start = range?.start ?? 0;
    const end = range?.end ?? info.size - 1;
    const length = info.size === 0 ? 0 : end - start + 1;
    res.writeHead(range ? 206 : 200, {
      ...headers,
      "content-length": length,
      ...(range ? { "content-range": `bytes ${start}-${end}/${info.size}` } : {}),
    });
    if (req.method === "HEAD" || length === 0) {
      res.end();
      return true;
    }
    await pipeline(createReadStream(path, { start, end }), res).catch(() => res.destroy());
    return true;
  };
