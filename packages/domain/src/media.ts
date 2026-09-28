import { projectSlug } from "./slug.ts";

/** A video file over this many bytes (25 MB) is refused before upload. */
export const VIDEO_FILE_LIMIT = 26_214_400;

/** The upload route's body limit: 500 MB. Images are accepted up to this size. */
export const UPLOAD_BODY_LIMIT = 500 * 1_048_576;

export const VIDEO_TOO_LARGE_MESSAGE = "Video is too large. Keep it under 25MB.";
export const VIDEO_LINK_MESSAGE = "Paste a full https:// link to a video file.";

const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "text/html": "html",
};

const essence = (mime: string): string => mime.split(";")[0]!.trim().toLowerCase();

const nameExtension = (name: string): string | undefined => {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return undefined;
  const ext = name.slice(dot + 1);
  return /^[A-Za-z0-9]{1,5}$/.test(ext) ? ext.toLowerCase() : undefined;
};

const withoutExtension = (name: string): string => {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? name : name.slice(0, dot);
};

/** The extension a saved file gets: by its type, else the original name's own (1 to 5 letters or digits), else `bin`. */
export const extensionFor = (mime: string, originalName: string): string =>
  EXTENSIONS[essence(mime)] ?? nameExtension(originalName) ?? "bin";

/**
 * `<epoch ms>-<slug of the name without its extension, or "upload">[-<n>].<ext>`, where
 * `n` starts at 1 and counts up while `exists` says the name is taken.
 */
export const mediaFileName = (input: {
  readonly originalName: string;
  readonly mime: string;
  readonly now: number;
  readonly exists: (name: string) => boolean;
}): string => {
  const base = `${input.now}-${projectSlug(withoutExtension(input.originalName)) || "upload"}`;
  const ext = extensionFor(input.mime, input.originalName);
  let name = `${base}.${ext}`;
  for (let n = 1; input.exists(name); n++) name = `${base}-${n}.${ext}`;
  return name;
};

/** The sidecar next to a file: the same base name with `.json`. */
export const sidecarFileName = (file: string): string => `${withoutExtension(file)}.json`;

/** The sidecar of an uploaded or copied file. `of` is the source file, present only for a copy. */
export interface MediaSidecar {
  readonly source: "upload" | "copy";
  readonly fileName: string;
  readonly mime: string;
  readonly bytes: number;
  readonly at: string;
  readonly of?: string;
}

export const sidecarText = (sidecar: MediaSidecar): string => {
  const ordered: Record<string, unknown> = {
    source: sidecar.source,
    fileName: sidecar.fileName,
    mime: sidecar.mime,
    bytes: sidecar.bytes,
    at: sidecar.at,
  };
  if (sidecar.of !== undefined) ordered.of = sidecar.of;
  return `${JSON.stringify(ordered, null, 2)}\n`;
};

/** A copy's original name: the source name with its leading `<digits>-` removed. */
export const copyFileName = (sourceFile: string): string => sourceFile.replace(/^\d+-/, "");

const VIDEO_PATH = /\.(mp4|mov|webm|m4v)$/i;

/** A single `https://` URL whose path ends in `.mp4`, `.mov`, `.webm` or `.m4v`, query ignored. */
export const isVideoLink = (text: string): boolean => {
  const value = text.trim();
  if (!/^https:\/\/\S+$/i.test(value)) return false;
  try {
    return VIDEO_PATH.test(new URL(value).pathname);
  } catch {
    return false;
  }
};

/** What the empty video's "Use link" accepts: `https://` followed by anything. */
export const isHttpsLink = (value: string): boolean => /^https:\/\/.+/.test(value);

/** A linked clip's name: its last path segment without the query, or "linked video". */
export const linkedVideoName = (url: string): string => {
  let segment = "";
  try {
    segment = new URL(url).pathname.split("/").pop() ?? "";
  } catch {
    segment = url.split(/[?#]/)[0]!.split("/").pop() ?? "";
  }
  try {
    segment = decodeURIComponent(segment);
  } catch {
    // keep it as written
  }
  return segment === "" ? "linked video" : segment;
};

/** The name of a pasted file that has none: `pasted-<kind>.<ext>` from its type, `png` when unknown. */
export const pastedFileName = (kind: "image" | "video", mime: string): string => {
  const type = essence(mime);
  const subtype = type.split("/")[1] ?? "";
  const ext = EXTENSIONS[type] ?? (/^[a-z0-9]{1,5}$/.test(subtype) ? subtype : "png");
  return `pasted-${kind}.${ext}`;
};
