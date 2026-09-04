# Plan: agent on the canvas, slice 1

Spec: `docs/superpowers/specs/2026-09-04-agent-canvas-slice-1-design.md`. This file is
scaffolding (CLAUDE.md: plans are deleted once merged; anything that outlives the work moves
to the spec, `status.md`, or `CLAUDE.md` before deletion).

Rules for every task: tests first where the logic is pure (`node`, `assert`, no framework);
one commit per task; `npm test` green before each commit; comments only where deleting them
would let someone make a wrong change.

## Part A — the document, server side

**A1 · `server/graph.js` pure core.** `emptyGraph()`, `applyOp(graph, op) → { graph, inverse }
| { rejected: reason }` for `addNode`, `updateNode` (shallow patch, `null` deletes a key),
`moveNode`, `resizeNode`, `removeNode` (inverse re-adds the node AND its edges),
`addEdge`, `removeEdge`, `batch` (all-or-nothing; inverse is the reversed list of inverses).
Structural rejections: edge to a missing node, duplicate node/edge id, patch to a missing
node. `graph.test.js`: every op round-trips through its inverse to deep-equal the original;
batch atomicity; each rejection.

**A2 · Journal and snapshot.** `openDocument(dir)` → in-memory `{ version, graph }` from
`graph.json` (snapshot, `{ version, nodes, edges }`) plus replay of `graph.log` lines with
`version > snapshot.version`. `commit(doc, op, origin)` serialises per document (promise
chain), assigns `version = doc.version + 1`, appends `{ version, op, inverse, origin, at }`
to the log, bumps memory, returns the entry. Snapshot temp-then-rename when the log exceeds
2 MB or after 5 s of quiet; log truncated after a successful snapshot. Legacy `graph.json`
without `version` reads as version 0. Tests: replay past snapshot; snapshot then more ops;
a torn snapshot (`.tmp` left behind) is ignored and the previous one used.

**A3 · Undo/redo.** Per document: `undoPointer` into the journal. `undo(doc)` commits the
inverse of the newest non-undo entry above the pointer, tagged `origin.kind: 'undo'` with
`undoes: <version>`; `redo` re-commits the original op, tagged `'redo'`. A fresh user op
clears the redo range. The pointer state is derived from the journal on open, so undo
survives a restart. Tests: undo/redo ladder; new op after undo drops redo; agent `batch`
undone as one step.

**A4 · Media leaves the document.** `extractMedia(graph, dir, writeFile)`: for every node
whose `data.dataUrl` is a `data:` URL, decode, write `<timestamp>-<slug>.<ext>` plus a
`.json` sidecar (`{ source: 'upload' | 'legacy-graph', fileName, bytes }`), and rewrite
data to `{ file, fileName, aspect }` (no `dataUrl`). Runs inside `openDocument` (legacy
graphs) and inside `commit` on any `addNode`/`updateNode` whose patch carries a `dataUrl`
(a preset fragment, an older client). An `https:` `dataUrl` (hosted video) is left alone.
Tests: extraction on open; extraction on op; hosted URL untouched; sidecar written.

**A5 · Routes.** In `server/index.js`:
- `GET /api/projects/:name` → `{ version, nodes, edges }` (was the bare graph).
- `POST /api/projects/:name/ops` body `{ ops: [op], origin }` → `{ version, applied: [entry],
  rejected: [{ op, reason }] }`.
- `GET /api/projects/:name/events?since=N` → SSE of journal entries; replays `> since`, then
  live. Heartbeat every 15 s. Closed on rename/delete of the project.
- `POST /api/projects/:name/undo`, `/redo` → the entry applied, or 204 when nothing to do.
- `POST /api/projects/:name/files` (multipart, one file) → `{ file, fileName, bytes }`,
  written with the same naming as A4.
- `POST /api/projects/:name` → create from the starter graph (one `batch`); 409 if exists.
- `PUT /api/projects/:name` removed. Nothing else consumes it.
Rename/delete/`OUTPUT_DIR` change already move or remove the folder wholesale; they must
also drop the in-memory document and end its SSE streams. `host.test.js`: ops round trip;
SSE `since` replay; undo through the route; kill mid-snapshot then reopen.

## Part B — the document, client side

**B1 · `client/src/graph/ops.js` (pure).** `changesToOps(changes, nodesBefore)` maps React
Flow `NodeChange`/`EdgeChange` lists to ops (position → `moveNode`, dimensions →
`resizeNode`, remove → `removeNode`/`removeEdge`, add → `addNode`/`addEdge`; `select` is
never an op). `Coalescer`: buffers per-node moves/resizes/patches and flushes one op per node
after 400 ms of quiet (`flushNow()` for blur/unload). `applyEntry(nodes, edges, entry)`
applies a remote journal entry to React Flow arrays. `ops.test.js`.

**B2 · `client/src/api.js`.** `openProject(name)`, `sendOps(name, ops, origin)`,
`subscribeProject(name, since, onEntry, onGap)` (EventSource; on reconnect passes the last
seen version), `undoProject`, `redoProject`, `uploadFile(name, file)`, `createProject`.
`setProject`/`getProject` deleted; `SESSION_ID` becomes the op origin.

**B3 · `client/src/graph/useDocument.js`.** One hook owning: open → seed React Flow state →
subscribe → apply remote entries (skipping own origin) → coalesce local changes into ops →
send → reconcile rejections by re-opening. Cmd-Z/Shift-Cmd-Z call undo/redo routes (same
text-field exemption as today). Replaces the autosave effect, the history stack, and the
`ready` flag in `App.jsx`. `activate()` keeps React state and the `localStorage` stamp only.
Project name reaches nodes through a `ProjectContext` instead of `getProject()`.

**B4 · Media by reference.** `ImageNode`/`VideoNode` render `data.file` via
`/api/file/<project>/<file>`; drops and pastes go through `uploadFile` then an `updateNode`
op. `resolve.js`'s `toReferences` emits that same URL; `/api/generate` and `/api/video`
inline any `/api/file/` reference to base64 at the boundary before calling OpenRouter.
Clipboard copy fetches the file. `resolve.test.js` updated; the legacy `dataUrl` path is
kept readable (A4 rewrites it on the server before the client ever sees it).

## Part C — the provider layer

**C1 · `server/providers.js` pure.** `resolveExecutable(binary, platform, env, isFile)`
(bare name → PATH lookup; Windows `.cmd/.bat/.ps1` shim → `bin/claude.exe` else `cli.js`),
`providerEnv(base, { configDir })` (adds `CLAUDE_CONFIG_DIR` only when set; never touches
`HOME`), `hydratedPath(loginShellPath, currentPath)`, `classify({ versionResult,
probeResult })` → one of `not_installed | wont_run | auth_unknown | ready` with message.
`providers.test.js`.

**C2 · Detection I/O + route.** `detectProvider(kind, settings)`: spawn `--version` with a
3 s timeout; Claude probe via the SDK with a never-yielding prompt and
`initializationResult()` (reads `account.email`, `subscriptionType`, `tokenSource`); Codex
probe via `codex login status`. 5-minute cache per provider; `GET /api/providers?refresh=1`.
`host.test.js`: a fake `claude` and `codex` on `PATH` in the temp dir exercising
`not_installed`, `wont_run` (exit 1), `auth_unknown` (answers `--version`, not the protocol).

**C3 · Settings plumbing.** `env.js` `PATTERNS`: `CLAUDE_PATH`, `CODEX_PATH` (absolute path
or bare command, no shell metacharacters), `CLAUDE_CONFIG_DIR` (absolute path).
`PUT /api/config` accepts `claudePath`, `codexPath`, `claudeConfigDir`; `/api/health`
reports them. `env.test.js`.

**C4 · `server/threads.js`.** Record `{ id, project, kind: 'canvas', provider, model,
status, messages: [], events: [], selection, createdAt, updatedAt }` at
`<project>/threads/<id>.json`, temp-then-rename, serialised per thread. Pure transitions
`appendEvent`, `setStatus`; sidecar writer `agentSidecar(dir, turn)` with
`billing: 'subscription'` and `estimatedUsd`. `threads.test.js`.

**C5 · `server/agent.js` + routes.** Session runner: `query({ prompt: <async queue>,
options })` with `pathToClaudeCodeExecutable`, `cwd` = project dir, `env` from C1,
`settingSources: []`, `tools: []`, `mcpServers: { unframed }`,
`allowedTools: ['mcp__unframed__canvas_read']`, `permissionMode: 'default'`,
`maxTurns: 30`, `includePartialMessages: true`, our `systemPrompt` (type `custom`),
`abortController` per turn. Maps SDK messages → thread events: `text_delta`, `tool_use`,
`tool_result`, `result` (usage, `total_cost_usd`, `is_error`), `rate_limit`, `error`.
Routes: `POST /api/agent/threads`, `GET /api/agent/threads?project=`,
`POST /api/agent/threads/:id/messages` (`{ text, selection }`),
`GET /api/agent/threads/:id/events?since=` (SSE with replay), `DELETE /api/agent/threads/:id`.
A running turn survives a dropped SSE client. Real turns are the manual test.

**C6 · `server/agentTools.js`.** `createSdkMcpServer({ name: 'unframed', tools: [canvas_read] })`
where `canvas_read` reads the document via A2 and the thread's latest selection, and returns
a compact JSON: nodes `{ id, type, title, file?, dimensions?, text?, result? }`, edges,
`selection`. Formatter tested pure.

**C7 · Codex sessions (stretch).** `server/mcp-stdio.js` exposes the same tools over stdio;
`codex exec --json -c mcp_servers.unframed.command=...` per turn. Only if C5 lands clean.

## Part D — UI and docs

**D1 · Settings › Providers.** One row per provider: status pill and message, email/plan
when ready, Check again, binary path field (saved through `saveConfig`).

**D2 · Agent panel.** `client/src/agent/AgentPanel.jsx`: an Agent button in the chrome; a
right panel with a Canvas tab, the project's thread list, messages, scope chips from the
current selection, a composer with provider/model chip. Consumes thread SSE. Empty state
per design state 10 when no provider is `ready` (Send disabled).

**D3 · Docs.** `CLAUDE.md`: document-authority bullet (replaces the autosave and
`activate()` paragraphs), provider-layer bullet, a `docs/agent.md` row. `docs/agent.md`
owns threads, providers, the safety configuration. `CHANGELOG.md` entry. `status.md`:
open-source direction; decided-not-to-build: bottom command bar, Remotion, browser relay.
Delete this plan.
