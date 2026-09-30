import http from "node:http";
import type { Duplex } from "node:stream";
import { internalErrorMessage } from "@unframed/domain";
import { logError, stackText, errorText } from "../log.ts";
import { HttpBodyError } from "./body.ts";
import { guardRequest, guardUpgrade, refuseUpgrade } from "./guard.ts";
import { NOT_FOUND, notFound, sendError } from "./respond.ts";

/** A plain HTTP route. Answers true when it handled the request. */
export type Route = (req: http.IncomingMessage, res: http.ServerResponse, url: URL) => boolean | Promise<boolean>;

/** A WebSocket upgrade route. Answers true when it took the socket. */
export type UpgradeRoute = (req: http.IncomingMessage, socket: Duplex, head: Buffer, url: URL) => boolean;

const requestUrl = (req: http.IncomingMessage): URL => new URL(req.url ?? "/", "http://localhost");

/**
 * The API listener: the web client, the RPC socket and the plain HTTP routes, on one
 * origin. The loopback guard runs before any route or upgrade, and nothing is ever
 * readable cross-origin: no response carries a CORS allow header.
 */
export const createApiServer = (routes: {
  readonly http: ReadonlyArray<Route>;
  readonly upgrade: ReadonlyArray<UpgradeRoute>;
}): http.Server => {
  // Without this Node answers a request with no Host itself, before the guard can.
  const server = http.createServer({ requireHostHeader: false }, (req, res) => {
    if (!guardRequest(req, res)) return;
    if (req.method === "OPTIONS") {
      // No allow headers, so the browser blocks the real request.
      res.writeHead(204);
      res.end();
      return;
    }
    const url = requestUrl(req);
    void (async () => {
      for (const route of routes.http) {
        if (await route(req, res, url)) return;
      }
      notFound(res);
    })().catch((error: unknown) => {
      if (error instanceof HttpBodyError && !res.headersSent) {
        sendError(res, error.status, error.message);
        return;
      }
      logError(`${req.method} ${req.url} failed: ${stackText(error)}`);
      if (res.headersSent) res.destroy();
      else sendError(res, 500, internalErrorMessage(errorText(error)));
    });
  });
  server.on("upgrade", (req: http.IncomingMessage, socket: Duplex, head: Buffer) => {
    if (!guardUpgrade(req, socket)) return;
    const url = requestUrl(req);
    for (const route of routes.upgrade) {
      if (route(req, socket, head, url)) return;
    }
    refuseUpgrade(socket, 404, NOT_FOUND);
  });
  return server;
};
