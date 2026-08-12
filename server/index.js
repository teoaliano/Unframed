import { spawn } from 'node:child_process';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { upsertEnv, PATTERNS } from './env.js';
import { ensureTunnel, mintShare, revokeShare, waitUntilPublic, stopTunnel } from './share.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
// override: .env wins over ambient env. The preview harness injects PORT=5173
// (its client port); without this the server would bind that instead of 8787.
dotenv.config({ path: path.join(ROOT, '.env'), override: true });

const PORT = process.env.PORT || 8787;
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
let OUTPUT_DIR = path.resolve(ROOT, process.env.OUTPUT_DIR || './output');

const app = express();
app.use(cors());
// References are sent as base64 data URLs. Video is the sizing case: the client
// caps a clip at 25MB raw, which is ~33MB as base64, plus prompt and images.
app.use(express.json({ limit: '60mb' }));

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
  const envPath = path.join(ROOT, '.env');
  const text = await fs.readFile(envPath, 'utf8').catch(() => '');
  await fs.writeFile(envPath, upsertEnv(text, updates));
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
    const dir = path.resolve(ROOT, updates.OUTPUT_DIR);
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (err) {
      return res.status(400).json({ error: `Cannot use that folder: ${err.message}` });
    }
  }

  try {
    await writeEnv(updates);
  } catch (err) {
    return res.status(500).json({ error: `Could not write .env: ${err.message}` });
  }

  // Apply to the live process too, so nothing needs a restart.
  if (updates.OPENROUTER_API_KEY) API_KEY = updates.OPENROUTER_API_KEY;
  if (updates.OPENROUTER_IMAGE_MODEL) IMAGE_MODEL = updates.OPENROUTER_IMAGE_MODEL;
  if (updates.OPENROUTER_TEXT_MODEL) TEXT_MODEL = updates.OPENROUTER_TEXT_MODEL;
  if (updates.OPENROUTER_VIDEO_MODEL) VIDEO_MODEL = updates.OPENROUTER_VIDEO_MODEL;
  if (updates.OUTPUT_DIR) OUTPUT_DIR = path.resolve(ROOT, updates.OUTPUT_DIR);

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
  res.json({ ok: true, ...settings() });
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
              // cents per second, by resolution where the model prices them apart.
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

// Run a prompt through a text model. Images wired into a text node are passed as
// content parts so the model can actually see them — that is what lets a text node
// plan work from a picture.
app.post('/api/text', async (req, res) => {
  if (!API_KEY) {
    return res
      .status(400)
      .json({ error: 'No OpenRouter key yet. Add one with the key icon in the top right (it becomes a settings gear once saved).' });
  }

  const { prompt, input_references, model, project, batchId } = req.body || {};
  // Coerce so a non-string prompt (e.g. a number) can't throw on .trim() inside
  // this async handler, which would otherwise hang the request.
  const p = typeof prompt === 'string' ? prompt : '';
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
    orRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: model || TEXT_MODEL,
        messages: [{ role: 'user', content }],
        // Ask for cost in the usage block so the node can show what the call cost.
        usage: { include: true },
      }),
    });
  } catch (err) {
    return res.status(502).json({ error: `Could not reach OpenRouter: ${err.message}` });
  }

  const raw = await orRes.text();
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
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const entries = await fs.readdir(OUTPUT_DIR, { withFileTypes: true });
  res.json({ projects: entries.filter((e) => e.isDirectory()).map((e) => e.name) });
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
  const dir = projectDir(req.params.name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'graph.json'), JSON.stringify(req.body, null, 2));
  res.json({ ok: true });
});

app.post('/api/projects/:name/rename', async (req, res) => {
  const to = slugify(req.body?.to || '');
  if (!to) return res.status(400).json({ error: 'New name is empty.' });
  const from = projectDir(req.params.name);
  const dest = path.join(OUTPUT_DIR, to);
  try {
    await fs.access(dest);
    return res.status(409).json({ error: `A project named "${to}" already exists.` });
  } catch {
    // dest is free — proceed
  }
  try {
    await fs.rename(from, dest);
    res.json({ ok: true, name: to });
  } catch (err) {
    res.status(500).json({ error: `Could not rename: ${err.message}` });
  }
});

app.delete('/api/projects/:name', async (req, res) => {
  await fs.rm(projectDir(req.params.name), { recursive: true, force: true });
  res.json({ ok: true });
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
    input_references = [],
    duration,
    resolution,
    aspect_ratio,
    size,
    generate_audio,
    model,
  } = req.body || {};

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
  const localVideoRefs = (Array.isArray(input_references) ? input_references : []).filter(
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
  if (input_references.length) payload.input_references = input_references;

  // Logged before the call so a failed or ignored run still leaves a record of what
  // went out. OpenRouter documents input_references as reference IMAGES for video
  // generation, so a video entry here is unproven territory: the request may be
  // accepted and the footage silently dropped.
  const sentRefs = countRefs(input_references);
  console.log(
    `  video job →  ${payload.model}  (sent ${sentRefs.images} image, ${sentRefs.videos} video refs)`,
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

  const raw = await orRes.text();
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
  res.json({ id: data.id, status: data.status || 'pending' });
});

// jobId -> share tokens minted for it. Revoked on completion or failure; the TTL
// in share.js is the backstop for a browser that stops polling.
const jobShareTokens = new Map();
function revokeJobShares(id) {
  for (const t of jobShareTokens.get(id) || []) revokeShare(t);
  jobShareTokens.delete(id);
}

// Poll one job. While it runs this just forwards the status; once it completes the
// file is fetched and written to disk, and the response points at the saved copy
// rather than carrying the bytes — a video inlined into node data would be saved
// into graph.json on every keystroke.
app.get('/api/video/:id', async (req, res) => {
  if (!API_KEY) return res.status(400).json({ error: 'No OpenRouter key yet.' });
  const { project, prompt = '', model = '', duration, resolution, size } = req.query;

  let data;
  try {
    const r = await fetch(`https://openrouter.ai/api/v1/videos/${encodeURIComponent(req.params.id)}`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    const raw = await r.text();
    try {
      data = JSON.parse(raw);
    } catch {
      return res.status(502).json({ error: `Unexpected response from OpenRouter: ${raw.slice(0, 300)}` });
    }
    if (!r.ok) {
      const msg = data?.error?.message || data?.error || raw.slice(0, 300);
      return res.status(r.status).json({ error: `OpenRouter (${r.status}): ${msg}` });
    }
  } catch (err) {
    return res.status(502).json({ error: `Could not reach OpenRouter: ${err.message}` });
  }

  const status = data.status || 'pending';
  if (status !== 'completed') {
    if (status === 'failed') {
      revokeJobShares(req.params.id); // the provider will not fetch a dead job's refs
      return res.json({ status, error: data.error?.message || data.error || 'Generation failed.' });
    }
    return res.json({ status, progress: data.progress ?? null });
  }

  const url = data.unsigned_urls?.[0] || data.urls?.[0];
  if (!url) return res.status(502).json({ error: 'Job completed without a video URL.' });

  let buf;
  try {
    const f = await fetch(url, { headers: { Authorization: `Bearer ${API_KEY}` } });
    if (!f.ok) return res.status(502).json({ error: `Could not download the video (${f.status}).` });
    buf = Buffer.from(await f.arrayBuffer());
  } catch (err) {
    return res.status(502).json({ error: `Could not download the video: ${err.message}` });
  }

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
          references: videoJobRefs.get(req.params.id) || null,
          // Verbatim, because it is the only evidence that footage was actually
          // consumed: models that charge for video input price it under their own
          // SKU (seedance's video_tokens_with_video_input), so the billing shape
          // tells you what the request shape cannot.
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
  videoJobRefs.delete(req.params.id); // the job is done; nothing else will read it
  revokeJobShares(req.params.id); // and its shared clip goes dark with it

  res.json({
    status,
    cost,
    savedPath: videoPath,
    // Served from disk rather than inlined, so the graph stays small.
    url: `/api/file/${encodeURIComponent(project || '')}/${encodeURIComponent(`${base}.mp4`)}`,
  });
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
    input_references = [],
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
  if (input_references.length) payload.input_references = input_references;

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

  const raw = await orRes.text();
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
            referenceCount: input_references.length,
            references: countRefs(input_references),
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

    res.json({ image: `data:${mediaType};base64,${first.b64_json}`, savedPath: imgPath, cost });
  } catch (err) {
    res.status(500).json({ error: `Generated the image but failed to write it: ${err.message}` });
  }
});

app.listen(PORT, () => {
  console.log(`\n  Unframed server  →  http://localhost:${PORT}`);
  console.log(`  image:    ${IMAGE_MODEL}`);
  console.log(`  text:     ${TEXT_MODEL}`);
  console.log(`  video:    ${VIDEO_MODEL}`);
  console.log(
    `  api key:  ${API_KEY ? 'loaded' : 'MISSING — add one in the app (settings icon, top right)'}`,
  );
  console.log(`  output:   ${OUTPUT_DIR}\n`);
});
