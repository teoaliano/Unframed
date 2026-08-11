// node server/share.test.js  (also part of `npm test`)
//
// The property under test is the security model: the share server exposes
// exactly one route shape, GET/HEAD /share/<valid live token>, and answers 404
// to literally everything else — most importantly to every API-looking path,
// because this is the server the public tunnel points at.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {
  startShareServer,
  mintShare,
  revokeShare,
  _internals,
} from './share.js';

const clip = Buffer.from('not a real mp4 but bytes are bytes');
const dataUrl = `data:video/mp4;base64,${clip.toString('base64')}`;

const port = await startShareServer();
const base = `http://127.0.0.1:${port}`;
const get = (p, method = 'GET') => fetch(base + p, { method });

// A valid token serves the exact bytes with the declared mime.
const token = await mintShare(dataUrl);
assert.match(token, /^[A-Za-z0-9_-]{43}$/, 'token is 32 crypto-random bytes, base64url');
{
  const r = await get(`/share/${token}`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'video/mp4');
  assert.deepEqual(Buffer.from(await r.arrayBuffer()), clip);
}
// HEAD works (providers often probe first) and carries no body.
{
  const r = await get(`/share/${token}`, 'HEAD');
  assert.equal(r.status, 200);
  assert.equal((await r.arrayBuffer()).byteLength, 0);
}

// THE API MUST NOT EXIST HERE. Every path a scanner or a leaked URL could try
// answers 404 — these routes live on the Express app, which is never tunnelled.
for (const p of [
  '/',
  '/api/health',
  '/api/config',
  '/api/key',
  '/api/projects',
  '/api/generate',
  '/api/video',
  '/api/text',
  '/api/pick-folder',
  '/api/file/default/x.mp4',
  '/share',
  '/share/',
  '/share/short',
  '/share/../../etc/passwd',
  `/share/${'A'.repeat(43)}`, // well-formed but never minted
  `/SHARE/${token}`, // case matters
  `/share/${token}/extra`,
]) {
  const r = await get(p);
  assert.equal(r.status, 404, `expected 404 for ${p}, got ${r.status}`);
}

// Writes are not a thing on this server, valid token or not.
for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
  const r = await get(`/share/${token}`, method);
  assert.equal(r.status, 404, `expected 404 for ${method}`);
}

// Expiry: a share past its TTL is gone even before the sweep runs.
_internals.shares.get(token).expiresAt = Date.now() - 1;
assert.equal((await get(`/share/${token}`)).status, 404);
_internals.shares.get(token).expiresAt = Date.now() + 60000; // restore for revoke test

// Revoke: 404s immediately and the tmp copy is deleted from disk.
const file = _internals.shares.get(token).file;
await revokeShare(token);
assert.equal((await get(`/share/${token}`)).status, 404);
await assert.rejects(fs.access(file), 'tmp copy must be deleted on revoke');

// Only video data URLs are mintable — an image or arbitrary string is refused.
await assert.rejects(mintShare('data:image/png;base64,AAAA'));
await assert.rejects(mintShare('https://example.com/a.mp4'));

console.log('share.test.js: ok');
process.exit(0); // the share server keeps the loop alive; tests are done
