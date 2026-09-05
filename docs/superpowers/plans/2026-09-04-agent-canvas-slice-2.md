# Plan: agent on the canvas, slice 2

Spec: `docs/superpowers/specs/2026-09-04-agent-canvas-slice-2-design.md`. This file is
scaffolding (CLAUDE.md: plans are deleted once merged; anything that outlives the work moves
to the spec, `status.md`, `docs/agent.md` or `CLAUDE.md` before deletion).

Rules for every task: tests first where the logic is pure (`node`, `assert`, no framework);
one commit per task; `npm test` green before each commit; comments only where deleting them
would let someone make a wrong change. Node components have no tests by design and are
verified in the browser at the end (Part E).

## Part A — the preview origin

**A1 · `server/preview.js`, pure handler.** `handlePreviewRequest(req, res, { outputDir })`:
one regex `^/p/([^/]+)/([^/]+)$`, project through `slugify` (import from a shared place —
`slugify` lives in `index.js` today; lift it into `server/names.js` with its existing test
pinned in `resolve.test.js` still holding, or import from `media.js` if it already has one),
file through `path.basename` and the extension allow-list (`ALLOWED_EXT`). Loopback `Host`
check (the same regex as `index.js`, exported from one place so the two cannot drift), 403
otherwise. Every response carries the headers the spec lists; `Content-Type` by extension.
`HEAD` sends headers only. `startPreviewServer(outputDir)` → port, listening on `127.0.0.1:0`;
`stopPreviewServer()`. `preview.test.js`: every allowed extension served; `.json`, `.log`,
`.tmp`, no-extension → 404; `..`, a nested path, a third segment → 404; `Host: evil` → 403;
`HEAD` no body; all headers present and exact on an `html` response.

**A2 · Wire it in.** `index.js` starts it at boot (after `.env` is read, before `listen`),
adds `previewPort` to `/api/health` and to the `ready` IPC message, and stops it on the same
exit signals `share.js` handles. `OUTPUT_DIR` change: the preview server reads the current
output dir through a getter, not a captured value, so a settings change needs no restart.
`host.test.js`: `previewPort` in health and in `ready`; a page written into the temp project
fetched from the preview port with `Content-Security-Policy` present; a sidecar 404 from it;
`/api/health` on the preview port is 404.

**A3 · Client URL helper.** `api.js`: `previewUrl(previewPort, project, file)` →
`http://127.0.0.1:<port>/p/<enc project>/<enc file>`. `App.jsx` already reads health into
`cfg`; expose `previewPort` through `ProjectContext` so nodes get it without a prop drill.

## Part B — the page asset

**B1 · Predicates.** `resolve.js`: `isArtifact(n) = n?.type === 'page'`. `bulkWire.js`:
`canSource` excludes artifacts, `canTarget` unchanged (already output-only). `sourceRoles`
returns `[]` for an artifact. `KIND` in `agentTools.js` gains `page: 'page'`. Tests in
`bulkWire.test.js` and `resolve.test.js`.

**B2 · `PageNode.jsx`.** `NodeHeader kind="page" family="artifact"`; a third family in
`styles.css` (`.xnode-tab--artifact`, a distinct fill; a doubled border on selection like the
others). Body: the sandboxed `<iframe sandbox="allow-scripts" referrerpolicy="no-referrer"
allow="">` at the preview URL when `data.file` is set, `pointer-events: none` while
`dragging`/`resizing`; a `FileInput accept=".html,text/html"` otherwise; an `.html` drop
onto the node replaces (uploads via `uploadFile`, then `updateNodeData({ file, fileName,
title })`). `NodeLine` shows the title. `MediaResize free` for any-edge resizing; default
480×320 via `withDrag`'s seeded width and a seeded height in `starter.js`. `NEW_NODE.page =
{ file: '', title: '', fileName: '' }`. Registered in `nodeTypes`; an "Artifacts" section in
the add menu with **Page**; `PageIcon` in `nodeIcons.jsx`.

**B3 · Drop and paste.** `App.jsx`'s canvas `onDrop`: a `text/html` file (or `.html` name)
becomes a page node at the drop point, through the same upload path as images. Copy/paste
of a page node carries `file`/`title` like an image node does (already generic).

**B4 · Media allow-list on upload.** `POST …/files` accepts `text/html` and names it
`<ts>-<slug>.html`; `extOf` in `media.js` maps `text/html` → `html`. Test in `media.test.js`.

## Part C — the tool surface

**C1 · `agentTools.js` pure helpers, tests first.** `prepareBatch(ops, { graph, files,
now, random })` → `{ batch, idMap }` or `{ error }`: known node types; reject `dataUrl` /
`data:` anywhere in node data or patch; strip `job`/`running`; rewrite `new:` ids across the
batch; existence check for `data.file` on `image`/`video`/`page` adds against `files` (a Set
of names in the folder); cap 200. `pageFileName(now, title)` via `mediaFileName`.
`pageSidecar(...)`. `messagePreamble({ target, with }, graph)` → the one line the model
sees, `''` when there is no target. `describeCanvas` gains `page` nodes and `target`/`with`.
`agentTools.test.js` covers each.

**C2 · The tools.** `canvasTools({ getGraph, getSelection, getContext, commit, readFile,
writeFile, listFiles, previewUrl })` returns `canvas_read`, `canvas_write`, `page_write`,
`page_read`. `canvas_write`: `prepareBatch` → `commit(batch, { kind: 'thread', id })` →
result text `{ version, idMap }` or the rejection. `page_write`: string under 2 MB → write
file + sidecar (`saveMedia` with `source: 'agent'`, extra fields) → one batch (`addNode` beside
the target selection's bounding box, or `updateNode { file, title }`) → `{ nodeId, file,
previewUrl }`. `page_read`: the file the node names, nothing else. Each tool's success emits
`ops_applied` through a callback the session provides.

**C3 · `agent.js`.** `allowedTools` lists the four names. The session passes `commit` (bound
to the document with the thread origin), file helpers scoped to `this.dir`, and an
`ops_applied` emitter. `send()` takes `{ text, selection, target, with }`, stores them on the
message, and pushes `preamble + text` to the SDK. New `SYSTEM_PROMPT` per the spec. The
first `page_write` that creates a node on a thread with `artifactId: null` and
`kind: 'artifact'` binds the id.

**C4 · `threads.js`.** `newThread` accepts `kind: 'canvas' | 'artifact'` and `artifactId`;
`appendMessage` stores `target`/`with`; `threadSummary` reports `artifactId`; `findArtifactThread
(dir, artifactId)` → newest idle one or null. Tests.

**C5 · Routes.** `POST …/threads` accepts `{ kind, artifactId }`; `POST …/messages` accepts
`target`/`with` (validated: `target` a string ≤ 80 chars or `"new"`, `with` ≤ 500 strings);
`GET …/threads?artifact=<id>` filters. `document.test.js`: a thread-origin batch undoes as
one step (already true — pin it).

## Part D — the toolbar and the composer

**D1 · Pure modules, tests first.** `client/src/toolbar/placement.js`: `place({ box, size,
viewport, gap })` → `{ x, y, below }`. `actions.js`: `toolbarActions(selectedNodes)` →
`{ primary: { label, hint, kind } | null, count }`. `target.js`: `messageTarget(selectedNodes)`
→ `{ target: id | 'new' | 'ask', with: [] }`. Three test files, listed in `package.json`'s
`test` script.

**D2 · `SelectionToolbar.jsx`.** Props: selected nodes, the viewport (from `useViewport` +
`flowToScreenPosition` via `useReactFlow`), `hidden` (dragging / box-select / panning / menu
open), `providers`, callbacks. Renders the tools group + Agent; `mode: 'tools' | 'composer'`.
The composer: To/with chips, a `TextArea`, the provider chip, Send (Cmd/Ctrl+Enter), Back/Esc,
the "ask" message when the target is ambiguous, the disabled state with the state-10 text when
no provider is ready. Styles in `styles.css` under `.sel-toolbar*`, tokens only, the same
surface treatment as the context menu (`.astryx-popover-surface` note in CLAUDE.md).

**D3 · Wire into `App.jsx`.** Track `dragging`/`panning`/`boxSelecting` (React Flow's
`onMoveStart`/`onMoveEnd`, the existing `onSelectionStart`/`End`, `nodes.some(n =>
n.dragging)`). While the composer is open: `onNodeClick` adds to `with` and keeps the
selection (the `keepSelected` seam); `onPaneClick` collapses. Send: resolve the thread
(`GET …/threads?artifact=` → reuse or `POST`), then `sendThreadMessage` with `target`/`with`;
subscribe to that thread's events for the reply.

**D4 · `AnchoredReply.jsx`.** Anchored below the target node (or beside the selection box),
positioned with `placement.js` (`below: true`). Text, **Undo**, **Open thread**, the
artifact's action. Undo shown only while the agent's `ops_applied.version` equals the
document's newest undoable version — `useDocument` exposes `latestVersion()` and whether the
newest entry's origin is that thread; otherwise the card says "use Cmd-Z". Dismiss on ×, next
message, selection change. Open thread → `setAgentOpen(true)` with `initialThreadId`.

**D5 · `AgentPanel.jsx`.** Accepts `initialThreadId`; shows `ops_applied` events as one-line
"Updated page · <title>" rows; activity text per tool name ("Writing the page…", "Changing
the canvas…"). No tabs (slice 3).

## Part E — docs, changelog, browser verification

**E1 · Docs.** `docs/agent.md`: the four tools, the preview server and its headers, artifact
threads, `target`/`with`. `CLAUDE.md`: `page` row in the node table (family `artifact`); one
architecture bullet on the preview origin; test list gains `preview.test.js`, `placement`,
`actions`, `target`. `CHANGELOG.md` dated entry. `status.md`: close the slice-2 todo, name the
shell's frame-origin follow-up, record "no overwrite of page files" as decided.

**E2 · Browser verification** (worktree dev server on its own ports and its own `OUTPUT_DIR`,
per the worktree-dev-server skill): select one output → Generate + Agent; select three →
"3 selected"; Agent → composer on the same centre; flip below near the top edge; Esc/Back;
click another node adds to with; click empty canvas collapses; a real turn creating a page
(spends quota — Matteo runs this; the stub rig covers the rest); Cmd-Z points the page back;
drop an `.html`; the sandbox probes (fetch to the API, `top.location`, an `<img>` at the API's
file route) all fail; the preview served with the policy header (Network panel).
