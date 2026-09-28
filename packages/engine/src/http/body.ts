import type http from "node:http";
import { MAX_REQUEST_BYTES, NOT_JSON_MESSAGE, tooLargeMessage } from "@unframed/domain";

/** A body the route cannot use. The API listener answers it with its status and message. */
export class HttpBodyError extends Error {
  readonly status: 400 | 413;
  constructor(status: 400 | 413, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * The one JSON body parser every HTTP route uses. Caps the body at 60 MB: it refuses a
 * declared length over the cap before reading, and an undeclared one as soon as it
 * passes it.
 */
export const readJsonBody = async (req: http.IncomingMessage, limit = MAX_REQUEST_BYTES): Promise<unknown> => {
  const header = req.headers["content-length"];
  const declared = header !== undefined && /^\d+$/.test(header) ? Number(header) : undefined;
  if (declared !== undefined && declared > limit) {
    req.resume();
    throw new HttpBodyError(413, tooLargeMessage(declared, limit));
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    total += chunk.length;
    if (total > limit) {
      req.resume();
      throw new HttpBodyError(413, tooLargeMessage(declared, limit));
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpBodyError(400, NOT_JSON_MESSAGE);
  }
};
