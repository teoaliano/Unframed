import { extname, join } from "node:path";
import { AUDIO_SERVED_TYPES, snapshotFileName } from "@unframed/domain";
import { PREVIEW_FOLDER, previewFileName } from "../media/mediaStore.ts";
import { SNAPSHOT_FOLDER } from "../artifacts/snapshots.ts";
import { fileNameOf } from "../paths.ts";
import type { Route } from "./api.ts";
import { sendError } from "./respond.ts";
import { sendFile } from "./sendFile.ts";

const FILE_PREFIX = "/api/file/";

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
  ...Object.fromEntries(Object.entries(AUDIO_SERVED_TYPES).map(([ext, mime]) => [`.${ext}`, mime])),
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

const contentTypeFor = (name: string): string =>
  CONTENT_TYPES[extname(name).toLowerCase()] ?? "application/octet-stream";

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
      }
    }
    const preview = url.searchParams.get("preview");
    const size = preview === "512" ? 512 : preview === "2048" ? 2048 : undefined;
    const snapshot = url.searchParams.get("snapshot");
    const still = snapshot === null ? undefined : /^(\d{1,5})x(\d{1,5})$/.exec(snapshot);
    const stillKit = { mode: url.searchParams.get("mode"), kit: url.searchParams.get("kit") };
    const path =
      folder === undefined || name === undefined
        ? undefined
        : still
          ? join(folder, SNAPSHOT_FOLDER, snapshotFileName(name, { w: Number(still[1]), h: Number(still[2]) }, stillKit))
          : size !== undefined
            ? join(folder, PREVIEW_FOLDER, previewFileName(name, size))
            : preview === null && snapshot === null
              ? join(folder, name)
              : undefined;
    const sent =
      path !== undefined &&
      name !== undefined &&
      (await sendFile(
        req,
        res,
        path,
        {
          "content-type": still ? "image/png" : size === undefined ? contentTypeFor(name) : "image/webp",
          "cache-control": "no-cache",
          "content-security-policy": "sandbox",
        },
        { ranges: true },
      ));
    if (!sent) sendError(res, 404, "File not found.");
    return true;
  };
