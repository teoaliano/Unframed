import { createHash } from "node:crypto";
import http from "node:http";
import net from "node:net";
import { StringDecoder } from "node:string_decoder";
import { pipeline, Transform, type Readable } from "node:stream";
import zlib from "node:zlib";
import {
  BRIDGE_PATH,
  bridgeTag,
  htmlInjector,
  loopbackGuard,
  mockLogEntries,
  MOCKS_EVENTS_PATH,
  MOCKS_LOG_PATH,
  MOCKS_SOURCE_PATH,
  proxiedResponseHeaders,
  REAL_MODULE_PARAM,
  restorePrefix,
  rewritesOrigin,
  screenBridgeSource,
  takeStateParam,
  takeUnframedParams,
  upstreamRequestHeaders,
  type FrozenState,
} from "@unframed/domain";
import { listenBothLoopbacks } from "../listen.ts";
import { listeningHost } from "./processes.ts";
import type { MockFiles } from "./mockFiles.ts";
import type { StateTokens } from "./stateTokens.ts";

const LOG_BODY_LIMIT = 256_000;
const SCRIPT_HEADERS = { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" };

const sendScript = (res: http.ServerResponse, body?: string) => {
  res.writeHead(200, SCRIPT_HEADERS);
  res.end(body);
};

const readBody = (req: http.IncomingMessage, limit: number): Promise<string | undefined> =>
  new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size <= limit) chunks.push(chunk);
    });
    req.on("end", () => resolve(size > limit ? undefined : Buffer.concat(chunks).toString("utf8")));
    req.on("error", () => resolve(undefined));
  });

const parsedJson = (text: string | undefined): unknown => {
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

const withoutRealParam = (path: string): { readonly path: string; readonly real: boolean } => {
  const at = path.indexOf("?");
  if (at === -1) return { path, real: false };
  const parts = path.slice(at + 1).split("&");
  const kept = parts.filter((part) => part.split("=")[0] !== REAL_MODULE_PARAM);
  if (kept.length === parts.length) return { path, real: false };
  return { path: kept.length === 0 ? path.slice(0, at) : `${path.slice(0, at)}?${kept.join("&")}`, real: true };
};

const ownPath = (path: string): boolean => path.startsWith("/__unframed/");

export interface InstanceProxy {
  readonly port: number;
  readonly close: () => Promise<void>;
}

const injecting = (tag: string): Transform => {
  const decoder = new StringDecoder("utf8");
  const injector = htmlInjector(tag);
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      callback(null, injector.push(decoder.write(chunk)));
    },
    flush(callback) {
      const rest = injector.push(decoder.end()) + injector.end();
      callback(null, rest === "" ? undefined : rest);
    },
  });
};

const decoded = (body: Readable, encoding: string): Readable | undefined => {
  if (encoding === "" || encoding === "identity") return body;
  const decoder = encoding === "gzip" || encoding === "x-gzip" ? zlib.createGunzip() : encoding === "br" ? zlib.createBrotliDecompress() : encoding === "deflate" ? zlib.createInflate() : undefined;
  return decoder === undefined ? undefined : pipeline(body, decoder, () => undefined);
};

const rawHead = (req: http.IncomingMessage, headers: Record<string, unknown>): string => {
  let head = `${req.method ?? "GET"} ${req.url ?? "/"} HTTP/1.1\r\n`;
  for (let index = 0; index < req.rawHeaders.length; index += 2) {
    const name = req.rawHeaders[index]!;
    const lower = name.toLowerCase();
    const value = lower === "origin" || lower === "host" ? String(headers[lower]) : req.rawHeaders[index + 1];
    head += `${name}: ${value}\r\n`;
  }
  return `${head}\r\n`;
};

export const startInstanceProxy = async (input: {
  readonly upstreamPort: number;
  readonly preferredPort?: number | null;
  readonly states: StateTokens;
  readonly mocks?: MockFiles | undefined;
  readonly frozen?: ((id: string) => Promise<FrozenState | undefined>) | undefined;
}): Promise<InstanceProxy> => {
  const upstreamPort = input.upstreamPort;
  const bridge = screenBridgeSource();
  let upstreamHost: string | undefined;

  const hostFor = async (): Promise<string> => {
    if (upstreamHost !== undefined) return upstreamHost;
    const host = await listeningHost(upstreamPort);
    if (host === undefined) return "127.0.0.1";
    upstreamHost = host;
    return host;
  };

  const forget = (error: NodeJS.ErrnoException) => {
    if (error.code === "ECONNREFUSED") upstreamHost = undefined;
  };

  const sockets = new Set<net.Socket>();
  const crossSite = new Set<string>();
  const onRequest = (req: http.IncomingMessage, res: http.ServerResponse) => {
    const decision = loopbackGuard({ origin: rewritesOrigin(req.url ?? "/", false) || ownPath(req.url ?? "/") ? req.headers.origin : undefined, host: req.headers.host });
    if (!decision.allowed) {
      res.writeHead(decision.status, { "content-type": "text/plain; charset=utf-8" });
      res.end(decision.error);
      return;
    }
    const asked = req.url ?? "/";
    const pathname = asked.split("?")[0]!;
    if (pathname === BRIDGE_PATH) {
      const query = new URLSearchParams(asked.slice(BRIDGE_PATH.length + 1));
      const key = query.get("state");
      const restore = query.get("restore");
      const state = key === null ? undefined : input.states.takeBridge(key);
      void Promise.all([restore === null || input.frozen === undefined ? undefined : input.frozen(restore).catch(() => undefined), input.mocks?.runtime().catch(() => "") ?? ""]).then(([frozen, mocks]) =>
        sendScript(res, [state === undefined ? "" : `window.__unframedScreenState = ${JSON.stringify(state)};\n`, frozen === undefined ? "" : restorePrefix(frozen), mocks, bridge].join("")),
      );
      return;
    }
    const mocks = input.mocks;
    if (mocks !== undefined && pathname === MOCKS_SOURCE_PATH) {
      void mocks.source().catch(() => "").then((source) => sendScript(res, source));
      return;
    }
    if (mocks !== undefined && pathname === MOCKS_LOG_PATH && req.method === "POST") {
      void readBody(req, LOG_BODY_LIMIT).then((text) => {
        mocks.note(mockLogEntries(parsedJson(text)));
        res.writeHead(204);
        res.end();
      });
      return;
    }
    const real = withoutRealParam(asked);
    if (mocks !== undefined && !real.real && (req.method === "GET" || req.method === "HEAD")) {
      void mocks.module(pathname).then((replacement) => {
        if (replacement === undefined) forward(req, res, asked);
        else sendScript(res, req.method === "HEAD" ? undefined : replacement);
      }, () => forward(req, res, asked));
      return;
    }
    forward(req, res, real.path);
  };

  const forward = (req: http.IncomingMessage, res: http.ServerResponse, asked: string) => {
    const { path: withoutState, token } = takeStateParam(asked);
    const { path, restore } = takeUnframedParams(withoutState);
    const stateKey = token === undefined ? undefined : input.states.takePage(token);
    const proxyOrigin = `http://${req.headers.host}`;
    void hostFor().then((host) => {
      const headers = upstreamRequestHeaders(req.headers, { path, upgrade: false, method: req.method, crossSite });
      const upstream = http.request({ host, port: upstreamPort, method: req.method, path, headers: headers as http.OutgoingHttpHeaders, setHost: false }, (answer) => {
        const rewritten = proxiedResponseHeaders(answer.headers, { upstreamPort, proxyOrigin });
        for (const [name, none] of rewritten.crossSite) {
          if (none) crossSite.add(name);
          else crossSite.delete(name);
        }
        const out = rewritten.headers as http.OutgoingHttpHeaders;
        const status = answer.statusCode ?? 502;
        const isHtml = /text\/html/i.test(String(answer.headers["content-type"] ?? ""));
        const body = isHtml && req.method !== "HEAD" && status !== 204 && status !== 304 ? decoded(answer, String(answer.headers["content-encoding"] ?? "").toLowerCase()) : undefined;
        if (body === undefined) {
          res.writeHead(status, out);
          answer.pipe(res);
          return;
        }
        delete out["content-length"];
        delete out["content-encoding"];
        res.writeHead(status, out);
        pipeline(body, injecting(bridgeTag(rewritten.nonce, stateKey, restore)), res, () => undefined);
      });
      upstream.on("error", (error: NodeJS.ErrnoException) => {
        forget(error);
        if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
        res.end(`The dev server did not answer: ${error.code ?? error.message}`);
      });
      req.pipe(upstream);
    });
  };

  const mockEvents = (req: http.IncomingMessage, socket: net.Socket, mocks: MockFiles) => {
    const accept = createHash("sha1").update(`${req.headers["sec-websocket-key"] ?? ""}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    const stop = mocks.subscribe(() => {
      const payload = Buffer.from("changed");
      if (!socket.destroyed) socket.write(Buffer.concat([Buffer.from([0x81, payload.length]), payload]));
    });
    socket.on("data", (chunk: Buffer) => {
      if (chunk.length > 0 && (chunk[0]! & 0x0f) === 0x8) socket.end(Buffer.from([0x88, 0]));
    });
    socket.on("close", stop);
  };

  const onUpgrade = (req: http.IncomingMessage, socket: net.Socket, head: Buffer) => {
    socket.on("error", () => socket.destroy());
    const decision = loopbackGuard({ origin: req.headers.origin, host: req.headers.host });
    if (!decision.allowed) {
      socket.end(`HTTP/1.1 ${decision.status} Forbidden\r\nConnection: close\r\n\r\n`);
      return;
    }
    if (input.mocks !== undefined && (req.url ?? "/").split("?")[0] === MOCKS_EVENTS_PATH) {
      mockEvents(req, socket, input.mocks);
      return;
    }
    const headers = upstreamRequestHeaders(req.headers, { path: req.url ?? "/", upgrade: true });
    void hostFor().then((host) => {
      const upstream = net.connect({ host, port: upstreamPort }, () => {
        upstream.write(rawHead(req, headers));
        if (head.length > 0) upstream.write(head);
        upstream.pipe(socket);
        socket.pipe(upstream);
      });
      upstream.on("error", (error: NodeJS.ErrnoException) => {
        forget(error);
        socket.destroy();
      });
      socket.on("close", () => upstream.destroy());
      upstream.on("close", () => socket.destroy());
    });
  };

  const make = () => {
    const server = http.createServer(onRequest);
    server.on("upgrade", onUpgrade);
    server.on("connection", (socket) => {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
    });
    return server;
  };

  const { port, servers } = await listenBothLoopbacks(make, input.preferredPort ?? 0);

  const close = async () => {
    const closed = servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve())));
    for (const socket of sockets) socket.destroy();
    await Promise.all(closed);
  };

  return { port, close };
};
