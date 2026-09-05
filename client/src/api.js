// Every request that writes into a project names it explicitly -- the caller reads
// it from graph/project.js's context. There used to be a module-level currentProject
// here, set by App.jsx on every switch; it was the third copy of the active project
// and the one that drifted (CLAUDE.md, the activate() story).

// One id per app session (i.e. per page load), never persisted anywhere itself. Two
// jobs: stamped into a node's in-flight marker (ImageOutputNode.onGenerate,
// TextOutputNode.onRun) so a marker left behind by a closed or reloaded tab reads as
// abandoned rather than disabling that node's button forever; and the origin of every
// op this tab sends, so the event stream's echo of our own changes can be told apart
// from everyone else's.
export const SESSION_ID = `s-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const enc = encodeURIComponent;

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const generate = (body, project) => postJson('/api/generate', { ...body, project });

export const runText = (body, project) => postJson('/api/text', { ...body, project });

// Starts a video job and returns immediately with its id — nothing here waits on
// the render. Split out from polling (which used to live in one function together
// with this) so the id can be written to node data, and therefore the document,
// before any polling begins: a tab that dies one line later still has it.
export const startVideo = (body, project) => postJson('/api/video', { ...body, project });

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
export async function pollVideo(id, params, onStatus, { until = 15 * 60 * 1000, project = '' } = {}) {
  const q = new URLSearchParams({
    project,
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
export const revealFiles = (fileNames, project) => postJson('/api/reveal', { fileNames, project });

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

// The server builds the authorize URL, because only it knows the port the
// callback has to come back to — in a clone this client talks to Vite's proxy
// and has no idea what it is.
export const startOauth = () =>
  fetch('/api/oauth/start', { method: 'POST' }).then(async (r) => {
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `Could not start connecting (${r.status})`);
    return d.authorizeUrl;
  });

// Cancelling drops the attempt on the server too, so approving in the browser
// afterwards is refused rather than quietly saving a key — when the request
// itself fails, though, the attempt is left live and an approval still saves
// a key; that is the swallow below, and it is the better failure mode of the
// two.
export const cancelOauth = () => fetch('/api/oauth/pending', { method: 'DELETE' }).catch(() => {});

// How the pending attempt ended, as {state: 'waiting'|'done'|'failed'|'none',
// reason}. null means the request itself failed, which the poll treats as "ask
// again" rather than as an answer — a dropped poll must not read as a failure.
export const oauthPending = () =>
  fetch('/api/oauth/pending')
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);

// null means "could not ask" — the dialog then shows nothing about the
// connection rather than claiming zero spend.
export const oauthStatus = () =>
  fetch('/api/oauth/status')
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);

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

// The selected image model's billing SKUs, for the pre-run estimate. Cached like the
// catalogue and for the same reason -- prices do not move within a session -- but keyed
// per model, since this is one upstream request per model rather than one per
// catalogue. A failure resolves to an empty list rather than rejecting: no estimate is
// a legitimate answer here (most image models are priced per token), so the node has
// one branch instead of two.
const pricingCache = new Map();
export const getModelPricing = (id) => {
  if (!pricingCache.has(id)) {
    pricingCache.set(
      id,
      fetch(`/api/model-pricing?id=${encodeURIComponent(id)}`)
        .then((r) => (r.ok ? r.json() : { endpoints: [] }))
        .then((d) => d.endpoints || [])
        .catch(() => []),
    );
  }
  return pricingCache.get(id);
};

// ---- the document ----
// The server owns the graph; this tab holds a replica and sends ops (graph/ops.js,
// graph/useDocument.js). Every graph read goes through openProject/createProject, and
// the type migration (graph/migrate.js) is applied by useDocument on the way in --
// still one funnel, still nothing rewritten on disk until an edit happens.

// { version, nodes, edges }. A project that has never been saved answers version 0
// and an empty graph; the folder appears on the first op.
const readGraph = async (r) => {
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `Could not open the project (${r.status})`);
  return d;
};
export const openProject = (name) => fetch(`/api/projects/${enc(name)}`).then(readGraph);

// Create with a starting graph; 409 if the name is taken.
export const createProject = (name, graph = { nodes: [], edges: [] }) =>
  fetch(`/api/projects/${enc(name)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(graph),
  }).then(readGraph);

// This is the SAVE path, so a failure here is a real one -- the canvas keeps editing
// whether or not the change reached disk, and useDocument surfaces the error. Answers
// { version, applied: [entry], rejected: [{ op, reason }] }.
export const sendOps = (name, ops) => postJson(`/api/projects/${enc(name)}/ops`, { ops, origin: { id: SESSION_ID } });

export const undoProject = (name) =>
  fetch(`/api/projects/${enc(name)}/undo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ origin: { id: SESSION_ID } }),
  }).then((r) => (r.ok ? null : Promise.reject(new Error(`Could not undo (${r.status})`))));

// What Cmd-Z would revert next: { version, origin } or null.
export const nextUndo = (name) =>
  fetch(`/api/projects/${enc(name)}/undo`)
    .then((r) => (r.ok ? r.json() : { next: null }))
    .then((d) => d.next ?? null)
    .catch(() => null);

export const redoProject = (name) =>
  fetch(`/api/projects/${enc(name)}/redo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ origin: { id: SESSION_ID } }),
  }).then((r) => (r.ok ? null : Promise.reject(new Error(`Could not redo (${r.status})`))));

// Raw bytes in, { file, fileName, bytes, mime } out; the node then references `file`.
// Media never travels inside node data any more (server/media.js).
export const uploadFile = (name, file) =>
  fetch(`/api/projects/${enc(name)}/files?name=${enc(file.name || '')}`, {
    method: 'POST',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  }).then(async (r) => {
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `Could not upload the file (${r.status})`);
    return d;
  });

// A copy of a project file, for pasting a page node so the paste owns its own file.
export const copyFile = (project, file) => postJson(`/api/projects/${enc(project)}/files/copy`, { file }).then((d) => d.file);

// Where a project's files are served from, for <img>/<video> src and for references
// the server inlines at the OpenRouter boundary.
export const fileUrl = (project, file) => `/api/file/${enc(project)}/${enc(file)}`;

// Where a page asset is shown from: the preview origin (server/preview.js), a different
// port and therefore a different origin from the API. The IP literal rather than
// `localhost`, so the origin is the same string in every browser.
export const previewUrl = (previewPort, project, file) => `http://127.0.0.1:${previewPort}/p/${enc(project)}/${enc(file)}`;

// The event stream: every accepted entry from version `since` onward, then live.
// EventSource reconnects on its own but cannot change its URL, so a drop is handled
// here by reopening from the last version seen -- the replay then covers exactly the
// gap. Returns a function that closes the stream for good.
export function subscribeProject(name, since, { onEntry, onLive } = {}) {
  let es = null;
  let closed = false;
  let last = since;
  let retry = 1000;
  const connect = () => {
    es = new EventSource(`/api/projects/${enc(name)}/events?since=${last}`);
    es.addEventListener('entry', (e) => {
      const entry = JSON.parse(e.data);
      last = Math.max(last, entry.version);
      onEntry?.(entry);
    });
    es.addEventListener('version', (e) => {
      last = Math.max(last, JSON.parse(e.data).version);
      retry = 1000;
      onLive?.(last);
    });
    es.onerror = () => {
      es.close();
      if (closed) return;
      setTimeout(connect, retry);
      retry = Math.min(retry * 2, 10000);
    };
  };
  connect();
  return () => {
    closed = true;
    es?.close();
  };
}

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

// ---- local agent providers and threads ----

// { providers: { claude: status, codex: status } } -- each { kind, name, status,
// installed, version, auth?, message?, install }. Cached five minutes server-side;
// `refresh` asks the CLIs again. null means the request itself failed.
export const listProviders = (refresh = false) =>
  fetch(`/api/providers${refresh ? '?refresh=1' : ''}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => d?.providers ?? null)
    .catch(() => null);

export const createThread = (project, { provider = 'claude', model = '', kind = 'canvas', artifactId = null } = {}) =>
  postJson(`/api/projects/${enc(project)}/threads`, { provider, model, kind, artifactId }).then((d) => d.thread);

// `artifactId` narrows the list to the threads about one node (the composer's lookup).
export const listThreads = (project, { artifactId } = {}) =>
  fetch(`/api/projects/${enc(project)}/threads${artifactId ? `?artifact=${enc(artifactId)}` : ''}`)
    .then((r) => (r.ok ? r.json() : { threads: [] }))
    .then((d) => d.threads ?? [])
    .catch(() => []);

export const getThread = (project, id) =>
  fetch(`/api/projects/${enc(project)}/threads/${enc(id)}`).then(async (r) => {
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `Could not open the thread (${r.status})`);
    return d.thread;
  });

// One turn. Resolves when the server has accepted the message; the answer arrives on
// the thread's event stream. A 409 means the previous turn is still running.
// `target` and `with` are the composer's: the node the message is about (or "new") and
// the rest of the selection. The panel sends neither.
export const sendThreadMessage = (project, id, { text, selection = [], target, with: withIds }) =>
  postJson(`/api/projects/${enc(project)}/threads/${enc(id)}/messages`, {
    text,
    selection,
    ...(target ? { target } : {}),
    ...(withIds?.length ? { with: withIds } : {}),
  });

export const interruptThread = (project, id) =>
  postJson(`/api/projects/${enc(project)}/threads/${enc(id)}/interrupt`, {}).catch(() => ({ interrupted: false }));

export const deleteThread = (project, id) =>
  fetch(`/api/projects/${enc(project)}/threads/${enc(id)}`, { method: 'DELETE' }).then((r) => {
    if (!r.ok) throw new Error(`Could not delete the thread (${r.status})`);
  });

// The thread's stream: `state` once (status, messages so far), stored events past
// `since`, a `live` marker, then everything as it happens -- text deltas included. Same
// reconnect rule as subscribeProject: a drop reopens from the last sequence seen.
export function subscribeThreadEvents(project, id, since, { onState, onEvent, onLive } = {}) {
  let es = null;
  let closed = false;
  let last = since;
  let retry = 1000;
  const connect = () => {
    es = new EventSource(`/api/projects/${enc(project)}/threads/${enc(id)}/events?since=${last}`);
    es.addEventListener('state', (e) => onState?.(JSON.parse(e.data)));
    es.addEventListener('event', (e) => {
      const ev = JSON.parse(e.data);
      if (typeof ev.seq === 'number') last = Math.max(last, ev.seq);
      onEvent?.(ev);
    });
    es.addEventListener('live', (e) => {
      last = Math.max(last, JSON.parse(e.data).seq ?? last);
      retry = 1000;
      onLive?.(last);
    });
    es.onerror = () => {
      es.close();
      if (closed) return;
      setTimeout(connect, retry);
      retry = Math.min(retry * 2, 10000);
    };
  };
  connect();
  return () => {
    closed = true;
    es?.close();
  };
}

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
