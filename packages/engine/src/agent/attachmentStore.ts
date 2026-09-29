import { createHash, randomBytes } from "node:crypto";
import { mkdir, open, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  attachmentId,
  attachmentLimitError,
  classifyAttachment,
  isAttachmentId,
  storedAttachmentType,
  type MessageAttachment,
} from "@unframed/domain";
import type { Route } from "../http/api.ts";
import { sendError, sendJson } from "../http/respond.ts";

export const UPLOAD_URL_TTL_MS = 10 * 60_000;
const UPLOAD_PATH = /^\/api\/attachments\/upload\/([0-9a-f]{64})$/;

interface PendingUpload {
  readonly name: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly expiresAt: number;
}

export class AttachmentRefused extends Error {}

/**
 * Chat attachments (spec 07, t3code's flow): stored under the data folder, never in a
 * project, each named by the hash of its bytes so the same bytes twice are one file.
 * Uploads go through a signed one-use path.
 */
export class AttachmentStore {
  readonly folder: string;
  private readonly pending = new Map<string, PendingUpload>();

  constructor(dataDir: string) {
    this.folder = join(dataDir, "attachments");
  }

  /** A signed, one-use upload path, valid ten minutes, for a file within the limits. */
  createUploadUrl(input: { name: string; mimeType: string; sizeBytes: number }): { relativeUrl: string; expiresAt: string } {
    const name = input.name.trim() === "" ? "attachment" : input.name.trim();
    const { kind } = classifyAttachment({ name, mimeType: input.mimeType });
    if (!Number.isInteger(input.sizeBytes) || input.sizeBytes < 0) throw new AttachmentRefused(`'${name}' is empty or could not be read.`);
    const refusal = attachmentLimitError([{ name, kind, size: input.sizeBytes }]);
    if (refusal) throw new AttachmentRefused(refusal);
    const now = Date.now();
    for (const [token, upload] of this.pending) if (upload.expiresAt <= now) this.pending.delete(token);
    const token = randomBytes(32).toString("hex");
    const expiresAt = now + UPLOAD_URL_TTL_MS;
    this.pending.set(token, { name, mimeType: input.mimeType, sizeBytes: input.sizeBytes, expiresAt });
    return { relativeUrl: `/api/attachments/upload/${token}`, expiresAt: new Date(expiresAt).toISOString() };
  }

  /** Stores the bytes, exclusively, under their id. The same bytes twice are one file with one id. */
  async store(upload: { name: string; mimeType: string }, bytes: Buffer): Promise<MessageAttachment> {
    const { kind, type } = classifyAttachment({ name: upload.name, mimeType: upload.mimeType });
    const hash = createHash("sha256").update(bytes).digest("hex");
    const id = attachmentId(hash, upload.name, type);
    await mkdir(this.folder, { recursive: true });
    await writeFile(join(this.folder, id), bytes, { flag: "wx" }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
    return { id, name: upload.name, type, kind, size: bytes.length };
  }

  /** The stored file an id names; `undefined` when the id is refused or nothing is there. */
  path(id: string): string | undefined {
    return isAttachmentId(id) ? join(this.folder, id) : undefined;
  }

  /**
   * A message's attachment as stored: its kind and type re-derived from the bytes, never
   * taken from the message, so a message cannot claim a file is something it is not.
   */
  async resolve(ref: { id: string; name: string }): Promise<MessageAttachment | undefined> {
    const path = this.path(ref.id);
    if (path === undefined) return undefined;
    const info = await stat(path).catch(() => undefined);
    if (!info?.isFile()) return undefined;
    const handle = await open(path, "r");
    try {
      const head = Buffer.alloc(Math.min(64, info.size));
      await handle.read(head, 0, head.length, 0);
      const { kind, type } = storedAttachmentType(ref.id, new Uint8Array(head));
      return { id: ref.id, name: ref.name, type, kind, size: info.size };
    } finally {
      await handle.close();
    }
  }

  /** The upload route: `POST` the raw bytes to a path from `createUploadUrl`, exactly `sizeBytes` long. */
  route(): Route {
    return async (req, res, url) => {
      const match = UPLOAD_PATH.exec(url.pathname);
      if (!match) return false;
      if (req.method !== "POST") {
        req.resume();
        sendError(res, 405, "Upload the file with POST.");
        return true;
      }
      const token = match[1]!;
      const upload = this.pending.get(token);
      this.pending.delete(token);
      if (!upload) {
        req.resume();
        sendError(res, 404, "That upload link was already used or never existed.");
        return true;
      }
      if (upload.expiresAt <= Date.now()) {
        req.resume();
        sendError(res, 410, "That upload link has expired. Attach the file again.");
        return true;
      }
      const chunks: Buffer[] = [];
      let total = 0;
      for await (const chunk of req as AsyncIterable<Buffer>) {
        total += chunk.length;
        if (total > upload.sizeBytes) {
          req.resume();
          sendError(res, 400, `'${upload.name}' is not the size the upload said it would be.`);
          return true;
        }
        chunks.push(chunk);
      }
      if (total !== upload.sizeBytes) {
        sendError(res, 400, `'${upload.name}' is not the size the upload said it would be.`);
        return true;
      }
      if (total === 0) {
        sendError(res, 400, `'${upload.name}' is empty or could not be read.`);
        return true;
      }
      const attachment = await this.store(upload, Buffer.concat(chunks));
      sendJson(res, 200, { attachment });
      return true;
    };
  }
}
