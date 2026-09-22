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

## Chats (`server/threads.js`, `server/agent.js`)

A thread is one **chat** about one project — not a thing about an artifact. Its record lives at
`<project>/threads/<id>.json` — messages, events with a sequence for replay, status —
written temp-then-rename before a turn starts, the `jobs.json` rule, so a turn in flight
survives the tab that asked for it and a reopened panel reads the transcript back. Text
deltas are streamed live and never stored; the assistant message holds the final text.

**A status is reconciled on the way out, never swept at boot.** A session lives in one
process and cannot outlive it, so a record saying `running` with no live session behind it
has exactly one explanation: the app was quit mid-turn. `reconcile` (pure, in
`threads.js`) makes that inference and `readThread`/`listThreads` apply it, with liveness
passed in from the routes — `hasLiveSession` in `agent.js` is the only thing that knows.
The record on disk is left alone; reconciliation is how a thread *reads*. It reads
`failed`, and that is deliberate rather than cosmetic: the composer and `findChatFor` skip
`running`, not `failed`, so an interrupted conversation is carried on instead of being
silently replaced by a new chat. `live` defaults to true wherever a caller does not say,
which is the safe way round — a wrong `false` would report a turn still in flight as dead.

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

### Tags, and why there is no `kind`

A chat carries **`tags`**: the node ids of the artifacts (pages, motions) it has touched.
They come from two places and nowhere else — the artifacts among the selection at its
**first** message (`tagFirstMessage` in `index.js`, which asks the *document* which of the
selected nodes are artifacts rather than trusting the browser), and every artifact the
agent writes to thereafter, created **or** updated (`onWrite` → `tagThread`). Adding a tag
a chat already has returns the same record, so a turn that rewrites one page five times
does not write the record five times.

**Tags are pointers, never dependencies.** Deleting every file a chat touched leaves the
chat intact and its tags in place; a stale tag simply stops matching, and the panel greys
its chip. This is why there is no confirmation for deleting an artifact the agent is
mid-turn on: the write fails and the agent says so.

There used to be a `kind` (`canvas` | `artifact`) and one `artifactId`, and a composer
message carried `target` and `with`. All four are gone. A chat bound to one node could not
be about two, so two motions selected had no target and the composer asked the person to
pick one — a mode picker doing the agent's job. The selection now travels as **context**
and the agent decides what the sentence means about it. Old records migrate on read
(`migrateThread`: `artifactId` becomes the one tag, a title becomes the person's since the
agent could not write one yet), permanently, the way `migrateNodes` does.

Two more fields ride along. **`titledBy`** (`'user' | 'agent' | null`) says who named the
chat: the agent names it once after the first turn, the person can rename a tab at any
time, and the person wins in **either order** — which one field could not express.
Clearing a name drops the credit with it, so the agent may name it again. Naming is one
small request on the person's own plan per new chat, with no tools and one turn, run
**after** the turn is settled and broadcast so a reply never waits behind a label; any
failure is silent and the tab falls back to the opening words.

**`lastVersion`** is the document version when the chat's last turn ended, stamped in
`settleTurn` and nowhere else. It is what the next turn's preamble measures "what changed"
from.

### What the model is told before the message

`contextPreamble` (`agentTools.js`, tested) prefixes the model's copy of a message with
what the person had selected — `Selected: motion m1 ("Intro"), motion m2 ("Outro").` —
and, when the board moved since the last turn, a sentence saying so:

> Since your last turn the canvas changed: 4 changes by the person, including an undo of a
> change from this chat. Read it again before acting.

`summarizeChanges` counts journal entries past `lastVersion` by `origin.kind`: `session`
and `undo`/`redo` are the person, another `thread` is another chat, `system` entries
(media extraction, project creation) are bookkeeping and are not counted — telling the
agent the canvas "changed" because a data URL was rewritten would send it re-reading for
nothing. An entry whose `undoes` names a version this chat committed is called out
separately, because an undo of the agent's own work is the case where carrying on
regardless is most obviously wrong.

The preamble goes in the transcript rather than only in a tool result the model might never
ask for. It is context, not an instruction: the system prompt tells the agent to decide
from the sentence what is meant, and to call `canvas_read` again whenever the preamble
says the board moved.

## The tools (`server/agentTools.js`)

Six, all on the in-process `unframed` MCP server, all listed in `allowedTools`, and the
only things the agent can call:

| Tool | Does |
| --- | --- |
| `canvas_read` | the graph as the agent should see it: every node (id, kind, position, text or file), the edges, the selection, the composer's `target`/`with`. Never bytes. |
| `canvas_write` | one `batch` of the document's own ops (`addNode`, `updateNode`, `moveNode`, `resizeNode`, `removeNode`, `addEdge`, `removeEdge`), committed under the thread's origin — journaled, streamed to every tab, **one undo step**. |
| `page_write` | a new version of a page: writes `<timestamp>-<slug>.html` plus a sidecar, then one batch (`addNode` beside the selection for a new page, `updateNode { file }` for an existing one). |
| `page_read` | the current HTML of a page node, so an edit starts from what is there. |
| `motion_write` / `motion_read` | the same pair for a motion asset (a HyperFrames composition); see "The motion asset" below. |

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

## The motion asset (`server/motion.js`, `client/src/nodes/MotionNode.jsx`)

A **motion** is a HyperFrames composition: one HTML file, timed by `data-start` /
`data-duration` on `class="clip"` elements under a root `#root[data-composition-id]`,
animated by one paused GSAP timeline registered as `window.__timelines.main`. It is a page
at the file level — same folder, same preview origin, same frame, a new file on every
write — with two things a page does not have: a player, and a render. Design and the
rejected alternatives: `docs/superpowers/specs/2026-09-06-agent-canvas-slice-4-design.md`.

**The library sits beside the compositions as plain files**, under fixed names:
`hyperframes-viewer.html`, `hyperframes-player.js`, `hyperframes-runtime.js`, `gsap.js`
(`ensureLibrary`, idempotent, refreshed when a source's size changes). The node frames
the viewer with the composition's name in its query (`?c=<file>`, checked against the
same alphabet the preview origin serves); the viewer mounts `<hyperframes-player
runtime-src="hyperframes-runtime.js">` on it. Same-origin with the composition is what
lets the player drive it, and not being the canvas's origin is what keeps the canvas
safe — the preview origin's rules below hold unchanged, plus two additions made for
this: `js` in the extension allow-list, and `frame-src 'self'` in the policy (a sibling
may frame a sibling; with `default-src 'none'` alone Chrome refused the inner frame).

**The runtime tag goes in at write time.** The player injects HyperFrames' runtime only
into a composition with no timeline of its own, and a real composition has one — without
the runtime inside the file the player drives GSAP and shows no timed clip. `withRuntime`
adds `<script src="hyperframes-runtime.js" data-hyperframes-preview-runtime>` once, on
`motion_write` and on `POST …/motion/files` (a composition the person drops on a motion
node); the attribute is the marker `@hyperframes/core` strips by, so the renderer removes
this copy and injects its own.

**Render** (`POST /api/projects/:name/motion/render { file, title? }` → `{ id }`, then
`GET …/motion/render/:id` → `{ status, progress, message, output, error }`) runs
`@hyperframes/producer` — a headless Chrome captured frame by frame through the BeginFrame
API, ffmpeg encoding — imported only when a render starts, since it is the heaviest
module in the package. The MP4 is rendered into a temp folder and only then placed in the
project as `<timestamp>-<slug>.mp4` with a sidecar (`source: 'render'`, `of` names the
composition, **no `cost`**), so a failed render leaves nothing behind; the node then adds a
`video` node beside itself naming the file, as a video output's Add to canvas does. Jobs
are an in-memory Map, not `jobs.js`: a render is local compute on files still on disk, so
one lost to a restart costs a click, not money. The Chrome is the person's own
(`findChrome`: Google Chrome, Chromium, Edge or Brave where each platform installs them,
then the puppeteer and HyperFrames caches; `UNFRAMED_CHROME_PATH` overrides), and
`.puppeteerrc.cjs` at the root keeps puppeteer from downloading one on install; with no
Chromium at all, Render fails with a message saying to install one.

**The agent's two tools**, `motion_write` and `motion_read`, are `page_write` and
`page_read` with the noun changed — one factory in `agentTools.js` builds both pairs, so
the new-file rule, placement, the node it becomes and the `ops_applied` event cannot
drift between them. `motion_write`'s description carries the composition contract
(root attributes, clips, one paused timeline, `gsap.js` by sibling name, no external
loads, no imperative media control); the runtime tag is added for it. The event's
artifact field is still named `page` for both kinds, with `kind` inside it.

## Parameters on an artifact (`server/dials.js`, `client/src/editor/Dials.jsx`)

An artifact can expose controls, and the editor's third column is where you turn them. The
whole contract, from the agent's side, is one call inside the composition or the page:

```js
unframed.dials('Scene', { accent: '#a78bfa', speed: [1, 0.5, 2], title: 'Launch day' }, (v) => {
  root.style.setProperty('--accent', v.accent);
});
```

**The shorthand is ours, not DialKit's.** A value is read by its shape — a hex is a colour
picker, `[value, min, max]` (with an optional fourth step) a slider, a plain string a text
field, a list of strings a select, a number or a boolean itself, a nested object a folder.
DialKit wants `{ type: 'color', default }` and would render a bare hex as a text field (its
own `isHexColor` only feeds colour interpolation and never classifies a control), so
`normalizeConfig` translates and the agent keeps the short form. Anything it cannot read is
refused **by name** — `dials.a.b.c: an array must be…` — so a typo is a message rather than
a control that silently does nothing.

**The UI is not in the artifact.** DialKit is imported by the editor's column and rides its
lazily-loaded chunk; the artifact holds the values and applies them. That is what keeps
~250KB out of every project folder and out of every render, and a render needs the *values*,
never a control to drag.

**The agent is told what an artifact is SET TO**: `canvas_read` reports `dials` on a page or
motion when it has any. It has to, and this was missed at first with a visible cost — the
values live on the node, so the file the agent reads back still holds the defaults, and a
stitch of two tuned motions came out as the originals with nothing in the reply admitting
it. The system prompt and both write tools say the same thing: build from the values, and
carry them into anything made FROM an artifact.

**There are three kinds of parameter, and conflating them is what breaks a motion.** One
that nothing animates — a colour, a piece of copy, a size — is applied straight to the DOM
in the callback. One the animation is MADE of — where a move starts or ends, how long it
lasts, its ease — belongs to the animation and has to be given to it. And a value that
varies across the timeline is not a parameter at all: it is a start, an end and a duration,
exposed as separate controls. There is deliberately no keyframe or curve control, because
the moment something needs a third waypoint the motion wants rewriting, which is a sentence
to the agent rather than an editor to build.

**The second kind is why a motion builds its timeline from the values.** Writing an
animated property to the DOM beside a tween is wrong in a way that looks right: GSAP takes
ownership of `transform` on everything it tweens and rewrites it every frame, so the value
holds while the clip sits still and is overwritten the instant it is played or scrubbed —
stored, delivered and applied perfectly, then lost, which from the outside is
indistinguishable from a tuning that was never saved (Matteo, 2026-09-14). So the timeline
is registered synchronously as always and then built INSIDE the callback: keep the
playhead, `tl.clear()`, re-add the tweens from the values, seek back. The first call is
synchronous, so a render builds the timeline from the saved values before its first frame;
every later change rebuilds it in place and the runtime keeps the same timeline object.
That makes the collision impossible rather than merely discouraged — GSAP stays the only
thing writing the animated properties, and it writes them from the values. `motion_write`
carries the rule and the worked example, `page_write` does not (a page has no timeline),
and `agentTools.test.js` pins both facts.

**A parameter is a value on the NODE** (`data.dials`), not an edit to the file. So tuning is
an ordinary undoable canvas change, it streams to every tab, and it survives the agent
rewriting the composition: the schema comes from the new file, the values from the node, and
`mergeValues` keeps what still exists, drops what the new version no longer names, and
refuses a saved value of the wrong type rather than coercing it. Writes are debounced by the
same 400ms the document treats as a unit of work, so a drag is one undo step.

**The relay, and why the canvas says hello first.** The bridge announces
`{ name, config, schema, values }` to whoever framed the artifact; the viewer
(`server/motion.js`) relays it up and relays values back down. Neither end knows the
other's origin, so the canvas sends `unframed:dials:hello` and the viewer replays the last
announcement to it — which is what lets every message be addressed to a known origin
instead of `*`. The bridge accepts only same-origin messages (the viewer is same-origin with
the composition); the viewer accepts only loopback ones from above, the same rule as the
preview origin's `frame-ancestors` and the API's own `Origin` check.

**Rendering.** The node's values reach the engine as `variables.unframedDials`, which it
injects as `window.__hfVariables` before any page script runs — so the bridge's first apply
already has them and the very first captured frame is the tuned one. The render's sidecar
records `dials`, because a composition's file is no longer enough to reproduce an MP4: the
same file at two settings is two different videos, and this is the only place that
difference is written down. Absent, not empty, when there were no parameters.

**Asking for a parameter is the column's own box.** Describe one — "the background colour,
the title size" — and it goes to that artifact's own chat as an ordinary message, with a
premade instruction (`ASK` in `Dials.jsx`) naming `unframed.dials`, insisting the callback
APPLIES each value rather than declaring one it ignores, and telling the agent to keep the
parameters already there. It replaced an "install the controls into the project" button,
which was the wrong thing in the right place: it answered a question almost nobody has,
while sitting where people look for a way to ADD a control, and twice read as "these
controls are not installed" to someone looking straight at working controls. The box also
gives the column a purpose when an artifact has no parameters at all.

**A pending write is flushed when the editor closes, never cancelled.** The debounce that
makes a drag one undo step used to be cleared on unmount, so a tweak made in the last 400ms
before closing was dropped silently: the preview had shown it, the node never heard, and the
canvas then correctly showed the untuned artifact — which reads as the canvas resetting your
work.

**An artifact carries no controls of its own.** Opened outside the app it plays and applies
whatever it was written with, and shows no panel — the controls are the editor's. DialKit was
briefly installable beside a composition so the viewer could mount its own; removed on
2026-09-14 because nothing asked for it, and the column's own box is how you ask for a
parameter. The **bridge** still ships with every composition and is injected by
`withRuntime`: the agent's contract is one function call, and a composition that called it
without remembering a script tag would do nothing at all, silently.

The bridge is **generated** from the same functions the engine tests (`bridgeSource()` in
`server/dials.js`), so the copy in a project folder cannot drift from the tested definition
— `dials.test.js` evaluates that generated source against a stub window and drives it.

## The preview origin (`server/preview.js`)

Pages are HTML and HTML runs code, so a page is never served from the API's origin —
there it would *be* Unframed to the browser and could read the folder, spend the key or
install one through the OAuth nonce. A second http server, bound to `127.0.0.1` on an
OS-assigned port reported as `previewPort` in `/api/health` and in the `ready` message,
serves `GET/HEAD /p/<project>/<file>` and nothing else. The rules, each pinned in
`preview.test.js`:

- one path shape; the file name must match the alphabet this server writes
  (`[A-Za-z0-9._-]`), which disposes of `..`, separators and anything odd;
- an **extension allow-list** (`html`, `js` — for the motion library beside a composition — images, video, audio, fonts): `.json` sidecars,
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
| `POST /api/projects/:name/threads` | start a chat (`{ provider, model, effort?, mode?, tags? }`); `kind`/`artifactId` are **refused with a 400** naming the new field, not ignored — a client still sending them would silently get an untagged chat, which looks exactly like the feature working |
| `GET /api/projects/:name/threads?tag=` | list, newest first; `tag` narrows to the chats tagged with that artifact, any-of when repeated |
| `GET /api/projects/:name/threads/:id` | the record |
| `POST …/:id/messages` | one turn: `{ text, selection }`; 409 while the previous one runs. The first message tags the chat with the artifacts among `selection` |
| `GET …/:id/events?since=` | SSE: `state`, stored events past `since`, `live`, then everything as it happens |
| `PATCH …/:id` | model and effort for the next turn: `{ model?, effort? }`, `''` resets to the default; 409 mid-turn; closes the live session so the next message resumes with the new values. `title` and `mode` ride the same route and are refused by none of those conditions — neither changes a running session |
| `POST …/:id/permission` | answer the request the turn is parked on: `{ id, decision: 'once' \| 'always' \| 'deny' }`. The record is updated first and the turn released second — `always` widens the chat's grants, and a turn released before that was saved could ask the same question again. A 409 is a stale panel answering a question that is no longer in flight |
| `POST …/:id/interrupt` | stop the running turn |
| `DELETE …/:id` | remove the record |

`mode` is the chat's **runtime mode** — how much the agent may do in it without asking
(`permissions.js`, which owns what each of `plan`, `acceptEdits`, `auto` and `full` allows
and how they map onto the SDK's `permissionMode`). It is a property of the chat, so two
chats can run at different levels of trust at once, and unlike the model it may change
mid-turn: the SDK's own mode only sets the floor, and every decision `canUseTool` makes
reads the record, so tightening a chat takes effect on the agent's very next call. A record
written before runtime modes existed migrates to the default, which is `auto`.

### Permissions

`permissions.js` answers one question and nothing else: **given a chat's runtime mode, a
tool name and its input, is this allowed, denied, or does it need asking?** The matrix, the
list of commands destructive enough to stop for even in auto, and how a thread-scoped grant
is matched all sit behind it, so they can be tested without running a model
(`permissions.test.js`). `canUseTool` is a thin adapter over it, and the scripted agent
goes through the same `decidePermission`, which is how the whole round trip is asserted in
`agentFlow.test.js`.

Reading is never asked about. Our own `mcp__unframed__` tools are never asked about either,
in any mode: they are already scoped to this project's document and folder, and a prompt
would make the thing the agent is good at slower without making it safer.

| Mode | SDK `permissionMode` | Allows |
| --- | --- | --- |
| plan | `plan` | reads only; anything else is **denied**, not asked — a prompt mid-plan defeats the point, and the message is written to the agent so it describes what it would do instead of stalling |
| accept edits | `acceptEdits` | files are written; anything that RUNS asks |
| auto | `default` | ordinary work proceeds; only what cannot be undone asks |
| full access | `bypassPermissions` | everything |

**The ordering is deliberately not Claude Code's own ordering of the same words.** There
`default` asks about edits and `acceptEdits` does not, so accept-edits is the looser of the
two; here auto is looser, because accept-edits means "write files, but ask before running
anything" and auto means "get on with it, and stop me only for the dangerous things". The
SDK mapping is what keeps the two orderings from colliding.

**A pending request is thread state, not session state.** It is written into the record and
emitted on the thread's event stream in ONE write, so nothing can read a chat waiting on a
question its own event log does not mention — and a panel that reconnects reads it from the
record rather than from a socket it missed. Only one can be outstanding at a time, which is
not a limitation but the shape of a turn: the agent is blocked on the answer. A turn parked
on one is still `running` — it has neither failed nor finished. A request whose process
died is cleared by the same `reconcile` that fails a stale `running`, because Allow and
Deny offered to nobody are worse than no buttons at all.

**A grant's breadth tracks how hard the thing is to undo.** "Allow for this chat" on a
shell command grants the *program*, so agreeing to `git` does not agree to `curl`; a
command on the dangerous list is its own kind, whole, because someone answering a prompt
about `git status` agreed to `git` and a push is not what they were shown. Grants are
thread-scoped by definition — a new chat starts with none.

`effort` is one of the Agent SDK's levels (`low` … `max`, `EFFORTS` in `threads.js`) and is
passed straight to the session's options; the models an account can run, each with the
effort levels it accepts, come from the Claude probe (`supportedModels()` on the same
zero-token handshake) as `models` on the provider's ready status.

The browser's selection travels with each message. The server never holds it otherwise;
`canvas_read` reports the latest one for that chat, and only that — there is no `target`
or `with` to report any more.

### The scripted agent (`server/agentScript.js`)

`UNFRAMED_TEST_AGENT_SCRIPT=<path>` — unset in a clone and therefore inert, the same
marker rule as `UNFRAMED_DATA_DIR` — makes a turn come from a JSON script instead of a
model. It replaces **the model and nothing else**: the same `Session`, the same tool
handlers, the same document, the same events (`session`, `tool_use`, `ops_applied`,
`tool_result`, `text_delta`, `api_retry`, `result`, `titled`), so a fixture commits real ops and writes
real files in milliseconds.

It exists because every interesting claim about a turn spans several modules — that a bulk
edit is one undo step, that a tag survives deleting the node it names, that the next turn
is told about an undo of its own change — and a real turn can show that once, expensively,
and never the same way twice. A script is `{ when?, turns: [...] }`; a turn is
`{ text, tools?, retries?, title?, isError?, errorSubtype?, expectPreamble? }` and turn N answers the chat's Nth
message. `when` is matched against a chat's first message, which is how one folder of
fixtures (`server/fixtures/agent/`) serves a flow that starts several conversations from
one env var; the choice is made once and kept, so turn 2 cannot wander into another
fixture. `expectPreamble` asserts what the agent was actually handed, which is what makes
the change-note contract checkable **from the agent's side**: drop the note and the turn
fails. Tested in `agentScript.test.js`; `agentFlow.test.js` drives the real forked server
through the routes with it, and is the acceptance test for chats and tags.

There is deliberately no route, header or body field that can turn any of this on.

## The Agent panel (`client/src/agent/AgentPanel.jsx`)

The Agent button in the chrome opens a right-hand panel over the project's chats, one tab
each, newest first. **This is where a reply lives** — there used to be a second place, a
card anchored on the node the agent worked on, and it could not survive the subject being
two artifacts at once. A tab reads the name the person typed, else the name the agent
wrote after the first turn, else the opening words of the first message (32 characters,
then an ellipsis), else "Chat" (`tabLabel` in `agent/tabs.js`). The strip is Astryx's `TabList`, shaped into folder tabs (a rounded top and
a border that joins the open tab to the transcript under it) by the `tab` and `tab-list`
overrides in `client/src/theme.js`, which is where that shape has to live: Astryx's own
base styles come out of StyleX and only the theme's generated rules land in a layer above
them. Past the third tab the rest go behind the strip's `TabMenu`, which names whichever
one is active, so a narrow panel never scrolls its tabs out of reach. **Double-clicking a
tab renames its thread** in the tab's own box -- Enter or clicking away commits, Escape
abandons, and an empty name clears it so the tab goes back to saying what it is about.
The name is `title` on the thread record (`renameThread` in `server/threads.js`, sent on
the same PATCH as model and effort but taken mid-turn, since it changes no session). Two chats about one page are the intended way to explore two directions, and a name is
what tells their tabs apart.

**The selection filters the strip** (`agent/tabs.js`, tested): nothing selected shows every
chat; an artifact selected shows the chats tagged with **any** selected artifact.
`visibleThreads` no longer hides a chat whose artifacts have all been deleted — the
conversation may be the only record of why the thing was made, so its chips grey out
instead. The active tab is always visible: it survives a re-filter it is part of, else the
newest visible one takes over, else none — and with none the next message starts a chat.
**A chat can always be started**, whatever is selected: `newKind` and the disabled Send
with "select one artifact to start a thread about it" are gone, because any selection is a
fine thing to talk about.

**Every artifact the active chat has touched wears the focus mark** — `onFocus` hands
App.jsx the chat's whole `tags` array and each matching node gets `className:
'agent-focus'`. Its name tag fills bright with a live dot: design option E, chosen over a
ring around the card because selection already owns the card border and the two read as
one fact when they share it. A tag whose node is gone matches nothing, which is what makes
a stale tag harmless. The mark is now the **only** thing on the canvas that says what the
chat has touched, which is the job it was always doing.

**The row above the composer is the live selection**, named — one chip per selected
artifact wearing its own node icon (`NODE_ICONS`, so the chip and the thing on the canvas
look like the same thing), plus a count of whatever else is selected. It carries no
Locate: a selected node is one you have just pointed at. The row is absent when nothing is
selected, since an empty selection IS the whole canvas and a chip announcing it was a label
on the default.

That row first listed the chat's *tags* instead, next to a selection count — two questions
in one row wearing one shape, which read as noise rather than as either answer. What the
chat has touched moved to the recap card below.

**The recap card sits at the foot of the transcript**, after the last message: a header
with the file count and a Hide/Show toggle, then one row per artifact — its node icon, what
it is called, **Open** and **Locate**; a deleted one is struck through and reads "deleted".
It is modelled on T3 Code's changed-files card, minus the diff, because here what matters
is *which* things were involved rather than by how much. Reads and writes are deliberately
**not** distinguished: the card answers what the conversation involved, and splitting it
into changed-versus-merely-read made a summary into a taxonomy.

It is **derived, not stored** — `touchedArtifacts` (`agent/tabs.js`, tested) folds it out of
the events the record already keeps: `input.nodeId` on the artifact tools for reads and
updates, `page.nodeId` and `artifacts` on `ops_applied` for writes. So a reopened chat
rebuilds it from the replay exactly as the live turn built it, and nothing new is persisted.
That set is deliberately NOT the record's `tags`: tags decide which chats the strip shows
for a selection, and a chat that read a file once should not thereby be filed under it
forever. `canvas_read` contributes nothing — it reads the whole board, every turn, and
listing everything would bury what the turn was about.

`ArtifactRow` in `AgentPanel.jsx` is that row.

### The agent's replies are markdown (`client/src/agent/Markdown.jsx`)

The agent writes markdown, so the panel renders it: `react-markdown` with `remark-gfm` and
`remark-breaks`, and the prose typography of t3code's chat
(`apps/web/src/components/ChatMarkdown.tsx` and the `.chat-markdown` rules in
`apps/web/src/index.css`, MIT — the same source as the model manifest and the provider
logos). Their measurements are kept and their theme variables swapped for Astryx tokens, so
a theme change carries and no hex lands in the stylesheet. Their code-block copy button is
kept too.

**What the PERSON typed is not parsed.** They typed prose; running it through markdown would
eat their asterisks and turn a line beginning `#` into a heading. Only the agent's side is
rendered, and the streaming draft goes through the same component so formatting appears as
it arrives rather than snapping in at the end.

**Raw HTML is never parsed, and that is the one deliberate divergence from t3code**, which
pairs `rehype-raw` with `rehype-sanitize` and does render it. Neither plugin is loaded here,
so markup in a reply is shown as the text it is. It is the same rule that gives page assets
their own origin (`server/preview.js`, below): HTML the model wrote must not execute where it
would BE Unframed to the browser, and the panel is as same-origin as it gets. A sanitiser is
a filter with a history of bypasses; not parsing the HTML at all has none. Without
`rehype-raw` there are no raw nodes to sanitise, and react-markdown's own `urlTransform`
already drops `javascript:` from hrefs and image sources. Links additionally open in a new
tab with `noopener noreferrer`, since a reply's links come from a model and may point
anywhere.

Shiki syntax highlighting is deliberately not adopted: it is most of t3code's markdown
weight, and replies here are prose about the canvas rather than code listings. The three
markdown packages cost about 158KB raw (48KB gzipped) in the client bundle.

**The transcript is the messages, and only the messages.** Each change the agent made
briefly got a block of its own here — the summary, expandable to the artifacts it touched,
with Undo — and it went on 2026-09-06: with the recap card listing the same files, a block
per message repeated itself up the whole transcript, and what a chat is FOR is what was
said in it. **Undo is Cmd-Z**, which walks the same server-side journal the button called
and flushes pending local edits first (`graph/useDocument.js`); a bulk edit is one journal
entry, so it is still one undo step — that guarantee lives in the document, not in a
button. **No chat message is written for an undo** either: it would claim the agent said
something it did not.

Which artifacts a change touched still travels on the `ops_applied` event, because the
recap is folded out of it: `page.nodeId` for a single artifact write, and `artifacts` for a
`canvas_write` batch (`batchArtifacts`, read from the ops rather than the graph afterwards,
because a `removeNode`'s node is gone by then).

A chat with nothing in it yet says what to say in one sentence, in plain text at the FOOT
of the transcript next to the composer it is about — in a box and at the top it read as the
first message. The composer's bottom
row sets the thread's **model and effort** for the next turn, after T3 Code's composer
footer (`agent/ModelPicker.jsx`): two small ghost triggers with a popup each. The model
popup has provider tabs across the top (Claude, Codex — the last says sessions on it do
not exist yet) and one-line rows: the current models, then the older ones under a
Legacy heading. The list is `mergeClaudeModels` in `providers.js`: the SDK's
`supportedModels()` rows (the aliases the CLI resolves, with the effort levels it
reported) named from a static catalogue, then the catalogue's remaining ids — the same
ids `claude --model` accepts, taken from t3code's model manifest (MIT). The SDK's
"default" alias is folded into the model it stands for, so the trigger always reads a
real model name. The effort popup is a short list headed Reasoning, Auto marked Default,
a hint under each level. Astryx has no component of that shape, so they are Astryx
`Popover` and `Badge` around our own rows, styled from tokens (`.mp-*` in `styles.css`);
the provider logos are the SVG paths t3code ships (MIT). Saved through
`PATCH …/threads/:id`; with no thread yet they apply to the one the next message creates. **Enter sends, Shift+Enter or Option+Enter breaks the line**, in
the panel and the toolbar's composer alike. The header's trash button deletes the active
chat after a confirmation; the canvas changes it made stay. Everything durable
is the server's; the panel mirrors the record and applies the stream, stored `ops_applied`
events included, so a reopened chat shows what changed and not only what was said. The
`titled` event updates the tab the moment the agent names the chat. With
no provider ready it shows what was checked, how to install, and Check again, with Send
disabled — that is the design's state 10. Settings has a Local agents section with the
same statuses and the path overrides. The toolbar's Send opens the panel on the chat it
started (`initialThreadId`). Design:
`2026-09-06-chats-and-tags-design.md`, and `2026-09-05-agent-canvas-slice-3-design.md`
for the strip's shape.

**Deleting an artifact is the ordinary undoable op**, with **no confirmation at all**:
files and chat records stay on disk, and undo brings the node and its tabs back. The
mid-turn confirmation is gone — a chat is not a dependency of what it touched, so the
write simply fails and the agent says so in its reply. Collecting the files and chats of
an artifact that stays deleted is compaction's job, together with superseded versions —
not built. **Pasting a page
copies its file** (`POST /api/projects/:name/files/copy { file }` → `copyMedia`, sidecar
`source: 'copy'`, `of: <original>`), so two nodes never share one file and a copy is the
unit of working on one asset from several threads at once.

## The selection toolbar and the composer (`client/src/toolbar/`)

A floating toolbar over any selection (design canvas "E · States", boards 2–4): the
selection's own action first — Generate with its size hint on one output, Open on one
page, the count on several, nothing on a lone input — then the filled **Agent** button.
Agent morphs the toolbar into a composer on the same centre and bottom edge
(`placement.js`: centred above, clamped to the sides, flipped below when there is no
room).

**The card only starts a chat.** Send opens the panel on it and the reply lives there, so
there is no Stop here and no answer here — there used to be both, in a card anchored on
the node, and neither survived the subject being two artifacts at once. "Add to \<page\>"
is gone with it.

The composer shows **one chip** saying what the agent is about to be shown
(`contextLabel` in `target.js`): "2 motions — Intro, Outro · with 1 image", "3 inputs",
"nothing selected". It names the artifacts, because "which two motions" is worth answering
before you type, and only counts the rest, because "which three images" is not; the kind is
the nodes' own when they are all one kind and the generic word when they are mixed. That
replaced a "To" line plus a chip per node, which turned a selection into a sentence about a
target — and two artifacts into an error the person had to resolve. `messageContext` returns
`{ selection, artifacts }` and there is no `target`, no `'new'` and no `'ask'` anywhere in
it; nothing may re-invent one.

Under the chip, **which chat this joins**: "continues *Title fixes*" or "new chat", with a
button to switch. `continuableChat` (`agent/tabs.js`, tested) picks the newest idle chat
whose tags include **every** selected artifact — all-of, unlike the strip's any-of,
because a chat that never saw B must not answer a message about A and B. It is the client
mirror of the server's `findChatFor`, and it exists twice on purpose: rendering that label
from the server would be a request per keystroke.

The bar floats over React Flow as ordinary DOM, so a wheel
over them would otherwise reach nothing and the canvas would sit frozen wherever they
happen to be: `toolbar/canvasWheel.js` forwards the event to `.react-flow__pane`, on a
timeout (d3-zoom ignores a wheel dispatched inside another wheel's dispatch) and with
`view: window` (d3-zoom reads `event.view.document`), leaving the wheel alone only when
something under the pointer can scroll itself. Two rules while it is open: clicking another
node adds it to the context (`addToContext`, idempotent, and it keeps the node selected),
clicking empty canvas collapses it; Esc and Back do the same. Send starts or continues the
chat, opens the panel on it **before** the message goes out so the reply streams into
somewhere the person is already looking, then posts the message. The toolbar's Generate
drives the output node's own action through one window event (`nodes/nodeCommands.js`), so
no run logic is duplicated. Pure parts are tested (`placement`, `actions`, `target`,
`tabs`); the components are verified in the browser, and with
`UNFRAMED_TEST_AGENT_SCRIPT` set that verification is deterministic.

## Codex

Detected and shown alongside Claude. Sessions run on Claude in this slice: Codex needs
the same tools reachable over stdio rather than in-process, a second transport for the
same tool definitions, and it is the first follow-up.
