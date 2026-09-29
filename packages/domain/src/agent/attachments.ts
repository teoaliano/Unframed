/**
 * Chat attachments (spec 07, t3code's limits): what a file is, whether a message's set is
 * within the limits, and the id a stored file gets. The composer and the engine both use
 * these, so they never disagree about what a file is.
 */
import type { AttachmentKind } from "./chatModel.ts";

const MIB = 1024 * 1024;

export const ATTACHMENT_LIMITS = {
  count: 100,
  imageBytes: 10 * MIB,
  totalImageBytes: 80 * MIB,
  fileBytes: 50 * MIB,
  promptChars: 120_000,
} as const;

/** The image types a model takes natively. Every other type, SVG and HEIC included, is a file. */
export const NATIVE_IMAGE_TYPES: ReadonlyArray<string> = ["image/gif", "image/jpeg", "image/png", "image/webp"];

const IMAGE_EXTENSIONS: Readonly<Record<string, string>> = {
  "image/gif": ".gif",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

const TYPES_BY_EXTENSION: Readonly<Record<string, string>> = {
  gif: "image/gif",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  svg: "image/svg+xml",
  heic: "image/heic",
  heif: "image/heif",
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  html: "text/html",
  htm: "text/html",
  mp4: "video/mp4",
  mov: "video/quicktime",
  zip: "application/zip",
};

const extensionOf = (name: string): string | undefined => /\.([^./\\]+)$/.exec(name)?.[1]?.toLowerCase();

/**
 * What a file is: its type, inferred from the extension when the reported one is empty or
 * `application/octet-stream` (a reported type beats the extension, so a PDF renamed `.png`
 * is still a file), and its kind: an image only for the types a model takes natively.
 */
export const classifyAttachment = (input: { readonly name: string; readonly mimeType: string }): { kind: AttachmentKind; type: string } => {
  const reported = input.mimeType.split(";")[0]!.trim().toLowerCase();
  const inferred = TYPES_BY_EXTENSION[extensionOf(input.name) ?? ""];
  const type = reported === "" || reported === "application/octet-stream" ? (inferred ?? "application/octet-stream") : reported;
  return { kind: NATIVE_IMAGE_TYPES.includes(type) ? "image" : "file", type };
};

export interface SizedAttachment {
  readonly name: string;
  readonly kind: AttachmentKind;
  readonly size: number;
}

const megabytes = (bytes: number) => bytes / MIB;

/** The first limit a message's attachments break, as the sentence the person reads; `undefined` when none. */
export const attachmentLimitError = (attachments: ReadonlyArray<SizedAttachment>): string | undefined => {
  if (attachments.length > ATTACHMENT_LIMITS.count) return `You can attach up to ${ATTACHMENT_LIMITS.count} files per message.`;
  let imageBytes = 0;
  for (const attachment of attachments) {
    if (!(attachment.size > 0)) return `'${attachment.name}' is empty or could not be read.`;
    const limit = attachment.kind === "image" ? ATTACHMENT_LIMITS.imageBytes : ATTACHMENT_LIMITS.fileBytes;
    if (attachment.size > limit) return `'${attachment.name}' exceeds the ${megabytes(limit)} MB attachment limit.`;
    if (attachment.kind === "image") imageBytes += attachment.size;
  }
  if (imageBytes > ATTACHMENT_LIMITS.totalImageBytes) {
    return "Images can total up to 80 MiB per message or question response. Use smaller images or send fewer at once.";
  }
  return undefined;
};

/** The sentence for a message text over the limit; `undefined` when it fits. */
export const promptLengthError = (text: string): string | undefined => {
  const over = text.length - ATTACHMENT_LIMITS.promptChars;
  if (over <= 0) return undefined;
  return `Prompt is ${over.toLocaleString("en-US")} character${over === 1 ? "" : "s"} over the 120,000-character limit. Shorten or split it before sending.`;
};

/**
 * A stored attachment's id: the first 32 hex characters of the bytes' SHA-256, and an
 * extension: the name's own when it matches `^\.[a-z0-9]{1,10}$`, else the image type's,
 * else `.bin`. The same bytes under the same name always get the same id.
 */
export const attachmentId = (sha256Hex: string, name: string, type: string): string => {
  const own = /\.[^./\\]+$/.exec(name)?.[0];
  const extension = own !== undefined && /^\.[a-z0-9]{1,10}$/.test(own) ? own : (IMAGE_EXTENSIONS[type] ?? ".bin");
  return `${sha256Hex.slice(0, 32).toLowerCase()}${extension}`;
};

/** Whether an id may name a stored file: never `..`, `/`, `\` or NUL. */
export const isAttachmentId = (id: string): boolean =>
  id !== "" && !id.includes("..") && !id.includes("/") && !id.includes("\\") && !id.includes("\u0000");

/** The native image type the bytes are, by their signature; `undefined` for anything else. */
export const sniffImageType = (bytes: Uint8Array): string | undefined => {
  const at = (index: number) => bytes[index];
  if (bytes.length >= 8 && at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return "image/png";
  if (bytes.length >= 3 && at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "image/jpeg";
  if (bytes.length >= 6 && at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x38) return "image/gif";
  if (
    bytes.length >= 12 &&
    String.fromCharCode(at(0)!, at(1)!, at(2)!, at(3)!) === "RIFF" &&
    String.fromCharCode(at(8)!, at(9)!, at(10)!, at(11)!) === "WEBP"
  ) {
    return "image/webp";
  }
  return undefined;
};

/**
 * What a stored file is, re-derived from its bytes and its id: an image only when its
 * signature is a native image type, so a message can never claim a file is something it is
 * not. Anything else is a file, typed by the id's extension.
 */
export const storedAttachmentType = (id: string, head: Uint8Array): { kind: AttachmentKind; type: string } => {
  const image = sniffImageType(head);
  if (image !== undefined) return { kind: "image", type: image };
  const type = TYPES_BY_EXTENSION[extensionOf(id) ?? ""];
  return { kind: "file", type: type === undefined || NATIVE_IMAGE_TYPES.includes(type) ? "application/octet-stream" : type };
};
