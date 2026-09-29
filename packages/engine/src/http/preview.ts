import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { loopbackGuard, projectSlug } from "@unframed/domain";
import { NOT_FOUND } from "./respond.ts";
import { guardUpgrade, refuseUpgrade } from "./guard.ts";

/**
 * The preview origin (spec 09): a second loopback listener that serves artifact files and
 * nothing else. It answers exactly one path shape, `/p/<project>/<file>`, and must never
 * gain a second route: a page served anywhere else would be the app to the browser.
 */

export const PREVIEW_CSP =
  "default-src 'none'; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; frame-src 'self'; connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'; frame-ancestors http://localhost:* http://127.0.0.1:* http://[::1]:*";

/** The allow-list. Everything else is 404, which keeps sidecars, the database and temp files unservable. */
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  woff: "font/woff",
  woff2: "font/woff2",
};

const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/;
const ROUTE = /^\/p\/([^/]+)\/([^/]+)$/;

export type PreviewResolution =
  | { readonly kind: "file"; readonly project: string; readonly file: string; readonly contentType: string }
  | { readonly kind: "refused"; readonly status: 403 | 404; readonly body: string };

const notFound: PreviewResolution = { kind: "refused", status: 404, body: "not found" };

const decode = (segment: string): string | undefined => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return undefined;
  }
};

/**
 * The pure step: a request's method, URL and headers to the project file it names, or the
 * refusal. The guard runs first, with the same decision the app origin uses.
 */
export const resolvePreview = (request: {
  readonly method: string | undefined;
  readonly url: string | undefined;
  readonly host: string | undefined;
  readonly origin: string | undefined;
}): PreviewResolution => {
  const guard = loopbackGuard({ host: request.host, origin: request.origin });
  if (!guard.allowed) return { kind: "refused", status: 403, body: guard.error };
  if (request.method !== "GET" && request.method !== "HEAD") return notFound;
  const path = (request.url ?? "").split(/[?#]/, 1)[0] ?? "";
  const match = ROUTE.exec(path);
  if (!match) return notFound;
  const project = decode(match[1]!);
  const file = decode(match[2]!);
  if (project === undefined || file === undefined) return notFound;
  const slug = projectSlug(project);
  if (slug === "" || !FILE_NAME.test(file)) return notFound;
  const dot = file.lastIndexOf(".");
  const contentType = dot < 0 ? undefined : CONTENT_TYPES[file.slice(dot + 1).toLowerCase()];
  if (contentType === undefined) return notFound;
  return { kind: "file", project: slug, file, contentType };
};

const refuse = (res: http.ServerResponse, status: number, body: string, head: boolean) => {
  res.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(head ? undefined : body);
};

/** The ETag: size and whole-millisecond mtime, both in hex. */
const etagOf = (size: number, mtimeMs: number) => `"${size.toString(16)}-${Math.floor(mtimeMs).toString(16)}"`;

const handler =
  (outputDir: () => Promise<string>) =>
  async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    const head = req.method === "HEAD";
    const resolved = resolvePreview({ method: req.method, url: req.url, host: req.headers.host, origin: req.headers.origin });
    if (resolved.kind === "refused") return refuse(res, resolved.status, resolved.body, head);
    let path: string;
    try {
      path = join(await outputDir(), resolved.project, resolved.file);
    } catch {
      return refuse(res, 404, "not found", head);
    }
    const info = await stat(path).catch(() => undefined);
    if (!info?.isFile()) return refuse(res, 404, "not found", head);
    const etag = etagOf(info.size, info.mtimeMs);
    const headers: http.OutgoingHttpHeaders = {
      "content-security-policy": PREVIEW_CSP,
      "cross-origin-resource-policy": "same-origin",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "cache-control": "no-cache",
      etag,
      "content-type": resolved.contentType,
    };
    if (req.headers["if-none-match"] === etag) {
      res.writeHead(304, headers);
      res.end();
      return;
    }
    res.writeHead(200, { ...headers, "content-length": info.size });
    if (head || info.size === 0) {
      res.end();
      return;
    }
    await pipeline(createReadStream(path), res).catch(() => res.destroy());
  };

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

/** Errors that mean this machine has no IPv6 loopback, so `localhost` only ever reaches 127.0.0.1. */
const NO_IPV6 = new Set(["EADDRNOTAVAIL", "EAFNOSUPPORT", "EINVAL"]);

export interface PreviewOrigin {
  readonly port: number;
  /** Stops accepting connections on every address it listens on. */
  readonly stopListening: () => void;
  readonly closeAllConnections: () => void;
}

/**
 * Starts the preview origin on `127.0.0.1` with an OS-assigned port, and on `[::1]` at the
 * same port where the machine has it, so `localhost` answers whichever address it resolves
 * to. It reads the output folder through `outputDir` on every request, so a settings change
 * moves it without a restart.
 */
export const startPreviewOrigin = async (outputDir: () => Promise<string>): Promise<PreviewOrigin> => {
  const make = () => {
    const server = http.createServer({ requireHostHeader: false }, (req, res) => {
      void handler(outputDir)(req, res).catch(() => {
        if (!res.headersSent) refuse(res, 404, "not found", req.method === "HEAD");
        else res.destroy();
      });
    });
    server.on("upgrade", (req, socket) => {
      if (guardUpgrade(req, socket)) refuseUpgrade(socket, 404, NOT_FOUND);
    });
    return server;
  };
  for (let attempt = 0; ; attempt++) {
    const v4 = make();
    const port = await listenOn(v4, "127.0.0.1", 0);
    const v6 = make();
    const both = await listenOn(v6, "::1", port).then(
      () => true,
      (error: NodeJS.ErrnoException) => {
        if (NO_IPV6.has(error.code ?? "")) return false;
        if (attempt < 5) return undefined;
        return false;
      },
    );
    if (both === undefined) {
      // Something else holds this port on ::1: try another pair.
      v4.close();
      continue;
    }
    const servers = both ? [v4, v6] : [v4];
    return {
      port,
      stopListening: () => {
        for (const server of servers) {
          server.close();
          server.closeIdleConnections();
        }
      },
      closeAllConnections: () => {
        for (const server of servers) server.closeAllConnections();
      },
    };
  }
};
