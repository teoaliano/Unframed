import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type http from "node:http";
import { pipeline } from "node:stream/promises";

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

/**
 * Streams a file for GET or answers its headers for HEAD, with byte ranges when asked.
 * Answers false, sending nothing, when `path` is not a file, so the caller answers 404.
 */
export const sendFile = async (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  path: string,
  headers: http.OutgoingHttpHeaders,
  options: { readonly ranges?: boolean } = {},
): Promise<boolean> => {
  const info = await stat(path).catch(() => undefined);
  if (!info?.isFile()) return false;
  const base: http.OutgoingHttpHeaders = {
    ...headers,
    "x-content-type-options": "nosniff",
    ...(options.ranges ? { "accept-ranges": "bytes" } : {}),
  };
  const range = options.ranges ? parseRange(req.headers.range, info.size) : undefined;
  if (range === "unsatisfiable") {
    res.writeHead(416, { ...base, "content-range": `bytes */${info.size}` });
    res.end();
    return true;
  }
  const start = range?.start ?? 0;
  const end = range?.end ?? info.size - 1;
  const length = info.size === 0 ? 0 : end - start + 1;
  res.writeHead(range ? 206 : 200, {
    ...base,
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
