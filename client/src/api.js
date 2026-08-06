// Current project name — kept here so generate() tags every request without
// threading it through the node components. Canvas sets it on load/switch.
let currentProject = 'default';
export const setProject = (name) => {
  currentProject = name;
};

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

// Video is a job, not a call: this starts one and resolves when the file exists,
// reporting progress along the way. The upstream job can run for minutes, so the
// polling lives here rather than in one long request that a proxy would time out.
export async function generateVideo(body, onStatus) {
  const res = await fetch('/api/video', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, project: currentProject }),
  });
  const started = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(started.error || `Request failed (${res.status})`);

  // Everything the server needs to name the file and its sidecar once the job lands.
  const q = new URLSearchParams({
    project: currentProject,
    prompt: body.prompt || '',
    model: body.model || '',
    duration: body.duration ?? '',
    resolution: body.resolution || '',
  });

  // Every 4s: fast enough to feel live, slow enough that a three-minute render is
  // ~45 requests rather than hundreds.
  for (let waited = 0; waited < 15 * 60 * 1000; waited += 4000) {
    await new Promise((r) => setTimeout(r, 4000));
    const p = await fetch(`/api/video/${encodeURIComponent(started.id)}?${q}`);
    const d = await p.json().catch(() => ({}));
    if (!p.ok) throw new Error(d.error || `Request failed (${p.status})`);
    if (d.status === 'failed') throw new Error(d.error || 'Generation failed.');
    if (d.status === 'completed') return d;
    onStatus?.(d.status, d.progress);
  }
  throw new Error('Gave up waiting for the video after 15 minutes. It may still finish on OpenRouter.');
}

// { ok, model, hasKey, keyHint, outputDir } — keyHint is the last 4 chars; the key
// itself never leaves the server.
export const getHealth = () => fetch('/api/health').then((r) => r.json());

export const saveKey = (key) =>
  fetch('/api/key', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key }),
  }).then(async (r) => {
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `Could not save the key (${r.status})`);
    return d;
  });

export const clearKey = () =>
  fetch('/api/key', { method: 'DELETE' }).then(async (r) => {
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `Could not remove the key (${r.status})`);
    return d;
  });

export const listProjects = () =>
  fetch('/api/projects')
    .then((r) => r.json())
    .then((d) => d.projects || []);

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

export const loadProject = (name) =>
  fetch(`/api/projects/${encodeURIComponent(name)}`).then((r) => r.json());

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

export const deleteProject = (name) =>
  fetch(`/api/projects/${encodeURIComponent(name)}`, { method: 'DELETE' });
