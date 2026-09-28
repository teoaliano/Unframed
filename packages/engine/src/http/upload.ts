import type http from "node:http";
import { isBareFileName } from "@unframed/contracts";
import { PREVIEW_SIZES, UPLOAD_BODY_LIMIT, type PreviewSize, type RenderedSidecar } from "@unframed/domain";
import { SaveRefused, type MediaStore } from "../media/mediaStore.ts";
import type { Route } from "./api.ts";
import { sendError, sendJson } from "./respond.ts";

const UPLOAD_PATH = /^\/api\/projects\/([^/]+)\/files$/;
const TOO_LARGE = "That file is larger than the 500MB upload limit.";
const NOT_RENDERED = "That is not a composite or sketch upload.";

const parseJson = (text: string | null): { ok: true; value: unknown } | { ok: false } => {
  if (text === null) return { ok: true, value: undefined };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
};

/**
 * A composite or sketch rendered at send time (spec 03) names itself with `source`, and
 * its sidecar keeps `of` (the image it was rendered from), `marks` and `crop`.
 */
const renderedSidecar = (params: URLSearchParams): RenderedSidecar | undefined | "refused" => {
  const source = params.get("source");
  if (source === null) return undefined;
  if (source !== "composite" && source !== "sketch") return "refused";
  const marks = parseJson(params.get("marks"));
  const crop = parseJson(params.get("crop"));
  const of = params.get("of");
  if (!marks.ok || !crop.ok) return "refused";
  const ids = marks.value ?? [];
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string")) return "refused";
  if (of !== null && (source !== "composite" || !isBareFileName(of))) return "refused";
  return { source, ...(of === null ? {} : { of }), marks: ids as string[], crop: crop.value ?? null };
};

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
      const rendered = renderedSidecar(url.searchParams);
      if (rendered === "refused") {
        req.resume();
        sendError(res, 400, NOT_RENDERED);
        return true;
      }
      sendJson(res, 200, await media.save(project, { originalName: name, mime, body: req, rendered }));
    } catch (error) {
      if (!(error instanceof SaveRefused)) throw error;
      if (req.readableEnded) sendError(res, error.status, error.message);
      else sendJson(res, error.status, { error: error.message }, { connection: "close" });
    }
    return true;
  };
