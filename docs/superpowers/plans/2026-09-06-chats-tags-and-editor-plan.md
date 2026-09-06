# Plan: chats with tags, the editor view, and what was started before the grilling

**Scaffolding.** Delete this file once the work has merged (CLAUDE.md, "Implementation plans
are scaffolding"); before deleting, the decisions below go to the spec named in task A9 and
any rejected alternative to `status.md`. Written 2026-09-06 from the grilling session with
Matteo; every decision here was put to him and chosen. Branch: `worktree-agent-canvas-slice-4`
(PR #65, stacked on #60). The editor shell files already in the tree (uncommitted:
`client/src/editor/Editor.jsx`, the `embedded` prop in `AgentPanel.jsx`, the `.editor-*`
styles) belong to Part B and are kept.

## Decisions (settled, not to be re-opened while building)

1. **A thread is a chat, not a thing about an artifact.** It gets **tagged** by the
   artifacts (pages, motions) selected at its first message and by every artifact the
   agent writes to. Tags are pointers, never dependencies: deleting every file a chat
   touched leaves the chat intact; a stale tag simply stops matching. No confirmation
   when deleting an artifact the agent is mid-turn on — the write fails, the agent says so.
2. **The selection is context; the agent decides what a message means** (same edit to
   all, one of them, different edits to each, a new asset from them, a question), asking
   in its reply only when the sentence is genuinely ambiguous. No mode picker. Mixed
   kinds and inputs-as-material are fine. A new asset from several is made of **copies**
   (a linked "sequence" is a later, opt-in feature). The agent never moves the selection.
3. **The strip** shows every chat with nothing selected, else chats tagged with **any**
   selected artifact. A tab reads the person's name, else the title the agent writes
   **once** after the first turn, else the first words of the first message.
4. **Every artifact the active chat has touched wears the focus mark.** The row above the
   composer lists the chat's tags as chips with Locate (stale ones greyed, no Locate) plus
   the live selection count.
5. **The toolbar card only starts a chat.** Send opens the panel on that thread and the
   reply lives there. The anchored reply card is removed; so is "Add to <page>". The
   composer continues the newest idle chat tagged with the selection, else starts one,
   and says which ("continues *Title fixes*" / "new chat") with a toggle.
6. **Change lines in the panel** say what changed, expand to the artifacts touched (Open
   in the editor, Locate), carry Undo on the most recent change; a bulk edit is one undo
   step; after an undo the line reads "Undone". No chat message is written for an undo.
7. **The agent is told what changed** since its last turn, in the next message's preamble
   ("Since your last turn the canvas changed: 4 changes by the person, including an undo
   of a change from this chat. Read it again before acting."), and keeps its rule to read
   before acting.
8. **The editor** replaces the canvas while open (unmount, not overlay; viewport put back
   on close), three columns: the panel filtered to this artifact, the artifact, its
   DialKit parameters. Pages get it too. Timeline read-only first.

## Part A — chats with tags

### A1. The record: `tags` replaces `kind` + `artifactId` (`server/threads.js`, test)

- `newThread({ ..., tags = [] })` validates each tag with `ID_RE`; record fields:
  `tags: string[]`, `title`, `titledBy: 'user' | 'agent' | null`, `lastVersion: number | null`
  (the document version when the agent's last turn ended). Drop `kind`, `artifactId`.
- `tagThread(thread, ids, now)` → adds unknown ids, keeps order, returns the same object
  when nothing changed.
- `renameThread` sets `titledBy: 'user'` (`''` clears both). New `titleThread(thread,
  title, now)` sets an agent title only when `titledBy !== 'user'`.
- `findChatFor(dir, artifactIds)`: newest thread not running whose tags include **every**
  id in `artifactIds` (the composer's continue rule, decision 5); `[]` → newest idle
  untagged chat. Replaces `findArtifactThread`.
- `threadSummary`: `tags`, `title`, `titledBy`, `preview` (first user message, 80 chars).
- **Migration on read**, in `readThread`: a record with `kind`/`artifactId` becomes
  `tags: artifactId ? [artifactId] : []`, `titledBy: title ? 'user' : null`; the old
  fields are dropped when the record is next written. Permanent, like `migrateNodes`.
- Tests: tag add/idempotent; user rename beats agent title in both orders; migration of
  both old kinds; `findChatFor` all-of semantics and the untagged case.

### A2. Routes (`server/index.js`, `host.test.js` if a route shape is asserted there)

- `POST …/threads` body `{ provider, model, effort, tags? }`; `kind`/`artifactId` refused
  with a 400 naming the new field.
- `GET …/threads?tag=<id>` filters to chats tagged with that id (any-of when repeated).
- `POST …/threads/:id/messages` body `{ text, selection }` only — `target`/`with` gone.
  Before queueing, the server tags the thread with the **artifacts** among `selection`
  when the thread has no messages yet (decision 1: first message), using the document's
  node types (`page`, `motion`).
- `PATCH …/threads/:id` unchanged (`title` → `renameThread`).

### A3. The turn (`server/agent.js`)

- `messagePreamble` → `contextPreamble({ selection, changes }, graph)`:
  `Selected: motion m1 ("Intro"), motion m2 ("Outro"), image i3 ("hero.png").` followed,
  when `changes` is non-empty, by the "Since your last turn…" sentence (decision 7).
  `changes` is computed in `sendToThread` from `openDocument(dir).entries` with
  `version > thread.lastVersion`: count by `origin.kind`, and flag entries whose
  `undoes` names a version whose entry has `origin.kind === 'thread' && origin.id ===
  threadId`. Pure builder in `agentTools.js`, tested.
- `onWrite`: `tagThread(cur, [summary.page.nodeId])` for every page/motion write, created
  or updated (was: bind on create only). `bindArtifact` deleted.
- At `result`: persist `lastVersion: (await openDocument(dir)).version`.
- **Title after the first turn** (decision 3): when `thread.turns === 1` and `titledBy
  !== 'user'`, run one `query()` with no tools, `maxTurns: 1`, the thread's model, prompt
  "Title this conversation in three to five words, no quotes: <first user message> /
  <answer's first 400 chars>"; `titleThread` with the trimmed first line (≤ 60 chars);
  any failure leaves the fallback. Emits `{ type: 'titled', title }`. One small request
  on the person's plan per new chat — say so in `docs/agent.md`.
- `SYSTEM_PROMPT`: replace the To/With paragraph with the selection-as-context rule and
  the intent list of decision 2; keep the stitch sentence (several motions + stitch /
  combine / sequence → one new motion, nested inline; `motion_write` says how); add "read
  the canvas again when the preamble says it changed."

### A4. The tools (`server/agentTools.js`, test)

- `contextPreamble` (above). `canvas_read` reports `selection` only (drop `target`/`with`).
- `motion_write`/`page_write` unchanged; the event's artifact field stays `page` with
  `kind` (the panel reads it).

### A5. Strip logic (`client/src/agent/tabs.js`, test)

- `visibleThreads(threads, selectedIds, nodes)`: no artifact selected → all; else threads
  whose `tags` intersect the selected artifacts (decision 3). No "node not on canvas"
  exclusion any more (decision 1).
- `tabLabel(thread, nodes)`: `title.trim()` (user or agent) → `preview` first 32 chars
  with an ellipsis → `'Chat'`.
- `tagLabel(id, nodes)`: node title / fileName / id; `stale` when the node is gone.
- Tests updated; the rename tests stay.

### A6. The panel (`client/src/agent/AgentPanel.jsx`)

- A chat can always be started (the `+` button and Send with any selection); `newKind`
  gone; `createThread(project, { provider, model, effort, tags: selectedArtifactIds })`.
- The row above the composer: the chat's tags as chips (`tagLabel`, Locate unless stale;
  stale greyed with a tooltip "no longer on the canvas") + "N selected" (decision 4).
- `onFocus(ids)` reports **all** tags (decision 4); App turns them into focus marks.
- Change lines: a note line becomes a small block — summary, expandable list of touched
  artifacts (from the event's `page` for single writes; for a `canvas_write` batch, the
  ids in its ops that are pages/motions) with **Open** (→ `onOpenEditor(id)`) and
  **Locate**; **Undo** on the most recent change while it is still the document's latest
  version (the same rule the card used: `canUndo = latestVersion === entry.version`),
  and "Undone" after (decision 6). Undo calls `POST …/undo`, as the card did.
- Empty-state copy: one sentence, no artifact/canvas split.
- The `agent-tab--artifact` accent applies to tagged chats.
- Event `titled` updates the tab.

### A7. Toolbar and App (`client/src/toolbar/target.js` + test, `SelectionToolbar.jsx`,
`App.jsx`, delete `AnchoredReply.jsx`)

- `target.js` → `messageContext(selected)`: `{ selection: ids, artifacts: ids }` and
  `contextLabel(state, nodes)`: "2 motions — Intro, Outro · with 1 image" / "3 inputs" /
  "nothing selected". `addToTarget` → `addToContext` (idempotent add). Tests.
- Composer: the label chip; below it the **continue indicator** — `listThreads(project)`
  on open, `findChatFor`-equivalent client-side (newest idle thread whose tags include
  every selected artifact) → "continues *Title*" with a toggle to "new chat" (decision 5).
- `sendComposer`: create or continue → `sendThreadMessage(project, id, { text, selection })`
  → `openAgent(thread.id)`; `reply` state, `AnchoredReply`, `undoReply`, `dismissReply`,
  `addTo` removed. `agentFocus` becomes a Set of ids; `agent-focus` class on each.
- `onBeforeDelete`: the mid-turn confirmation (`deleteBusy`, the AlertDialog) removed
  (decision 1); artifacts delete like any node.
- Threads-in-panel filtered by selection as before; `openAgent(threadId)` also used by the
  toolbar Send.

### A8. Docs

- New spec `docs/superpowers/specs/2026-09-06-chats-and-tags-design.md`: the decisions
  above with their reasons, and the rejected alternatives (mode picker; several → new
  asset by default; hiding chats of deleted artifacts; a chat message per undo).
- `docs/agent.md`: rewrite "Threads", "The Agent panel", "The selection toolbar and the
  composer" in present tense; note the title request.
- Slice-1 and slice-3 specs: dated *Superseded* notes on the target rule, the artifact
  binding, "fixed for life", the delete confirmation, the reply card.
- `CLAUDE.md`: the threads sentence in the agent bullet; the `docs/agent.md` row.
- `CHANGELOG.md`, dated: chats with tags, the panel is where replies live, several
  selected works, agent-written titles.

### A9. Verify (Part A)

`npm test`; in the app: start a chat from two selected motions, see the panel open on it
and the reply stream there; the tab gets a title after the turn; both motions wear the
mark; select one motion → the chat shows; delete a motion → the chat stays, its chip
greys; Undo on the change line → "Undone", and the next message's preamble carries the
note (read the server log). The agent turns are Matteo's to run.

## Part B — the editor

### B1. Shell (files in the tree + `App.jsx`)

- `App.jsx`: `editor` state (`nodeId | null`), `openEditor(id)` saves `getViewport()`,
  selects the node alone, closes the composer; `closeEditor()`. Render swap: `editor ?
  <Suspense><Editor/></Suspense> : <the chrome + canvas>`; `Editor` via `React.lazy`.
  `<ReactFlow fitView={!restoreViewport} defaultViewport={restoreViewport}>`, cleared
  after the remount (React Flow reads both on mount only). `onNodeDoubleClick` on an
  artifact → `openEditor`. Toolbar and change-line **Open** → `openEditor`; the editor's
  header has "Open in a new tab" (the old `openPage`).
- `Editor.jsx` as written: left = `<AgentPanel embedded>` with the same props; centre =
  header + the artifact's frame (motion through the viewer); right = Parameters column
  (placeholder until B2). Escape closes.
- Verify: open from the toolbar and by double-click; the canvas is gone from the DOM
  (`.react-flow` absent); Escape restores the exact viewport; the panel's strip is
  filtered to this artifact's chats.

### B2. DialKit parameters (`server/motion.js`, viewer, `client/src/editor/Dials.jsx`)

- Library gains `dialkit.js` (`dialkit/dist/vanilla/browser.global.js`), `dialkit.css`,
  and our bridge `unframed-dials.js`. Contract for the agent (in `motion_write` /
  `page_write` descriptions and the system prompt): `unframed.dials("Scene", { accent:
  "#a78bfa", speed: [1, 0.5, 2], title: "Launch day" }, (v) => { /* apply */ })`.
- Bridge, inside the composition/page: registers the config with DialKit's store,
  applies saved values first (`window.__hfVariables?.unframedDials` at render time;
  `postMessage` from the viewer in preview), calls the apply function on every change,
  posts `{ type: 'unframed:dials', schema, values }` to `parent` (the viewer forwards to
  the canvas; a page posts straight to the canvas).
- Canvas side: `Dials.jsx` in the editor's right column hosts DialKit vanilla with
  `createDialRoot({ target, mode: 'inline', theme })` and the mirrored config; a change
  posts `{ type: 'unframed:dials:set', values }` down and writes `data.dials` on the node
  (debounced, one op). Origin-checked both ways.
- Render: `startRender({ …, variables: { unframedDials: node.data.dials } })` →
  producer `variables`. Sidecar records `dials`.
- Tests: bridge schema/values message shape (pure builders), `withRuntime` unchanged,
  `renderSidecar` with dials. Verify: agent exposes two parameters, the column shows
  them, dragging changes the preview live, Render honours the values, ⌘Z reverts a
  tweak.

### B3. Read-only timeline (`client/src/editor/Timeline.jsx`)

- `@hyperframes/parsers` `parseHtml` (server route `GET …/motion/clips?file=` → `[{ id,
  label, start, duration, track }]`, duration) — the server reads the file; the client
  draws lanes. Playhead: the viewer posts `{ type: 'unframed:time', t }` from the
  player's timeupdate; clicking a lane at x posts `{ type: 'unframed:seek', t }`.
- Pages: no timeline. Retiming by drag is a follow-up (a new version through the SDK).

## Part C — stitching

Needs nothing beyond A3's prompt once several selected motions can be sent (A6/A7).
Verify: three scene nodes selected, "stitch these in order" → one new motion node playing
them back to back; Render it.

## Order and size

A1–A4 (server, one PR-sized commit each or together), A5–A7 (client), A8, A9 — about two
days. B1 half a day (mostly done), B2 a day, B3 half a day. C is verification only.
