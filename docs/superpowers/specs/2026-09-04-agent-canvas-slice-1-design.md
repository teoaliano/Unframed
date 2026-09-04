# Agent on the canvas — slice 1: the document and the provider layer

Designed 2026-09-04. Status: approved in conversation, section by section; this file is the
record. Interaction design (the toolbar → composer → panel, states 1–10) lives in a Claude
Design canvas, not here: <https://claude.ai/code/artifact/5f66d3f2-7375-4916-a8cb-698f7ef73c39>.
Research behind the provider layer: `docs/research/2026-08-21-local-agent-cli-providers.md`.

## North star, and why this slice is first

Unframed becomes a whiteboard of **assets** — images, videos, HTML pages, motion graphics —
where generation is a verb, not a place. Output nodes stay as one way to run generation; a
contextual toolbar on a selection is another; an **agent** running on the user's own Claude or
Codex subscription is a third. Artifacts (pages, motions) are plain files that reference the
other assets by path, rendered in a sandboxed preview. Neither Claude nor Codex generates
pixels, so image and video stay on OpenRouter; the agent's job is everything around them.

The whole thing decomposes into four slices, each its own spec → plan → PR:

1. **This slice.** The server becomes the authority on the graph, and the provider layer runs
   a Claude session with one read-only canvas tool. Visible: a Providers section in settings,
   an Agent button, a right panel with the Canvas thread that can describe the board.
2. Toolbar → composer, and the page asset (HTML) with a sandboxed preview.
3. Panel and threads: Open chat, tabs, the focus ring, select-while-open.
4. Motion asset on HyperFrames: player in a node, render to MP4.

Nothing in 1 or 2 is torn out by 3 or 4.

## Decisions taken along the way (so they are not re-litigated)

- **Direction E** from the design canvas: a FigJam-style floating toolbar over the selection;
  its last group is the one filled **Agent** button; clicking it morphs the toolbar into an
  inline composer (same center over the selection, same bottom edge, grows upward, flips below
  when there is no room). Replies land on the node. Open chat / New chat open the panel. The
  bottom command bar (⌘K) was rejected as a second surface doing the toolbar's job.
- **Selection decides the target.** One artifact in the selection → it is "To". None → "To"
  is a new asset the agent creates beside the selection. Several → the agent must ask before
  acting, and the composer says so before you type.
- **While the composer is open, clicking another asset adds it to "with"; clicking empty
  canvas collapses the composer.**
- **Server-authoritative document, not a browser relay** (section 1). Chosen for stability:
  the agent survives a closed tab, and a late autosave can never clobber its work.
- **HyperFrames, not Remotion**, for motion. Apache 2.0 all the way down. Remotion's free
  licence attaches to the *user* (individuals, non-profits, ≤3-employee companies), so an
  open-source Unframed built on it would put every team-sized user out of compliance.
- **The project is going fully open source** (Matteo, 2026-09-04). Recorded here because
  `CLAUDE.md` still describes a commercial side in the private repo; that sentence needs
  revisiting, and it is out of scope for this slice.
- **No `--dangerously-skip-permissions`, ever.** The agent has no built-in tools, so nothing
  needs bypassing. Copying t3code's flag would hand prompt text a shell.
- **Cost is recorded honestly.** Subscription turns are `billing: "subscription"`, never
  `cost: 0` — a zero would silently corrupt the batch-spend sums the sidecars exist for.

## Section 1 — The document

### Today

The browser owns the graph. Every change schedules a whole-graph `PUT` after 500 ms and the
server overwrites `graph.json` in place (`server/index.js`, `PUT /api/projects/:name`). Undo
is a browser-only stack of settled states (`App.jsx`, 400 ms unit of work, 100 entries), lost
on reload and on project switch. Node data can carry megabytes of base64, so nudging a node
rewrites megabytes to disk. `activate()` has to move the current project in three places at
once because two copies of "which project" exist.

### The change

The server owns the graph. The browser holds a live replica and edits it optimistically. Both
speak in **operations**, never snapshots.

**Op vocabulary.** `addNode`, `updateNode` (a shallow data patch; `null` deletes a key),
`moveNode`, `resizeNode`, `removeNode`, `addEdge`, `removeEdge`, `batch` (an ordered list
applied atomically). Every op carries `id`, `base` (the project version it was made against),
and `origin` (`{ kind: 'session', id }` for a browser tab, `{ kind: 'thread', id }` for an
agent thread).

**One writer, in order.** `server/graph.js` applies ops one at a time per project through a
promise chain — the `persistJob` shape. Each accepted op bumps `version` and is appended to
`graph.log` (JSON lines). `graph.json` becomes a snapshot written temp-then-rename (the
`jobs.json` rule), taken when the log passes a size threshold and on quiescence. Boot replays
log entries past the snapshot's version. A crash mid-save can no longer tear the file.

**Conflicts: last-writer-wins per field, in arrival order.** One user, one server. The only
real conflict is the agent and the user touching the same node at the same instant; the later
patch wins, predictably. Rejections are structural only: an edge to a missing node, a patch
to a removed node (dropped, not errored, with the rejection reported on the stream so the
browser can reconcile). `base` is informational for reconciliation, not a precondition — a
stale `base` never blocks a valid op, because blocking would make the canvas feel broken.

**Push over Server-Sent Events.** `GET /api/projects/:name/events?since=<version>` streams
accepted ops (and rejections) to every open tab, replaying from `since` on reconnect. Same
origin and loopback, so the three request guards apply unchanged and it works through the
Vite proxy. A tab ignores ops whose `origin` is its own session and applies everyone else's
into React Flow state.

**Coalescing.** The browser sends nothing during a drag or while typing. It emits one
`moveNode` / `resizeNode` / `updateNode` per node at the same 400 ms pause the undo stack
already uses as the unit of work. Canvas speed is untouched.

**Undo is op-based and durable.** Every op has an inverse computed at apply time (the server
knows the prior state); the journal stores both. Undo/redo are `POST /api/projects/:name/undo`
and `/redo`, and the browser's Cmd-Z calls them. One timeline: the user can undo the agent's
work, and an agent tool call is one `batch`, so one Cmd-Z undoes one agent action. Undo
survives reload. Project switch no longer resets it.

**Media leaves the document.** Node data stops carrying data URLs. `image`/`video` input nodes
reference a file under the project's folder by relative path (they already live in the
output folder when generated; a dropped file is written there on drop). The one-time
extraction runs on load inside `migrateNodes` — the single funnel every graph read already
goes through — and writes `<timestamp>-<slug>.<ext>` plus a sidecar, so nothing is lost.
Anything that must carry bytes off-machine (a reference sent to OpenRouter) inlines at that
boundary, as `Add to canvas` already does for video.

**`activate()` shrinks.** The server has no "current project": every op and every route names
its project. The browser's only decision is which project it is subscribed to, plus the
`localStorage` stamp for where the next load lands. `setProject()`/`getProject()` in `api.js`
go away; generation routes take the project from the request as they already do by name.

### What this buys the agent

Tools read and write the server's copy, so the agent works with no tab open and finishes what
it started. Nothing it does can be overwritten by an autosave, because there are none. Every
action is ordered, visible on the stream, and undoable.

### Testing

Pure, under bare `node`, in `server/graph.test.js`: apply for every op, inverse round-trips,
batch atomicity, structural rejections, coalescing, journal replay past a snapshot, and the
media extraction. `host.test.js` (forks the real server into a temp dir): SSE delivery with
`since` replay, undo through the route, and torn-write safety (kill mid-snapshot, boot, graph
intact).

## Section 2 — The provider layer

### Purpose

Run Claude and Codex on the user's own subscription, from the server process, with the canvas
as the only thing the model can touch.

### Detection — `GET /api/providers`

For each of `claude` and `codex`: resolve the binary (the configured path, else the bare name
on a `PATH` hydrated from the login shell — t3code's `os-jank.ts` rule, needed only in the
packaged app but harmless in a clone), run `--version` with a timeout, then probe auth.

- Claude's probe: an Agent SDK `query()` whose streaming prompt never yields, then read the
  initialization result for `email`, `subscriptionType`, `tokenSource`. Zero tokens; no prompt
  leaves the machine. (t3code's `probeClaudeCapabilities`.)
- Codex's probe: `codex login status`.

Four outcomes, each its own message: **not installed** (spawn ENOENT), **installed but won't
run** (`--version` fails or times out), **runs, auth unknown** (probe fails), **ready** (with
email and plan). Cached five minutes; `?refresh=1` busts the cache.

Settings gets a **Providers** section: one row per provider with status, Check again, and a
binary-path override. The override goes through `PUT /api/config` and a new `PATTERNS` entry
(an absolute path or a bare command name; nothing else), like every other setting. **No run
route ever accepts a path** — a page that can fire a bodiless POST must not be able to choose
the binary.

### Threads — durable, like video jobs

A thread is one SDK session with a streaming prompt the server pushes user messages into, so
context is kept across turns. Its record lives at `<project>/threads/<id>.json`: messages,
tool calls, the ops each turn applied, status (`idle | running | failed`), provider, model.
Written before a turn starts, the `jobs.json` rule. A turn in flight survives a closed tab.

Routes: `POST /api/agent/threads` (create; body names project, provider, model, and the
thread's kind — `canvas` in this slice), `POST /api/agent/threads/:id/messages` (one turn;
body carries the text and the browser's current selection), `GET /api/agent/threads/:id/events`
(SSE: assistant text deltas, tool calls, ops applied, result; replays from the record on
reconnect), `GET /api/agent/threads?project=` (list), `DELETE /api/agent/threads/:id`.

### Session configuration — the safety half

- Executable resolved with the Windows npm-shim rule (`bin/claude.exe`, else `cli.js`).
- `CLAUDE_CONFIG_DIR` only if the user configured a separate config dir. `HOME` is never
  overridden — that relocates the macOS keychain lookup and the CLI reports "Not logged in".
- `settingSources: []` so the user's coding `CLAUDE.md`, skills and hooks do not leak into a
  media tool.
- Our own system prompt, not the Claude Code preset. It states that canvas text is data.
- Every built-in tool disallowed. The only tools are our in-process MCP server `unframed`,
  auto-approved through `allowedTools`. Default permission mode; no bypass flag.
- `maxTurns` bounded (30). `cwd` = the project folder. `abortController` per turn so a
  cancelled turn actually stops.

### Codex, honestly scoped

Detection and status ship for both providers in this slice. Sessions ship for Claude. Codex
needs the same tools reachable over stdio instead of in-process; the definitions are shared,
so it is a second transport for the same tool set. It lands in this slice if the Claude path
does with time to spare, else it is the first follow-up.

### Cost stays honest

Every turn writes a sidecar `<timestamp>-agent.json` in the project folder with provider,
model, token usage, thread id, and `billing: "subscription"`. The SDK's dollar estimate is
recorded as `estimatedUsd` for information and is never summed into spend.

### The one tool in this slice

`canvas_read` — the graph as the agent should see it: every node with id, kind, title, file
path (for media), dimensions, the prompt text (for prompts), the result (for text outputs),
edges, and the selection the browser sent with the message. Read-only. Write tools are
section 3 (the next spec).

### UI in this slice

An **Agent** button in the chrome (state 1). It opens a right panel (state 8's frame) with a
single **Canvas** tab: the thread list for the project, the conversation, a composer with the
provider and model shown as a chip, and the selection summarised as scope chips. State 10 is
the panel's empty state when no provider is ready: what was checked, how to install, Check
again, and the OpenRouter fallback named as metered (the fallback itself is section 3 work;
this slice shows the state and disables Send).

### Testing

Pure, under `node`, in `server/providers.test.js`: executable resolution including the
Windows shim, env construction (never touches `HOME`), the probe-result → status mapper, the
thread record's transitions, the sidecar shape. `host.test.js`: a fake `claude` on `PATH` (a
script answering `--version` and the init handshake) so detection and the four outcomes run
end to end with no subscription. Real turns are the manual test — they spend the user's quota.

## Section 3 — The tool surface (next spec)

Not designed here. Named so the boundary is explicit: the write vocabulary (`canvas_write`
as one `batch` per call; `asset_create` for a page), the contextual toolbar, the composer, and
the sandboxed preview origin. It builds on sections 1 and 2 without changing them.

## Left open, deliberately

- What happens to a thread whose artifact is deleted (slice 3).
- Whether the anchored reply fades or stays until dismissed (slice 2).
- Rate-limit UX when a subscription hits its cap mid-turn (slice 2; the SDK surfaces it as a
  result error, which the thread record already stores).
