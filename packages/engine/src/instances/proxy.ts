import http from "node:http";
import net from "node:net";
import { StringDecoder } from "node:string_decoder";
import { pipeline, Transform, type Readable } from "node:stream";
import zlib from "node:zlib";
import { BRIDGE_PATH, bridgeTag, htmlInjector, loopbackGuard, proxiedResponseHeaders, rewritesOrigin, screenBridgeSource, takeStateParam, upstreamRequestHeaders } from "@unframed/domain";
import { listenBothLoopbacks } from "../listen.ts";
import { listeningHost } from "./processes.ts";
import type { StateTokens } from "./stateTokens.ts";

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

export const startInstanceProxy = async (input: { readonly upstreamPort: number; readonly preferredPort?: number | null; readonly states: StateTokens }): Promise<InstanceProxy> => {
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
    const decision = loopbackGuard({ origin: rewritesOrigin(req.url ?? "/", false) ? req.headers.origin : undefined, host: req.headers.host });
    if (!decision.allowed) {
      res.writeHead(decision.status, { "content-type": "text/plain; charset=utf-8" });
      res.end(decision.error);
      return;
    }
    const asked = req.url ?? "/";
    if (asked === BRIDGE_PATH || asked.startsWith(`${BRIDGE_PATH}?`)) {
      const key = new URLSearchParams(asked.slice(BRIDGE_PATH.length + 1)).get("state");
      const state = key === null ? undefined : input.states.takeBridge(key);
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" });
      res.end(state === undefined ? bridge : `window.__unframedScreenState = ${JSON.stringify(state)};\n${bridge}`);
      return;
    }
    const { path, token } = takeStateParam(asked);
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
        pipeline(body, injecting(bridgeTag(rewritten.nonce, stateKey)), res, () => undefined);
      });
      upstream.on("error", (error: NodeJS.ErrnoException) => {
        forget(error);
        if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
        res.end(`The dev server did not answer: ${error.code ?? error.message}`);
      });
      req.pipe(upstream);
    });
  };

  const onUpgrade = (req: http.IncomingMessage, socket: net.Socket, head: Buffer) => {
    socket.on("error", () => socket.destroy());
    const decision = loopbackGuard({ origin: req.headers.origin, host: req.headers.host });
    if (!decision.allowed) {
      socket.end(`HTTP/1.1 ${decision.status} Forbidden\r\nConnection: close\r\n\r\n`);
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
