import http from "node:http";
import https from "node:https";
import type { Socket } from "node:net";
import type { Duplex } from "node:stream";
import { internalErrorMessage, deviceGuard, isPrivateAddress } from "@unframed/domain";
import type { Route, UpgradeRoute } from "../http/api.ts";
import { HttpBodyError } from "../http/body.ts";
import { refuseUpgrade } from "../http/guard.ts";
import { NOT_FOUND, notFound, sendError } from "../http/respond.ts";
import { errorText, logError, stackText } from "../log.ts";
import type { LeafMaterial } from "./certificates.ts";
import { markDeviceRequest } from "./deviceSockets.ts";
import { pairPage } from "./pairPage.ts";

export const DEVICE_COOKIE = "unframed_device";
const COOKIE_MAX_AGE = 34_560_000;
export const PAIR_FIRST = "Pair this device in Unframed's Settings on your Mac.";
const PAIR_PATH = "/pair";
const PAIR_API = "/api/ipad/pair";

const OPEN_PATHS: ReadonlySet<string> = new Set(["/manifest.webmanifest", "/apple-touch-icon.png", "/favicon.ico"]);

export interface DeviceAuth {
  readonly resolve: (token: string) => { readonly id: string } | undefined;
  readonly touch: (id: string) => void;
  readonly pair: (
    code: string,
    userAgent: string,
  ) => Promise<{ readonly ok: true; readonly token: string } | { readonly ok: false; readonly message: string }>;
}

export interface IpadListenerOptions {
  readonly port: number;
  readonly localName: string;
  readonly certificates: LeafMaterial;
  readonly acceptLoopback: boolean;
  readonly auth: DeviceAuth;
  readonly routes: ReadonlyArray<Route>;
  readonly upgrades: ReadonlyArray<UpgradeRoute>;
}

export interface IpadListener {
  readonly port: number;
  readonly update: (next: { readonly certificates: LeafMaterial; readonly localName: string }) => void;
  readonly stop: () => void;
}

const isLoopbackAddress = (ip: string): boolean => /^127\./.test(ip) || ip === "::1" || ip === "::ffff:127.0.0.1";

const cookieValue = (header: string | undefined, name: string): string | undefined => {
  for (const part of (header ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return undefined;
};

const isNavigation = (req: http.IncomingMessage): boolean => {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  const mode = req.headers["sec-fetch-mode"];
  if (typeof mode === "string") return mode === "navigate";
  return (req.headers.accept ?? "").includes("text/html");
};

const readBody = async (req: http.IncomingMessage, limit = 4096): Promise<string> => {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    total += chunk.length;
    if (total > limit) {
      req.resume();
      throw new HttpBodyError(413, "That request is too large.");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
};

const codeOf = (body: string, contentType: string | undefined): string => {
  if ((contentType ?? "").includes("application/json")) {
    try {
      const parsed: unknown = JSON.parse(body);
      const code = (parsed as { code?: unknown } | null)?.code;
      return typeof code === "string" ? code : "";
    } catch {
      return "";
    }
  }
  return new URLSearchParams(body).get("code") ?? "";
};

const sendHtml = (res: http.ServerResponse, status: number, html: string): void => {
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(html),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(html);
};

export const startIpadListener = async (
  options: IpadListenerOptions,
): Promise<{ readonly ok: true; readonly listener: IpadListener } | { readonly ok: false; readonly reason: "port_taken" | "failed"; readonly error: string }> => {
  let boundPort = options.port;
  let localName = options.localName;
  const allowedAddress = (ip: string | undefined): boolean =>
    ip !== undefined && (options.acceptLoopback ? isLoopbackAddress(ip) : isPrivateAddress(ip));

  const guard = (req: http.IncomingMessage) =>
    deviceGuard({ host: req.headers.host, origin: req.headers.origin, localName, port: boundPort });

  const deviceOf = (req: http.IncomingMessage) => {
    const token = cookieValue(req.headers.cookie, DEVICE_COOKIE);
    return token === undefined ? undefined : options.auth.resolve(token);
  };

  const pairPost = async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    const body = await readBody(req);
    const outcome = await options.auth.pair(codeOf(body, req.headers["content-type"]), req.headers["user-agent"] ?? "");
    if (!outcome.ok) {
      sendHtml(res, 400, pairPage({ code: "", message: outcome.message }));
      return;
    }
    res.writeHead(303, {
      location: "/",
      "set-cookie": `${DEVICE_COOKIE}=${outcome.token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${COOKIE_MAX_AGE}`,
      "cache-control": "no-store",
    });
    res.end();
  };

  const handle = async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    const decision = guard(req);
    if (!decision.allowed) {
      sendError(res, decision.status, decision.error);
      return;
    }
    const url = new URL(req.url ?? "/", `https://${localName}`);
    if (url.pathname === PAIR_PATH && (req.method === "GET" || req.method === "HEAD")) {
      sendHtml(res, 200, pairPage({ code: url.searchParams.get("code") ?? "" }));
      return;
    }
    if (url.pathname === PAIR_API && req.method === "POST") {
      await pairPost(req, res);
      return;
    }
    const device = deviceOf(req);
    if (device === undefined && !OPEN_PATHS.has(url.pathname)) {
      if (isNavigation(req)) {
        res.writeHead(303, { location: PAIR_PATH, "cache-control": "no-store" });
        res.end();
        return;
      }
      sendError(res, 401, PAIR_FIRST);
      return;
    }
    if (device !== undefined) options.auth.touch(device.id);
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    for (const route of options.routes) {
      if (await route(req, res, url)) return;
    }
    notFound(res);
  };

  const server = https.createServer(
    { key: options.certificates.leafKeyPem, cert: options.certificates.leafPem, requireHostHeader: false },
    (req, res) => {
      void handle(req, res).catch((error: unknown) => {
        if (error instanceof HttpBodyError && !res.headersSent) {
          sendError(res, error.status, error.message);
          return;
        }
        logError(`ipad ${req.method} ${req.url} failed: ${stackText(error)}`);
        if (res.headersSent) res.destroy();
        else sendError(res, 500, internalErrorMessage(errorText(error)));
      });
    },
  );

  server.on("connection", (socket: Socket) => {
    if (!allowedAddress(socket.remoteAddress) || !allowedAddress(socket.localAddress)) socket.destroy();
  });

  server.on("upgrade", (req: http.IncomingMessage, socket: Duplex, head: Buffer) => {
    const decision = guard(req);
    if (!decision.allowed) {
      refuseUpgrade(socket, decision.status, decision.error);
      return;
    }
    const device = deviceOf(req);
    if (device === undefined) {
      refuseUpgrade(socket, 401, PAIR_FIRST);
      return;
    }
    options.auth.touch(device.id);
    markDeviceRequest(req, device.id);
    const url = new URL(req.url ?? "/", `https://${localName}`);
    for (const route of options.upgrades) {
      if (route(req, socket, head, url)) return;
    }
    refuseUpgrade(socket, 404, NOT_FOUND);
  });

  const listened = await new Promise<{ ok: true; port: number } | { ok: false; error: NodeJS.ErrnoException }>((resolve) => {
    const onError = (error: NodeJS.ErrnoException) => {
      server.off("listening", onListening);
      resolve({ ok: false, error });
    };
    const onListening = () => {
      server.off("error", onError);
      const address = server.address();
      resolve(address === null || typeof address === "string" ? { ok: false, error: new Error("no port") } : { ok: true, port: address.port });
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen({ port: options.port, host: "0.0.0.0" });
  });
  if (!listened.ok) {
    server.close();
    return { ok: false, reason: listened.error.code === "EADDRINUSE" ? "port_taken" : "failed", error: errorText(listened.error) };
  }
  boundPort = listened.port;

  return {
    ok: true,
    listener: {
      port: boundPort,
      update: (next) => {
        localName = next.localName;
        server.setSecureContext({ key: next.certificates.leafKeyPem, cert: next.certificates.leafPem });
      },
      stop: () => {
        server.close();
        server.closeIdleConnections();
      },
    },
  };
};
