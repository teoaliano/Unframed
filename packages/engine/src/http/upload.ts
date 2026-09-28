import type http from "node:http";
import { UPLOAD_BODY_LIMIT } from "@unframed/domain";
import { PREVIEW_SIZES, SaveRefused, type MediaStore, type PreviewSize } from "../media/mediaStore.ts";
import type { Route } from "./api.ts";
import { sendError, sendJson } from "./respond.ts";

const UPLOAD_PATH = /^\/api\/projects\/([^/]+)\/files$/;
const TOO_LARGE = "That file is larger than the 500MB upload limit.";

/**
 * `POST /api/projects/<project>/files?name=<original file name>`: the raw bytes become a
 * project file with a sidecar. With `preview=512` or `preview=2048` and `name` set to an
 * existing project file, the bytes are that file's WebP display preview instead, kept in
 * the regenerable cache folder with no sidecar. Plain HTTP because it carries raw bytes.
 */
export const uploadRoute =
  (media: MediaStore["Service"]): Route =>
  async (req: http.IncomingMessage, res: http.ServerResponse, url: URL) => {
    const match = UPLOAD_PATH.exec(url.pathname);
    if (!match || req.method !== "POST") return false;
    let project = "";
    try {
      project = decodeURIComponent(match[1]!);
    } catch {
      // a malformed escape names no project
    }
    const header = req.headers["content-length"];
    const declared = header !== undefined && /^\d+$/.test(header) ? Number(header) : undefined;
    if (declared !== undefined && declared > UPLOAD_BODY_LIMIT) {
      // The body is never read, so the connection cannot carry another request.
      sendJson(res, 413, { error: TOO_LARGE }, { connection: "close" });
      return true;
    }
    const name = url.searchParams.get("name") ?? "";
    const mime = (req.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
    const previewParam = url.searchParams.get("preview");
    try {
      if (previewParam !== null) {
        const size = Number(previewParam) as PreviewSize;
        if (!PREVIEW_SIZES.includes(size)) {
          req.resume();
          sendError(res, 400, "A preview is 512 or 2048 pixels.");
          return true;
        }
        const saved = await media.savePreview(project, name, size, req);
        sendJson(res, 200, { file: name, preview: size, bytes: saved.bytes });
        return true;
      }
      sendJson(res, 200, await media.save(project, { originalName: name, mime, body: req }));
    } catch (error) {
      if (!(error instanceof SaveRefused)) throw error;
      if (req.readableEnded) sendError(res, error.status, error.message);
      else sendJson(res, error.status, { error: error.message }, { connection: "close" });
    }
    return true;
  };
