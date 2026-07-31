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

// { models: [{id,name}], default } — cached; the model list rarely changes.
let modelsCache;
export const listModels = () =>
  (modelsCache ??= fetch('/api/models')
    .then((r) => r.json())
    .catch(() => ({ models: [], default: '' })));

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
