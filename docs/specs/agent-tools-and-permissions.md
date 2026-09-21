# The agent gets the provider's own tools, behind a permission it asks for

## Problem Statement

The agent inside Unframed can only touch the canvas. It cannot read a file on the
person's machine, cannot open an image they want to work from, and cannot run anything.
When someone says "read the latest file in my Downloads, it's called the pour icon", the
agent answers that it has no filesystem access — which is true, and useless.

That limitation is deliberate: `server/agent.js` passes `tools: []`, `allowedTools` of
only the six `unframed` MCP tools, `settingSources: []`, and a `canUseTool` that denies
anything else. It was the right call while there was nowhere to ask a person for
permission, because the alternative was an agent with unprompted shell access on their
own subscription.

Three further things are missing or broken, all in the same place:

- **There is no way to hand the agent an image.** The composer takes text only. A person
  who wants a logo turned into a page has no way to give it to the agent.
- **A failed turn tells the person nothing.** `agent.js` builds its answer as
  `text || msg.result || ''`, but the SDK's `SDKResultError` has no `result` field at
  all — only the success variant does — so every agent failure renders as an empty reply
  and a generic "The agent reported an error." The field that names the failure,
  `subtype`, is never read. Observed in production on 2026-09-21: a turn failed with
  `stop_reason: "tool_use"` and the person saw a blank message.
- **A turn that dies with the process is `running` forever.** Thread status is a field in
  a JSON record and nothing reconciles it at boot. Sessions live in a module-level Map
  and cannot outlive the process, so quitting the app mid-turn leaves a thread whose
  record says `running` for good: the panel shows a phantom turn in flight, and
  `findChatFor` skips it, so the composer silently starts a new chat instead of
  continuing that one. Observed in production the same evening.

The 100 seconds of apparent silence in that production incident was probably the API
retrying: the SDK emits `{ type: 'system', subtype: 'api_retry' }` with the attempt,
the delay and the error status, and the session's message switch drops everything that
is not `subtype === 'init'`. A retrying request is indistinguishable from a model
thinking quietly.

## Solution

Unframed stops disabling what the provider CLI already has, and builds the one thing
that made disabling it necessary: a permission the person is actually asked for.

This follows `t3code` (`github.com/pingdotgg/t3code`, MIT), which is where the behaviour
people like comes from. It is worth being precise about what `t3code` does, because it
is less than it appears: its Claude adapter passes **no** `tools`, `allowedTools` or
`disallowedTools` at all. The Read, Write, Bash, Glob and Grep the person values are
Claude Code's own; `t3code`'s contribution is the approval experience around them — a
runtime mode the person picks, and a permission request surfaced in the UI. There is no
tool implementation to port. There is a permission round-trip to build.

Concretely, from the person's side:

- A chat can be set to one of four **runtime modes** — plan, accept edits, auto, full
  access — chosen per thread and changeable mid-conversation.
- When the agent wants to do something the mode does not already allow, a **permission
  request** appears in the agent panel naming the tool and what it will touch. The turn
  waits. Allow or deny, once or for the rest of the thread.
- The agent can **read and write files, run commands, and search** — the provider's own
  tools — alongside the six `unframed` canvas tools, which stay auto-approved because
  they are already scoped to the project.
- A person can **attach images and files** to a message, by button, drag or paste.
- A failed turn **says why**.
- A thread the app was quit on **says that**, and can be continued.

## User Stories

1. As a person using Unframed, I want to ask the agent to read a file on my machine, so
   that I can work from something that is not already on the canvas.
2. As a person, I want to paste an image into the composer, so that I can say "make a
   page from this logo" without first adding it to the canvas.
3. As a person, I want to drag a file onto the composer, so that attaching does not
   require finding a button.
4. As a person, I want to attach several files to one message, so that I can give the
   agent a set to work from.
5. As a person, I want a file whose type my browser did not report (a drag from another
   app, a file piped through a shell) to still be recognised as an image, so that a plain
   `photo.jpg` is not silently downgraded to a generic attachment.
6. As a person, I want an attachment that is too large to be refused with its size and the
   limit, so that I know whether to shrink it or split the request.
7. As a person, I want the agent to see my attached image as an image, so that it can
   describe or reason about what is in it rather than only knowing a path.
8. As a person, I want my attachments stored outside my project folder, so that uploading
   something does not add a file to the work I am organising.
9. As a person, I want to choose how much the agent may do without asking, so that a
   throwaway experiment and a careful edit do not need the same amount of supervision.
10. As a person, I want plan mode, so that the agent can tell me what it would do before
    it does any of it.
11. As a person, I want accept-edits mode, so that file edits proceed but commands still
    ask.
12. As a person, I want auto mode, so that ordinary work proceeds and only the dangerous
    things stop me.
13. As a person, I want full-access mode, so that when I am supervising directly I am not
    interrupted at all.
14. As a person, I want the runtime mode to be a property of the chat, so that two chats
    can run at different levels of trust at once.
15. As a person, I want to change the mode mid-conversation, so that I can loosen it once
    I trust what the agent is doing.
16. As a person, I want a permission request to name the tool and what it will touch, so
    that I can decide without guessing.
17. As a person, I want to allow a request once, so that a single exception does not widen
    the whole thread.
18. As a person, I want to allow a kind of request for the rest of the thread, so that I
    am not asked twenty times for the same thing.
19. As a person, I want to deny a request and have the agent told, so that it can try
    another way instead of stalling.
20. As a person, I want the turn to visibly wait while a permission is pending, so that a
    paused agent does not read as a hung one.
21. As a person, I want a pending permission request to survive a page reload, so that
    switching tabs does not abandon a turn.
22. As a person, I want the canvas tools to keep working without asking, so that adding
    permissions does not make the thing the agent was already good at slower.
23. As a person, I want to know when the agent is retrying a failed API call, so that a
    slow turn is distinguishable from a stuck one.
24. As a person, I want a failed turn to tell me why it failed, so that I know whether to
    retry, wait, or change what I asked.
25. As a person, I want to be told when I have hit a usage limit and when it resets, so
    that I stop retrying into a wall.
26. As a person, I want a chat the app was quit on to say so, so that I do not sit
    watching a spinner for a turn that is not running.
27. As a person, I want to continue a chat the app was quit on, so that an interrupted
    conversation is not lost.
28. As a person, I want the composer to continue that chat rather than silently starting a
    new one, so that my history stays in one place.
29. As a person, I want the agent's canvas work to keep its current quality once it also
    has general tools, so that a broader agent is not a worse one at the thing I use it
    for.
30. As a person, I want the agent to still treat canvas text as material rather than as
    instructions, so that a prompt someone shared with me cannot redirect it.
31. As a maintainer, I want the permission decision to be one pure function, so that the
    mode matrix can be tested without running a model.
32. As a maintainer, I want the whole flow driveable by the scripted agent, so that agent
    behaviour is asserted in `npm test` without spending the user's quota.
33. As a maintainer, I want attachment classification to be pure and tested, so that the
    MIME-type edge cases are pinned rather than rediscovered.
34. As a maintainer, I want a stale `running` status to be reconciled on read, so that the
    class of bug cannot recur rather than being fixed once.
35. As a maintainer, I want the lifted `t3code` code to carry its provenance and its
    comments, so that the reasons survive the copy.
36. As a maintainer, I want the safety rationale in `agent.js` rewritten rather than
    deleted, so that the next reader knows what replaced it.

## Implementation Decisions

### The permission decision is a new pure module

A new module owns one question: **given a runtime mode, a tool name and its input, is
this allowed, denied, or does it need asking?** Its interface is one function returning
one of three outcomes, plus the mode vocabulary. Everything else about permissions — the
mode matrix, which tools are ours and auto-approved, which are destructive enough to ask
about even in auto mode, how a thread-scoped grant is matched on a later call — sits
behind it.

This is the deep-module shape the repo already uses for `env.js`, `presets.js` and
`jobs.js`: pure decision logic in its own file with its own test, thin I/O at the call
site. `canUseTool` becomes a thin adapter: ask the module, and on "needs asking" park the
turn and wait for the person.

The four runtime modes are `t3code`'s, mapped to the SDK's `permissionMode`:

| Unframed mode | SDK `permissionMode` |
| --- | --- |
| plan | `plan` |
| accept edits | `acceptEdits` |
| auto | `default` |
| full access | `bypassPermissions` |

The SDK enforces the mode itself; our module decides the cases the SDK hands to
`canUseTool`, and holds the thread-scoped grants the SDK does not.

### A pending permission is thread state, not session state

A permission request is written into the thread record and emitted on the thread's event
stream, the same path every other agent event takes. The answer arrives as a route call
and resolves the parked promise. This is what makes a pending request survive a reload:
a client that reconnects reads it from the record rather than from a socket it missed.

A pending request that the process dies on is reconciled the same way a `running` status
is — see below.

### The session configuration is reversed, deliberately and in one place

`tools: []`, `allowedTools` and the denying `canUseTool` go. `settingSources` opens to
`['user', 'project', 'local']` as `t3code` does. The system prompt becomes the Claude
Code preset with Unframed's existing canvas instructions **appended**, rather than
replacing it — the behaviour the person likes comes from that preset as much as from the
tools.

Three things stay, and the header comment in `agent.js` is rewritten to say why rather
than deleted:

- The `unframed` MCP server, and its six tools auto-approved.
- The init handshake check: a session whose tool list lacks ours still fails loudly.
- `CLAUDE_CONFIG_DIR` only if configured; `HOME` never overridden.

`strictMcpConfig: true` is the one genuinely contested removal. It exists because on
2026-09-05 a turn saw the user's Figma MCP tools and none of ours. Opening
`settingSources` brings the user's own MCP servers, skills and hooks back. The decision
is to open it anyway, because that is what the person is asking for and what `t3code`
does — but the init handshake check becomes load-bearing rather than belt-and-braces, and
the canvas fidelity of the broadened agent is something to measure rather than assume
(see Further Notes).

### Attachments are lifted from t3code, filtered to the slice

`t3code`'s composer is roughly 20,000 lines of source; its attachment handling is roughly
800 of them, and only the attachment slice is taken. The Tiptap document model, the draft
store, context chips, citations, banners and command menus are not.

What is taken, with provenance noted in the files:

- **Classification**, from `composerAttachmentFiles.ts`: extension-based MIME inference
  for files whose reported type is empty or `application/octet-stream`, image/file/
  unsupported-image classification, and the normalisation that gives an
  extension-recognised image a concrete type before anything else touches it.
- **Size clamping and its message**, from `client-runtime/state/attachments.ts`.
- **The store shape**, from `attachmentStore.ts` and `attachmentPaths.ts`: content-
  addressed files in a directory that is not the project folder.

The design rules taken with it, stated in `t3code`'s own docs and adopted verbatim:

- Attachments live **outside the project workspace**, so uploading does not add a file to
  the person's work. In Unframed they go beside `.env` under the data directory, which is
  already the "not the project" location and already moves with a packaged app.
- The on-disk path goes into the turn's text (`Attached image "x.png": "/path/…"`) **and**
  the file goes to the provider in its native form, so the model both sees the image and
  can dereference the path.
- `additionalDirectories` grants that one leaf directory, so reading an attachment needs
  no approval. Siblings — the key, the job store — stay ungranted.
- A path in a prompt does not grant filesystem access. Provider sandbox and approval rules
  stay in force, and uploads are never copied into the project to dodge them.

### A thread's status is reconciled against what can actually be running

Sessions cannot outlive the process. Therefore a thread whose record says `running` while
no live session exists for it is, with certainty, a thread the app was quit on. That
inference is made a pure function in `threads.js` — given a record and whether a session
is live, return the record as it should now read — and applied on the read path, so the
correction happens wherever a thread is listed or opened rather than only at boot.

A reconciled thread reads `failed` with an error naming the cause, which makes it
continuable: `findChatFor` skips `running`, not `failed`.

### The two result defects

- The answer is built from `msg.subtype` on the error branch, not from `msg.result`,
  which the error variant does not have. Each of `error_during_execution`,
  `error_max_turns`, `error_max_budget_usd` and `error_max_structured_output_retries`
  gets a sentence a person can act on.
- `system` messages with `subtype: 'api_retry'` become an event carrying the attempt,
  the maximum, the delay and the error status. Rate-limit information already arrives as
  its own event and stays.

## Testing Decisions

A good test here asserts what crosses an interface: a request in and events, a thread
record and files out. It does not assert that a callback was wired, does not render a
component to check an attribute, and does not reach past a module's interface to poke its
internals. Node components have no tests in this repo by design and that does not change;
the panel's permission UI is verified in the running app and said to be.

**The highest seam is the thread routes**, exercised by forking the real server into a
temp data directory on an ephemeral port — the `host.test.js` harness, as `agentFlow.test.js`
already uses it. Everything user-visible about the agent crosses that seam: sending a
message, the event stream, the thread record, the files on disk. New behaviour is asserted
there in preference to anywhere else.

**The scripted agent is the adapter that makes that seam deterministic.**
`UNFRAMED_TEST_AGENT_SCRIPT` already replaces the SDK while calling the real tool
handlers, real ops and real files. It gains one capability: a turn may script a
**permission request**, so the round-trip can be driven end to end — request emitted,
turn parked, answer posted, turn resumes — without a model and without quota. This is an
extension of an existing adapter rather than a new seam, which is the point.

**Pure modules are tested directly**, as `env.js`, `jobs.js` and `presets.js` are:

- the permission decision module: the mode matrix, our-tools-are-ours, once versus
  thread-scoped grants, and an unknown tool;
- attachment classification: an empty MIME type with a known extension, `application/
  octet-stream`, HEIC, an unsupported image type, a non-image, and the size clamp;
- `threads.js` reconciliation: `running` with no live session becomes failed and
  continuable; `running` with a live session is untouched; `idle` and `failed` pass
  through.

**Prior art to follow**: `agentFlow.test.js` for the route-level flow and its assert-
after-each-step shape; `agentScript.test.js` for driving fixtures against a temp
document; `jobs.test.js` for the pure-core/thin-I-O split; `agentTools.test.js` for
asserting that the agent is actually *told* something in a tool description.

**One claim cannot be tested deterministically and is stated as such**: that the agent's
canvas work stays good once it also has general tools. That is a real model on real
turns, and it is Matteo's to judge (see Further Notes).

## Tasks

Each is a vertical slice that can go red then green on its own.

1. A failed turn reports its reason. Seam: the thread routes — a scripted turn that fails
   yields a `result` event and a thread record whose error names the failure, not an empty
   string.
2. A retrying API call is visible. Seam: the thread routes — a scripted `api_retry`
   becomes an event carrying attempt, maximum and delay.
3. A thread left `running` with no live session reads as failed. Seam: `threads.js`
   reconciliation, pure.
4. That reconciliation applies on the read path, and the chat can be continued. Seam: the
   thread routes — restart the forked server mid-turn, list threads, send again.
5. The permission decision answers allow for our own tools in every mode. Seam: the
   permission module, pure.
6. It answers ask, deny or allow per runtime mode for a provider tool. Seam: same.
7. A thread-scoped grant makes a second identical request allow without asking. Seam: same.
8. A thread carries a runtime mode, settable at creation and changeable mid-conversation.
   Seam: the thread routes.
9. The scripted agent can script a permission request. Seam: `agentScript.test.js`.
10. A permission request parks the turn and reaches the event stream. Seam: the thread
    routes.
11. Answering allow resumes the turn and the tool runs. Seam: the thread routes.
12. Answering deny resumes the turn and the agent is told. Seam: the thread routes.
13. A pending request is readable from the thread record after a reconnect. Seam: the
    thread routes.
14. A pending request whose process died is reconciled like a stale `running`. Seam: the
    thread routes.
15. The session runs with the provider's own tools and the preset system prompt, with the
    `unframed` server still present and its tools still auto-approved. Seam: the thread
    routes — the init handshake still fails loudly when ours are missing.
16. Attachment classification handles the MIME-type edge cases. Seam: the attachment
    module, pure.
17. An oversized attachment is refused with its size and the limit. Seam: same.
18. An upload is stored outside the project folder and addressable by path. Seam: the
    attachment routes.
19. A turn carrying an attachment puts its path in the text and the file in the provider's
    native input. Seam: the thread routes.
20. The attachments directory is granted and its siblings are not. Seam: the thread routes
    — assert the granted directory list, not the filesystem.
21. The composer attaches by button, drag and paste. Seam: the running app; no component
    test, verified by hand and reported.

## Out of Scope

- **Porting `t3code`'s composer.** The Tiptap editor, draft store, context chips,
  citations, banners, stash menu, command menu and prompt history are not taken. Unframed's
  composer stays a plain field that grows an attachment row.
- **Becoming a fork of `t3code`.** Decided explicitly: Unframed keeps its own engine,
  canvas, graph and generation pipeline, and lifts agent-side solutions rather than
  adopting the product.
- **Re-founding threads on an event log.** `t3code` is event-sourced end to end and
  Unframed's canvas already is, but its threads are not, and converting them is a larger
  change than this spec. Reconciliation solves the observed bug without it.
- **Other providers.** Codex is detected and runnable today; the permission round-trip is
  specified against the Claude adapter first. Codex's equivalent is a follow-up, and the
  permission module's interface should not assume one provider.
- **Checkpointing.** `t3code` ends every turn with a hidden git ref so work can be diffed
  and restored. Unframed has undo through its own journal and does not need this.
- **Terminal, SSH, tunnels, mobile, remote environments.** All present in `t3code`, none
  in scope.
- **A curve editor, keyframes, or anything about motion.** Unrelated work in flight on
  another branch.

## Further Notes

**This spec reverses a documented rule, on purpose.** `CLAUDE.md` currently says the
agent has no built-in tools and that this is never relaxed by touching `tools`,
`canUseTool` or `settingSources`. Matteo decided on 2026-09-22 to relax exactly that. The
rule is not deleted quietly: it is rewritten in the same commit that changes the code, so
the file never describes a state the code is not in.

**The sourcing rule this work is the first instance of.** `CLAUDE.md` gained a rule on
2026-09-22 — take the solved problem, write the part nobody else has — with three guards:
take the slice not the tree, bring the comments that explain the shape, and refuse a
reciprocal licence. `t3code` is MIT, its notice is kept, and lifted chunks carry a comment
naming where they came from.

**A precondition.** The scripted agent (`agentScript.js`) and the route-level flow test
(`agentFlow.test.js`) are the seams this spec tests almost everything at, and they exist
only on the `chats-tags` branch — PR #67, open and mergeable, awaiting hands-on testing.
On `main` there is no way to assert agent behaviour without spending real quota on a
non-deterministic turn. Either #67 merges first and this branches off `main`, or this
branches off `chats-tags`. Starting on `main` as it stands means tasks 1, 2, 4 and 9–20
have no seam to be tested at.

**An open question for the person, not the implementation.** Whether the agent's canvas
work holds up once it is also a coding agent. The preset system prompt is what makes
"read my Downloads" behave well, and the canvas instructions become an appendix to it
rather than the whole brief. This cannot be settled by a test; it wants a few real turns
on a real board, comparing against what the canvas-only agent does today. Worth doing
after task 15 and before the attachment work, since a bad answer there changes what the
rest is for.
