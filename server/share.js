// Temporary public sharing of a single local video, for video models that only
// take a reference as a public https URL (base64 is rejected by /videos; the
// Files API takes no video; localhost is unreachable from a provider).
//
// SECURITY MODEL — the whole point of this file:
// The cloudflared tunnel points at a DEDICATED http server that serves exactly
// one route shape: GET/HEAD /share/<256-bit token>. The Express app with the API
// (key writes, money-spending generation, project files) is never behind the
// tunnel, so no filter bug can expose it — the guarantee is structural, not a
// path check. Everything this server does not recognise is a plain 404.
//
// Tokens are crypto-random 32 bytes (base64url, 43 chars), single-purpose, and
// die on revoke (job finished) or TTL, whichever comes first. Files are copies
// in os.tmpdir(), deleted on revoke. The tunnel process is killed as soon as no
// live share remains, which also kills the URL itself.
import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const TOKEN_RE = /^\/share\/([A-Za-z0-9_-]{43})$/;
// Backstop only — the normal end of life is revoke-on-job-completion.
export const SHARE_TTL_MS = 30 * 60 * 1000;

const shares = new Map(); // token -> { file, mime, expiresAt }

export function handleShareRequest(req, res) {
  const notFound = () => {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  };
  if (req.method !== 'GET' && req.method !== 'HEAD') return notFound();
  // req.url, not a parsed path: nothing else exists here, so nothing else parses.
  const m = TOKEN_RE.exec(req.url || '');
  if (!m) return notFound();
  const share = shares.get(m[1]);
  if (!share || share.expiresAt < Date.now()) return notFound();

  fs.readFile(share.file).then(
    (buf) => {
      res.writeHead(200, { 'Content-Type': share.mime, 'Content-Length': buf.length });
      res.end(req.method === 'HEAD' ? undefined : buf);
    },
    () => notFound(),
  );
}

// 127.0.0.1 only: the tunnel is the single intended way in from outside.
let server = null;
export function startShareServer() {
  if (server) return Promise.resolve(server.address().port);
  return new Promise((resolve, reject) => {
    server = http.createServer(handleShareRequest);
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

// Write the clip to a tmp copy and mint its token. dataUrl is the node's
// data:video/...;base64,... payload.
export async function mintShare(dataUrl) {
  const m = /^data:(video\/[\w.+-]+);base64,(.*)$/s.exec(dataUrl);
  if (!m) throw new Error('Not a video data URL.');
  const token = crypto.randomBytes(32).toString('base64url');
  const file = path.join(os.tmpdir(), `unframed-share-${token}.bin`);
  await fs.writeFile(file, Buffer.from(m[2], 'base64'));
  shares.set(token, { file, mime: m[1], expiresAt: Date.now() + SHARE_TTL_MS });
  return token;
}

export async function revokeShare(token) {
  const share = shares.get(token);
  shares.delete(token);
  if (share) await fs.unlink(share.file).catch(() => {});
  if (shares.size === 0) stopTunnel();
}

// ---- public tunnel ----
// Two providers, measured against each other on this machine (2026-08-12):
//   localtunnel  4/4 up, 0.6-1.4s, plain npm package, no binary to install
//   cloudflared  2/4 up, 11-14s, needs `brew install cloudflared`
// So localtunnel leads and cloudflared is the fallback for when the free
// localtunnel service is down.
//
// The interstitial worry does not apply: localtunnel answers browser-ish User-
// Agents with an HTTP 511 reminder page, but the provider fetches with FFmpeg
// (observed User-Agent `Lavf/59.27.100`), which it serves directly. Confirmed
// end to end against the real API.
let tunnel = null; // { url, close() }

async function startLocaltunnel(port) {
  const localtunnel = createRequire(import.meta.url)('localtunnel');
  const t = await localtunnel({ port });
  return {
    url: t.url,
    close: () => t.close(),
  };
}

function startCloudflared(port) {
  return new Promise((resolve, reject) => {
    const proc = spawn('cloudflared', ['tunnel', '--url', `http://127.0.0.1:${port}`]);
    let settled = false;
    const fail = (msg) => {
      if (settled) return;
      settled = true;
      proc.kill();
      reject(new Error(msg));
    };
    proc.on('error', () => fail('cloudflared is not installed'));
    let out = '';
    proc.stderr.on('data', (d) => {
      out += d;
      const m = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(out);
      if (m && !settled) {
        settled = true;
        resolve({ url: m[0], close: () => proc.kill() });
      }
    });
    proc.on('exit', () => fail('cloudflared exited before the tunnel came up'));
    setTimeout(() => fail('timed out waiting for the cloudflared URL'), 20000);
  });
}

export async function ensureTunnel() {
  const port = await startShareServer();
  if (tunnel?.url) return tunnel.url;
  try {
    tunnel = await startLocaltunnel(port);
  } catch (err) {
    try {
      tunnel = await startCloudflared(port);
    } catch (fallbackErr) {
      tunnel = null;
      throw new Error(
        `no tunnel available (localtunnel: ${err.message}; cloudflared: ${fallbackErr.message})`,
      );
    }
  }
  return tunnel.url;
}

export function stopTunnel() {
  try {
    tunnel?.close();
  } catch {
    /* already gone */
  }
  tunnel = null;
}

// node --watch restarts this process on every edit, which wipes the share map but
// would leave the tunnel alive: an orphan serving a server that no longer knows
// about it. Close it on the way out.
for (const signal of ['exit', 'SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    try {
      tunnel?.close();
    } catch {
      /* already gone */
    }
    if (signal !== 'exit') process.exit(0);
  });
}

// A fresh trycloudflare hostname is handed over before it is fetchable, and the
// provider pulls the reference within seconds of the job being created, so
// creating the job first is a race the provider loses: "resource download
// failed". This proves the URL serves BEFORE any job exists.
//
// It must NOT ask the local resolver. This machine kept answering NXDOMAIN for a
// hostname that was already live at Cloudflare's edge -- a false negative that
// would block a perfectly good generation. So: resolve over DoH (what a provider's
// resolver would see) and connect straight to that IP, with SNI and Host set to
// the real hostname, which is what `curl --resolve` does.
async function resolvePublic(hostname) {
  const r = await fetch(
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=A`,
    { headers: { accept: 'application/dns-json' } },
  );
  const d = await r.json();
  return (d.Answer || []).filter((a) => a.type === 1).map((a) => a.data);
}

function headVia(ip, hostname, pathname) {
  return new Promise((resolve) => {
    const req = https.request(
      { host: ip, servername: hostname, headers: { Host: hostname }, path: pathname, method: 'HEAD', timeout: 8000 },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      },
    );
    req.on('error', () => resolve(0));
    req.on('timeout', () => {
      req.destroy();
      resolve(0);
    });
    req.end();
  });
}

export async function waitUntilPublic(url, timeoutMs = 90000) {
  const { hostname, pathname } = new URL(url);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ips = await resolvePublic(hostname).catch(() => []);
    for (const ip of ips) {
      // 530 is Cloudflare saying the tunnel is not wired up yet.
      if ((await headVia(ip, hostname, pathname)) === 200) return true;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

// Expired shares must not outlive their TTL just because nobody asked for them:
// the sweep also tears the tunnel down once the last one dies. unref() so the
// interval never holds the process open.
setInterval(() => {
  const now = Date.now();
  for (const [token, share] of shares) {
    if (share.expiresAt < now) revokeShare(token);
  }
}, 60 * 1000).unref();

// For tests: reach in without exporting mutable state to production callers.
export const _internals = { shares };
