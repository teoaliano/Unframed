import { migrateNodes } from './graph/migrate.js';

// Current project name — kept here so generate() tags every request without
// threading it through the node components. Canvas sets it on load/switch.
let currentProject = 'default';
export const setProject = (name) => {
  currentProject = name;
};
// Read back by anything whose result outlives the request: a run started in one
// project must not write its answer into whatever project is open when it lands.
export const getProject = () => currentProject;

// One id per app session (i.e. per page load), never persisted anywhere itself.
// Stamped into a node's in-flight marker (ImageOutputNode.onGenerate,
// TextOutputNode.onRun) so a marker left behind by a closed or reloaded tab reads
// as abandoned rather than disabling that node's button forever: an image or text
// run is a single request nothing can resume, so a marker from any OTHER session
// is stale by definition and gets cleared on mount instead of trusted.
export const SESSION_ID = `s-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export async function generate(body) {
  const res = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, project: currentProject }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export async function runText(body) {
  const res = await fetch('/api/text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, project: currentProject }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// Starts a video job and returns immediately with its id — nothing here waits on
// the render. Split out from polling (which used to live in one function together
// with this) so the id can be written to node data, and therefore graph.json,
// before any polling begins: a tab that dies one line later still has it.
export async function startVideo(body) {
  const res = await fetch('/api/video', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, project: currentProject }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// Polls one job. `params` is exactly what the server needs to name the file and
// its sidecar once the job lands — the same shape a caller stores in a node's
// data.job, so a poll resumed after a reload has everything it needs from that
// object alone, with nothing else in scope. Checks once immediately, so a mount
// resuming a job the server may already have collected gets its answer without
// waiting 4s for nothing, then every 4s after — fast enough to feel live, slow
// enough that a three-minute render is ~45 requests rather than hundreds.
//
// `until` (ms) bounds how long this call keeps at it; past that it resolves with
// `{ pending: true }` rather than throwing — the caller decides what "still going"
// means for the id it holds, and it is never this function's place to decide the
// id is lost. The one thing that DOES throw is a genuine failure: the job itself
// reporting failed. A bad response or a failure to even reach our own server
// (it could just be restarting) says nothing about the job, so it is treated the
// same as still-pending rather than costing the id its only reference.
export async function pollVideo(id, params, onStatus, { until = 15 * 60 * 1000 } = {}) {
  const q = new URLSearchParams({
    project: currentProject,
    prompt: params.prompt || '',
    model: params.model || '',
    duration: params.duration ?? '',
    // One of these is set, never both — see the size/resolution note in OutputNode.
    resolution: params.resolution || '',
    size: params.size || '',
  });

  const deadline = Date.now() + until;
  for (;;) {
    const d = await fetch(`/api/video/${encodeURIComponent(id)}?${q}`)
      .then((p) => (p.ok ? p.json().catch(() => null) : null))
      .catch(() => null);
    if (d) {
      if (d.status === 'failed') throw new Error(d.error || 'Generation failed.');
      if (d.status === 'completed') return d;
      onStatus?.(d.status, d.progress);
    }
    if (Date.now() >= deadline) return { pending: true };
    await new Promise((r) => setTimeout(r, 4000));
  }
}

// Ask the OS to show generated files (or the project folder) in its file manager.
export async function revealFiles(fileNames) {
  const res = await fetch('/api/reveal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileNames, project: currentProject }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// { ok, hasKey, keyHint, imageModel, textModel, videoModel, outputDir } — keyHint
// is the last 4 chars; the key itself never leaves the server.
export const getHealth = () => fetch('/api/health').then((r) => r.json());

// Fields left out are left untouched on the server, so the dialog can save just
// the key or just the folder. Returns the settings as they now stand.
export const saveConfig = (fields) =>
  fetch('/api/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  }).then(async (r) => {
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `Could not save settings (${r.status})`);
    return d;
  });

export const clearKey = () =>
  fetch('/api/key', { method: 'DELETE' }).then(async (r) => {
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `Could not remove the key (${r.status})`);
    return d;
  });

// Opens the OS folder dialog on the machine running the server (which is this
// one). Resolves to '' if it was cancelled; throws where there is no picker.
export const pickFolder = () =>
  fetch('/api/pick-folder', { method: 'POST' }).then(async (r) => {
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `Could not open the folder picker (${r.status})`);
    return d.path || '';
  });

// null means "could not ask" — the server is restarting, or the request failed.
// That is NOT the same as [] ("no projects yet"), and the difference matters: on a
// failure the app must not invent a project and start writing into it.
export const listProjects = () =>
  fetch('/api/projects')
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then((d) => d.projects || [])
    .catch(() => null);

// { models: [{id,name}], default } per catalogue — cached, since the lists rarely
// change within a session. Keyed by type so the two catalogues can't overwrite
// each other.
const modelsCache = new Map();
export const listModels = (type = 'image') => {
  if (!modelsCache.has(type)) {
    modelsCache.set(
      type,
      fetch(`/api/models?type=${encodeURIComponent(type)}`)
        .then((r) => r.json())
        .catch(() => ({ models: [], default: '' })),
    );
  }
  return modelsCache.get(type);
};

// Migrated on the way in, here rather than at the two call sites, because this is the
// only place a graph is read and one of those sites would eventually be forgotten. A
// graph saved before the output split names types nothing on the canvas registers any
// more; the next autosave writes the migrated shape back, so each project self-heals
// the first time it is opened.
export const loadProject = (name) =>
  fetch(`/api/projects/${encodeURIComponent(name)}`)
    .then((r) => r.json())
    .then((g) => (g?.nodes ? { ...g, nodes: migrateNodes(g.nodes) } : g));

export const saveProject = (name, graph) =>
  fetch(`/api/projects/${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(graph),
  });

export const renameProject = (name, to) =>
  fetch(`/api/projects/${encodeURIComponent(name)}/rename`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to }),
  }).then(async (r) => {
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `Rename failed (${r.status})`);
    return d;
  });

// Unlike its neighbours this one reads the body: a project with renders in
// flight answers 409 with how many, and the caller escalates its confirmation
// before calling again with confirmRenders. Returning the bare fetch (as this
// did) meant that refusal -- and every other failure -- read as success, and the
// project vanished from the list without being deleted.
export const deleteProject = (name, { confirmRenders } = {}) =>
  fetch(`/api/projects/${encodeURIComponent(name)}${confirmRenders ? '?confirmRenders=1' : ''}`, {
    method: 'DELETE',
  }).then(async (r) => {
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      const err = new Error(d.error || `Could not delete the project (${r.status})`);
      err.pendingRenders = d.pendingRenders ?? 0;
      throw err;
    }
    return d;
  });

// Your saved library presets — one array, one file. This one throws on failure
// instead of falling back to []: savePresets replaces the whole file, so a
// swallowed error here would let the next save quietly erase presets that are
// still on disk. Same reasoning as listProjects returning null.
export const listPresets = () =>
  fetch('/api/presets').then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  });

export const savePresets = (presets) =>
  fetch('/api/presets', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(presets),
  }).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
  });
