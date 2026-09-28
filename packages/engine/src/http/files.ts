import { extname, join } from "node:path";
import { fileNameOf } from "../paths.ts";
import type { Route } from "./api.ts";
import { sendError } from "./respond.ts";
import { sendFile } from "./sendFile.ts";

const FILE_PREFIX = "/api/file/";

/**
 * Anything a browser could run as a page or a script is served as plain text: a page is
 * never rendered from the app's origin.
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
  ".css": "text/css; charset=utf-8",
  ".html": "text/plain; charset=utf-8",
  ".htm": "text/plain; charset=utf-8",
  ".xhtml": "text/plain; charset=utf-8",
  ".js": "text/plain; charset=utf-8",
  ".mjs": "text/plain; charset=utf-8",
};

export const contentTypeFor = (name: string): string =>
  CONTENT_TYPES[extname(name).toLowerCase()] ?? "application/octet-stream";

/**
 * `GET /api/file/<project>/<name>` (and `HEAD`). `projectFolder` slugs the project and
 * `fileNameOf` keeps only the name's basename, so neither can escape the project folder.
 */
export const projectFileRoute =
  (projectFolder: (project: string) => Promise<string | undefined>): Route =>
  async (req, res, url) => {
    if (!url.pathname.startsWith(FILE_PREFIX) || (req.method !== "GET" && req.method !== "HEAD")) return false;
    const rest = url.pathname.slice(FILE_PREFIX.length);
    const slash = rest.indexOf("/");
    let folder: string | undefined;
    let name: string | undefined;
    if (slash >= 0) {
      try {
        folder = await projectFolder(decodeURIComponent(rest.slice(0, slash)));
        name = fileNameOf(decodeURIComponent(rest.slice(slash + 1)));
      } catch {
        // A malformed escape names no file.
      }
    }
    const sent =
      folder !== undefined &&
      name !== undefined &&
      (await sendFile(
        req,
        res,
        join(folder, name),
        {
          "content-type": contentTypeFor(name),
          "cache-control": "no-cache",
          // Opened as a document, the file gets no script and no origin.
          "content-security-policy": "sandbox",
        },
        { ranges: true },
      ));
    if (!sent) sendError(res, 404, "File not found.");
    return true;
  };
