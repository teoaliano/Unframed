// Media leaves the document. An image or video node used to carry its bytes as a data:
// URL in node data, so the graph on disk was megabytes and every nudge of any node
// rewrote all of them. Now the bytes become a file in the project folder -- the same
// `<timestamp>-<slug>.<ext>` plus `.json` sidecar every generation already writes -- and
// the node keeps `data.file`, which the browser turns into `/api/file/<project>/<file>`
// and the generate routes inline back to base64 at the one boundary where bytes must
// leave the machine (OpenRouter). Design: the slice-1 spec, "Media leaves the document".
//
// Two entry points, both used by document.js: extractMedia for a whole graph on open (a
// project saved before this existed), extractFromOp for an op that arrives carrying a
// data: URL (an older client, a preset fragment). A hosted https: URL in `dataUrl` -- a
// video that already lives somewhere -- is not inline media and is left alone.
import fs from 'node:fs/promises';
import path from 'node:path';

const MEDIA_TYPES = new Set(['image', 'video']);

const EXT_BY_MIME = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
};

// Only base64 data URLs count: that is the only form FileReader.readAsDataURL produces,
// and a text/plain one is a string someone typed, not media.
export function decodeDataUrl(url) {
  if (typeof url !== 'string') return null;
  const m = /^data:([\w.+-]+\/[\w.+-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(url);
  if (!m) return null;
  return { mime: m[1].toLowerCase(), bytes: Buffer.from(m[2].replace(/\s/g, ''), 'base64') };
}

export function extOf(mime, fileName) {
  if (EXT_BY_MIME[mime]) return EXT_BY_MIME[mime];
  const fromName = /\.([a-z0-9]{1,5})$/i.exec(fileName || '');
  return fromName ? fromName[1].toLowerCase() : 'bin';
}

// Same rules as the client's slug() (graph/starter.js) and the server's slugify: the two
// have to agree so a file the browser named and a file the server named sort together.
const slug = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 40);

export function mediaFileName(ts, fileName, ext, n) {
  const base = slug((fileName || '').replace(/\.[^.]+$/, '')) || 'upload';
  return `${ts}-${base}${n ? `-${n}` : ''}.${ext}`;
}

const isInline = (node) => MEDIA_TYPES.has(node.type) && decodeDataUrl(node.data?.dataUrl) !== null;

export const findInlineMedia = (nodes) => nodes.filter(isInline);

// Picks a name nobody else in the folder has. Two drops in the same millisecond, or a
// legacy graph with two same-named images, must not overwrite each other.
async function freshName(dir, ts, fileName, ext) {
  for (let n = 0; ; n++) {
    const name = mediaFileName(ts, fileName, ext, n || undefined);
    try {
      await fs.access(path.join(dir, name));
    } catch {
      return name;
    }
  }
}

// The one place media bytes become a file: extraction below and the upload route in
// index.js both come through here, so naming and the sidecar cannot drift apart.
export async function saveMedia(dir, { bytes, mime, fileName, source, now = Date.now }) {
  const ext = extOf(mime, fileName);
  await fs.mkdir(dir, { recursive: true });
  const file = await freshName(dir, now(), fileName, ext);
  await fs.writeFile(path.join(dir, file), bytes);
  const sidecar = { source, fileName: fileName || '', mime, bytes: bytes.length, at: new Date().toISOString() };
  await fs.writeFile(path.join(dir, file.replace(/\.[^.]+$/, '.json')), JSON.stringify(sidecar, null, 2));
  return file;
}

function writeMedia(dir, dataUrl, fileName, { now, source }) {
  const { mime, bytes } = decodeDataUrl(dataUrl);
  return saveMedia(dir, { bytes, mime, fileName, source, now });
}

const defaults = (opts) => ({ now: opts.now ?? Date.now, source: opts.source ?? 'upload' });

// Whole-graph pass. Returns the rewritten graph (same object when nothing was inline) and
// the updateNode ops that describe the rewrite, so the document can journal them and
// every open tab learns about the new file names the same way it learns anything else.
export async function extractMedia(graph, dir, opts = {}) {
  const o = defaults({ source: 'legacy-graph', ...opts });
  const inline = findInlineMedia(graph.nodes);
  if (!inline.length) return { graph, ops: [] };
  const ops = [];
  const rewritten = new Map();
  for (const node of inline) {
    const file = await writeMedia(dir, node.data.dataUrl, node.data.fileName, o);
    const { dataUrl, ...rest } = node.data;
    rewritten.set(node.id, { ...node, data: { ...rest, file } });
    ops.push({ type: 'updateNode', id: node.id, patch: { dataUrl: null, file } });
  }
  return { graph: { ...graph, nodes: graph.nodes.map((n) => rewritten.get(n.id) ?? n) }, ops };
}

// Per-op pass, run before an op is applied. Returns the op itself when it carries no
// inline media, so callers can compare by identity.
export async function extractFromOp(op, dir, opts = {}) {
  const o = defaults(opts);
  if (!op) return op;
  if (op.type === 'addNode' && op.node && isInline(op.node)) {
    const file = await writeMedia(dir, op.node.data.dataUrl, op.node.data.fileName, o);
    const { dataUrl, ...rest } = op.node.data;
    return { ...op, node: { ...op.node, data: { ...rest, file } } };
  }
  if (op.type === 'updateNode' && op.patch && decodeDataUrl(op.patch.dataUrl)) {
    const file = await writeMedia(dir, op.patch.dataUrl, op.patch.fileName, o);
    return { ...op, patch: { ...op.patch, dataUrl: null, file } };
  }
  if (op.type === 'batch' && Array.isArray(op.ops)) {
    const ops = [];
    let changed = false;
    for (const child of op.ops) {
      const next = await extractFromOp(child, dir, o);
      if (next !== child) changed = true;
      ops.push(next);
    }
    return changed ? { ...op, ops } : op;
  }
  return op;
}
