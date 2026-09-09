// The motion asset: a HyperFrames composition -- one HTML file in the project folder,
// timed with data-start/data-duration attributes and a paused GSAP timeline -- shown in
// a node through HyperFrames' player and rendered to an MP4 that becomes an ordinary
// video asset. Design: docs/superpowers/specs/2026-09-06-agent-canvas-slice-4-design.md.
//
// Everything a composition needs at play time sits BESIDE it in the project folder, as
// plain files the preview origin already knows how to hand out: the player, the runtime
// it injects into a composition, GSAP, and a one-page viewer that mounts the player on a
// composition named in its query string. That is what the preview origin's content
// policy was written to allow (`script-src 'self'`, no network) and what makes a motion
// the same kind of thing as a page at the file level -- the same server, the same
// headers, the same frame. Nothing is fetched from a CDN, in the preview or by the agent.
//
// Rendering is the one place a browser runs on the server's behalf: @hyperframes/producer
// drives Chrome frame by frame and ffmpeg encodes. It is imported only when a render is
// asked for -- it is by far the heaviest module in this package, and a canvas that never
// renders a motion should never pay for it. The Chrome is the person's own (findChrome
// below; `.puppeteerrc.cjs` at the root is what stops puppeteer downloading one), because
// nearly everyone who will render has one, and a 170MB download on `npm install` is a
// high price for the few who do not -- they get a message instead (Matteo, 2026-09-06).
import fs from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { mediaFileName } from './media.js';

const require = createRequire(import.meta.url);

// The library, by the name it takes in the project folder. Resolved through what each
// package's `exports` map lets `require.resolve` reach: the player hides its dist, so
// its global build is found beside the entry point; core exports its package.json.
export const LIBRARY = {
  'hyperframes-player.js': () => path.join(path.dirname(require.resolve('@hyperframes/player')), 'hyperframes-player.global.js'),
  'hyperframes-runtime.js': () => path.join(path.dirname(require.resolve('@hyperframes/core/package.json')), 'dist', 'hyperframe.runtime.iife.js'),
  'gsap.js': () => require.resolve('gsap/dist/gsap.min.js'),
};
export const VIEWER = 'hyperframes-viewer.html';
export const LIBRARY_FILES = [VIEWER, ...Object.keys(LIBRARY)];
export const isLibraryFile = (name) => LIBRARY_FILES.includes(name);

// The same alphabet the preview origin serves (preview.js NAME_RE), so the viewer's
// query string can only ever name a sibling that could exist.
const COMPOSITION_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.html?$/;

// The page the node frames. `runtime-src` names the sibling runtime, because the
// player's default is a CDN the preview origin refuses; `muted` so a node can autoplay
// under browser policy, with the controls there to unmute.
export function viewerHtml() {
  return [
    '<!doctype html>',
    '<html><head><meta charset="utf-8"><title>motion</title>',
    '<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}hyperframes-player{display:block;width:100%;height:100%}</style>',
    '<script src="hyperframes-player.js"></script></head>',
    '<body><hyperframes-player id="player" runtime-src="hyperframes-runtime.js" controls muted></hyperframes-player>',
    '<script>',
    `var c = new URLSearchParams(location.search).get('c') || '';`,
    `if (${COMPOSITION_RE.toString()}.test(c)) document.getElementById('player').setAttribute('src', c);`,
    '</script></body></html>',
    '',
  ].join('\n');
}

// The viewer URL for a composition, relative to the project's preview path.
export const viewerPath = (file) => `${VIEWER}?c=${encodeURIComponent(file)}`;

// Put the library beside the compositions, or bring it up to date: a file is rewritten
// when its size differs from the source's, which is what a dependency bump looks like
// from here. Returns the names written. Idempotent, and cheap when nothing changed.
export async function ensureLibrary(dir) {
  await fs.mkdir(dir, { recursive: true });
  const written = [];
  const same = async (file, size) => (await fs.stat(path.join(dir, file)).catch(() => null))?.size === size;
  const viewer = Buffer.from(viewerHtml(), 'utf8');
  if (!(await same(VIEWER, viewer.length))) {
    await fs.writeFile(path.join(dir, VIEWER), viewer);
    written.push(VIEWER);
  }
  for (const [file, resolve] of Object.entries(LIBRARY)) {
    const src = resolve();
    const { size } = await fs.stat(src);
    if (await same(file, size)) continue;
    await fs.copyFile(src, path.join(dir, file));
    written.push(file);
  }
  return written;
}

// The runtime, embedded. A composition plays its clips (show at data-start, hide at the
// end, seek its videos) only with HyperFrames' runtime inside it; the player injects one
// itself only when a composition has no timeline of its own, and every real composition
// has one. So the tag goes in at write time, marked with the attribute the renderer looks
// for (`RUNTIME_BOOTSTRAP_ATTR` in @hyperframes/core) so it can strip this copy and inject
// its own. Idempotent: a composition read back and rewritten does not grow a second one.
export const RUNTIME_TAG = '<script src="hyperframes-runtime.js" data-hyperframes-preview-runtime></script>';
export function withRuntime(html) {
  if (/data-hyperframes-preview-runtime|hyperframes-runtime\.js|hyperframe\.runtime\.iife\.js/i.test(html)) return html;
  const head = /<\/head\s*>/i.exec(html);
  if (head) return `${html.slice(0, head.index)}${RUNTIME_TAG}\n${html.slice(head.index)}`;
  const body = /<body\b[^>]*>/i.exec(html);
  if (body) {
    const at = body.index + body[0].length;
    return `${html.slice(0, at)}\n${RUNTIME_TAG}${html.slice(at)}`;
  }
  return `${RUNTIME_TAG}\n${html}`;
}

// A composition's file name: the same shape as every file in the folder (media.js).
export const motionFileName = (now, title, n) => mediaFileName(now, `${title || 'motion'}.html`, 'html', n);

// ---- rendering ----
// One in-memory record per render. A render is local compute on files that are still
// there, so a record lost to a restart costs a click, not money -- which is why this is
// a Map and not jobs.js.
const renders = new Map();
export const getRender = (id) => renders.get(id) ?? null;

export const renderFileName = (now, title, n) => mediaFileName(now, `${title || 'motion'}.mp4`, 'mp4', n);

export function renderSidecar({ of, title, fps, quality, bytes, now = Date.now() }) {
  return { source: 'render', of, title: title || '', mime: 'video/mp4', fps, quality, bytes, at: new Date(now).toISOString() };
}

// ---- the browser ----
// Where a Chromium lives on each platform, most likely first. Any of these drives the
// render (they all speak the same protocol); the puppeteer and HyperFrames caches come
// last, for a machine that happens to have one from another tool. `UNFRAMED_CHROME_PATH`
// names a binary outright, for the odd install. Pure, so the list is testable.
export function chromeCandidates(platform = process.platform, home = os.homedir(), env = process.env) {
  const out = env.UNFRAMED_CHROME_PATH ? [env.UNFRAMED_CHROME_PATH] : [];
  if (platform === 'darwin') {
    for (const root of ['/Applications', path.join(home, 'Applications')]) {
      out.push(
        path.join(root, 'Google Chrome.app/Contents/MacOS/Google Chrome'),
        path.join(root, 'Chromium.app/Contents/MacOS/Chromium'),
        path.join(root, 'Microsoft Edge.app/Contents/MacOS/Microsoft Edge'),
        path.join(root, 'Brave Browser.app/Contents/MacOS/Brave Browser'),
        path.join(root, 'Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary'),
      );
    }
  } else if (platform === 'win32') {
    const roots = [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean);
    for (const root of roots) {
      out.push(path.join(root, 'Google/Chrome/Application/chrome.exe'), path.join(root, 'Microsoft/Edge/Application/msedge.exe'), path.join(root, 'BraveSoftware/Brave-Browser/Application/brave.exe'), path.join(root, 'Chromium/Application/chrome.exe'));
    }
  } else {
    for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'brave-browser']) {
      out.push(`/usr/bin/${name}`, `/usr/local/bin/${name}`, `/snap/bin/${name}`, `/opt/google/chrome/${name}`);
    }
  }
  // Chrome for Testing, if another tool already fetched it.
  const shell = { darwin: ['chrome-headless-shell-mac-arm64', 'chrome-headless-shell-mac-x64'], linux: ['chrome-headless-shell-linux64'], win32: ['chrome-headless-shell-win64'] }[platform] ?? [];
  for (const cache of [path.join(home, '.cache/puppeteer/chrome-headless-shell'), path.join(home, '.cache/hyperframes/chrome/chrome-headless-shell')]) {
    out.push({ cache, shell });
  }
  return out;
}

// The first candidate that exists, or null. A cache entry is searched newest version
// first; everything else is a plain path.
export function findChrome(candidates = chromeCandidates()) {
  for (const c of candidates) {
    if (typeof c === 'string') {
      if (existsSync(c)) return c;
      continue;
    }
    let versions = [];
    try {
      versions = readdirSync(c.cache).sort().reverse();
    } catch {
      continue;
    }
    for (const v of versions) {
      for (const dirName of c.shell) {
        const bin = path.join(c.cache, v, dirName, platformBinary(dirName));
        if (existsSync(bin)) return bin;
      }
    }
  }
  return null;
}
const platformBinary = (dirName) => (dirName.includes('win') ? 'chrome-headless-shell.exe' : 'chrome-headless-shell');

export const NO_CHROME = 'Rendering needs a Chromium browser on this Mac -- Google Chrome, Chromium, Edge or Brave. Install one, or point UNFRAMED_CHROME_PATH at its binary, and render again.';

// The producer, behind one function so a test can stand in for it.
async function produce({ dir, file, fps, quality, out, onProgress }) {
  const chromePath = findChrome();
  if (!chromePath) throw new Error(NO_CHROME);
  const [{ createRenderJob, executeRenderJob }, { resolveConfig }] = await Promise.all([import('@hyperframes/producer'), import('@hyperframes/engine')]);
  const quiet = { debug() {}, info() {}, warn() {}, error: (m) => console.error('[render]', m) };
  const job = createRenderJob({ fps, quality, format: 'mp4', entryFile: file, logger: quiet, producerConfig: resolveConfig({ chromePath }) });
  await executeRenderJob(job, dir, out, (j, message) => onProgress(j.progress, message));
}

// Start a render and return its record at once; poll `getRender` for the rest. The
// output is rendered into a temp folder and only then placed in the project, named and
// sidecarred like every other file, so a failed render leaves nothing behind.
export function startRender({ dir, file, title = '', fps = 30, quality = 'standard' }, { execute = produce, now = Date.now } = {}) {
  const id = `r-${now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const job = { id, file, status: 'queued', progress: 0, message: '', output: null, error: null, startedAt: now(), resolvedAt: null };
  renders.set(id, job);
  (async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'unframed-render-'));
    try {
      const out = path.join(tmp, 'out.mp4');
      job.status = 'rendering';
      await execute({
        dir,
        file,
        fps,
        quality,
        out,
        onProgress: (progress, message) => {
          job.progress = Math.max(job.progress, Math.min(99, Math.round(progress)));
          job.message = String(message || '');
        },
      });
      job.output = await placeRender(dir, out, { of: file, title, fps, quality, now });
      job.status = 'done';
      job.progress = 100;
    } catch (err) {
      job.status = 'failed';
      job.error = String(err?.message || err);
    } finally {
      job.resolvedAt = now();
      await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
    }
  })();
  return job;
}

// Into the folder under a fresh name (COPYFILE_EXCL, so two renders finishing in the
// same millisecond cannot land on one name), with its sidecar.
async function placeRender(dir, src, { of, title, fps, quality, now }) {
  const ts = now();
  for (let n = 0; ; n++) {
    const file = renderFileName(ts, title, n || undefined);
    try {
      await fs.copyFile(src, path.join(dir, file), fs.constants.COPYFILE_EXCL);
      const { size } = await fs.stat(path.join(dir, file));
      await fs.writeFile(path.join(dir, file.replace(/\.mp4$/, '.json')), JSON.stringify(renderSidecar({ of, title, fps, quality, bytes: size, now: ts }), null, 2));
      return file;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
  }
}
