import type http from "node:http";

/** Every HTTP error answer is JSON with an `error` string. */
export const sendJson = (
  res: http.ServerResponse,
  status: number,
  body: unknown,
  headers: http.OutgoingHttpHeaders = {},
): void => {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
    "cache-control": "no-cache",
    "x-content-type-options": "nosniff",
    ...headers,
  });
  res.end(text);
};

export const sendError = (res: http.ServerResponse, status: number, message: string): void =>
  sendJson(res, status, { error: message });

export const NOT_FOUND = "Not found.";

export const notFound = (res: http.ServerResponse): void => sendError(res, 404, NOT_FOUND);
