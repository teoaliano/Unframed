import type http from "node:http";
import type { Duplex } from "node:stream";
import { loopbackGuard, type GuardDecision } from "@unframed/domain";
import { sendError } from "./respond.ts";

export const guardDecision = (req: http.IncomingMessage): GuardDecision =>
  loopbackGuard({ origin: req.headers.origin, host: req.headers.host });

/** Runs the loopback guard before any handler. Answers the refusal and returns false. */
export const guardRequest = (req: http.IncomingMessage, res: http.ServerResponse): boolean => {
  const decision = guardDecision(req);
  if (decision.allowed) return true;
  sendError(res, decision.status, decision.error);
  return false;
};

/** A refused upgrade gets a plain HTTP 403 with the same body, and no handshake. */
export const guardUpgrade = (req: http.IncomingMessage, socket: Duplex): boolean => {
  const decision = guardDecision(req);
  if (decision.allowed) return true;
  refuseUpgrade(socket, decision.status, decision.error);
  return false;
};

export const refuseUpgrade = (socket: Duplex, status: number, message: string): void => {
  const body = JSON.stringify({ error: message });
  const reason = status === 403 ? "Forbidden" : status === 404 ? "Not Found" : "Error";
  socket.end(
    `HTTP/1.1 ${status} ${reason}\r\n` +
      "Connection: close\r\n" +
      "Content-Type: application/json; charset=utf-8\r\n" +
      `Content-Length: ${Buffer.byteLength(body)}\r\n` +
      "\r\n" +
      body,
    () => socket.destroy(),
  );
};
