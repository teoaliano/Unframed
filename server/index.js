import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
// override: .env wins over ambient env. The preview harness injects PORT=5173
// (its client port); without this the server would bind that instead of 8787.
dotenv.config({ path: path.join(ROOT, '.env'), override: true });

const PORT = process.env.PORT || 8787;
const MODEL = process.env.OPENROUTER_MODEL || 'openai/gpt-image-2';
const API_KEY = process.env.OPENROUTER_API_KEY;
const OUTPUT_DIR = path.resolve(ROOT, process.env.OUTPUT_DIR || './output');

const app = express();
app.use(cors());
// Reference images are sent as base64 data URLs, so allow a generous body size.
app.use(express.json({ limit: '30mb' }));

function slugify(text) {
  return (
    (text || 'image')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 40) || 'image'
  );
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, model: MODEL, hasKey: Boolean(API_KEY), outputDir: OUTPUT_DIR });
});

// Image-capable models OpenRouter currently lists, for the output node's picker.
// The configured MODEL is always included (some working slugs aren't listed).
app.get('/api/models', async (req, res) => {
  try {
    const r = await fetch('https://openrouter.ai/api/v1/models');
    const d = await r.json();
    const models = (d.data || [])
      .filter((m) => (m.architecture?.output_modalities || []).includes('image'))
      .map((m) => ({ id: m.id, name: m.name || m.id }));
    if (!models.some((m) => m.id === MODEL)) models.unshift({ id: MODEL, name: MODEL });
    res.json({ models, default: MODEL });
  } catch {
    res.json({ models: [{ id: MODEL, name: MODEL }], default: MODEL });
  }
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

app.post('/api/generate', async (req, res) => {
  if (!API_KEY) {
    return res.status(400).json({
      error: 'Missing OPENROUTER_API_KEY. Copy .env.example to .env and paste your key.',
    });
  }

  const {
    prompt,
    input_references = [],
    resolution,
    quality,
    aspect_ratio,
    output_format = 'png',
    model,
    project,
  } = req.body || {};

  if (!prompt || !prompt.trim()) {
    return res
      .status(400)
      .json({ error: 'Prompt is empty. Wire at least one prompt node into the output node.' });
  }

  const payload = { model: model || MODEL, prompt, output_format };
  if (resolution) payload.resolution = resolution;
  if (quality && quality !== 'auto') payload.quality = quality;
  if (aspect_ratio) payload.aspect_ratio = aspect_ratio;
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
    const base = `${stamp}-${slugify(prompt)}`;
    const imgPath = path.join(dir, `${base}.${ext}`);
    const metaPath = path.join(dir, `${base}.json`);

    await fs.writeFile(imgPath, Buffer.from(first.b64_json, 'base64'));
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
          referenceCount: input_references.length,
          cost,
          createdAt: new Date().toISOString(),
          file: path.basename(imgPath),
        },
        null,
        2,
      ),
    );

    console.log(`  generated → ${imgPath}${cost != null ? `  ($${Number(cost).toFixed(4)})` : ''}`);

    res.json({ image: `data:${mediaType};base64,${first.b64_json}`, savedPath: imgPath, cost });
  } catch (err) {
    res.status(500).json({ error: `Generated the image but failed to write it: ${err.message}` });
  }
});

app.listen(PORT, () => {
  console.log(`\n  weave-lite server  →  http://localhost:${PORT}`);
  console.log(`  model:    ${MODEL}`);
  console.log(`  api key:  ${API_KEY ? 'loaded' : 'MISSING — add it to .env'}`);
  console.log(`  output:   ${OUTPUT_DIR}\n`);
});
