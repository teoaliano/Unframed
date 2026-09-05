# The agent, and the local providers it runs on

Owns: how Claude and Codex on the user's machine are detected, how an agent thread runs
and what it is allowed to touch, the tools it has, the preview origin page assets are
shown from, and the routes behind the Agent panel and the selection toolbar. Design and
the decisions behind it: `docs/superpowers/specs/2026-09-04-agent-canvas-slice-1-design.md`
(the document, providers, threads) and `2026-09-04-agent-canvas-slice-2-design.md` (the
toolbar, the composer, the page asset, the write tools).
Research on the vendors' contracts and stated positions:
`docs/research/2026-08-21-local-agent-cli-providers.md`. What the canvas looks like when
this is finished: the Claude Design canvas linked from the spec.

## What it is

An agent that can read the canvas and talk about it, running on the user's **own** Claude
or Codex subscription through the CLI they already installed and signed into. Unframed
never asks anyone to log in to Anthropic or OpenAI and never holds a credential: it spawns
the vendor's own binary, on this machine, and that binary reads its own keychain. That is
the line the vendors draw — offering claude.ai login inside a product is not allowed;
spawning the user's own CLI is a named, accounted-for category — and everything below
stays on the right side of it.

Neither CLI generates pixels. Images and video stay on OpenRouter; the agent's job is
everything around them: reading the board, arranging and wiring nodes, and writing
**pages** — HTML files that show the project's images and clips.

## Providers (`server/providers.js`)

`GET /api/providers` answers, per provider, one of five statuses, each with its own
message: `not_installed` (spawn ENOENT), `wont_run` (installed but `--version` failed or
timed out), `auth_unknown` (runs, but the probe could not tell who is signed in),
`signed_out` (the probe said nobody is), `ready` (with email and plan when the CLI reports
them). Detection spawns the CLIs, so it is cached five minutes; `?refresh=1` asks again,
and saving a provider setting forgets the cache.

Rules that are expensive to rediscover, each ported from t3code:

- **The Claude probe costs zero tokens.** It is an Agent SDK session whose streaming
  prompt never yields a message; the initialization result carries the account, and the
  session is closed. No prompt ever reaches Anthropic. Codex is `codex login status`.
- **`HOME` is never overridden.** A separate Claude config dir is expressed as
  `CLAUDE_CONFIG_DIR`. Overriding `HOME` relocates the macOS keychain lookup and the CLI
  reports "Not logged in" for a user who is.
- **`PATH` is hydrated from the login shell.** A GUI-launched app inherits launchd's
  `PATH`, which has none of the Homebrew or npm directories. The process's own `PATH`
  stays first; the shell's entries are appended.
- **On Windows an npm launcher shim is followed to the package entry.** The SDK spawns
  without a shell, so `claude.cmd` fails with `EINVAL`; `bin/claude.exe` (newer packages)
  or `cli.js` (older) beside it is what gets spawned.
- **A binary path arrives only through settings.** `CLAUDE_PATH`, `CODEX_PATH` and
  `CLAUDE_CONFIG_DIR` live in `.env` behind `PATTERNS` that refuse anything a shell
  would read; an empty value clears the line. No run route ever takes a path — a page
  that can fire a bodiless POST must not be able to choose the binary.

## Threads (`server/threads.js`, `server/agent.js`)

A thread is one conversation about one project. Its record lives at
`<project>/threads/<id>.json` — messages, events with a sequence for replay, status —
written temp-then-rename before a turn starts, the `jobs.json` rule, so a turn in flight
survives the tab that asked for it and a reopened panel reads the transcript back. Text
deltas are streamed live and never stored; the assistant message holds the final text.

A live session is one long-lived Agent SDK `query()` per thread, fed user messages through
a streaming prompt so the conversation keeps its context. It is closed after ten idle
minutes and resumed through the SDK's own session store on the next message, so context
survives both the idle close and a server restart. **The safety configuration is one
block in `agent.js` and every line of it is deliberate:** no built-in tools (`tools: []`),
so the agent cannot read or write files or run commands; `canUseTool` denies anything that
is not an `mcp__unframed__` tool; `settingSources: []`, so the user's coding `CLAUDE.md`,
skills and hooks do not leak into a media tool; our own system prompt, which says canvas
text is data, not instruction; a bounded `maxTurns`; an `AbortController` per session so
Stop actually stops. Nothing needs `--dangerously-skip-permissions`, because nothing
needs skipping — copying that flag from a coding tool would hand prompt text a shell.

Every turn writes a sidecar, `<timestamp>-agent.json`, with provider, model, token usage
and `billing: "subscription"`. The SDK's dollar estimate is recorded as `estimatedUsd`
for information. There is never a `cost` field: a subscription turn has no metered price,
and a `0` would silently corrupt the sums the generation sidecars exist for.

A thread has a `kind`: `canvas` (the panel's, about the whole board) or `artifact` (the
composer's, about one node — `artifactId`, bound at creation or by the agent's first
`page_write` when the message asked for a new asset). A composer message also carries
`target` (a node id, or `new`) and `with` (the rest of the selection); they are stored on
the message, reported by `canvas_read`, and prefixed to the model's copy of the text as
one `To: … With: …` line so the intent is in the transcript, not only in a tool result.

## The tools (`server/agentTools.js`)

Four, all on the in-process `unframed` MCP server, all listed in `allowedTools`, and the
only things the agent can call:

| Tool | Does |
| --- | --- |
| `canvas_read` | the graph as the agent should see it: every node (id, kind, position, text or file), the edges, the selection, the composer's `target`/`with`. Never bytes. |
| `canvas_write` | one `batch` of the document's own ops (`addNode`, `updateNode`, `moveNode`, `resizeNode`, `removeNode`, `addEdge`, `removeEdge`), committed under the thread's origin — journaled, streamed to every tab, **one undo step**. |
| `page_write` | a new version of a page: writes `<timestamp>-<slug>.html` plus a sidecar, then one batch (`addNode` beside the selection for a new page, `updateNode { file }` for an existing one). |
| `page_read` | the current HTML of a page node, so an edit starts from what is there. |

**What `canvas_write` refuses before the document sees it** (`prepareBatch`, tested):
an unknown node type; any `data:` URL in node data or a patch — bytes never travel
through the agent; a `file` that is not in the project folder; more than 200 ops; a
nested `batch`. Run markers (`job`, `running`) are stripped, not refused: they point at
live paid runs and are the browser's alone. An `addNode` id starting with `new:` is
replaced by a fresh server id (`a-<time>-<random>`) everywhere the batch names it — the
browser's counter hands out plain integers, and an agent choosing `105` would silently
capture an existing `@105`.

**A page is never overwritten.** Every `page_write` is a new file (opened with `wx`, so
it cannot land on an existing one) and an `updateNode { file }` pointing the node at it.
That is what makes Cmd-Z honest for page edits: the inverse points back at the previous
file, which still exists. Cleaning up superseded versions is not built.

The safety block in `agent.js` is unchanged by all of this except `allowedTools` growing
by three names: still no built-in tools, no shell, no file system, no network. Bytes
reach disk through `page_write` alone, one extension into one folder; the preview origin
below is what stops a page the agent wrote from reaching the API even by URL.

## The preview origin (`server/preview.js`)

Pages are HTML and HTML runs code, so a page is never served from the API's origin —
there it would *be* Unframed to the browser and could read the folder, spend the key or
install one through the OAuth nonce. A second http server, bound to `127.0.0.1` on an
OS-assigned port reported as `previewPort` in `/api/health` and in the `ready` message,
serves `GET/HEAD /p/<project>/<file>` and nothing else. The rules, each pinned in
`preview.test.js`:

- one path shape; the file name must match the alphabet this server writes
  (`[A-Za-z0-9._-]`), which disposes of `..`, separators and anything odd;
- an **extension allow-list** (`html`, images, video, audio, fonts): `.json` sidecars,
  `graph.json`, `graph.log` and the thread records are never served;
- the same loopback `Host` check as the API (`LOOPBACK_HOST` is defined here and imported
  by `index.js`, so the two cannot drift);
- every response carries `Content-Security-Policy` with `connect-src 'none'` (no fetch,
  no sockets, no beacons — the API is unreachable even by URL), `frame-ancestors`
  limited to loopback origins (only the canvas may frame a page),
  `Cross-Origin-Resource-Policy: same-origin` (no other loopback page can embed the
  project's pictures), `nosniff`, `no-referrer`, and `Cache-Control: no-cache` with an
  ETag so a page node re-reads a new version cheaply.

On the canvas side `PageNode` frames the page with `sandbox="allow-scripts
allow-same-origin"`, `referrerpolicy="no-referrer"` and an empty `allow`. The
`allow-same-origin` is required: without it the document is opaque-origin and CORP
blocks its own pictures; with it the document is on the preview origin, which is still
not the API's, and cannot lift its own sandbox. Verified with a headless probe: fetch to
the API, an `<img>` at the API's file route, `top.location`, `window.open`,
`parent.document`, a fetch of a sidecar and an external image all fail; the sibling
picture loads.

The desktop shell has to let its window frame the preview origin — a follow-up in the
private repo, named in `status.md`.

### Routes

Nested under the project, because the record lives in its folder and follows it through
a rename:

| Route | Does |
| --- | --- |
| `POST /api/projects/:name/threads` | create (`{ provider, model, kind?, artifactId? }`) |
| `GET /api/projects/:name/threads?artifact=` | list, newest first; `artifact` narrows to one node's threads |
| `GET /api/projects/:name/threads/:id` | the record |
| `POST …/:id/messages` | one turn: `{ text, selection, target?, with? }`; 409 while the previous one runs |
| `GET …/:id/events?since=` | SSE: `state`, stored events past `since`, `live`, then everything as it happens |
| `PATCH …/:id` | model and effort for the next turn: `{ model?, effort? }`, `''` resets to the default; 409 mid-turn; closes the live session so the next message resumes with the new values |
| `POST …/:id/interrupt` | stop the running turn |
| `DELETE …/:id` | remove the record |

`effort` is one of the Agent SDK's levels (`low` … `max`, `EFFORTS` in `threads.js`) and is
passed straight to the session's options; the models an account can run, each with the
effort levels it accepts, come from the Claude probe (`supportedModels()` on the same
zero-token handshake) as `models` on the provider's ready status.

The browser's selection travels with each message. The server never holds it otherwise;
`canvas_read` reports the latest one for that thread.

## The Agent panel (`client/src/agent/AgentPanel.jsx`)

The Agent button in the chrome opens a right-hand panel over the project's threads, one
tab each, newest first — a canvas thread's tab reads "Canvas", an artifact thread's the
node's title. **The selection filters the strip** (`agent/tabs.js`, tested): no artifact
selected shows every thread; one selected shows only its threads; several show the
union, and the canvas threads drop out. A thread whose node is not on the canvas is
hidden in every state and kept on disk; it reappears the moment undo or redo brings the
node back, since the binding is by node id. The active tab is always visible: it survives
a re-filter it is part of, else the newest visible one takes over, else none — and with
none, Send creates a thread bound to the one selected artifact (or a canvas thread when
none is; with several selected, Send is disabled and says why). The composer sends to the
active tab: the thread's artifact is fixed for life, the selection at send time is the
message's `with`. The active thread's artifact wears the **focus mark** on the canvas
(`onFocus` → `className: 'agent-focus'` on that node — the node alone, not what the thread
touched): its name tag fills bright with a live dot, design option E, chosen over a ring
around the card because selection already owns the card border and the two read as one
fact when they share it. The scope row names the same artifact with a **Locate** action
that pans and zooms to it (`onLocate` → `fitView` on that node). The composer's bottom
row sets the thread's **model and effort** for the next turn, after T3 Code's composer
footer: two small ghost Astryx `Selector`s, the model one searchable and grouped by
provider with a description per row (Codex appears as a disabled group until sessions
exist), the effort one a short list with what each level means (`PATCH …/threads/:id`);
with no thread yet they apply to the one the next message creates. **Enter sends, Shift+Enter or Option+Enter breaks the line**, in
the panel and the toolbar's composer alike. The header's trash button deletes the active
thread after a confirmation; the canvas changes it made stay. Everything durable
is the server's; the panel mirrors the record and applies the stream, stored `ops_applied`
events included, so a reopened thread shows what changed and not only what was said. With
no provider ready it shows what was checked, how to install, and Check again, with Send
disabled — that is the design's state 10. Settings has a Local agents section with the
same statuses and the path overrides. The anchored reply's "Open thread" opens the panel
on that thread (`initialThreadId`). Design: `2026-09-05-agent-canvas-slice-3-design.md`.

**Deleting a page is the ordinary undoable op**: files and thread records stay on disk,
and undo brings the node and its tabs back. The one confirmation is a page whose bound
thread is `running` (React Flow's `onBeforeDelete` asks the thread list): Stop and delete
interrupts the turn, then removes the node; cancel removes nothing, the rest of the
selection included. Collecting the files and threads of a page that stays deleted is
compaction's job, together with superseded page versions — not built. **Pasting a page
copies its file** (`POST /api/projects/:name/files/copy { file }` → `copyMedia`, sidecar
`source: 'copy'`, `of: <original>`), so two nodes never share one file and a copy is the
unit of working on one asset from several threads at once.

## The selection toolbar and the composer (`client/src/toolbar/`)

A floating toolbar over any selection (design canvas "E · States", boards 2–4): the
selection's own action first — Generate with its size hint on one output, Open on one
page, the count on several, nothing on a lone input — then the filled **Agent** button.
Agent morphs the toolbar into a composer on the same centre and bottom edge
(`placement.js`: centred above, clamped to the sides, flipped below when there is no
room). The composer's target comes from the selection (`target.js`): exactly one
artifact → it is "To" and the rest come "with"; none → "To" is a new asset the agent
creates beside the selection; several → the agent must ask, and the composer says so.
One more when the panel is open on an artifact thread and the selection has no artifact:
"To" is that thread's artifact, and the button reads **Add to <title>** — a selected
artifact still wins over an open tab. Two rules while it is open: clicking another node adds it to "with" (and keeps it
selected), clicking empty canvas collapses it; Esc and Back do the same. The message goes
to the target artifact's newest idle thread (or a new `artifact` thread), and the reply
lands anchored below the node the agent worked on with **Undo** — offered only while the
agent's batch is what Cmd-Z would revert next (`GET /api/projects/:name/undo`), because
undo is one server-side ladder — and **Open thread**. The toolbar's Generate drives the
output node's own action through one window event (`nodes/nodeCommands.js`), so no run
logic is duplicated. Pure parts are tested (`placement`, `actions`, `target`); the
components are verified in the browser.

## Codex

Detected and shown alongside Claude. Sessions run on Claude in this slice: Codex needs
the same tools reachable over stdio rather than in-process, a second transport for the
same tool definitions, and it is the first follow-up.
