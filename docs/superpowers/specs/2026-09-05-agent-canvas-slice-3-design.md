# Agent on the canvas — slice 3: tabs, the focus ring, and deleting an artifact

Designed 2026-09-05, the day after slice 2 merged (PR #58). Status: the decisions below
were put to Matteo in conversation and chosen explicitly; this file is the record. Builds
on `2026-09-04-agent-canvas-slice-1-design.md` (the document, the threads) and
`2026-09-04-agent-canvas-slice-2-design.md` (the composer, the page asset, `kind:
'artifact'` and `artifactId` on a thread) without changing either. Interaction design is
the Claude Design canvas linked from the slice-1 spec, page "E · States", the panel
boards — one tab per thread plus the canvas ones.

## What this slice adds

The panel becomes a view over the project's threads, and the canvas tells you which
artifact the open thread is about.

1. **Tabs per thread, filtered by the selection.** Every thread is a tab. Selecting an
   artifact narrows the strip to that artifact's threads; clearing the selection shows
   them all.
2. **The focus ring.** The artifact the active thread is bound to wears a ring distinct
   from selection, so "which page am I talking to" is answered on the canvas, not in
   the panel's header.
3. **Selection while the panel is open** does two things at once: it filters the tabs
   and becomes the next message's `with`. There is no separate mode.
4. **"Add to <artifact>"** on the selection toolbar, when an artifact thread is active
   and the selection has no artifact of its own.
5. **Deleting a page stays undoable**, and brings its threads back with it. The only
   confirmation is when its agent is mid-turn. Copying a page node copies its file, so
   several agents can work on several copies without touching each other's.

Slice 4 (the motion asset) is untouched by this. Codex sessions remain detection only.

## The model: a thread is a session, and two sessions on one file is the user's call

This is stated once, here, because it is the reason several rules below are the way they
are. A thread is one long-lived Agent SDK session with its own context (slice 1). Two
threads bound to the same artifact are two terminals open on the same branch: each is
coherent on its own, and neither knows what the other just did until it reads the canvas
again. That is a known property of every agent harness, and this design does not try to
hide it with locks or merges. **The intended way to explore in parallel is copies**: one
artifact node per direction, one thread per node, delete the losers. That is why
duplicating a page duplicates its file (section 4), why a copy starts with no threads,
and why a deleted page's threads disappear with it (and return with undo) — the copies
are the unit of isolation, so they have to be cheap to make and cheap to drop.

## Section 1 — the tab strip

### What is a tab

One tab per thread in the project, newest first, `canvas` and `artifact` alike. A
canvas thread's tab reads "Canvas"; an artifact thread's tab reads its artifact's title
(the node's `data.title`, else `fileName`, else the node id). A running thread's tab
carries the running dot the transcript already uses. There is no separate permanent
"Canvas" tab: a canvas thread is a session like any other and is worth returning to,
so it gets the same tab and the same place in the order.

### The selection filters the strip

Three states, decided by which artifacts are in the selection:

| Selection | Tabs shown |
| --- | --- |
| no artifact selected (nothing, or only inputs/outputs) | every thread |
| one artifact selected | that artifact's threads only |
| several artifacts selected | the union of their threads; canvas threads drop out |

Pure: `visibleThreads(threads, selectedIds, nodes)` in `client/src/agent/tabs.js`,
pinned in `tabs.test.js`. Threads whose `artifactId` names a node no longer on the
canvas are excluded in every state (section 5 says why they can exist at all).

### Which tab is active

The composer always sends to the active tab, so the rule is that the active tab is
always visible:

- when the strip re-filters, the active tab stays active if it survives;
- otherwise the newest visible tab becomes active;
- when no tab is visible, none is active, and the composer's send **creates** a thread:
  bound to the selected artifact when exactly one is selected, a canvas thread when
  none is; with several selected and no thread among them, the composer reads the
  same "pick one" line `target.js` already produces and send is disabled.
- clearing the selection widens the strip without changing the active tab.

Pure: `nextActive(activeId, visibleIds)` beside `visibleThreads`. The "+" button
creates a thread the same way send does when none is active, then activates it.

### What the composer sends

The active thread's `artifactId` is fixed for its life (slice 2: bound at creation or
by the agent's first `page_write`, never rebound). The selection is per message: on
send, the current selection minus the thread's own artifact is the message's `with`,
and `target` is the thread's artifact (or `new` for a canvas thread, as today). So
replacing the selection while inside an artifact thread changes what the next message
comes with, never what it is about — which is what Matteo asked for, and what the
record already models.

### The transcript

The panel reads the stored events, not only the messages: a stored `ops_applied` is
rendered as the same note line the live one produces, so a reopened thread shows what
the agent changed and not only what it said. This closes the "live only" gap slice 2
left in `AgentPanel.jsx`.

## Section 2 — the focus ring

When the active tab is an artifact thread, its artifact node — that node only, not the
nodes the thread has touched — wears a ring. It is a second visual, not a reuse of
selection: selection is a doubled neutral border (node-anatomy spec); the focus ring is
a 2px outline in the agent accent, offset outside the card, present whether or not the
node is selected. Both can be on at once and must read as two facts.

Plumbing: `AgentPanel` reports its active thread's `artifactId` up through an
`onFocus(artifactId | null)` prop; `App.jsx` sets `className: 'focused'` on that node
(the same `className` field React Flow already forwards to the wrapper), so no node
component changes and no context is added. The ring goes when the panel closes, when
the active tab is a canvas thread, and when the node is deleted.

## Section 3 — "Add to <artifact>"

The toolbar's last group is the filled Agent button (slice 2). When the panel is open
on an artifact thread **and** the selection contains no artifact, that button reads
**Add to <title>** and clicking it opens the composer already targeting that artifact,
with the selection as `with`. When the selection contains an artifact, the selection
wins as today (one artifact → it is the target; several → pick one), because a selected
artifact is a more deliberate statement than an open tab. Pure: `messageTarget` gains
an optional `focus` argument and the rule above; `target.test.js` pins it. Nothing is
added to the right-click menu — one place for one action.

## Section 4 — copies and deletion

### Copying a page copies its file

Today a pasted page node carries the original's `data.file`, so two nodes point at one
file and an edit through either moves both. **Paste of a page node duplicates the
file first**: `POST /api/projects/:name/files/copy { file }` writes a new
`<timestamp>-<slug>.html` plus sidecar (`source: 'copy'`, `of: <original>`) through
`saveMedia`'s naming, and the pasted node is added pointing at the copy. The new node
has a new id, so it has no threads and no binding; its first message opens a fresh
session. The library path (`instantiateFragment` for presets) is left alone: a preset
holding a page is not a case anyone has, and the write rule in `docs/library.md` says
not to widen that path casually.

### Deleting an artifact is an ordinary undoable op; the disk is cleaned later

Removing a page node goes through the same `removeNode` diff as every other node, and
is undone the same way. Nothing on disk moves: the file versions stay, the thread
records stay. Threads bind by node id, so undo restores the node **and its tabs**, and
redo takes them away again. No route, no dialog, no system commit — the cost of keeping
delete undoable is zero today, because the journal is append-only and never truncated
(slice 1), so there is no moment at which an entry becomes unrecoverable.

That moment is **journal compaction**, already an open item in `status.md` beside
"clean up superseded page versions". They are one job and are designed together, later:
compact the journal to a snapshot, then delete every file no node references (a removed
page's versions, and a living page's superseded ones) and every thread whose artifact
is not in the snapshot. One rule, one test, and no way to collect a file the journal
can still restore. This slice's only obligation is to leave the project in the shape
that job needs — files immutable, threads orphaned rather than deleted, nothing
hard-deleted by a gesture — which it does.

**The one confirmation** is deleting a page whose bound thread is `running`: an agent
mid-turn on a file whose node is about to go has no good outcome, so the gesture asks
"The agent is working on this page. Stop it and delete?" Confirm interrupts the thread
(`POST …/threads/:id/interrupt`, which exists) and then removes the node as the ordinary
op; cancel removes nothing, not even the rest of the selection. Undo restores the node
and the stopped thread's tab. A running thread is the only condition that asks; every
other delete is silent and reversible, like every other node's.

Rejected, in favour of this: a confirmed hard delete (node, every file version and every
thread, as a non-undoable system commit). It answered "who cleans the disk" today, but it
made a page the one node Cmd-Z could not bring back, and it put a modal on every
deletion. Deferring the cleanup to compaction keeps undo uniform and removes the modal.

## Section 5 — what else moves

- **Orphaned threads.** A thread whose artifact is not on the canvas is hidden from the
  strip and kept on disk, whoever removed the node. It is reachable again the moment
  the node comes back through undo or redo, since the binding is by node id.
- `GET /api/projects/:name/threads` is unchanged; the client filters, because the strip
  re-filters on every selection change and a round trip per click is the wrong shape.
- `docs/agent.md` gains the strip's three states, the ring, the running-thread
  confirmation and the copy route; `CLAUDE.md`'s node table row for `page` gains the
  sentence that its files and threads outlive the node until compaction; `CHANGELOG.md` gets the user-visible half.
- `status.md` (main checkout, after the worktree exits): slice 3 closed; "concurrent
  threads on one artifact" recorded under Decided not to build with the copies
  reasoning; the compaction item gains the file and thread collection as part of the
  same job.

## Testing

Pure, under `node`: `client/src/agent/tabs.test.js` (the three filter states, orphans
excluded, `nextActive` in all four cases), `target.test.js` (the focus rule),
`server/media.test.js` (the copy's naming and sidecar) and `server/host.test.js` (the
copy route).

In the browser, by hand: the strip in all three selection states; the active tab
surviving and not surviving a re-filter; the ring following the active tab and
disappearing on close; Add to <title> appearing and the composer's To line matching;
paste of a page producing a second file and an edit on one leaving the other; deleting
a page hiding its tabs and Cmd-Z bringing both back; the confirm dialog only when its
thread is running, cancel leaving the whole selection, confirm stopping the turn.

## Left open, deliberately

- **Compaction** — journal squash plus collecting unreferenced files and orphaned
  threads, as one job (section 4). Designed when it is built, not here.
- **Renaming a thread, reordering tabs** — the title is the artifact's; a canvas thread
  is "Canvas". Not asked for.
- **Codex sessions**, **the motion asset**, **rate-limit UX** — as slice 2 left them.
