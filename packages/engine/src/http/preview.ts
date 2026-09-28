import http from "node:http";
import { guardRequest, guardUpgrade, refuseUpgrade } from "./guard.ts";
import { NOT_FOUND, notFound } from "./respond.ts";

/**
 * The preview origin: a second loopback listener that serves artifact files and nothing
 * else. In this spec it has no route, so every path answers 404 once the guard passes.
 */
export const createPreviewServer = (): http.Server => {
  const server = http.createServer({ requireHostHeader: false }, (req, res) => {
    if (!guardRequest(req, res)) return;
    notFound(res);
  });
  server.on("upgrade", (req, socket) => {
    if (!guardUpgrade(req, socket)) return;
    refuseUpgrade(socket, 404, NOT_FOUND);
  });
  return server;
};
