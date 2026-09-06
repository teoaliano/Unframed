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
   The row above the composer lists the chat's tags as chips with Locate (a stale one
   greyed, with no Locate) plus the live selection count.

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
- **A dedicated `sequence` node linking several motions** instead of copies. Deferred: it
  needs a story for what happens when a member changes, and copies need none.
