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
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

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

// ---- cloudflared quick tunnel ----
let tunnel = null; // { proc, url }

export async function ensureTunnel() {
  const port = await startShareServer();
  if (tunnel?.url) return tunnel.url;
  return new Promise((resolve, reject) => {
    const proc = spawn('cloudflared', ['tunnel', '--url', `http://127.0.0.1:${port}`]);
    let settled = false;
    const fail = (msg) => {
      if (settled) return;
      settled = true;
      proc.kill();
      tunnel = null;
      reject(new Error(msg));
    };
    proc.on('error', () =>
      fail(
        'cloudflared is not installed, so the clip cannot be shared. Install it (macOS: brew install cloudflared) and try again.',
      ),
    );
    // The assigned URL is printed to stderr while the tunnel starts.
    let out = '';
    proc.stderr.on('data', (d) => {
      out += d;
      const m = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(out);
      if (m && !settled) {
        settled = true;
        tunnel = { proc, url: m[0] };
        proc.on('exit', () => {
          tunnel = null;
        });
        resolve(m[0]);
      }
    });
    proc.on('exit', () => fail('cloudflared exited before the tunnel came up.'));
    setTimeout(() => fail('Timed out waiting for the tunnel URL.'), 20000);
  });
}

export function stopTunnel() {
  tunnel?.proc.kill();
  tunnel = null;
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
