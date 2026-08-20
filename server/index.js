import { spawn } from 'node:child_process';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { upsertEnv, PATTERNS, envFile, outputPath } from './env.js';
import { readPresets, writePresets } from './presets.js';
import {
  readJobs,
  readJobsStrict,
  persistJob,
  givenUp,
  pendingJobsFor,
  copyPendingJobs,
  dropPendingJobs,
  failPendingJobs,
  reassignPendingJobs,
} from './jobs.js';
import { ensureTunnel, mintShare, revokeShare, waitUntilPublic, stopTunnel } from './share.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
// override: .env wins over ambient env. The preview harness injects PORT=5173
// (its client port); without this the server would bind that instead of 8787.
dotenv.config({ path: envFile(ROOT), override: true });

const PORT = Number(process.env.PORT ?? 8787);
// None of these are const: PUT /api/config rewrites .env and reassigns them, so a
// setting changed in the app takes effect immediately, without a restart. PORT is
// the exception -- the client's dev-server proxy points at a fixed port, so
// changing it needs both halves restarted anyway.
//
// OPENROUTER_MODEL is the old name for the image model, still read so an existing
// .env keeps working.
let IMAGE_MODEL =
  process.env.OPENROUTER_IMAGE_MODEL || process.env.OPENROUTER_MODEL || 'openai/gpt-image-2';
// Vision-capable so a text node can describe images wired into it. Verified live
// on OpenRouter; qwen/qwen3.7-flash is the cheaper fallback if this slug retires.
let TEXT_MODEL = process.env.OPENROUTER_TEXT_MODEL || 'google/gemini-3.5-flash-lite';
// Video is priced per second of output, so the default is a mid-tier model rather
// than the most capable one.
let VIDEO_MODEL = process.env.OPENROUTER_VIDEO_MODEL || 'bytedance/seedance-2.0';
let API_KEY = process.env.OPENROUTER_API_KEY;
let OUTPUT_DIR = outputPath(ROOT, process.env.OUTPUT_DIR);

const app = express();
// Loopback only. A wide-open ACAO let any page the user happened to be visiting
// read this API cross-origin -- /api/health alone carries the key hint, the model
// settings and the output path -- and call DELETE /api/key. Neither real consumer
// needs CORS at all: Vite proxies server-side, so no browser origin is involved,
// and a packaged app is same-origin (see the note below). The allowlist rather
// than nothing is for local tooling, and it is a real boundary because the browser
// sets Origin, not the page.
const LOOPBACK_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
app.use(cors({ origin: (origin, cb) => cb(null, !origin || LOOPBACK_ORIGIN.test(origin)) }));
// Two things the line above cannot do. Neither is redundant with it, and neither
// is redundant with the other.
//
// cors() only decides whether to ECHO Access-Control-Allow-Origin. For any
// method but OPTIONS it calls next() whichever way that went, so the handler
// runs regardless -- and a cross-origin POST carrying no body and no custom
// header is a CORS *simple* request, so there is no preflight to refuse either.
// Any page the user happens to be visiting can therefore fire one and cause its
// side effect while being unable to read the reply. POST /api/pick-folder is the
// live example: a native folder dialog, on the user's desktop, opened by a
// website. Refusing a present non-loopback Origin is what stops the handler from
// being reached at all.
//
// Under DNS rebinding there is no Origin to refuse: a page whose OWN hostname
// resolves to 127.0.0.1 is same-origin with this server, so the browser sends
// none, no CORS check runs, and every response is readable. Host is the name the
// browser actually dialled, so requiring it to be loopback is what rejects a
// rebound one.
//
// Both real consumers pass. Vite proxies without changeOrigin, so the forwarded
// Host stays localhost:5173 and the page's own Origin is loopback too; the
// packaged app loads 127.0.0.1 on its assigned port. share.js is its own http
// server rather than an Express route, so the tunnel -- which must answer a
// public hostname -- is untouched by this.
//
// Both patterns are case-INSENSITIVE, because host names are: LOCALHOST is the
// same machine, and 403ing it rejects a request that was always legitimate.
// Dropping the flag looks like tightening a security check and is not -- it only
// ever refuses a name DNS already resolves to 127.0.0.1. What does the refusing
// is the anchors plus the digits-only port group, and those are untouched, so
// LOCALHOST.evil.example is still no match.
const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
app.use((req, res, next) => {
  const { origin, host } = req.headers;
  if (origin && !LOOPBACK_ORIGIN.test(origin)) {
    return res.status(403).json({ error: 'Unframed answers only same-machine requests.' });
  }
  if (!LOOPBACK_HOST.test(host || '')) {
    return res.status(403).json({ error: 'Unframed answers only requests addressed to localhost.' });
  }
  next();
});
// References are sent as base64 data URLs. Video is the sizing case: the client
// caps a clip at 25MB raw, which is ~33MB as base64, plus prompt and images.
app.use(express.json({ limit: '60mb' }));
// A packaged app serves the canvas from the same origin as the API, so the window
// needs no CORS and no file:// handling. Unset in a clone, where Vite serves it on
// 5173 and proxies /api here.
if (process.env.UNFRAMED_CLIENT_DIST) app.use(express.static(process.env.UNFRAMED_CLIENT_DIST));

function slugify(text) {
  return (
    (text || 'image')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 40) || 'image'
  );
}

// Everything the settings dialog shows. The key itself is never included -- only
// its last 4 chars, enough to tell which key is in use.
function settings() {
  return {
    hasKey: Boolean(API_KEY),
    keyHint: API_KEY ? API_KEY.slice(-4) : '',
    imageModel: IMAGE_MODEL,
    textModel: TEXT_MODEL,
    videoModel: VIDEO_MODEL,
    outputDir: OUTPUT_DIR,
  };
}

app.get('/api/health', (req, res) => {
  // `model` is the old field name for the image model, kept so a stale tab running
  // an older client bundle still reads something sensible.
  res.json({ ok: true, model: IMAGE_MODEL, ...settings() });
});

async function writeEnv(updates) {
  const file = envFile(ROOT);
  const text = await fs.readFile(file, 'utf8').catch(() => '');
  await fs.writeFile(file, upsertEnv(text, updates));
}

// Save settings typed into the UI, so a fresh clone doesn't have to hand-edit
// .env. They land in .env exactly where the manual instructions put them, which
// is also what makes them survive a restart. Anything absent from the body is
// left alone, so the dialog can save one field without resending the others.
app.put('/api/config', async (req, res) => {
  const body = req.body ?? {};
  const fields = {
    key: 'OPENROUTER_API_KEY',
    imageModel: 'OPENROUTER_IMAGE_MODEL',
    textModel: 'OPENROUTER_TEXT_MODEL',
    videoModel: 'OPENROUTER_VIDEO_MODEL',
    outputDir: 'OUTPUT_DIR',
  };
  const updates = {};
  for (const [field, envKey] of Object.entries(fields)) {
    if (body[field] === undefined) continue;
    const value = String(body[field]).trim();
    // Trust boundary: these strings get written into .env, and the key is sent as
    // an HTTP header. Only single clean tokens pass -- see PATTERNS in env.js.
    if (!PATTERNS[envKey].test(value)) {
      return res.status(400).json({
        error:
          field === 'key'
            ? 'That does not look like an OpenRouter key. Keys start with "sk-or-".'
            : field === 'outputDir'
              ? 'That folder path has characters that cannot be saved.'
              : 'That does not look like a model slug. Expected something like "openai/gpt-image-2".',
      });
    }
    updates[envKey] = value;
  }
  if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nothing to save.' });

  // Writing the image model retires the old OPENROUTER_MODEL name, so an upgraded
  // .env doesn't keep two lines that disagree.
  if (updates.OPENROUTER_IMAGE_MODEL) updates.OPENROUTER_MODEL = null;

  // The folder has to be usable before it is saved, or every later generation
  // fails with a disk error instead of a message you can act on.
  if (updates.OUTPUT_DIR) {
    const dir = outputPath(ROOT, updates.OUTPUT_DIR);
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (err) {
      return res.status(400).json({ error: `Cannot use that folder: ${err.message}` });
    }
  }

  // Moving the output folder is a commit protocol, not a sequence of hopeful
  // steps, because every one of them can fail and a pending record is a paid
  // render. The strip of the OLD store is the commit point and comes LAST, so
  // no FAILING step anywhere can lose a record -- the worst outcome of a
  // failure is a duplicate in a store nothing reads. See
  // docs/video-and-sharing.md for the row this makes true.
  //
  // That guarantee is about failures, not about every possible timing: there is
  // a narrow window this protocol does NOT close, and closing it (a second copy
  // pass, merged id lists) is not worth the complexity for what it buys. The
  // copy reads the OLD store before writeEnv commits, and the strip below acts
  // only on the ids that were actually copied -- so a render created between
  // that read and the commit (POST /api/video's persistJob resolves OUTPUT_DIR
  // at call time, and can land mid-writeEnv) is written straight into the old
  // store, was never copied, and is therefore never stripped either: it is left
  // behind, pending, in a folder the sweep no longer visits. The window is one
  // small file read plus write -- on the order of a millisecond. It costs
  // nothing to a browser tab still watching that job, though: the poll route
  // already falls back to its own query-string params when the store lookup
  // misses (the same fallback it used before this store existed), so the clip
  // still gets collected and written under the CURRENT output dir. What is
  // actually lost is bookkeeping -- a stray `pending` row in the old
  // jobs.json that nothing will ever mark done.
  let copied = { ids: [], count: 0 };
  const nextOutputDir = updates.OUTPUT_DIR ? outputPath(ROOT, updates.OUTPUT_DIR) : null;
  if (nextOutputDir) {
    // 1. Copy first. A strict read is the point: readJobs would answer [] for a
    // corrupt or unreadable store, which reads exactly like "nothing is in
    // flight" and would wave the folder change through, orphaning every render
    // the store was tracking.
    try {
      copied = await copyPendingJobs(OUTPUT_DIR, nextOutputDir);
    } catch (err) {
      return res.status(500).json({
        error: `Could not move the renders already in progress to that folder, so the folder was not changed: ${err.message}`,
      });
    }
  }

  // 2. Commit the setting. If this fails the copies are rolled back, so the old
  // store is still the only place those records live -- exactly as before the
  // request.
  try {
    await writeEnv(updates);
  } catch (err) {
    if (copied.count) {
      try {
        await dropPendingJobs(nextOutputDir, copied.ids);
      } catch (rollbackErr) {
        console.log(`  could not roll back copied jobs: ${rollbackErr.message}`);
      }
    }
    return res.status(500).json({ error: `Could not write .env: ${err.message}` });
  }

  // Apply to the live process too, so nothing needs a restart.
  if (updates.OPENROUTER_API_KEY) API_KEY = updates.OPENROUTER_API_KEY;
  if (updates.OPENROUTER_IMAGE_MODEL) IMAGE_MODEL = updates.OPENROUTER_IMAGE_MODEL;
  if (updates.OPENROUTER_TEXT_MODEL) TEXT_MODEL = updates.OPENROUTER_TEXT_MODEL;
  if (updates.OPENROUTER_VIDEO_MODEL) VIDEO_MODEL = updates.OPENROUTER_VIDEO_MODEL;

  if (nextOutputDir) {
    const previousDir = OUTPUT_DIR;
    OUTPUT_DIR = nextOutputDir; // 3. the new store is authoritative from here
    // 3b. If the key was removed while this move was in flight, the records just
    // copied into the new store will never be swept -- the sweep needs a key -- and
    // the DELETE /api/key that removed it failed only the OLD store it could see, so
    // the copies here are still pending. That is a paid render stranded in the live
    // store while the app reported every render ended. Fail them now, the same thing
    // DELETE /api/key would have done had it seen this store. Keyless, every pending
    // record is doomed anyway, so failing all of them matches that route's own
    // semantics; a later step failing changes nothing already made consistent here.
    if (!API_KEY && copied.count) {
      try {
        await failPendingJobs(nextOutputDir, {
          error: 'The OpenRouter key was removed while this render was being moved to a new folder.',
        });
      } catch (err) {
        console.log(`  could not fail moved renders after a key removal: ${err.message}`);
      }
    }
    // 4. Strip the source last, and only the ids that actually travelled -- a
    // render started between the copy and now has not been copied anywhere.
    // Failure here is the one step allowed to be best-effort: the record exists
    // in the store being swept, so nothing is lost, only duplicated in a folder
    // nothing reads.
    if (copied.count) {
      try {
        await dropPendingJobs(previousDir, copied.ids);
        console.log(`  moved ${copied.count} pending video job(s) to the new output folder`);
      } catch (err) {
        console.log(`  left ${copied.count} job record(s) behind in the old folder: ${err.message}`);
      }
    }
  }

  res.json({ ok: true, ...settings() });
});

app.delete('/api/key', async (req, res) => {
  try {
    // null drops the whole line rather than blanking the value, so a
    // shell-provided OPENROUTER_API_KEY isn't overridden with an empty string on
    // the next load.
    await writeEnv({ OPENROUTER_API_KEY: null });
  } catch (err) {
    return res.status(500).json({ error: `Could not write .env: ${err.message}` });
  }
  API_KEY = '';
  // The sweep returns immediately without a key, so every pending render would
  // sit unresolved until the 24-hour clock -- neither collected nor failed,
  // precisely the state the lifecycle contract says cannot happen. Removing a
  // key is an explicit "stop using my account", so ending them now and saying
  // why is the honest answer. REPLACING a key deliberately does not do this: it
  // is usually a renewed key for the same account, and a genuinely unusable id
  // is already ended by the clock.
  //
  // Unlike every other lifecycle mutation here, a store this cannot read does
  // NOT block the action -- the key is already gone by this line, on purpose.
  // Removing a key is a security act, and someone doing it may be responding to
  // a leak; refusing over a corrupt JSON file would be a worse failure than the
  // orphaning it prevents, and in a packaged app they cannot edit .env by hand
  // either. So the failure is REPORTED rather than swallowed, and the caller
  // decides what to say about it.
  let ended = 0;
  let renderCleanupError;
  try {
    ended = await failPendingJobs(OUTPUT_DIR, {
      project: null,
      error: 'Stopped tracking this render: the OpenRouter key was removed, so its progress can no longer be checked. It may still finish upstream, but nothing here will save the result.',
    });
  } catch (err) {
    renderCleanupError = `The key was removed, but renders already in progress could not be stopped: ${err.message}`;
    console.log(`  ${renderCleanupError}`);
  }
  res.json({ ok: true, endedRenders: ended, ...(renderCleanupError ? { renderCleanupError } : {}), ...settings() });
});

// Native folder chooser for the output directory. The browser cannot hand back a
// real filesystem path -- showDirectoryPicker yields a sandboxed handle, and the
// server needs somewhere to write -- but the server is local, so it can open the
// OS dialog itself. Same trick as /api/reveal further down.
app.post('/api/pick-folder', async (req, res) => {
  const run = (cmd, args) =>
    new Promise((resolve) => {
      const child = spawn(cmd, args);
      let out = '';
      child.stdout.on('data', (d) => (out += d));
      // null: no such binary, i.e. no picker on this machine. '': the dialog was
      // cancelled, which exits non-zero with no output and is not an error.
      child.on('error', () => resolve(null));
      child.on('close', (code) => resolve(code === 0 ? out.trim() : ''));
    });

  let picked = null;
  if (process.platform === 'darwin') {
    picked = await run('osascript', [
      '-e',
      `POSIX path of (choose folder with prompt "Choose where Unframed saves its output" default location POSIX file ${JSON.stringify(OUTPUT_DIR)})`,
    ]);
  } else if (process.platform === 'win32') {
    picked = await run('powershell', [
      '-NoProfile',
      '-Command',
      'Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog; if ($d.ShowDialog() -eq "OK") { $d.SelectedPath }',
    ]);
  } else {
    // zenity is the usual one and is often absent; run() resolves null then, which
    // the dialog reports as "type the path instead".
    picked = await run('zenity', ['--file-selection', '--directory', `--filename=${OUTPUT_DIR}/`]);
  }

  if (picked === null) {
    return res
      .status(501)
      .json({ error: 'No folder picker available here. Type the path instead.' });
  }
  res.json({ ok: true, path: picked.split('\n')[0] || '' });
});

// Which video models take existing footage as input. The documented API cannot
// answer this: /api/v1/videos/models has no modality field, and video models are
// absent from /api/v1/models, which is where architecture.input_modalities lives.
// The site's own filter can, though, and this is the endpoint behind it — the same
// data, one tier less official. Inferring from pricing SKUs instead got the count
// right and the set wrong (claimed wan-2.7, missed hailuo-3), which is exactly the
// failure mode a guess produces: plausible, unverifiable, wrong.
//
// Unofficial, so every failure degrades to an empty set: no data means no warning,
// never a false one. Cached for the process lifetime; the catalogue moves weekly.
let videoInputSlugs = null;
async function loadVideoInputSlugs() {
  if (videoInputSlugs) return videoInputSlugs;
  try {
    const r = await fetch(
      'https://openrouter.ai/api/frontend/v1/models/find?active=true&fmt=cards&input_modalities=video',
    );
    const d = await r.json();
    const models = d?.data?.models;
    if (!Array.isArray(models)) throw new Error('unexpected shape');
    videoInputSlugs = new Set(
      models
        .filter((m) => (m.input_modalities || []).includes('video'))
        .map((m) => m.slug)
        .filter(Boolean),
    );
  } catch (err) {
    console.log(`  video input modalities unavailable (${err.message}); warnings disabled`);
    videoInputSlugs = new Set();
  }
  return videoInputSlugs;
}

// jobId -> { images, videos } sent with a video job, so the poll handler can record
// it in the sidecar. Bounded because a long session would otherwise accumulate ids
// forever; entries are read once, seconds to minutes after they are written.
const videoJobRefs = new Map();
function rememberJobRefs(id, refs) {
  if (videoJobRefs.size > 200) videoJobRefs.delete(videoJobRefs.keys().next().value);
  videoJobRefs.set(id, refs);
}

// What a request actually carried, by kind. Recorded in every sidecar and logged,
// so "was the video sent?" is answerable after the fact from our side. Whether the
// model then USED it is a different question, and only billing can hint at that.
function countRefs(refs) {
  const list = Array.isArray(refs) ? refs : [];
  return {
    images: list.filter((r) => r?.image_url?.url).length,
    videos: list.filter((r) => r?.video_url?.url).length,
  };
}

// Models for the node pickers. Two catalogues, two upstream endpoints:
//   image — /images/models is the image catalogue AND the only place that says
//           which generation params each model actually honours. Its
//           `supported_parameters` is a typed map ({aspect_ratio: {type:'enum',
//           values:[...]}, n: {type:'range',min,max}}), which is what lets the
//           output node offer a model's real options instead of a fixed list.
//           The general /models listing has a `supported_parameters` too, but it
//           is the chat one — temperature, top_p — and never mentions an image
//           param, which is why the controls used to be guesswork.
//   text  — the default listing, narrowed to vision-capable models, because a text
//           node can always have images wired into it and a text-only model would
//           silently ignore them.
//   video — a third catalogue with a schema of its own: flat supported_durations /
//           supported_resolutions / supported_aspect_ratios arrays instead of the
//           images endpoint's typed map, plus per-second pricing, which is what
//           makes a spend estimate possible before the click.
app.get('/api/models', async (req, res) => {
  const wantText = req.query.type === 'text';
  const wantVideo = req.query.type === 'video';
  const fallback = wantText ? TEXT_MODEL : wantVideo ? VIDEO_MODEL : IMAGE_MODEL;
  try {
    const url = wantText
      ? 'https://openrouter.ai/api/v1/models'
      : wantVideo
        ? 'https://openrouter.ai/api/v1/videos/models'
        : 'https://openrouter.ai/api/v1/images/models';
    const r = await fetch(url);
    const d = await r.json();
    // Only the video catalogue needs the extra lookup; it is the one whose input
    // modalities the documented API omits.
    const videoInputs = wantVideo ? await loadVideoInputSlugs() : null;
    const models = (d.data || [])
      .filter((m) => {
        if (!wantText) return true; // the image/video endpoints are already filtered
        const out = m.architecture?.output_modalities || [];
        const inp = m.architecture?.input_modalities || [];
        return out.includes('text') && inp.includes('image');
      })
      .map((m) => ({
        id: m.id,
        name: m.name || m.id,
        // Unix seconds, present on every model in all three catalogues. The
        // picker sorts on it, so it stays a number here rather than a
        // formatted date.
        created: m.created ?? null,
        // Passed through as-is; the client reads these to build its controls.
        ...(wantText ? {} : {}),
        ...(wantVideo
          ? {
              params: {
                duration: m.supported_durations || null,
                resolution: m.supported_resolutions || null,
                aspect_ratio: m.supported_aspect_ratios || null,
                // Exact WIDTHxHEIGHT dimensions. OpenRouter documents `size` as
                // interchangeable with resolution + aspect_ratio, so the node
                // offers these instead of that pair where a model declares them.
                size: m.supported_sizes || null,
                frame_images: m.supported_frame_images || null,
                generate_audio: Boolean(m.generate_audio),
                seed: Boolean(m.seed),
              },
              // Per-model billing SKUs in three different units, keyed by name —
              // read docs/models.md before interpreting any value.
              pricing: m.pricing_skus || null,
              // null, not false, when the lookup failed: "unknown" must not read as
              // "does not accept", or an outage turns into a wrong warning.
              acceptsVideo: videoInputs?.size ? videoInputs.has(m.id) : null,
            }
          : wantText
            ? {}
            : { params: m.supported_parameters || null }),
      }));
    if (!models.some((m) => m.id === fallback)) models.push({ id: fallback, name: fallback });
    // Sorted by slug, which also groups them by provider.
    models.sort((a, b) => a.id.localeCompare(b.id));
    res.json({ models, default: fallback });
  } catch {
    res.json({ models: [{ id: fallback, name: fallback }], default: fallback });
  }
});

// Same test-only override pattern as VIDEOS_STATUS_BASE below: unset -- and
// therefore inert -- in every real environment. What it buys is the one
// deterministic way to make a response BODY die mid-read in a test, which no
// real endpoint will do on demand.
const CHAT_COMPLETIONS_URL =
  process.env.UNFRAMED_TEST_CHAT_COMPLETIONS_URL || 'https://openrouter.ai/api/v1/chat/completions';

// Reading a response BODY is a second network operation after the fetch that
// delivered the headers, and it can die on its own -- after the money is spent.
// Unwrapped, that rejection hangs the request and can kill the server (see
// CLAUDE.md's no-error-middleware rule). One implementation for all three
// generation routes; `what` names the thing the user paid for. Callers keep
// their own cleanup -- /api/video's minted share tokens, for one.
// Only the /api/text call site is pinned by a test (its stub can die
// mid-body); /api/generate and /api/video hit hardcoded URLs, so their
// identical two-line call sites are covered by inspection, not by a test.
async function readUpstreamBody(orRes, what) {
  try {
    return { raw: await orRes.text() };
  } catch (err) {
    return {
      error: `Lost the connection while reading OpenRouter's answer: ${err.message}. The ${what} may still have completed and been charged — check your OpenRouter activity page.`,
    };
  }
}

// Run a prompt through a text model. Images wired into a text node are passed as
// content parts so the model can actually see them — that is what lets a text node
// plan work from a picture.
app.post('/api/text', async (req, res) => {
  if (!API_KEY) {
    return res
      .status(400)
      .json({ error: 'No OpenRouter key yet. Add one with the key icon in the top right (it becomes a settings gear once saved).' });
  }

  const { prompt, system, input_references, model, project, batchId } = req.body || {};
  // Coerce so a non-string prompt (e.g. a number) can't throw on .trim() inside
  // this async handler, which would otherwise hang the request.
  const p = typeof prompt === 'string' ? prompt : '';
  // Optional, and the only caller that sends it is the Free-mode repair call. It is
  // what stops the text being rewritten from being read as instructions: rules in the
  // system role arrive through a different channel than the material, so a prompt
  // saying "apply this to image 3" is data, not an order. Sent as a plain string
  // rather than the content array a user turn takes -- providers that have no system
  // slot get it folded into the first user turn by OpenRouter, which is exactly the
  // shape this call had before, so a model without one is no worse off than today.
  const sys = typeof system === 'string' && system.trim() ? system : null;
  if (!p.trim()) {
    return res
      .status(400)
      .json({ error: 'Prompt is empty. Wire a prompt node into this text node, or type one in.' });
  }
  const refs = Array.isArray(input_references) ? input_references : [];

  const content = [{ type: 'text', text: p }];
  for (const ref of refs) {
    // Rebuilt rather than forwarded, so only the two known shapes ever reach the
    // upstream call. video_url is OpenRouter's chat content type for video input
    // (base64 data URLs allowed); the model must list video in input_modalities.
    if (ref?.image_url?.url) content.push({ type: 'image_url', image_url: { url: ref.image_url.url } });
    else if (ref?.video_url?.url) content.push({ type: 'video_url', video_url: { url: ref.video_url.url } });
  }

  let orRes;
  try {
    orRes = await fetch(CHAT_COMPLETIONS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: model || TEXT_MODEL,
        messages: sys ? [{ role: 'system', content: sys }, { role: 'user', content }] : [{ role: 'user', content }],
        // Ask for cost in the usage block so the node can show what the call cost.
        usage: { include: true },
      }),
    });
  } catch (err) {
    return res.status(502).json({ error: `Could not reach OpenRouter: ${err.message}` });
  }

  const { raw, error: bodyError } = await readUpstreamBody(orRes, 'run');
  if (bodyError) return res.status(502).json({ error: bodyError });
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return res
      .status(502)
      .json({ error: `Unexpected response from OpenRouter: ${raw.slice(0, 300)}` });
  }

  if (!orRes.ok) {
    const msg = data?.error?.message || data?.error || raw.slice(0, 300);
    return res.status(orRes.status).json({ error: `OpenRouter (${orRes.status}): ${msg}` });
  }

  const text = data?.choices?.[0]?.message?.content;
  if (!text || !String(text).trim()) {
    return res.status(502).json({ error: 'The model returned no text.' });
  }

  const cost = data?.usage?.cost ?? null;

  // Same treatment as a generation: the project folder should be a complete record
  // of what was spent in it, and a Free batch is one repair call plus N generations.
  try {
    const dir = project ? projectDir(project) : OUTPUT_DIR;
    await fs.mkdir(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const metaPath = path.join(dir, `${stamp}-text-${slugify(p)}.json`);
    await fs.writeFile(
      metaPath,
      JSON.stringify(
        {
          kind: 'text',
          prompt: p,
          model: model || TEXT_MODEL,
          result: String(text),
          referenceCount: refs.length,
          references: countRefs(refs),
          batchId: batchId || null,
          cost,
          createdAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  } catch (err) {
    // A missing cost record must not fail the run the user is waiting on.
    console.log(`  text sidecar failed: ${err.message}`);
  }

  const sent = countRefs(refs);
  console.log(
    `  text →  ${String(text).length} chars  (sent ${sent.images} image, ${sent.videos} video refs)${cost != null ? `  ($${Number(cost).toFixed(4)})` : ''}`,
  );
  res.json({ text: String(text), cost });
});

// A project is just a subfolder of OUTPUT_DIR holding its images, sidecars, and a
// graph.json. slugify() sanitises the name, which also blocks path traversal.
function projectDir(name) {
  return path.join(OUTPUT_DIR, slugify(name));
}

app.get('/api/projects', async (req, res) => {
  // Express 4 with no error middleware: a rejection here used to hang the
  // request, and the project list simply never loaded, with nothing to show why.
  try {
    await fs.mkdir(OUTPUT_DIR, { recursive: true });
    const entries = await fs.readdir(OUTPUT_DIR, { withFileTypes: true });
    res.json({ projects: entries.filter((e) => e.isDirectory()).map((e) => e.name) });
  } catch (err) {
    res.status(500).json({ error: `Could not list the output folder: ${err.message}` });
  }
});

app.get('/api/projects/:name', async (req, res) => {
  try {
    const raw = await fs.readFile(path.join(projectDir(req.params.name), 'graph.json'), 'utf8');
    res.json(JSON.parse(raw));
  } catch {
    res.json({}); // no graph saved yet
  }
});

app.put('/api/projects/:name', async (req, res) => {
  // This is AUTOSAVE. Unwrapped, a full disk or a permissions change hung every
  // save while the canvas looked fine -- silently lost work, the worst version
  // of the no-error-middleware hang.
  try {
    const dir = projectDir(req.params.name);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'graph.json'), JSON.stringify(req.body, null, 2));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: `Could not save the project: ${err.message}` });
  }
});

app.post('/api/projects/:name/rename', async (req, res) => {
  // Slugify the source side too, and reuse this one value for both the folder
  // path and the record match below -- projectDir() already slugifies
  // internally, so resolving the folder from the raw :name while matching
  // records against that same raw string is how the two could silently
  // disagree about which project this is. `to` was already slugified for
  // exactly this reason; `from` now matches it.
  const name = slugify(req.params.name);
  const to = slugify(req.body?.to || '');
  if (!to) return res.status(400).json({ error: 'New name is empty.' });
  const from = projectDir(name);
  const dest = path.join(OUTPUT_DIR, to);
  try {
    await fs.access(dest);
    return res.status(409).json({ error: `A project named "${to}" already exists.` });
  } catch {
    // dest is free — proceed
  }
  // Records first, folder second. A job record carries the slug it was created
  // under and collectVideo mkdirs that path when the clip lands -- so a render
  // finishing after a rename would recreate the OLD folder and write itself
  // into a project the user no longer has. Repointing first is deliberate: a
  // record write is the more reliable of the two operations and its rollback is
  // another record write, whereas rolling back an fs.rename is another rename
  // that can fail just as easily.
  let moved = 0;
  try {
    moved = await reassignPendingJobs(OUTPUT_DIR, name, to);
  } catch (err) {
    return res.status(500).json({
      error: `Could not update the renders in progress for this project, so it was not renamed: ${err.message}`,
    });
  }
  try {
    await fs.rename(from, dest);
  } catch (err) {
    // Put the records back, or they point at a name with no folder and the next
    // collection creates one. If even that fails there is nothing left to try,
    // so say both things plainly rather than reporting a clean failure.
    let restored = true;
    try {
      await reassignPendingJobs(OUTPUT_DIR, to, name);
    } catch (rollbackErr) {
      restored = false;
      console.log(`  could not restore job records after a failed rename: ${rollbackErr.message}`);
    }
    return res.status(500).json({
      error: restored
        ? `Could not rename: ${err.message}`
        : `Could not rename (${err.message}), and ${moved} render(s) in progress are now recorded under "${to}". Renaming the project to "${to}" by hand will reunite them.`,
    });
  }
  res.json({ ok: true, name: to, movedRenders: moved });
});

// Deleting a project with renders in flight is the one destructive case here:
// the render is paid for and cannot be stopped upstream, so the most the app
// can do is stop tracking it and say so. Two-phase rather than a client-side
// confirmation alone, so a caller that forgets to ask cannot silently abandon a
// render: without confirmRenders the route reports what is at stake and changes
// nothing.
app.delete('/api/projects/:name', async (req, res) => {
  // Slugify once and reuse it for the record lookup below AND for projectDir()
  // (which slugifies internally too) -- a raw :name would let the confirm gate
  // check pending renders under one spelling while the folder it goes on to
  // remove is a different one, which is the gate bypassed silently.
  const name = slugify(req.params.name);
  let pending;
  try {
    // Strict: a store that cannot be read cannot tell us what this delete would
    // strand, and guessing "nothing" is how a paid render disappears silently.
    pending = pendingJobsFor(await readJobsStrict(OUTPUT_DIR), name);
  } catch (err) {
    return res.status(500).json({
      error: `Could not check whether this project has renders in progress, so nothing was deleted: ${err.message}`,
    });
  }
  if (pending.length && req.query.confirmRenders !== '1') {
    return res.status(409).json({
      error: `This project has ${pending.length} video render${pending.length === 1 ? '' : 's'} in progress.`,
      pendingRenders: pending.length,
    });
  }
  // Records first, folder second. If the rm then fails, the user retries a
  // delete on a project that is still intact; the other order would leave
  // records pointing at a folder that is gone, and the sweep would recreate it
  // as a ghost holding one clip and no graph.
  let ended = 0;
  if (pending.length) {
    try {
      ended = await failPendingJobs(OUTPUT_DIR, {
        project: name,
        error: 'Stopped tracking this render: the project it belonged to was deleted. It may still finish upstream, but nothing here will save the result.',
      });
    } catch (err) {
      return res.status(500).json({
        error: `Could not stop the renders in progress, so the project was not deleted: ${err.message}`,
      });
    }
    for (const job of pending) revokeJobShares(job.id);
  }
  try {
    await fs.rm(projectDir(name), { recursive: true, force: true });
  } catch (err) {
    // The one partial outcome with no compensation worth having: un-failing a
    // record would claim a render is still being watched when its project may
    // be half-deleted. State both facts instead, so a retry is an informed one.
    return res.status(500).json({
      error: ended
        ? `Stopped ${ended} render(s), but the project folder could not be deleted: ${err.message}. Deleting again is safe.`
        : `Could not delete the project: ${err.message}`,
    });
  }
  res.json({ ok: true, endedRenders: ended });
});

// ---- library ----
// Presets live in presets.js — see the comment there on why reading them is its own
// module. OUTPUT_DIR is passed per call rather than captured, since the settings
// dialog reassigns it and presets follow the output folder.
app.get('/api/presets', async (req, res) => {
  try {
    res.json(await readPresets(OUTPUT_DIR));
  } catch (err) {
    // Unreadable is not empty: 500 so the client aborts its save instead of
    // replacing the whole file with an empty array.
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/presets', async (req, res) => {
  if (!Array.isArray(req.body)) return res.status(400).json({ error: 'Expected an array of presets.' });
  try {
    await writePresets(OUTPUT_DIR, req.body);
    res.json({ ok: true });
  } catch (err) {
    // Unwrapped this hung -- and a preset save that never answers reads as a
    // preset saved, which presets.json's never-rewritten rule makes permanent.
    res.status(500).json({ error: `Could not save the presets: ${err.message}` });
  }
});

// ---- video ----
// Video generation is asynchronous upstream: the create call returns a job, and the
// file only exists minutes later. So this is two routes, not one. The client starts
// a job and then polls; the server keeps the key and, on completion, pulls the
// finished file down and writes it next to the images with the same sidecar shape.
app.post('/api/video', async (req, res) => {
  if (!API_KEY) {
    return res.status(400).json({
      error: 'No OpenRouter key yet. Add one with the key icon in the top right (it becomes a settings gear once saved).',
    });
  }

  const {
    prompt,
    input_references,
    frame_images,
    duration,
    resolution,
    aspect_ratio,
    size,
    generate_audio,
    model,
    project,
  } = req.body || {};

  // Normalised once rather than guarded at each use, the way /api/text does it. A
  // destructuring default only fills in for undefined, so `"input_references": null`
  // would reach .length below and throw -- and a throw in an async handler is not a
  // failed request but a dead server, since Express 4 leaves the rejection unhandled
  // and `node --watch` restarts on file changes, never after a crash.
  const refs = Array.isArray(input_references) ? input_references : [];
  // Same reason as refs: a destructuring default only fills in for undefined, so a
  // literal null would reach .length and take the process down rather than the request.
  const frames = Array.isArray(frame_images) ? frame_images : [];

  if (!prompt || !prompt.trim()) {
    return res
      .status(400)
      .json({ error: 'Prompt is empty. Wire at least one prompt node into the output node.' });
  }

  // OpenRouter's /videos endpoint takes a reference VIDEO only as a public https
  // URL -- a base64 data URL comes back as "Only HTTPS URLs are allowed", and the
  // Files API that could have hosted one accepts images, audio and documents, not
  // video. (Reference IMAGES are fine as base64, which is why image-to-video
  // works.) The way through is a temporary public tunnel to the dedicated share
  // server in share.js -- EXPLICITLY opted into per node, because it makes the
  // clip publicly fetchable (unguessable URL) for the duration of the job.
  const localVideoRefs = refs.filter(
    (r) => r?.video_url?.url && !String(r.video_url.url).startsWith('https://'),
  );
  const mintedTokens = [];
  if (localVideoRefs.length && req.body?.shareLocalVideos !== true) {
    return res.status(400).json({
      error:
        'Video generation only accepts a reference video as a public https:// link, and this one is a local file. Tick “Share via temporary link” on the output node, or wire the video into a text node instead — that path does take local clips.',
    });
  }
  if (localVideoRefs.length) {
    try {
      for (const ref of localVideoRefs) {
        mintedTokens.push(await mintShare(ref.video_url.url));
      }
      // Quick tunnels are best-effort and a share of them never come up at all
      // ("no more connections active and exiting"), so a dead one is retried with
      // a fresh hostname rather than reported as a failure. Each attempt waits for
      // the link to actually serve before the job exists: a new hostname is not
      // fetchable for a few seconds, and the provider fetches immediately, which
      // is the losing side of that race ("resource download failed").
      let base = null;
      for (let attempt = 1; attempt <= 3 && !base; attempt++) {
        if (attempt > 1) stopTunnel(); // a stuck tunnel is not worth waiting on twice
        const candidate = await ensureTunnel();
        if (await waitUntilPublic(`${candidate}/share/${mintedTokens[0]}`, 30000)) base = candidate;
        else console.log(`  tunnel attempt ${attempt} never came up; retrying`);
      }
      if (!base) {
        throw new Error(
          'the temporary link did not come up. The tunnel service is best-effort, so trying again usually works',
        );
      }
      for (let i = 0; i < localVideoRefs.length; i++) {
        localVideoRefs[i].video_url.url = `${base}/share/${mintedTokens[i]}`;
      }
    } catch (err) {
      for (const t of mintedTokens) revokeShare(t);
      return res.status(400).json({ error: `Could not share the clip: ${err.message}` });
    }
  }

  const payload = { model: model || VIDEO_MODEL, prompt };
  if (duration) payload.duration = duration;
  // size is interchangeable with resolution + aspect_ratio upstream; the node sends
  // whichever pair the model declares, and never both.
  if (size) payload.size = size;
  if (resolution) payload.resolution = resolution;
  if (aspect_ratio) payload.aspect_ratio = aspect_ratio;
  if (generate_audio != null) payload.generate_audio = generate_audio;
  if (refs.length) payload.input_references = refs;
  if (frames.length) payload.frame_images = frames;

  // Logged before the call so a failed or ignored run still leaves a record of what
  // went out. OpenRouter documents input_references as reference IMAGES for video
  // generation, so a video entry here is unproven territory: the request may be
  // accepted and the footage silently dropped.
  // Frames aren't references, but a run is either/or (references XOR frames), so
  // folding frames into this object still answers "how much went upstream" —
  // `images` alone stops doing that once a frame run is possible.
  const sentRefs = { ...countRefs(refs), frames: frames.length };
  console.log(
    `  video job →  ${payload.model}  (sent ${sentRefs.images} image, ${sentRefs.videos} video refs, ${sentRefs.frames} frames)`,
  );

  let orRes;
  try {
    orRes = await fetch('https://openrouter.ai/api/v1/videos', {
      method: 'POST',
      headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    for (const t of mintedTokens) revokeShare(t);
    return res.status(502).json({ error: `Could not reach OpenRouter: ${err.message}` });
  }

  const { raw, error: bodyError } = await readUpstreamBody(orRes, 'render');
  if (bodyError) {
    // Like every other failure branch in this route: a job nothing will ever
    // learn about has no refs left to fetch, so its share tokens go dark.
    for (const t of mintedTokens) revokeShare(t);
    return res.status(502).json({ error: bodyError });
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    for (const t of mintedTokens) revokeShare(t);
    return res.status(502).json({ error: `Unexpected response from OpenRouter: ${raw.slice(0, 300)}` });
  }
  if (!orRes.ok) {
    for (const t of mintedTokens) revokeShare(t);
    const msg = data?.error?.message || data?.error || raw.slice(0, 300);
    return res.status(orRes.status).json({ error: `OpenRouter (${orRes.status}): ${msg}` });
  }
  if (!data?.id) {
    for (const t of mintedTokens) revokeShare(t);
    return res.status(502).json({ error: 'OpenRouter did not return a video job id.' });
  }
  // The sidecar is written by the poll handler, which never sees the request body,
  // so what went out is parked here under the job id. Same process serves both, and
  // a lost entry only costs a field in the sidecar. Share tokens ride along so the
  // poll handler can kill them the moment the job stops needing the file.
  rememberJobRefs(data.id, sentRefs);
  if (mintedTokens.length) jobShareTokens.set(data.id, mintedTokens);

  // Written to the store as pending, with everything the sweep will ever need to
  // finish it without a browser in the loop: which project, and the exact params
  // (prompt/model/duration/resolution/size) the sidecar has to match. A write
  // failure here must not fail the request the user is waiting on -- the browser
  // still gets its id back and can resume the old way, via query-string params,
  // exactly as it could before this store existed.
  try {
    await persistJob(OUTPUT_DIR, data.id, {
      project: project || null,
      params: { prompt, model: payload.model, duration: duration || null, resolution: resolution || null, size: size || null },
      startedAt: Date.now(),
      status: 'pending',
      refs: sentRefs,
    });
  } catch (err) {
    console.log(`  job store write failed: ${err.message}`);
  }

  res.json({ id: data.id, status: data.status || 'pending' });
});

// jobId -> share tokens minted for it. Revoked on completion or failure; the TTL
// in share.js is the backstop for a browser that stops polling.
const jobShareTokens = new Map();
function revokeJobShares(id) {
  for (const t of jobShareTokens.get(id) || []) revokeShare(t);
  jobShareTokens.delete(id);
}

// The two record-shapes the sweep and the poll route must never disagree on.
// PR 19's shadowing crash lived in one diverged copy of exactly this code.
async function failJob(id, message) {
  revokeJobShares(id); // the provider will not fetch a dead job's refs
  return persistJob(OUTPUT_DIR, id, { status: 'failed', error: message, resolvedAt: Date.now() });
}

// One finished job becomes one done record.
//
// `params`/`refs` are added ONLY when this caller actually has them, and the
// `!== undefined` guard is load-bearing rather than defensive: persistJob merges
// with `{...existing, ...patch}`, and a spread copies a key even when its value
// is undefined, so an unconditional `params: job.params` would overwrite the
// stored params with undefined -- which writeJobs' JSON.stringify then drops,
// erasing the key from disk. The sweep's own done patch never wrote these two
// keys for exactly that reason; the poll route wrote them because its fallback
// record (a job the store never learned about) is the only source for them.
// Guarded, one function serves both: the poll route's fallback still supplies
// them, and a store-backed job re-writes the values it already has.
async function collectToDone(job, data) {
  const { savedPath, cost, project } = await collectVideo(job, data);
  const patch = { project, status: 'done', savedPath, cost, resolvedAt: Date.now() };
  if (job.params !== undefined) patch.params = job.params;
  if (job.refs !== undefined) patch.refs = job.refs;
  const saved = await persistJob(OUTPUT_DIR, job.id, patch);
  videoJobRefs.delete(job.id); // the job is done; nothing else will read it
  revokeJobShares(job.id); // and its shared clip goes dark with it
  return saved;
}

// Where the saved clip is served from, given the project it landed in and its
// path on disk. Shared by the poll route (fresh and store-served alike) and
// nothing else needs it, since the sweep never returns an HTTP response.
function fileUrl(project, savedPath) {
  return `/api/file/${encodeURIComponent(project || '')}/${encodeURIComponent(path.basename(savedPath || ''))}`;
}

// The client-facing shape for a job the store already resolved, one way or the
// other. Used both by the top-of-route short-circuit and by the re-check after
// the collecting lock below -- two spots that need to answer "is this already
// resolved?" identically, not two hand-rolled copies of the same JSON shape.
function doneResponse(job) {
  return {
    status: 'completed',
    cost: job.cost ?? null,
    savedPath: job.savedPath,
    url: fileUrl(job.project, job.savedPath),
  };
}
function failedResponse(job) {
  return { status: 'failed', error: job.error || 'Generation failed.' };
}

// Overridable ONLY so host.test.js can pin how an upstream status is handled --
// there is no honest way to make OpenRouter itself answer "expired" or an
// unrecognised status on demand. Unset in every real environment, including the
// Electron shell's, so production always asks the real OpenRouter.
const VIDEOS_STATUS_BASE =
  process.env.UNFRAMED_TEST_VIDEOS_STATUS_BASE || 'https://openrouter.ai/api/v1/videos';

// Asks OpenRouter what one job is doing. Used by both the poll route and the
// sweep, so "ask upstream" has one implementation the same way "turn a finished
// job into files" (collectVideo, below) does. Never throws -- everything
// upstream can say or fail to say comes back as a value to branch on, so a
// caller always gets an answer rather than having to wrap this in its own
// try/catch too.
async function fetchVideoStatus(id) {
  let r;
  try {
    r = await fetch(`${VIDEOS_STATUS_BASE}/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
      // A status check is one small JSON answer, and the sweep polls jobs one at
      // a time -- without a signal, one hung socket holds the line for undici's
      // ~5-minute default and stalls collection for every job behind it. 30s
      // matches the sweep's own cadence: slower than that IS no answer.
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    return { ok: false, networkError: err.message };
  }
  // The body is a second network operation after the headers arrived, and it can
  // die on its own -- which is what made the "never throws" promise above false.
  // The poll route awaits this function outside any try/catch, so a rejection
  // here hung that request; the sweep survived only because sweepOne catches.
  // "Could not read the answer" means exactly what "could not reach" means to
  // both callers -- no answer -- so it returns the same shape, and the 24h
  // give-up clock counts it the same way.
  let raw;
  try {
    raw = await r.text();
  } catch (err) {
    return { ok: false, networkError: `could not read the status answer: ${err.message}` };
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, httpStatus: 502, upstreamError: `Unexpected response from OpenRouter: ${raw.slice(0, 300)}` };
  }
  if (!r.ok) {
    const msg = data?.error?.message || data?.error || raw.slice(0, 300);
    return { ok: false, httpStatus: r.status, upstreamError: `OpenRouter (${r.status}): ${msg}` };
  }
  return { ok: true, data };
}

// One home for "this status is terminal", so sweepOne and the poll route can't
// drift apart (`expired` surfaced that gap: it fell through as "still
// rendering" forever). Deliberately NOT a map of every status: anything
// neither `completed` nor in this set is treated as still in flight, because
// providers add in-progress statuses far more often than terminal ones, and
// silently failing a job that is still rendering throws away money -- an
// unrecognised status must default to "keep waiting", never to "this failed".
const TERMINAL_FAILURE_STATUSES = new Set(['failed', 'expired', 'cancelled', 'canceled']);
const isTerminalFailure = (status) => TERMINAL_FAILURE_STATUSES.has(status);

// Turns one COMPLETED OpenRouter job into files on disk: the clip, then its
// sidecar. The only implementation of that step -- the poll route calls it for
// a browser that is watching, the sweep calls it for one that isn't, and
// neither downloads or writes anything a finished job needs on its own. `job`
// carries what was true at creation (project, params, refs) rather than
// whatever the current request happens to have, because the sweep has no
// request at all.
async function collectVideo(job, data) {
  const url = data.unsigned_urls?.[0] || data.urls?.[0];
  if (!url) throw new Error('Job completed without a video URL.');

  const f = await fetch(url, {
    headers: { Authorization: `Bearer ${API_KEY}` },
    // A total-time cap, not an inactivity one: a big clip on a slow line still
    // fits comfortably in five minutes, and the failure this ends is the socket
    // that never answers at all. On abort the throw lands in the caller's
    // existing catch -- the sweep retries next tick, the poll route answers 502.
    signal: AbortSignal.timeout(300_000),
  });
  if (!f.ok) throw new Error(`Could not download the video (${f.status}).`);
  const buf = Buffer.from(await f.arrayBuffer());

  const { prompt = '', model = '', duration, resolution, size } = job.params || {};
  // Resolve the project AFTER the download, from the store as it stands NOW.
  // The download above can run for minutes, and `job` was read before it
  // started -- a rename landing in between is exactly what used to recreate the
  // old folder as a ghost (the same bug 850666b fixed one call frame up, left
  // open here for the length of the download). `current` can legitimately be
  // absent -- a damaged or replaced store -- so fall back to the handed job,
  // the same tolerance both callers already have. Not `||`: '' is a real value
  // meaning "no project", and `current` existing but lacking a `project` key
  // (undefined) is treated the same as '' by this ternary -- consistent with
  // pendingJobsFor's own missing-and-''-are-one-bucket rule, and no reachable
  // path produces a record with `project` literally missing mid-flight anyway.
  const current = (await readJobs(OUTPUT_DIR)).find((j) => j.id === job.id);
  const project = current ? current.project : job.project;
  const dir = project ? projectDir(project) : OUTPUT_DIR;
  await fs.mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const base = `${stamp}-${slugify(prompt)}`;
  const videoPath = path.join(dir, `${base}.mp4`);
  await fs.writeFile(videoPath, buf);

  const cost = data.usage?.cost ?? data.cost ?? null;
  try {
    await fs.writeFile(
      path.join(dir, `${base}.json`),
      JSON.stringify(
        {
          kind: 'video',
          prompt,
          model,
          duration: duration ? Number(duration) : null,
          resolution: resolution || null,
          size: size || null,
          references: job.refs || null,
          // Verbatim, because it is the only evidence that footage was actually
          // consumed: models that charge for video input price it under their
          // own SKU, so the billing shape tells you what the request shape can't.
          usage: data.usage ?? null,
          cost,
          createdAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  } catch (err) {
    console.log(`  sidecar not written: ${err.message}`);
  }

  // `project` rides along so the callers' done patches can record the folder
  // the clip ACTUALLY went into. Without it the sweep's patch left `project`
  // untouched and the poll route's wrote its own pre-download copy -- either
  // way a record whose project and savedPath could disagree after a rename.
  return { savedPath: videoPath, cost, project };
}

// In-process only: closes the gap collectVideo's own idempotency can't. The
// store check in the poll route stops a SECOND request from re-downloading a job
// that already finished, but a sweep tick and a browser's poll for the SAME job
// can both observe "not done yet" and both start collecting in the same instant
// -- this set makes the second one back off instead of racing the first.
//
// It is NOT, on its own, enough for the sweep: sweepJobs takes one snapshot of
// the store per tick, and sweepOne can spend real time (a slow download) inside
// that tick. A second job in the same snapshot can be collected by someone else
// entirely -- a browser's own poll -- while the sweep is still busy with the
// first, and by the time the sweep reaches it `collecting` is long since clear
// again (the other collector finished and released it). That is why sweepOne
// re-reads the store AFTER taking the lock, not before: the lock only proves
// nothing else is racing RIGHT NOW, not that nothing already finished the job
// while this tick's snapshot was going stale.
const collecting = new Set();

// One pending job, one tick -- and one job's failure costs only ITS update.
// sweepOneInner's branches await persistJob in several places; a rejected store
// write there used to throw past the for-loop in sweepJobs and silently skip
// every job queued behind this one until the next tick. The wrapper is what
// makes the "never throws" promise in the comment below actually true.
async function sweepOne(job) {
  try {
    await sweepOneInner(job);
  } catch (err) {
    console.log(`  sweep failed for ${job.id}: ${err.message}`);
  }
}

// One pending job, one tick: poll it, and either leave it alone (still
// rendering), fail it, or collect it. Never throws -- a transient problem
// reaching OpenRouter or downloading the file just waits for the next tick,
// the same tolerance pollVideo has client-side for reaching this server.
async function sweepOneInner(job) {
  const polled = await fetchVideoStatus(job.id);
  if (!polled.ok) {
    // A poll that got no answer. Ordinarily that means "try again next tick" and
    // nothing else -- but an id OpenRouter has forgotten answers this way every
    // time, and a pending record is never pruned, so something has to end it. See
    // UNREACHABLE_MS in jobs.js for the window and why it is a duration rather
    // than a count of failures.
    const why = polled.upstreamError || polled.networkError || 'no answer';
    if (givenUp(job)) {
      // Says what actually happened rather than "Generation failed.": the render
      // may well have run. What is certain is that this machine stopped being
      // able to ask about it, and a user whose clip vanished deserves that much.
      await failJob(job.id, `Stopped checking after 24 hours with no answer about this render. The last attempt said: ${why}`);
      console.log(`  video job ${job.id} gave up: unreachable for 24h (${why})`);
      return;
    }
    // Only the FIRST failure in a run of them writes; every one after that leaves
    // the record alone, so a dead job costs one write, not one every 30 seconds.
    if (!job.unreachableSince) await persistJob(OUTPUT_DIR, job.id, { unreachableSince: Date.now() });
    return;
  }
  // Upstream answered. Whatever it said, the job is reachable, so the clock resets
  // -- a blip today and a blip tomorrow must not add up to a day of silence.
  if (job.unreachableSince) await persistJob(OUTPUT_DIR, job.id, { unreachableSince: undefined });
  const { data } = polled;
  const status = data.status || 'pending';

  if (isTerminalFailure(status)) {
    await failJob(job.id, data.error?.message || data.error || 'Generation failed.');
    return;
  }
  if (status !== 'completed') return; // still queued, rendering, or an unrecognised in-flight status

  if (collecting.has(job.id)) return; // a poll for this exact job is already in flight
  collecting.add(job.id);
  try {
    // See the comment on `collecting` above: this tick's snapshot could be
    // stale by now. Only proceed if the store STILL says pending.
    const fresh = (await readJobs(OUTPUT_DIR)).find((j) => j.id === job.id);
    if (fresh && fresh.status !== 'pending') return; // already resolved elsewhere
    // Collect with FRESH, not `job`: the tick's snapshot can be minutes old by
    // now. collectVideo re-reads the store for the FOLDER itself, so fresh here
    // buys the `status !== 'pending'` guard above plus current params/refs for
    // the filename and sidecar. Fall back to the snapshot only when the store
    // can't supply the record -- damaged or replaced -- same as the poll route.
    const saved = await collectToDone(fresh || job, data);
    console.log(`  video job ${job.id} collected by the sweep → ${saved.savedPath}`);
  } catch (err) {
    console.log(`  sweep could not collect ${job.id}: ${err.message}`);
  } finally {
    collecting.delete(job.id);
  }
}

// Guards against a slow tick overlapping the next: with no re-entrancy check,
// a tick whose downloads run past 30s would still be in its own for-loop when
// the interval fired again, and the second sweepJobs call would build its
// snapshot while the first was mid-flight -- the exact staleness `collecting`'s
// comment above describes, just from two sweeps instead of a sweep and a
// browser poll.
let sweeping = false;

// The point of this whole file: a render finishes whether or not a browser is
// open to watch it. Every pending job in the store gets one poll per tick,
// sequentially -- not Promise.all -- so two ticks' worth of reads-then-writes to
// the same jobs.json can never interleave and drop one job's update under
// another's.
async function sweepJobs() {
  if (!API_KEY || sweeping) return; // nothing to collect without a key; nothing to overlap with a running tick
  sweeping = true;
  try {
    const jobs = await readJobs(OUTPUT_DIR);
    for (const job of jobs.filter((j) => j.status === 'pending')) {
      await sweepOne(job);
    }
  } finally {
    sweeping = false;
  }
}

// Poll one job. While it runs this just forwards the status; once it completes the
// file is fetched and written to disk, and the response points at the saved copy
// rather than carrying the bytes — a video inlined into node data would be saved
// into graph.json on every keystroke.
app.get('/api/video/:id', async (req, res) => {
  const id = req.params.id;

  // Consult the store BEFORE ever touching OpenRouter. Without this, a browser
  // resuming a job the sweep already finished (or a second tab polling the same
  // one) would download and write the clip a second time under a fresh
  // timestamp -- this is what makes double collection impossible, together
  // with the re-check after the lock further down.
  //
  // And before the key check below, not after: an already-resolved record is an
  // answer this route can give with no key at all, since giving it needs only
  // the store. Answering 400 first is what left a card reading "Rendering..."
  // forever after DELETE /api/key ended its record -- the record said `failed`,
  // and the only route that could have told the node bounced it for the very
  // reason the record existed.
  const stored = (await readJobs(OUTPUT_DIR)).find((j) => j.id === id);
  if (stored?.status === 'done') return res.json(doneResponse(stored));
  if (stored?.status === 'failed') return res.json(failedResponse(stored));

  // Everything past here has to reach OpenRouter, so now the key matters.
  if (!API_KEY) return res.status(400).json({ error: 'No OpenRouter key yet.' });

  // Still pending in the store (or not in it at all -- a job started before this
  // store existed). Query params are the fallback source for params in that
  // second case; a job created after this change already has them in `stored`.
  const { project, prompt = '', model = '', duration, resolution, size } = req.query;

  const polled = await fetchVideoStatus(id);
  if (!polled.ok) {
    return polled.networkError
      ? res.status(502).json({ error: `Could not reach OpenRouter: ${polled.networkError}` })
      : res.status(polled.httpStatus).json({ error: polled.upstreamError });
  }
  const { data } = polled;

  const status = data.status || 'pending';
  if (status !== 'completed') {
    if (isTerminalFailure(status)) {
      const message = data.error?.message || data.error || 'Generation failed.';
      // A rejected store write here hung the poll; the failure still reached the
      // store via the sweep eventually, but the browser sat on a request that
      // never answered. A directory where jobs.json belongs makes writeJobs' own
      // rename fail with EISDIR, which is how host.test.js exercises this.
      try {
        const job = await failJob(id, message);
        return res.json(failedResponse(job));
      } catch (err) {
        return res.status(502).json({
          error: `The render failed upstream (${message}), but recording that failed too: ${err.message}`,
        });
      }
    }
    // Still in flight, including a status neither `completed` nor a known
    // failure -- the raw upstream string rides along as-is (not folded into a
    // generic "pending") so an unrecognised one reads as unusual rather than
    // as ordinary progress. pollVideo (client/src/api.js) only branches on
    // `completed`/`failed`; anything else just reaches its onStatus callback.
    return res.json({ status, progress: data.progress ?? null });
  }

  // Completed. The store check above closes the gap once either side finishes;
  // this closes it while both the sweep and this request are still in flight
  // for the exact same job at the exact same moment.
  if (collecting.has(id)) return res.json({ status: 'pending', progress: null });
  collecting.add(id);
  try {
    // The `stored` read above happened before the OpenRouter round trip this
    // request just made -- real time, long enough for the sweep to have
    // already collected this exact job while this request was waiting on
    // fetchVideoStatus. Re-read AFTER taking the lock: the lock only proves
    // nothing else can start collecting from here on, not that nothing already
    // finished while `stored` was going stale.
    const fresh = (await readJobs(OUTPUT_DIR)).find((j) => j.id === id) || stored;
    if (fresh?.status === 'done') return res.json(doneResponse(fresh));
    if (fresh?.status === 'failed') return res.json(failedResponse(fresh));

    const job = fresh || {
      id,
      project: project || null,
      params: { prompt, model, duration, resolution, size },
      refs: videoJobRefs.get(id) || null,
    };
    const saved = await collectToDone(job, data);
    res.json(doneResponse(saved));
  } catch (err) {
    res.status(502).json({ error: err.message });
  } finally {
    collecting.delete(id);
  }
});

// Show generated files in the OS file manager. macOS can select many at once
// (Finder's AppleScript `reveal` takes a list); Windows' explorer /select and
// Linux openers cannot, so multiple files there degrade to opening the folder.
// Files not on disk (uploaded or pasted pictures never touch it) are dropped,
// and an empty survivor list falls back to the folder, so the button always
// lands somewhere sensible.
app.post('/api/reveal', async (req, res) => {
  const { project, fileName, fileNames } = req.body || {};
  const dir = project ? projectDir(project) : OUTPUT_DIR;
  const dirExists = await fs.access(dir).then(() => true, () => false);
  if (!dirExists) return res.status(404).json({ error: 'No files for this project yet.' });

  // Basenames only: the names come from the client, and a path must not escape.
  const wanted = (Array.isArray(fileNames) ? fileNames : [fileName]).filter(Boolean);
  const files = [];
  for (const name of wanted) {
    const file = path.join(dir, path.basename(name));
    if (await fs.access(file).then(() => true, () => false)) files.push(file);
  }

  // Hosted by the shell: hand the paths over rather than driving the OS here. The
  // shell's showItemInFolder covers all three platforms, so this one seam replaces
  // all three branches below -- and, on macOS, removes the Apple Event that would
  // otherwise need an entitlement and a first-run consent prompt.
  //
  // `process.send` alone is NOT the test, and gating on it alone broke reveal for
  // every developer between 2026-08-13 and 2026-08-17: `npm run server` is
  // `node --watch`, watch mode runs the app in a child WITH an IPC channel, and
  // its supervisor drops messages it doesn't know -- so the reveal went nowhere,
  // this route still answered 200, and nothing anywhere reported a failure. Any
  // other IPC-bearing parent (a debugger's auto-attach, nodemon, a process
  // manager) would have done the same. So the channel has to be paired with
  // proof that the parent on the other end is the shell, and that proof is the
  // shell's own marker: UNFRAMED_CLIENT_DIST is set on every fork it makes and
  // by nothing else, which keeps hosted-mode behaviour gated on an env var unset
  // in a clone (docs/releases.md's first invariant) rather than on plumbing that
  // an ordinary dev run happens to share.
  if (process.send && process.env.UNFRAMED_CLIENT_DIST) {
    process.send({ type: 'reveal', files: files.length ? files : [dir] });
    return res.json({ ok: true, revealed: files.length || 'folder' });
  }

  if (process.platform === 'darwin') {
    // A quote in a path would break out of the AppleScript string literal.
    const safe = files.filter((f) => !f.includes('"'));
    if (safe.length) {
      const list = safe.map((f) => `POSIX file "${f}"`).join(', ');
      const script = `tell application "Finder"\nreveal {${list}}\nactivate\nend tell`;
      spawn('osascript', ['-e', script], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('open', [dir], { detached: true, stdio: 'ignore' }).unref();
    }
    return res.json({ ok: true, revealed: safe.length || 'folder' });
  }
  if (process.platform === 'win32') {
    if (files.length === 1) spawn('explorer', [`/select,${files[0]}`], { detached: true, stdio: 'ignore' }).unref();
    else spawn('explorer', [dir], { detached: true, stdio: 'ignore' }).unref();
    return res.json({ ok: true, revealed: files.length === 1 ? 1 : 'folder' });
  }
  spawn('xdg-open', [dir], { detached: true, stdio: 'ignore' }).unref();
  res.json({ ok: true, revealed: 'folder' });
});

// Generated files on disk, for the browser to play without the bytes ever going
// through node data.
app.get('/api/file/:project/:name', (req, res) => {
  const dir = req.params.project ? projectDir(req.params.project) : OUTPUT_DIR;
  // Basename only: the name comes from a URL, and a path in it must not escape.
  const file = path.join(dir, path.basename(req.params.name));
  res.sendFile(file, (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: 'File not found.' });
  });
});

app.post('/api/generate', async (req, res) => {
  if (!API_KEY) {
    return res.status(400).json({
      error: 'No OpenRouter key yet. Add one with the key icon in the top right (it becomes a settings gear once saved).',
    });
  }

  const {
    prompt,
    input_references,
    resolution,
    quality,
    aspect_ratio,
    output_format = 'png',
    background,
    model,
    project,
    batchId,
    runIndex,
    runCount,
  } = req.body || {};

  // Same reason as /api/video: a null here is a dead server, not a failed request.
  const refs = Array.isArray(input_references) ? input_references : [];

  if (!prompt || !prompt.trim()) {
    return res
      .status(400)
      .json({ error: 'Prompt is empty. Wire at least one prompt node into the output node.' });
  }

  const payload = { model: model || IMAGE_MODEL, prompt, output_format };
  if (resolution) payload.resolution = resolution;
  if (quality && quality !== 'auto') payload.quality = quality;
  if (aspect_ratio) payload.aspect_ratio = aspect_ratio;
  // 'auto' means "model's choice", same as quality: send nothing.
  if (background && background !== 'auto') payload.background = background;
  if (refs.length) payload.input_references = refs;

  let orRes;
  try {
    orRes = await fetch('https://openrouter.ai/api/v1/images', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    return res.status(502).json({ error: `Could not reach OpenRouter: ${err.message}` });
  }

  const { raw, error: bodyError } = await readUpstreamBody(orRes, 'run');
  if (bodyError) return res.status(502).json({ error: bodyError });
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return res
      .status(502)
      .json({ error: `Unexpected response from OpenRouter: ${raw.slice(0, 300)}` });
  }

  if (!orRes.ok) {
    const msg = data?.error?.message || data?.error || raw.slice(0, 300);
    return res.status(orRes.status).json({ error: `OpenRouter (${orRes.status}): ${msg}` });
  }

  const first = data?.data?.[0];
  if (!first?.b64_json) {
    return res.status(502).json({ error: 'OpenRouter returned no image data.' });
  }

  const isSvg = first.media_type && first.media_type.includes('svg');
  const ext = isSvg ? 'svg' : output_format;
  const mediaType = first.media_type || `image/${output_format}`;
  const cost = data?.usage?.cost ?? null;

  try {
    const dir = project ? projectDir(project) : OUTPUT_DIR;
    await fs.mkdir(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    // Fixed-N runs share a byte-identical prompt, and Free mode's slug is truncated
    // to 40 chars of shared context — either way, concurrent runs in one batch can
    // collide on the same base name. Folding the run index in spreads them out; the
    // wx-and-retry loop below still catches two different batches landing in the
    // same millisecond.
    const suffix = runCount > 1 ? `-${runIndex || 1}` : '';
    let base = `${stamp}-${slugify(prompt)}${suffix}`;
    const buffer = Buffer.from(first.b64_json, 'base64');

    let imgPath;
    let attempt = 1;
    let candidate = base;
    for (;;) {
      imgPath = path.join(dir, `${candidate}.${ext}`);
      try {
        await fs.writeFile(imgPath, buffer, { flag: 'wx' });
        base = candidate;
        break;
      } catch (err) {
        // wx refuses to clobber an existing file. Retry under a numeric suffix
        // instead of silently overwriting someone else's paid-for image.
        if (err.code !== 'EEXIST' || attempt >= 5) throw err;
        attempt += 1;
        candidate = `${base}-${attempt}`;
      }
    }

    // The sidecar uses the same final base name so image and metadata stay paired,
    // but a sidecar write failure must not turn an already-saved image into a 500 —
    // the /api/text handler already treats its sidecar this way.
    try {
      const metaPath = path.join(dir, `${base}.json`);
      await fs.writeFile(
        metaPath,
        JSON.stringify(
          {
            prompt,
            model: payload.model,
            resolution,
            quality,
            aspect_ratio,
            output_format,
            background: background || null,
            referenceCount: refs.length,
            references: countRefs(refs),
            batchId: batchId || null,
            runIndex: runIndex || 1,
            runCount: runCount || 1,
            cost,
            createdAt: new Date().toISOString(),
            file: path.basename(imgPath),
          },
          null,
          2,
        ),
      );
    } catch (err) {
      console.log(`  sidecar failed: ${err.message}`);
    }

    console.log(`  generated → ${imgPath}${cost != null ? `  ($${Number(cost).toFixed(4)})` : ''}`);

    // url alongside the data URL: the client has no project name of its own to build
    // a file route from, and needs one to persist a pointer instead of the base64
    // bytes in node data (a 1.4MB png inlined into graph.json would be rewritten on
    // every keystroke — the same reason the video routes hand one back).
    res.json({
      image: `data:${mediaType};base64,${first.b64_json}`,
      savedPath: imgPath,
      url: fileUrl(project, imgPath),
      cost,
    });
  } catch (err) {
    res.status(500).json({ error: `Generated the image but failed to write it: ${err.message}` });
  }
});

// A render outlives the browser: sweep once at boot (a job that finished while
// the app was closed shouldn't wait for the first interval to land) and every
// 30s after. unref() so this timer alone can never keep the process alive --
// host.test.js kills a forked server and needs it to actually exit, and a
// packaged app closing its window must not leave an orphan still polling
// OpenRouter on its way out.
sweepJobs().catch((err) => console.log(`  sweep failed: ${err.message}`));
setInterval(() => {
  sweepJobs().catch((err) => console.log(`  sweep failed: ${err.message}`));
}, 30_000).unref();

// PORT=0 asks the OS for any free port, which is how the packaged app avoids
// fighting whatever else is on 8787. The parent cannot guess it, so it is reported
// back over the IPC channel fork() provides.
// Bound to loopback, not every interface. The two guards above are browser-side:
// they read headers a browser sets honestly and a non-browser client simply
// writes itself, so `curl -H 'Host: localhost'` from any other machine on the
// network satisfies both. Refusing the connection is the only check that holds
// against a client that is not a browser -- and every route here either spends
// the user's money, reads their output folder, or writes their key. share.js
// already binds this way; this is the same reasoning, for the API the app itself
// uses. There is deliberately no opt-in to widen it: nothing in Unframed is
// meant to be reached from another device.
const server = app.listen(PORT, '127.0.0.1', () => {
  const { port } = server.address();
  console.log(`\n  Unframed server  →  http://localhost:${port}`);
  console.log(`  image:    ${IMAGE_MODEL}`);
  console.log(`  text:     ${TEXT_MODEL}`);
  console.log(`  video:    ${VIDEO_MODEL}`);
  console.log(
    `  api key:  ${API_KEY ? 'loaded' : 'MISSING — add one in the app (settings icon, top right)'}`,
  );
  console.log(`  output:   ${OUTPUT_DIR}\n`);
  process.send?.({ type: 'ready', port });
});
