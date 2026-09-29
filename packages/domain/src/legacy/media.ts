/**
 * Media in old graphs (spec 11): inline `data:` URLs, `https://` clip links, file names
 * carried in result URLs and saved paths, and the names extracted files get.
 */
import { extensionFor } from "../media.ts";
import { projectSlug } from "../slug.ts";

export interface DataUrl {
  readonly mime: string;
  readonly bytes: Uint8Array;
}

/** A base64 `data:` URL's type and bytes, or `undefined` when it is not one. */
export const parseDataUrl = (url: unknown): DataUrl | undefined => {
  if (typeof url !== "string") return undefined;
  const match = /^data:([^;,]*)((?:;[^;,]*)*),(.*)$/s.exec(url);
  if (!match || !match[2]!.split(";").includes("base64")) return undefined;
  const text = match[3]!.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text) || text.length % 4 === 1) return undefined;
  let binary: string;
  try {
    binary = atob(text);
  } catch {
    return undefined;
  }
  const bytes = new Uint8Array(binary.length);
  for (let at = 0; at < binary.length; at++) bytes[at] = binary.charCodeAt(at);
  return { mime: match[1]!.trim().toLowerCase() || "application/octet-stream", bytes };
};

const withoutExtension = (name: string): string => {
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? name : name.slice(0, dot);
};

/**
 * The deterministic name of a file extracted from a `data:` URL: `legacy-`, the first 16
 * hex characters of the bytes' SHA-256, `-`, the slug of the old file name without its
 * extension (or `upload`), and the extension of its type.
 */
export const extractedFileName = (input: { readonly hash: string; readonly fileName: string; readonly mime: string }): string =>
  `legacy-${input.hash.slice(0, 16)}-${projectSlug(withoutExtension(input.fileName)) || "upload"}.${extensionFor(input.mime, input.fileName)}`;

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  svg: "image/svg+xml",
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  html: "text/html",
};

/** A file's type from its extension, when it is one media files have. */
export const mimeByExtension = (file: string): string | undefined => {
  const dot = file.lastIndexOf(".");
  return dot < 0 ? undefined : MIME_BY_EXTENSION[file.slice(dot + 1).toLowerCase()];
};

/** The last segment of a path written with either separator. */
export const baseName = (path: string): string => path.split(/[\\/]/).pop() ?? "";

/** The file an old result URL names: the last segment after `/api/file/`, decoded, without a query. */
export const fileOfResultUrl = (url: unknown): string | undefined => {
  if (typeof url !== "string") return undefined;
  const at = url.indexOf("/api/file/");
  if (at < 0) return undefined;
  const segment = url.slice(at).split(/[?#]/)[0]!.split("/").pop() ?? "";
  try {
    return decodeURIComponent(segment) || undefined;
  } catch {
    return segment || undefined;
  }
};
