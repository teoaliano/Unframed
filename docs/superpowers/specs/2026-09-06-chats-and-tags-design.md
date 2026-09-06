# Chats with tags, and the selection as context

**Written 2026-09-06**, from a grilling session in which every decision below was put to
Matteo and chosen. Cited by `server/threads.js`, `client/src/agent/tabs.js`,
`client/src/toolbar/target.js` and `docs/agent.md`.

Slices 1–3 built the agent around one assumption: **a thread is about one thing.** It had
a `kind` (`canvas` or `artifact`) and an `artifactId`, the composer worked out a `target`
from the selection, and the reply appeared in a card anchored on the node that was worked
on. That assumption is what this design removes, and everything here follows from removing
it.

It broke in four places at once, all of them the same break:

- **Two motions selected had no target.** The composer said "2 artifacts selected — pick
  one", which is a mode picker asking the person to do the agent's job. "Stitch these" is
  not ambiguous to a reader; it was only ambiguous to a data model with one `artifactId`.
- **A card has one anchor.** An answer about two nodes cannot be pinned below one of them,
  and "which of these two is this reply about" has no answer.
- **A chat about a deleted node vanished.** The strip hid it, because a thread bound to a
  node that is gone looked like clutter. The conversation may be the only record of why
  the thing was made.
- **`bindArtifact` bound once, on create.** A chat that spent ten turns rewriting an
  existing page was tagged with nothing.

## The decisions

1. **A thread is a chat, not a thing about an artifact.** It is **tagged** by the
   artifacts (pages, motions) selected at its first message and by every artifact the
   agent writes to, created or updated. Tags are **pointers, never dependencies**:
   deleting every file a chat touched leaves the chat intact, and a stale tag simply stops
   matching. There is therefore no confirmation when deleting an artifact the agent is
   mid-turn on — the write fails and the agent says so. The confirmation was protecting a
   binding that no longer exists, and it turned deleting a node into a question about a
   conversation the person may not even have open.

2. **The selection is context; the agent decides what a message means about it** — the
   same edit to all of them, an edit to one, a different edit to each, a new asset made
   from them, or a question. It asks in its reply only when the sentence is genuinely
   ambiguous, and never asks which *mode* was meant. Mixed kinds are normal and inputs
   among the selection are material. A new asset made from several is made of **copies**,
   so the originals are untouched; a linked "sequence" is a later, opt-in feature. The
   agent never changes what is selected.

3. **The strip** shows every chat with nothing selected, else the chats tagged with **any**
   selected artifact. A tab reads the person's name for the chat, else the name the agent
   writes **once** after the first turn, else the opening words of the first message.

4. **Every artifact the active chat has touched wears the focus mark** — not one of them.

   **Revised 2026-09-06, after testing.** The row above the composer first listed the
   chat's *tags* as chips, next to a selection count. Both were chips, in one row, in the
   same shape — while answering two different questions ("what has this chat touched" and
   "what is attached to this message"), and the result read as noise rather than as either
   answer. So they are separated by *where* they live:

   - **The row above the composer is the live selection**, named, one chip per artifact
     plus a count of the rest. This is the conventional "what is attached to this message"
     row, it changes as you click around the canvas, and it carries no Locate — a selected
     node is one you have just pointed at.
   - **What the chat has touched is a recap card at the foot of the transcript**, after the
     last message: a header with the file count and a Hide/Show toggle, then one row per
     artifact with its node icon, Open and Locate. Modelled on T3 Code's changed-files
     card, minus the diff, because here what matters is *which* things were involved rather
     than by how much.

   Reads and writes are **not** distinguished in that card. The question it answers is what
   the conversation involved; splitting a small card into changed-versus-merely-read made
   it an argument rather than a summary.

   The focus mark still follows the chat's tags, and is now the *only* thing on the canvas
   that says so — which is the job it was always doing, no longer competing with a chip row
   saying the same thing in words.

5. **The toolbar card only starts a chat.** Send opens the panel on that chat and the reply
   lives there. The anchored reply card is removed, and so is "Add to \<page\>". The
   composer continues the newest idle chat tagged with **every** selected artifact, else
   starts one, and says which before you type, with a toggle.

6. **Change lines in the panel** say what changed, expand to the artifacts touched (each
   with Open and Locate), and carry Undo on the most recent change while it is still what
   Cmd-Z would revert next. A bulk edit is one undo step. After an undo the line reads
   "Undone". **No chat message is written for an undo** — a message would claim the agent
   said something it did not.

7. **The agent is told what changed** since its last turn, in the next message's preamble,
   and keeps its rule to read before acting.

8. **The editor** replaces the canvas while open (unmount, not overlay; the viewport is put
   back on close): three columns — the panel filtered to this artifact, the artifact, its
   parameters. Pages get it too. The timeline is read-only first.

## Two rules that look like one and are not

The strip is **any-of**; the composer's continue rule is **all-of**. They answer different
questions and must not be merged:

- The strip answers "what has been said about these?" — a chat about either is relevant.
- Continuing answers "may this message join that conversation?" — a chat that never saw B
  must not answer a message about A **and** B, or it carries over an answer built without
  half the subject.

`findChatFor` (server) and `continuableChat` (client, for the label the composer shows
before you type) are the same rule in two places on purpose: rendering that label from the
server would be a request per keystroke.

## Why the recap is derived, not stored

The card lists what a chat **read or changed**; the record's `tags` list what it *touched
by writing* (plus the artifacts selected at its first message). They are deliberately not
the same set, because they answer different questions: `tags` decide which chats the strip
shows for a selection, and a chat that read a file once should not thereby be filed under
it forever.

So `touchedArtifacts` (`client/src/agent/tabs.js`, tested) folds the card out of the events
the record already stores — `input.nodeId` on the artifact tools for reads and updates,
`page.nodeId` and `artifacts` on `ops_applied` for writes. Nothing new is persisted, and a
reopened chat rebuilds the card from its replay exactly as the live turn built it.
`canvas_read` contributes nothing: it reads the whole board, it is the first thing every
turn does, and listing everything would bury what the turn was actually about.

## Why `titledBy` exists rather than one `title` field

The agent names a chat after its first turn; the person can rename a tab at any time. A
single field cannot express "the person has spoken, stop guessing", and the two orders
must both end with the person's name winning — an agent title arriving after a rename has
to lose, and a rename after an agent title has to win. `titledBy: 'user' | 'agent' | null`
is the smallest thing that survives both orders. Clearing a name drops the credit with it,
so the agent may name the chat again.

Naming costs one small request on the person's own plan per new chat, with no tools and
one turn, and it happens **after** the turn is settled and broadcast — a reply must never
wait behind a label. Any failure is silent: the tab falls back to the opening words, and
an error about a label would be worse than the label being missing.

## Why the scripted agent is part of the design, not scaffolding

Every claim above spans several modules — that a bulk edit is one undo step, that a tag
survives deleting the node it names, that the next turn is told about an undo of its own
change. A unit test of any one module cannot see those, and a real turn can see them once,
expensively, and never the same way twice. So `UNFRAMED_TEST_AGENT_SCRIPT` (unset in a
clone, the same marker rule as `UNFRAMED_DATA_DIR`) replaces **the model and nothing else**:
`server/agentScript.js` runs the real Session, the real tool handlers and the real
document from a JSON script, emitting the same events. `server/agentFlow.test.js` is the
acceptance test built on it.

A fixture can assert the preamble it received (`expectPreamble`), which is what makes
decision 7 checkable **from the agent's side**: drop the change note and the turn fails,
rather than a log line quietly changing shape.

## Rejected

- **A mode picker** ("same edit to all / one of them / a new asset from these"). It asks
  the person to classify a sentence they have already written. The agent reads the
  sentence; where it truly cannot tell, its reply asks — in words, in context, once.
- **Several selected → a new asset by default.** Guesses the least reversible of the
  intents. "Make these both red" would have made a third thing.
- **Hiding the chats of deleted artifacts.** Loses the record of why something was made
  precisely when it is most wanted. A greyed chip costs one line of CSS.
- **A chat message per undo.** Puts words in the agent's mouth. The change line reads
  "Undone", which is a fact about the change, said where the change is.
- **Tag chips and the selection count sharing the composer row** (the original decision 4).
  Two questions, one shape, one row: it read as neither. See the revision above.
- **Splitting the recap into "Changed" and "Read".** More precise and less useful: it turns
  a two-line summary into a taxonomy, and the per-change blocks above it already say what
  each change did.
- **A dedicated `sequence` node linking several motions** instead of copies. Deferred: it
  needs a story for what happens when a member changes, and copies need none.
