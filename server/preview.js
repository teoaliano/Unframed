// The preview origin: a second, minimal http server that hands out a project's files --
// pages the agent wrote, and the pictures and clips they reference -- from its own
// loopback port. Design: docs/superpowers/specs/2026-09-04-agent-canvas-slice-2-design.md,
// section 1.
//
// SECURITY MODEL -- the whole point of this file. A page is HTML the model authored, and
// HTML runs code. Served from the API's origin it would BE Unframed to the browser and
// could call every route: read the folder, spend the key, install a new one through the
// OAuth nonce. A different port is a different origin, so the browser's own same-origin
// rules do the isolating, and the API is not behind this server at all -- the guarantee
// is structural, like share.js, not a path filter. On top of that: every response carries
// a content policy with no network (`connect-src 'none'`), so a page cannot reach the API
// even by URL; `Cross-Origin-Resource-Policy: same-origin` so no OTHER loopback page can
// embed the project's pictures; `frame-ancestors` so only a loopback page (the canvas) can
// frame one; and the same loopback Host check as the API, because a DNS-rebound page
// arrives with no Origin at all. The canvas side adds the frame's sandbox attribute.
import http from 'node:http';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { slug } from './media.js';

// One path shape. Nothing else exists here, so nothing else parses.
const PATH_RE = /^\/p\/([^/?#]+)\/([^/?#]+)(?:[?#].*)?$/;

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/;

// The same names the API accepts (index.js), and case-insensitive for the same reason.
export const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

// Deny by default: what is NOT here never leaves the folder -- `.json` (every sidecar,
// graph.json, the thread records), `.log` (the journal), `.tmp`. The next kind this server
// should hand out is added here on purpose.
export const ALLOWED_TYPES = {
  html: 'text/html; charset=utf-8',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  woff: 'font/woff',
  woff2: 'font/woff2',
};

export const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline'",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "object-src 'none'",
  'frame-ancestors http://localhost:* http://127.0.0.1:* http://[::1]:*',
].join('; ');

export function previewHeaders(ext) {
  return {
    'Content-Type': ALLOWED_TYPES[ext],
    'Content-Security-Policy': CONTENT_SECURITY_POLICY,
    'Cross-Origin-Resource-Policy': 'same-origin',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    // A page node re-reads its file after an edit; the browser revalidates by mtime.
    'Cache-Control': 'no-cache',
  };
}

// The request, resolved to a file or a status. Pure: what to serve, not the serving.
export function resolvePreview(url, host, outputDir) {
  if (!LOOPBACK_HOST.test(host || '')) return { status: 403 };
  const m = PATH_RE.exec(url || '');
  if (!m) return { status: 404 };
  let project;
  let name;
  try {
    project = slug(decodeURIComponent(m[1]));
    name = decodeURIComponent(m[2]);
  } catch {
    return { status: 404 };
  }
  // Files here are named by this server (`<timestamp>-<slug>.<ext>`, media.js), so a name
  // outside that alphabet is not a file that can exist -- which also disposes of `..`,
  // separators, and anything percent-encoded that decoded to something odd.
  if (!project || !NAME_RE.test(name)) return { status: 404 };
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase();
  if (!ext || !ALLOWED_TYPES[ext]) return { status: 404 };
  return { status: 200, file: path.join(outputDir, project, name), ext };
}

// `outputDir` is a getter: a settings change moves the folder without a restart.
export function createPreviewHandler({ outputDir }) {
  return async (req, res) => {
    const plain = (status) => {
      res.writeHead(status, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
      res.end(status === 403 ? 'Unframed answers only requests addressed to localhost.' : 'not found');
    };
    if (req.method !== 'GET' && req.method !== 'HEAD') return plain(404);
    const r = resolvePreview(req.url, req.headers.host, outputDir());
    if (r.status !== 200) return plain(r.status);
    let stat;
    try {
      stat = await fs.stat(r.file);
    } catch {
      return plain(404);
    }
    if (!stat.isFile()) return plain(404);
    const etag = `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
    const headers = { ...previewHeaders(r.ext), ETag: etag, 'Content-Length': stat.size };
    if (req.headers['if-none-match'] === etag) {
      delete headers['Content-Length'];
      res.writeHead(304, headers);
      return res.end();
    }
    res.writeHead(200, headers);
    if (req.method === 'HEAD') return res.end();
    const stream = createReadStream(r.file);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  };
}

// 127.0.0.1 only, OS-assigned port: the canvas learns it from /api/health.
let server = null;
export function startPreviewServer({ outputDir }) {
  if (server) return Promise.resolve(server.address().port);
  return new Promise((resolve, reject) => {
    server = http.createServer(createPreviewHandler({ outputDir }));
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

export function stopPreviewServer() {
  server?.close();
  server = null;
}
