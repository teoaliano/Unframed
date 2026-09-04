// node server/preview.test.js  (also runs as part of `npm test`)
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {
  resolvePreview,
  previewHeaders,
  ALLOWED_TYPES,
  CONTENT_SECURITY_POLICY,
  createPreviewHandler,
} from './preview.js';

const out = '/out';

// ---- resolvePreview: what is served, pure ----

for (const ext of Object.keys(ALLOWED_TYPES)) {
  const r = resolvePreview(`/p/coast/1-a.${ext}`, 'localhost', out);
  assert.equal(r.status, 200, ext);
  assert.equal(r.file, path.join(out, 'coast', `1-a.${ext}`));
  assert.equal(r.ext, ext);
}
assert.equal(resolvePreview('/p/coast/1-a.HTML', '127.0.0.1:5000', out).ext, 'html', 'extension is case-insensitive');

// Deny by default: the folder's bookkeeping never leaves.
for (const name of ['graph.json', 'graph.log', '1-a.json', 'x.tmp', 'noext', 'a.js', 'a.css', 'a.txt']) {
  assert.equal(resolvePreview(`/p/coast/${name}`, 'localhost', out).status, 404, name);
}

// One path shape; nothing escapes the project folder.
for (const url of [
  '/',
  '/p',
  '/p/coast',
  '/p/coast/',
  '/p/coast/sub/a.html',
  '/p/coast/../a.html',
  '/p/../coast/a.html',
  '/p/coast/%2e%2e/a.html',
  '/p/coast/a.html/extra',
  '/api/health',
  '/p/coast/%2Fetc%2Fpasswd.html',
  '/p/%00/a.html',
]) {
  assert.equal(resolvePreview(url, 'localhost', out).status, 404, url);
}
assert.equal(resolvePreview('/p/coast/a.html?x=1', 'localhost', out).status, 200, 'a query is ignored');
assert.equal(resolvePreview('/p/coast/%252e%252e%252fa.html', 'localhost', out).status, 404, 'a name outside our own alphabet cannot exist');
assert.equal(resolvePreview('/p/coast/.hidden.html', 'localhost', out).status, 404, 'no dotfiles');
assert.equal(resolvePreview('/p/coast/a%20b.html', 'localhost', out).status, 404, 'no spaces: never a name this server wrote');

// The project name is slugified like every project route, so the same folder answers.
assert.equal(resolvePreview('/p/Coast%20Teaser/a.html', 'localhost', out).file, path.join(out, 'coast-teaser', 'a.html'));

// The Host check: a rebound page dials a name that is not loopback.
assert.equal(resolvePreview('/p/coast/a.html', 'rebound.evil.example', out).status, 403);
assert.equal(resolvePreview('/p/coast/a.html', 'rebound.evil.example:1234', out).status, 403);
assert.equal(resolvePreview('/p/coast/a.html', '', out).status, 403);
assert.equal(resolvePreview('/p/coast/a.html', undefined, out).status, 403);
assert.equal(resolvePreview('/p/coast/a.html', 'LOCALHOST:5173', out).status, 200, 'case-insensitive, like the API');
assert.equal(resolvePreview('/p/coast/a.html', '[::1]:9', out).status, 200);
assert.equal(resolvePreview('/p/coast/a.html', 'localhost.evil.example', out).status, 403);

// ---- headers ----

const h = previewHeaders('html');
assert.equal(h['Content-Type'], 'text/html; charset=utf-8');
assert.equal(h['Content-Security-Policy'], CONTENT_SECURITY_POLICY);
assert.equal(h['Cross-Origin-Resource-Policy'], 'same-origin');
assert.equal(h['X-Content-Type-Options'], 'nosniff');
assert.equal(h['Referrer-Policy'], 'no-referrer');
assert.equal(h['Cache-Control'], 'no-cache');
assert.equal(Object.hasOwn(h, 'Access-Control-Allow-Origin'), false, 'nothing is readable cross-origin');
// The lines the isolation depends on, pinned one by one so a "tidy" rewrite cannot
// drop one silently.
for (const directive of [
  "default-src 'none'",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "object-src 'none'",
  'frame-ancestors http://localhost:* http://127.0.0.1:* http://[::1]:*',
]) {
  assert.ok(CONTENT_SECURITY_POLICY.split('; ').includes(directive), directive);
}
assert.equal(previewHeaders('png')['Content-Type'], 'image/png');

// ---- the handler, against a real folder ----

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'unframed-preview-'));
await fs.mkdir(path.join(dir, 'coast'));
await fs.writeFile(path.join(dir, 'coast', '1-page.html'), '<h1>hi</h1>');
await fs.writeFile(path.join(dir, 'coast', '1-page.json'), '{"secret":1}');
await fs.mkdir(path.join(dir, 'coast', 'threads'));
await fs.writeFile(path.join(dir, 'coast', 'threads', 't.json'), '{}');

let current = dir;
const server = http.createServer(createPreviewHandler({ outputDir: () => current }));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

try {
  const ok = await fetch(`${base}/p/coast/1-page.html`);
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), '<h1>hi</h1>');
  assert.equal(ok.headers.get('content-security-policy'), CONTENT_SECURITY_POLICY);
  assert.equal(ok.headers.get('cross-origin-resource-policy'), 'same-origin');
  assert.equal(ok.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal(ok.headers.get('access-control-allow-origin'), null);
  const etag = ok.headers.get('etag');
  assert.ok(etag, 'an ETag, so no-cache revalidates cheaply');

  const cached = await fetch(`${base}/p/coast/1-page.html`, { headers: { 'If-None-Match': etag } });
  assert.equal(cached.status, 304);

  const head = await fetch(`${base}/p/coast/1-page.html`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.equal(head.headers.get('content-length'), '11');

  assert.equal((await fetch(`${base}/p/coast/1-page.json`)).status, 404, 'a sidecar never leaves');
  assert.equal((await fetch(`${base}/p/coast/threads/t.json`)).status, 404);
  assert.equal((await fetch(`${base}/p/coast/missing.html`)).status, 404);
  assert.equal((await fetch(`${base}/p/coast`)).status, 404, 'a folder is not a file');
  assert.equal((await fetch(`${base}/api/health`)).status, 404, 'the API is not here');
  assert.equal((await fetch(`${base}/p/coast/1-page.html`, { method: 'POST' })).status, 404);
  assert.equal((await fetch(`${base}/p/coast/1-page.html`, { method: 'DELETE' })).status, 404);

  // Raw request, because fetch does not let Host be set.
  const withHost = (host) =>
    new Promise((resolve, reject) => {
      http
        .request({ host: '127.0.0.1', port: server.address().port, path: '/p/coast/1-page.html', headers: { Host: host } }, (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode));
        })
        .on('error', reject)
        .end();
    });
  assert.equal(await withHost('rebound.evil.example'), 403);
  assert.equal(await withHost('localhost:5173'), 200);

  // The folder is read through a getter: moving it takes effect at once.
  current = path.join(dir, 'elsewhere');
  assert.equal((await fetch(`${base}/p/coast/1-page.html`)).status, 404, 'the old folder is no longer served');
} finally {
  server.close();
  await fs.rm(dir, { recursive: true, force: true });
}

console.log('preview.test.js: ok');
