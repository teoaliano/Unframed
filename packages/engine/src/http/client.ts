import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type http from "node:http";
import { extname, join, relative, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import type { Route } from "./api.ts";

const ASSETS_PREFIX = "/assets/";

const CLIENT_TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
};

const sendFile = async (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  path: string,
  headers: http.OutgoingHttpHeaders,
): Promise<boolean> => {
  const info = await stat(path).catch(() => undefined);
  if (!info?.isFile()) return false;
  res.writeHead(200, { ...headers, "content-length": info.size, "x-content-type-options": "nosniff" });
  if (req.method === "HEAD") res.end();
  else await pipeline(createReadStream(path), res).catch(() => res.destroy());
  return true;
};

/**
 * The built web client, on the engine's own origin, when `UNFRAMED_CLIENT_DIST` is set:
 * `index.html` for `/` and the hashed files under `/assets/`. Nothing else, and no SPA
 * catch-all, so an unknown path is a 404.
 */
export const clientRoute =
  (clientDist: string): Route =>
  async (req, res, url) => {
    if (req.method !== "GET" && req.method !== "HEAD") return false;
    if (url.pathname === "/") {
      return sendFile(req, res, join(clientDist, "index.html"), {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-cache",
      });
    }
    if (!url.pathname.startsWith(ASSETS_PREFIX)) return false;
    let name: string;
    try {
      name = decodeURIComponent(url.pathname.slice(ASSETS_PREFIX.length));
    } catch {
      return false;
    }
    const assets = resolve(clientDist, "assets");
    const path = resolve(assets, name);
    const inside = relative(assets, path);
    if (inside === "" || inside.startsWith("..") || inside.split(sep).includes("..")) return false;
    return sendFile(req, res, path, {
      "content-type": CLIENT_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream",
      "cache-control": "public, max-age=31536000, immutable",
    });
  };
