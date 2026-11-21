/**
 * Loopback reverse proxy for the dev share preview (spec 01). It readdresses the one
 * preview share origin, and the app share origin, to loopback and forwards to the preview
 * server. The engine's bind and guard stay as they are.
 */
import http from "node:http";
import https from "node:https";
import { previewShareHeaders } from "../packages/domain/src/devShare.ts";

export interface ShareProxy {
  readonly port: number;
  close(): void;
}

const valueOf = (value: string | readonly string[] | undefined): string | undefined => {
  if (typeof value === "string") return value;
  return value?.[0];
};

const read = (value: string | (() => string)): string => (typeof value === "function" ? value() : value);

const upstreamPortOf = (value: number | (() => number)): number => (typeof value === "function" ? value() : value);

const listenOn = (server: http.Server, host: string, port: number): Promise<number> =>
  new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      const address = server.address();
      if (address === null || typeof address === "string") reject(new Error("The listener has no port."));
      else resolve(address.port);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen({ port, host, exclusive: true });
  });

export const startShareProxy = async (options: {
  readonly shareOrigin: string | (() => string);
  readonly appOrigin?: string | (() => string) | undefined;
  readonly upstreamPort: number | (() => number);
  readonly host?: string | undefined;
  readonly port?: number | undefined;
  readonly tls?: { readonly cert: Buffer; readonly key: Buffer } | undefined;
}): Promise<ShareProxy> => {
  const onRequest = (req: http.IncomingMessage, res: http.ServerResponse) => {
    const upstreamPort = upstreamPortOf(options.upstreamPort);
    if (!Number.isInteger(upstreamPort) || upstreamPort <= 0) {
      res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
      res.end("bad gateway");
      return;
    }
    const loopbackHost = `localhost:${upstreamPort}`;
    const replaced = previewShareHeaders({
      previewOrigin: read(options.shareOrigin),
      appOrigin: options.appOrigin === undefined ? undefined : read(options.appOrigin),
      loopbackHost,
      origin: valueOf(req.headers.origin),
      host: valueOf(req.headers.host),
    });
    const headers: http.OutgoingHttpHeaders = { ...req.headers };
    if (replaced.host !== undefined) headers.host = replaced.host;
    if (replaced.origin !== undefined) headers.origin = replaced.origin;
    delete headers.connection;
    delete headers["transfer-encoding"];
    const upstream = http.request(
      { hostname: "localhost", port: upstreamPort, method: req.method, path: req.url, headers },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers);
        up.pipe(res);
      },
    );
    upstream.on("error", () => {
      if (!res.headersSent) {
        res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
        res.end("bad gateway");
      } else res.destroy();
    });
    req.on("aborted", () => upstream.destroy());
    req.pipe(upstream);
  };

  const onUpgrade = (req: http.IncomingMessage, socket: import("node:stream").Duplex, head: Buffer) => {
    const upstreamPort = upstreamPortOf(options.upstreamPort);
    if (!Number.isInteger(upstreamPort) || upstreamPort <= 0) {
      socket.destroy();
      return;
    }
    const loopbackHost = `localhost:${upstreamPort}`;
    const replaced = previewShareHeaders({
      previewOrigin: read(options.shareOrigin),
      appOrigin: options.appOrigin === undefined ? undefined : read(options.appOrigin),
      loopbackHost,
      origin: valueOf(req.headers.origin),
      host: valueOf(req.headers.host),
    });
    const headers: http.OutgoingHttpHeaders = { ...req.headers };
    if (replaced.host !== undefined) headers.host = replaced.host;
    if (replaced.origin !== undefined) headers.origin = replaced.origin;
    const upstream = http.request({ hostname: "localhost", port: upstreamPort, method: req.method, path: req.url, headers });
    const fail = () => {
      socket.destroy();
      upstream.destroy();
    };
    upstream.on("upgrade", (up, upstreamSocket, upstreamHead) => {
      const lines = [`HTTP/1.1 ${up.statusCode ?? 101} ${up.statusMessage ?? "Switching Protocols"}`];
      for (const [key, header] of Object.entries(up.headers)) {
        if (header === undefined) continue;
        for (const each of Array.isArray(header) ? header : [header]) lines.push(`${key}: ${each}`);
      }
      socket.write(`${lines.join("\r\n")}\r\n\r\n`);
      if (upstreamHead.length > 0) socket.write(upstreamHead);
      if (head.length > 0) upstreamSocket.write(head);
      upstreamSocket.pipe(socket);
      socket.pipe(upstreamSocket);
      upstreamSocket.on("error", () => socket.destroy());
      socket.on("error", () => upstreamSocket.destroy());
      upstreamSocket.on("close", () => socket.destroy());
      socket.on("close", () => upstreamSocket.destroy());
    });
    upstream.on("error", fail);
    upstream.on("response", (up) => {
      socket.write(`HTTP/1.1 ${up.statusCode ?? 502} ${up.statusMessage ?? ""}\r\nconnection: close\r\n\r\n`);
      socket.destroy();
      up.resume();
    });
    socket.on("error", () => upstream.destroy());
    upstream.end();
  };

  const make = (): http.Server => {
    const server = options.tls === undefined ? http.createServer(onRequest) : https.createServer(options.tls, onRequest);
    server.on("upgrade", onUpgrade);
    server.on("clientError", (_error, socket) => socket.destroy());
    return server;
  };

  const wanted = options.port ?? 0;
  const servers: http.Server[] = [];
  const v4 = make();
  const port = await listenOn(v4, options.host ?? "127.0.0.1", wanted);
  servers.push(v4);
  if (options.host === undefined) {
    const v6 = make();
    const both = await listenOn(v6, "::1", port).then(
      () => true,
      () => false,
    );
    if (both) servers.push(v6);
    else v6.close();
  }
  return {
    port,
    close: () => {
      for (const server of servers) {
        server.close();
        server.closeAllConnections();
      }
    },
  };
};
