// node server/motion.test.js  (also runs as part of `npm test`)
//
// The motion asset's file-level rules: the library a composition needs sits beside it
// under fixed names and comes from the installed packages; the viewer only ever frames a
// sibling; a render lands in the folder named and sidecarred like every other file, or
// leaves nothing behind when it fails.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { LIBRARY, LIBRARY_FILES, VIEWER, isLibraryFile, viewerHtml, viewerPath, ensureLibrary, motionFileName, renderFileName, renderSidecar, startRender, getRender, withRuntime, withBridge, ensureBridge, RUNTIME_TAG, chromeCandidates, findChrome, NO_CHROME } from './motion.js';
import { BRIDGE, BRIDGE_TAG } from './dials.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'unframed-motion-test-'));

// ---- the library ----
// Every source resolves on this install: a dependency that moved its dist would show up
// here, not on a user's first motion.
for (const [file, resolve] of Object.entries(LIBRARY)) {
  const src = resolve();
  assert.ok((await fs.stat(src)).size > 1000, `${file} <- ${src}`);
}
// The parameters bridge ships with every composition -- it is ours, not the person's, and
// nothing should mistake it for a composition.
assert.deepEqual(LIBRARY_FILES, [VIEWER, BRIDGE, 'hyperframes-player.js', 'hyperframes-runtime.js', 'gsap.js']);
assert.equal(isLibraryFile(BRIDGE), true);
assert.equal(isLibraryFile('gsap.js'), true);
assert.equal(isLibraryFile('1-launch.html'), false);

// The viewer: loads the sibling player, points the player at the sibling runtime (its
// default is a CDN the preview origin refuses), and frames only a name that could be a
// sibling composition.
const viewer = viewerHtml();
assert.match(viewer, /<script src="hyperframes-player\.js">/);
assert.match(viewer, /runtime-src="hyperframes-runtime\.js"/);
assert.doesNotMatch(viewer, /https?:\/\//, 'nothing external');
assert.match(viewer, /\.test\(c\)/, 'the query is checked before it becomes a src');
assert.equal(viewerPath('1-intro.html'), 'hyperframes-viewer.html?c=1-intro.html');

{
  const dir = path.join(root, 'proj');
  const first = await ensureLibrary(dir);
  assert.deepEqual(first.sort(), [...LIBRARY_FILES].sort(), 'an empty folder gets the whole library');
  assert.equal((await fs.readFile(path.join(dir, VIEWER), 'utf8')), viewer);
  assert.deepEqual(await ensureLibrary(dir), [], 'and nothing is rewritten when it is current');
  // A stale copy (a dependency bump, or a truncated file) is replaced.
  await fs.writeFile(path.join(dir, 'gsap.js'), 'old');
  assert.deepEqual(await ensureLibrary(dir), ['gsap.js']);
  assert.ok((await fs.stat(path.join(dir, 'gsap.js'))).size > 1000);
}

// ---- the runtime tag ----
// Into <head> when there is one, else at the top of <body>, else first; never twice, and
// never when the composition already carries a runtime under any of its names.
// Two tags go in: the runtime, and the parameters bridge. The bridge is unconditional
// because the agent's contract is one function call -- a composition that called
// `unframed.dials` without remembering a script tag would do nothing, silently.
assert.equal(withRuntime('<html><head><title>x</title></head><body></body></html>'), `<html><head><title>x</title>${RUNTIME_TAG}\n${BRIDGE_TAG}\n</head><body></body></html>`);
assert.equal(withRuntime('<body class="a"><div id="root"></div></body>'), `<body class="a">\n${BRIDGE_TAG}\n${RUNTIME_TAG}<div id="root"></div></body>`);
assert.equal(withRuntime('<div id="root"></div>'), `${BRIDGE_TAG}\n${RUNTIME_TAG}\n<div id="root"></div>`);
const once = withRuntime('<html><head></head><body></body></html>');
assert.equal(withRuntime(once), once, 'a composition read back and rewritten does not grow a second copy of either');
assert.match(once, /unframed-dials\.js/);
// With no head and no body a tag is PREPENDED, so the bridge lands first.
assert.equal(
  withRuntime('<script src="./hyperframe.runtime.iife.js"></script>'),
  `${BRIDGE_TAG}\n<script src="./hyperframe.runtime.iife.js"></script>`,
  "the CLI's own runtime name counts as present; the bridge is still added",
);
// Either tag already there is left alone on its own.
assert.equal(withRuntime(`<head>${BRIDGE_TAG}</head>`), `<head>${BRIDGE_TAG}${RUNTIME_TAG}\n</head>`);
assert.match(RUNTIME_TAG, /data-hyperframes-preview-runtime/, 'the marker the renderer strips by');

// ---- the browser ----
// An explicit path comes first; each platform lists its usual installs; the caches come
// last. Pure, so the list can be checked without those browsers.
{
  const mac = chromeCandidates('darwin', '/Users/m', {});
  assert.equal(mac[0], '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  assert.ok(mac.includes('/Users/m/Applications/Chromium.app/Contents/MacOS/Chromium'));
  assert.deepEqual(chromeCandidates('darwin', '/Users/m', { UNFRAMED_CHROME_PATH: '/opt/x/chrome' })[0], '/opt/x/chrome', 'an explicit path is tried first');
  assert.equal(chromeCandidates('linux', '/home/m', {})[0], '/usr/bin/google-chrome');
  assert.equal(chromeCandidates('win32', '/u', { PROGRAMFILES: 'C:\\PF' })[0], path.join('C:\\PF', 'Google/Chrome/Application/chrome.exe'));
  const last = mac.at(-1);
  assert.equal(typeof last, 'object');
  assert.match(last.cache, /hyperframes\/chrome\/chrome-headless-shell$/);
  // findChrome: the first that exists, else null -- and never a throw.
  assert.equal(findChrome(['/nope/a', '/nope/b', { cache: '/nope/cache', shell: ['x'] }]), null);
  assert.equal(findChrome(['/nope/a', process.execPath]), process.execPath);
  assert.match(NO_CHROME, /Install one/);
}

// ---- names ----
assert.equal(motionFileName(1700000000000, 'Launch teaser'), '1700000000000-launch-teaser.html');
assert.equal(motionFileName(1700000000000, ''), '1700000000000-motion.html');
assert.equal(renderFileName(1700000000000, 'Launch teaser', 2), '1700000000000-launch-teaser-2.mp4');
assert.deepEqual(renderSidecar({ of: '1-a.html', title: 'A', fps: 30, quality: 'standard', bytes: 12, now: 1700000000000 }), {
  source: 'render',
  of: '1-a.html',
  title: 'A',
  mime: 'video/mp4',
  fps: 30,
  quality: 'standard',
  bytes: 12,
  at: '2023-11-14T22:13:20.000Z',
});
assert.equal('cost' in renderSidecar({ of: 'x', fps: 30, quality: 'standard', bytes: 1 }), false, 'a render costs nothing and must not say 0');
// The parameter values a render was made WITH. A composition's file is not enough to
// reproduce an MP4 once its parameters can be tuned -- the same file at two settings is
// two different videos -- and this is the only place that difference is written down.
{
  const tuned = renderSidecar({ of: 'x', fps: 30, quality: 'standard', bytes: 1, dials: { accent: '#000', speed: 1.75 } });
  assert.deepEqual(tuned.dials, { accent: '#000', speed: 1.75 });
  // Absent, not empty, when there were none: a `dials: {}` on every render would read as
  // "it had parameters and they were all default", which is a different fact.
  assert.equal('dials' in renderSidecar({ of: 'x', fps: 30, quality: 'standard', bytes: 1 }), false);
  assert.equal('dials' in renderSidecar({ of: 'x', fps: 30, quality: 'standard', bytes: 1, dials: {} }), false);
}

// The values reach the engine as `variables.unframedDials`, which it injects as
// `window.__hfVariables` before any page script runs -- so the bridge's first apply has
// them and the very first captured frame is the tuned one.
{
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'unframed-render-dials-'));
  const seen = [];
  const done = (job) => new Promise((resolve) => {
    const tick = () => (job.status === 'done' || job.status === 'failed' ? resolve(job) : setTimeout(tick, 5));
    tick();
  });
  const execute = async ({ out, variables }) => {
    seen.push(variables);
    await fs.writeFile(out, 'mp4');
  };
  const withDials = await done(startRender({ dir, file: '5-intro.html', title: 'Tuned', dials: { speed: 1.75 } }, { execute, now: () => 1700000000000 }));
  assert.equal(withDials.status, 'done');
  assert.deepEqual(seen[0], { unframedDials: { speed: 1.75 } });
  const side = JSON.parse(await fs.readFile(path.join(dir, withDials.output.replace(/\.mp4$/, '.json')), 'utf8'));
  assert.deepEqual(side.dials, { speed: 1.75 }, 'and the sidecar records them');
  // No parameters: nothing is handed to the engine at all, so a composition that never
  // called `unframed.dials` renders exactly as it did before any of this existed.
  await done(startRender({ dir, file: '5-intro.html', title: 'Plain' }, { execute, now: () => 1700000001000 }));
  assert.equal(seen[1], undefined);
  await fs.rm(dir, { recursive: true, force: true });
}

// ---- a render, with the producer stood in for ----
const settle = (job) =>
  new Promise((resolve) => {
    const tick = () => (job.status === 'done' || job.status === 'failed' ? resolve(job) : setTimeout(tick, 5));
    tick();
  });
{
  const dir = path.join(root, 'render');
  await fs.mkdir(dir);
  let clock = 1700000000000;
  const now = () => clock++;
  const execute = async ({ dir: d, file, out, onProgress }) => {
    assert.equal(d, dir);
    assert.equal(file, '5-intro.html');
    onProgress(42.4, 'Streaming frame 20/48');
    await fs.writeFile(out, Buffer.alloc(2048, 1));
  };
  const job = startRender({ dir, file: '5-intro.html', title: 'Intro' }, { execute, now });
  assert.equal(getRender(job.id), job);
  assert.equal(job.status, 'queued');
  await settle(job);
  assert.equal(job.status, 'done');
  assert.equal(job.progress, 100);
  assert.equal(job.message, 'Streaming frame 20/48');
  assert.match(job.output, /^\d+-intro\.mp4$/);
  assert.equal((await fs.stat(path.join(dir, job.output))).size, 2048);
  const side = JSON.parse(await fs.readFile(path.join(dir, job.output.replace(/\.mp4$/, '.json')), 'utf8'));
  assert.equal(side.of, '5-intro.html');
  assert.equal(side.bytes, 2048);
  assert.equal(side.fps, 30);
  assert.ok(job.resolvedAt >= job.startedAt);

  // Two renders finishing on one timestamp cannot share a name.
  const same = () => 1700000000000;
  const j1 = startRender({ dir, file: '5-intro.html', title: 'Twin' }, { execute: async ({ out }) => fs.writeFile(out, 'a'), now: same });
  const j2 = startRender({ dir, file: '5-intro.html', title: 'Twin' }, { execute: async ({ out }) => fs.writeFile(out, 'b'), now: same });
  await Promise.all([settle(j1), settle(j2)]);
  assert.notEqual(j1.output, j2.output);
  assert.deepEqual([j1.output, j2.output].sort(), ['1700000000000-twin-1.mp4', '1700000000000-twin.mp4']);

  // A failure is reported and leaves no file behind.
  const before = (await fs.readdir(dir)).length;
  const failed = startRender({ dir, file: '5-intro.html' }, { execute: async () => Promise.reject(new Error('Chrome not found')), now });
  await settle(failed);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error, 'Chrome not found');
  assert.equal(failed.output, null);
  assert.equal((await fs.readdir(dir)).length, before);
  assert.equal(getRender('nope'), null);
}

await fs.rm(root, { recursive: true, force: true });
// ---- a page takes the bridge and nothing else ----
// It is shown as itself rather than through a viewer, so the player, GSAP and the runtime
// are cost it never pays back. ensureBridge is what keeps the tag from naming a file that
// is not there.
{
  assert.equal(withBridge('<html><head></head><body></body></html>'), `<html><head>${BRIDGE_TAG}\n</head><body></body></html>`);
  assert.equal(withBridge('<h1>hi</h1>'), `${BRIDGE_TAG}\n<h1>hi</h1>`);
  const once = withBridge('<body></body>');
  assert.equal(withBridge(once), once, 'a page read back and rewritten does not grow a second copy');
  assert.equal(withBridge(`<head>${BRIDGE_TAG}</head>`), `<head>${BRIDGE_TAG}</head>`, 'a page that brought its own is left alone');
  // And no runtime: that is the motion's, and a page loading it would run a player it has
  // no composition for.
  assert.equal(/hyperframes-runtime/.test(withBridge('<body></body>')), false);

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'unframed-bridge-'));
  assert.deepEqual(await ensureBridge(dir), [BRIDGE], 'written the first time');
  assert.deepEqual(await fs.readdir(dir), [BRIDGE], 'and nothing else: no player, no GSAP, no runtime');
  assert.deepEqual(await ensureBridge(dir), [], 'idempotent');
  await fs.rm(dir, { recursive: true, force: true });
}

console.log('motion.test.js: ok');
