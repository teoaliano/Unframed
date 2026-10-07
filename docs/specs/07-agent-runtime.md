# 07 · Agent runtime

Depends on: 01, 02, 03, 04, 05, 06

## Problem Statement

A person working on the canvas wants to hand part of the work to a coding agent they already pay for: "turn these three stills into a landing page", "stitch these two motions", "make every title red", "read the brief in my Downloads and lay the board out from it". Unframed must run that agent on the person's own Claude or Codex subscription, through the CLI they installed and signed into, without ever holding a credential of theirs.

The agent has to see the canvas as data, change it in ways the person can take back, write pages and motions as files in the project, and use the provider's own tools (files, shell, search) behind approvals the person controls. Every conversation has to survive a closed tab, a quit app and a restart, and it has to be testable without spending anyone's quota.

This spec is the engine half: providers, sessions, the chat store, the canvas tools, permissions, attachments, turn revert, the scripted agent and the turn sidecar. Spec 08 builds the chat rail and the Agent tray on top of it.

## Solution

The engine detects Claude and Codex on the machine and reports one of five statuses for each. A chat runs on one of them through t3code's provider adapter pattern: one adapter per provider translates the provider's native protocol into one set of canonical runtime events. The Claude adapter drives the Claude Agent SDK with a streaming prompt, Claude Code's own tools and system prompt, and Unframed's instructions appended. The Codex adapter drives `codex app-server` over JSON-RPC. Both adapters reach Unframed's canvas tools through one MCP server the engine hosts on loopback.

Chats are stored the way t3code stores threads: commands go through a pure decider, which emits events; a projector folds events into read tables; the events, the projections and the command receipt commit in one transaction in the project database (spec 01's `unframed.sqlite`). Reactors do the side effects (start a provider turn, ingest runtime events, name the chat, tag it, write the sidecar) and report back through more commands.

The canvas tools read and write the project's tldraw document through the sync room. A `canvas_write` call is one batch and one step of its turn. Every change a turn makes is recorded with its inverse, so the recap card can offer "Revert this turn", which skips any shape the person has edited since and says which.

Permission modes are t3code's, unchanged: Supervised, Auto-accept edits, Auto and Full access, default Full access, with plan as a separate interaction mode. Attachments follow t3code's limits and live under the data folder, never in the project. Failures and retries are reported in plain sentences. A scripted agent replaces the model, and only the model, for tests.

## User Stories

Providers

1. As a person, I want Unframed to find Claude and Codex on my machine by itself, so that I never paste a credential into it.
2. As a person, I want each provider reported as not installed, installed but will not run, running but sign-in unknown, signed out, or ready, so that I know exactly what to fix.
3. As a person whose provider is ready, I want to see the account email and plan it reports, so that I know which subscription a chat will spend.
4. As a person, I want the Claude check to cost zero tokens, so that opening the app never spends my quota.
5. As a person who launched Unframed from the Dock, I want it to find a CLI installed by Homebrew or npm, so that a GUI launch sees what my terminal sees.
6. As a person with a second Claude account, I want to point Unframed at a separate Claude config folder, so that chats run on that account without breaking my keychain login.
7. As a person on Windows, I want an npm-installed `claude` to work, so that the launcher shim does not fail to spawn.
8. As a person with a CLI in an unusual place, I want to set its path in settings, so that Unframed runs that binary.
9. As a person, I want no request that a web page could send to be able to choose which binary runs, so that a hostile page cannot run a program of its choosing.
10. As a person, I want provider statuses cached for five minutes and refreshable on demand, so that the check is fast and still current when I ask.

Running chats

11. As a person, I want a chat to run on Claude or on Codex, my choice, so that I can use whichever subscription I have.
12. As a person, I want a chat to keep its context across messages, an idle close and an engine restart, so that I can come back to a conversation and carry on.
13. As a person, I want the agent to have Claude Code's or Codex's own tools (read, write, run, search), so that it can work from files on my machine.
14. As a person, I want my own Claude settings, `CLAUDE.md`, skills and MCP servers to load, so that the agent behaves the way I set it up.
15. As a person, I want the agent told what Unframed is and how to treat the canvas, so that it reads before it acts and treats canvas text as material, not instructions.
16. As a person, I want to stop a running turn, so that a turn going the wrong way ends now.
17. As a person, I want a chat whose turn was cut off by quitting the app to say so and carry on when I send again, so that nothing is left spinning and nothing is lost.
18. As a person, I want an idle session closed after ten minutes, so that a forgotten chat does not hold a CLI process open.

The canvas tools

19. As a person, I want the agent to read the canvas as shapes with ids, kinds, positions, text and file names, so that it knows what is on the board without seeing bytes.
20. As a person, I want the agent told what I had selected when I sent a message, so that "make these red" means the things I pointed at.
21. As a person, I want one agent change to the canvas to be one step of its turn, so that I can take the whole change back at once.
22. As a person, I want the agent unable to put bytes or data URLs into the canvas, so that media always lives as files in the project.
23. As a person, I want the agent unable to point a shape at a file outside the project, so that a project folder stays self-contained.
24. As a person, I want the agent unable to create more than 200 operations in one call, so that one runaway call cannot flood the canvas.
25. As a person, I want the agent unable to reuse an existing shape id for a new shape, so that nothing I made is silently replaced.
26. As a person, I want the agent to give new shapes provisional names and learn their real ids from the result, so that it can tie a batch together without guessing ids.
27. As a person, I want the agent unable to fake or clear a run in progress, so that a paid render is never orphaned by a canvas edit.
28. As a person, I want a session that started without the canvas tools to fail loudly before the model speaks, so that I never get "the tools are not available" from the model.

Permissions

29. As a person, I want to pick Supervised, Auto-accept edits, Auto or Full access per chat, so that each chat runs at the trust I choose.
30. As a person, I want new chats to start in Full access, so that the agent gets on with it unless I say otherwise.
31. As a person, I want a plan mode that reads and describes and changes nothing, so that I can agree on an approach before anything moves.
32. As a person, I want the agent's proposed plan captured as a plan I can implement, so that plan mode ends in something I can act on.
33. As a person, I want to accept a request once, accept it for the rest of the session, decline it, or cancel the turn, so that I answer exactly as broadly as I mean.
34. As a person, I want a request to survive a reload, so that reopening the rail shows what the agent is waiting for.
35. As a person, I want to change the mode mid-turn and have it apply to the next tool call, so that I can tighten a chat while it works.
36. As a person, I want Unframed's own canvas tools never to ask, so that the thing the agent is good at stays fast; they are already scoped to this project and every change is revertable.
37. As a person using Codex, I want the same four modes to map onto Codex's sandbox and approval settings, so that the words mean the same on both providers.
38. As a person, I want the agent to be able to ask me a question and wait for my answer, so that it does not guess.

The chat record

39. As a person, I want every chat stored in the project folder, so that copying the project copies its conversations.
40. As a person, I want a chat named by the agent after its first turn, so that tabs say what each conversation is about.
41. As a person, I want a name I type to win over the agent's, in either order, so that my label sticks.
42. As a person, I want clearing a name to let the agent name the chat again, so that I can undo a rename.
43. As a person, I want a chat tagged with the artifacts I had selected at its first message, so that selecting an artifact finds the chats about it.
44. As a person, I want a chat tagged with every artifact the agent writes or edits, including through a plain canvas edit, so that the tags are honest about what the chat touched.
45. As a person, I want deleting an artifact to leave the chats about it intact, so that the conversation survives as the record of why it was made.
46. As a person, I want each chat to remember its provider, model, traits, runtime mode and interaction mode, so that the next message runs the way the last one did.

Context each turn

47. As a person, I want the agent told when the canvas changed since its last turn, by me, by another chat or by a revert, so that it re-reads instead of acting on a stale board.
48. As a person, I want attachments named in the message the agent reads, by path, with images sent to the model natively, so that it can both look at a picture and open the file.

Attachments

49. As a person, I want to attach up to 100 files to one message, so that I can hand the agent a set.
50. As a person, I want an image over 10 MiB, images totalling over 80 MiB, or any file over 50 MiB refused with the size and the limit, so that I know what to shrink.
51. As a person, I want a HEIC photo converted so the model can look at it, so that phone pictures just work.
52. As a person, I want attachments stored outside the project, so that talking about a file does not add it to my work.
53. As a person, I want the same file attached twice stored once, so that re-sending does not fill my disk.

Revert

54. As a person, I want to revert everything one agent turn did to the canvas, so that I can take back one turn without touching the others.
55. As a person, I want a revert to leave alone any shape I edited since that turn, and tell me which ones it skipped, so that reverting never destroys my own later work.
56. As a person, I want a reverted page or motion to point back at its previous file, so that the older version comes back exactly.
57. As a person, I want the agent told on its next turn that one of its turns was reverted, so that it does not rebuild what I took back.

Failures and limits

58. As a person, I want a failed turn to say why in a plain sentence, kept below whatever the agent had already written, so that I know what to do next.
59. As a person, I want to see when the provider is retrying a busy API and which attempt it is on, so that a slow turn does not look dead.
60. As a person, I want to be told when I hit my usage limit and when it resets, and warned when I am close, so that I know whether to wait.

Records and tests

61. As a person who sums spend from sidecars, I want every agent turn to leave a sidecar marked `billing: "subscription"` with no `cost` field, so that my totals are never corrupted by a zero.
62. As a developer, I want a scripted agent that replaces the model and nothing else, so that a whole turn, with real tools, real canvas writes and real permission decisions, runs in milliseconds and the same way every time.
63. As a developer, I want the scripted agent reachable only through a test environment variable, so that no request can turn it on.

## Implementation Decisions

### Modules

| Module | Where | Interface | Depth |
| --- | --- | --- | --- |
| Provider detection | domain (rules) + engine (spawning, probes, cache) | `status(provider, {refresh})`, `runEnvironment(provider)` | deep: five statuses, PATH, HOME, shims, probes behind two calls |
| Provider service and adapters | engine | the adapter interface below; the service routes by provider | deep: each adapter hides a whole native protocol |
| Chat store | domain (decider, projector) + engine (event store, projections, reactors) | `dispatchCommand`, `subscribeShell`, `subscribeThread` | deep, t3code's shape |
| Unframed MCP server | engine | an MCP endpoint with the two canvas tools; spec 09 adds its four artifact tools and the preview tools to the same server | shallow transport over the tool services |
| Canvas tool service | domain (batch preparation) + engine (room writes) | `read`, `write` | deep: the op vocabulary, refusals, tags, turn changes |
| Turn changes and revert | engine | `record(chatId, turn, before, after)`, `revert(chatId, turn)`, reading spec 02's canvas change log through `changedSince` | deep: the skip rule lives here |
| Permission policy | domain | `decide({runtimeMode, interactionMode, tool, input}) -> allow \| deny(message) \| ask(requestType)`, plus the two mode mappings | deep, pure |
| Attachments | domain (classification, limits) + engine (store) | `classify`, `check`, `store`, `resolve` | small |
| Scripted adapter | engine | the adapter interface | an adapter like the others |

The seams: the adapter interface (real Claude, real Codex, scripted), the MCP endpoint (both CLIs, and tests), and the sync room (tabs and the canvas tool service both write through it).

### Provider detection

A deep module with a small interface: `status(provider, {refresh})` returns a provider status, and `runEnvironment(provider)` returns the environment and executable a session must use. Its pure half lives in `domain` (classification, PATH merging, shim following, `codex login status` parsing, model list merging); its I/O half lives in the engine.

Status shape, one per provider (`claude`, `codex`):

| Field | Meaning |
| --- | --- |
| `kind` | `claude` or `codex` |
| `name` | `Claude` or `Codex` |
| `status` | `not_installed`, `wont_run`, `auth_unknown`, `signed_out`, `ready` |
| `installed` | boolean |
| `version` | the first `N.N.N` (with an optional `-suffix`) found in `--version` output, or null |
| `message` | a sentence for every status except `ready` (table below) |
| `auth` | on `ready`: `{email?, plan?}` |
| `models` | on `ready`: the model rows (below) |
| `install` | the install page: Claude `https://claude.com/product/claude-code`, Codex `https://developers.openai.com/codex/cli` |
| `checkedAt` | ISO time of the check |

The executable path is never sent to the web.

Classification, in order:

1. Spawning `<binary> --version` fails with ENOENT: `not_installed`, "Claude is not installed or not on PATH." (Codex the same with its name).
2. It times out (5 s): `wont_run`, "Claude is installed but timed out while starting."
3. Any other spawn failure: `wont_run`, "Claude is installed but failed to run (<code>)."; a non-zero exit: `wont_run`, "Claude is installed but failed to run."
4. The auth probe says signed in: `ready`.
5. The probe says nobody is signed in: `signed_out`, "Claude is installed but not signed in. Sign in with `claude login`, then check again." (Codex: `codex login`).
6. Anything else: `auth_unknown`, "Claude runs, but Unframed could not verify who is signed in."

The Claude probe costs zero tokens. It starts an Agent SDK query whose streaming prompt never yields a message, with no setting sources, no tools, default permission mode and session persistence off, waits up to 15 s for the initialization result, reads the account from it, asks the same handshake for the supported models (still a control request, not a prompt), then aborts and closes. Signed out is claimed only when the account has no email, no subscription type, no API key source and no token source. The plan is the subscription type, else "API key" when an API key source is reported. Any error or timeout is `auth_unknown`, never `signed_out`.

The Codex probe runs `codex login status` (8 s timeout). "Logged in using <x>" is ready with plan `<x>` (a leading "a " or "an " dropped). "Not logged in" is signed out. Anything else is `auth_unknown`, because guessing signed out would tell a signed-in person to sign in. Codex models come from the app-server's model list (see the Codex adapter) and are fetched when a Codex status is ready.

The run environment:

- **PATH is hydrated from the login shell.** Once per engine process, run `$SHELL -lc 'echo "$PATH"'` (`/bin/sh` when `SHELL` is unset, 4 s timeout, last non-empty line of output). The process's own PATH entries stay first; the shell's are appended without duplicates. Skipped on Windows. Probes and sessions use the same hydrated environment, so a probe can never call a CLI ready that the session then cannot spawn.
- **HOME is never overridden.** A separate Claude account is expressed only as `CLAUDE_CONFIG_DIR` (set when the setting is non-empty). A missing HOME is filled from the OS; a present one is never touched. Overriding HOME moves the macOS keychain lookup and the CLI then reports "Not logged in" for a signed-in person.
- **Windows shims are followed.** On Windows a bare name is looked up on PATH with PATHEXT. When it resolves to a `.cmd`, `.bat` or `.ps1` launcher, the package entry beside it is used instead: for Claude `node_modules/@anthropic-ai/claude-code/bin/claude.exe`, else `node_modules/@anthropic-ai/claude-code/cli.js`. If nothing is found the bare name is spawned so the failure reads as ENOENT.
- **A binary path arrives only through settings.** `CLAUDE_PATH`, `CODEX_PATH` and `CLAUDE_CONFIG_DIR` are `.env` settings (spec 01's settings rules and validators: no shell metacharacters in the paths, an absolute config dir, an empty value deletes the line). No RPC method, command or route that starts or runs a chat accepts a path.
- **`pathToClaudeCodeExecutable` is always passed** to every Agent SDK query, probe and session alike, set to the resolved executable. The packaged app ships the SDK without its bundled native CLI, so a query that relies on the bundled one fails.

Caching: each provider's status is cached for 5 minutes. `refresh: true` re-checks. Saving any of the three provider settings forgets the cache for that provider.

Claude model rows: `{id, name, description, efforts, legacy}`. The SDK's supported models come first, named from a static catalogue (in assets) by id or alias; a `[1m]` suffix is the 1M-context variant and its name gets " · 1M". The SDK's `default` row is dropped because it aliases another row. Then every catalogue model the SDK did not report follows, with the full effort list `low, medium, high, xhigh, max`. An empty model setting on a chat means the first non-legacy row.

RPC: `providers.getStatuses {refresh?: boolean, projectId?: string} -> {claude: ProviderStatus, codex: ProviderStatus}`. With `projectId`, the skills include that project's own (`<project folder>/.claude/skills`, Codex's `skills/list` for its folder).

### The Unframed MCP server

One MCP server, hosted by the engine over streamable HTTP on loopback, is how both adapters reach the canvas tools (the way t3code exposes its own tools to every provider). It is a plain HTTP route on the engine's origin and keeps every loopback check from contract 1. It also requires a bearer token: each provider session gets a fresh 256-bit token bound to one project and one chat, revoked when the session closes. A request without a valid token is refused with 401 before any tool runs. The CLI clients send no `Origin`; a request that does send a non-loopback `Origin` is refused as everywhere else.

Claude sessions get it as an `http` MCP server named `unframed` with an `Authorization: Bearer <token>` header. Codex sessions get it through `-c` config overrides naming the URL and a `bearer_token_env_var` whose variable the engine sets in the app-server's environment.

This spec builds the server with two tools, `canvas_read` and `canvas_write` (provider-side names `mcp__unframed__<name>` on Claude). It does not build the artifact tools: spec 09 adds `page_write`, `page_read`, `motion_write` and `motion_read`, and the preview tools, to this same server. Their descriptions are model-facing text: use the `canvas_read` and `canvas_write` text in `assets/prompts/tool-descriptions.md`; the artifact and preview tools' text is spec 09's.

**The init handshake is load-bearing.** A Claude session's initialization lists its tools. The required list is every tool the Unframed server registers, so it is the two canvas tools in this spec and grows to include the artifact and preview tools when spec 09 registers them. If any required `mcp__unframed__*` name is missing, the turn fails before the model speaks with: "The agent session started without the canvas tools (<missing names>). This is a bug in Unframed, not your setup." A Codex session checks the MCP server's startup status the same way. Tools from the person's own MCP servers are allowed and reported on the session event as `foreign`, never refused.

Every tool result is JSON text. A refusal is `{"error": "<sentence>"}` marked as an error result. No tool ever returns bytes.

### Canvas tools over the tldraw document

The tools read and write the project's canvas through its sync room (spec 02), server-side, so every open tab sees an agent change at once. A deep module, the **canvas tool service**, sits behind the MCP handlers: `read(chat)` and `write(chat, turn, ops)`. Its batch preparation is pure and lives in `domain`. Every room write it makes goes through spec 02's `apply` with origin `chat:<chatId>`, and records its turn changes (below); spec 09's artifact tools write through the same path.

Every id the agent reads or writes is tldraw's shape id without its `shape:` prefix (the fixtures' `m1` is the room's `shape:m1`); ids the engine stores on the chat (tags, turn files, revert results, a message's selection) keep the prefix.

`canvas_read {}` returns:

- `shapes`: every shape, in z-order, as `{id, kind, x, y, w, h, parent?, ref?}` plus per kind. `ref` is the shape's `@id` on every shape that has one (every kind but a mark): a number the canvas minted, or the name a person gave it (spec 06).
  - prompt: `text`
  - image, video: `file` (a project file name), `fileName` (the original name), `aspect`, `crop` when cropped; a linked clip gives `url` (its https link) instead of `file`
  - group: `members` (ids, in their order inside the box), `recipe` when it carries standing settings (spec 06)
  - page, motion: `file`, `title`, `dials` when the shape has any saved dial values (spec 09 explains why the agent must see these)
  - result shapes also carry `recipe`, spec 03's result recipe read from the sidecar, and `running: true` while they carry spec 03's run marker
  - mark: `type` (the tldraw shape type), `text` when it has a label, `on` (the image it belongs to, by spec 03's mark rule) when it sits on one
- `selection`: the ids the person had selected when they sent the latest message, filtered to shapes that still exist.

A member's `x, y` is relative to its group, as the document holds it, and `parent` says so.

`canvas_write {ops}` applies one batch, all or nothing, as one step of the current turn. Each op is an object whose discriminator field is `type`, naming the op, beside that op's fields: `{type: "update", id, props}`. The op vocabulary:

| Op | Fields | Does |
| --- | --- | --- |
| `create` | `id`, `kind`, `x`, `y`, `w?`, `h?`, `parent?`, `props` | adds a shape. `kind` is `prompt` (`props.text`), `image` or `video` (`props.file`, or `props.url` for a clip link), `group` (`props.name`), or `mark` (`props.type` one of `geo`, `note`, `arrow`, `line`, plus that tldraw type's own props) |
| `update` | `id`, `props` | a shallow patch onto the shape's props; `null` deletes an optional key |
| `move` | `id`, `x`, `y` | |
| `resize` | `id`, `w`, `h` | media keeps its aspect lock (spec 02) |
| `delete` | `id` | deleting a group deletes its members, as on the canvas |
| `reparent` | `id`, `parent` | into a group, or `null` to take it out; spec 02's group membership rules apply |
| `rename` | `id`, `name` | renames any shape with an `@id` (a prompt, image, video, page, motion or group) exactly as the canvas does (spec 06): slugified, collision-suffixed, a page or motion retitled with the name, and every `@` reference to it rewritten in the same batch. A mark is refused with "rename: <id> has no @id to rename" |

Refused before the canvas sees the batch, with these messages:

- not a non-empty array: "ops must be a non-empty array"
- more than 200 ops: "at most 200 ops per call"
- an op that is not an object: "every op must be an object"
- an op whose `type` is `batch`: "a call is already one batch; pass the ops flat"
- an op with no `type`, or an unknown one: `unknown op type "<type>"`
- `create` with a kind outside the list: `create: unknown kind "<kind>"`; with `page` or `motion`: "create: make pages and motions with page_write and motion_write"
- `create` with no string id: `create: id must be a string (use "new:<name>" for a fresh id)`
- `create` reusing an existing id: `create: shape <id> already exists`
- `create` without numeric `x` and `y`: "create: x and y must be numbers"
- any string anywhere in `props` starting with `data:` (any case): `<op>: bytes cannot travel in shape props; name a file in the project folder instead`
- a `file` naming nothing in the project folder: `<op>: no file named "<file>" in the project folder`

Stripped, not refused: spec 03's `meta.unframed.run` and `meta.unframed.runError` (the one run marker mechanism, which specs 04, 05 and 09 share). They point at live paid runs and belong to the engine.

`new:<name>` provisional ids: every id starting `new:` is replaced by a fresh engine id everywhere the batch names it (as `id`, `parent`, or a group member). A new prompt gets its `@id` from the canvas's own id counter (spec 02), never from the agent, so an agent can never capture an existing `@` reference. Structural failures the canvas reports (a missing id, a group rule of spec 02 or 06) come back as the error. Success returns `{ok: true, ids: {"new:<name>": "<id>", ...}, clock}`, where `clock` is the room's clock after the write.

**Artifact tools.** `page_write`, `page_read`, `motion_write` and `motion_read` are spec 09's. They join this server when spec 09 lands, write through the same `apply` path with origin `chat:<chatId>`, record turn changes like `canvas_write`, and tag the chat through the tag reactor below. This spec only reserves their names in the plan-mode rule and the refusal that sends page and motion creation to them.

### Provider adapters

t3code's adapter pattern, 1:1. The chat store never knows which provider runs a chat; everything provider-specific sits behind one interface, and adding a provider means adding an adapter, never a branch in the reactors or the web.

```
ProviderAdapter = {
  provider: "claude" | "codex" | "scripted",
  capabilities: { sessionModelSwitch: "in-session" | "unsupported",
                  supportsConversationRollback: boolean },
  startSession({chatId, projectDir, modelSelection, runtimeMode, resumeCursor?}) -> ProviderSession,
  sendTurn({chatId, input, attachments, modelSelection?, interactionMode}) -> {turnId, resumeCursor?},
  interruptTurn(chatId, turnId?),
  respondToRequest(chatId, requestId, decision),
  respondToUserInput(chatId, requestId, answers),
  setRuntimeMode(chatId, runtimeMode),
  rollbackThread(chatId, numTurns),
  stopSession(chatId), hasSession(chatId), stopAll(),
  events: Stream<ProviderRuntimeEvent>
}
```

`sendTurn` while a turn is running steers it: the message joins the running turn and no new turn starts (spec 08's Steer). A **provider service** owns the adapters, routes by the chat's provider, issues the MCP token per session, keeps the resume cursor in `provider_session_runtime`, and runs the 10-minute idle close.

**Canonical runtime events** (t3code's names and fields; the subset Unframed consumes):

| Event | Payload |
| --- | --- |
| `session.started`, `session.configured`, `session.state.changed`, `session.exited` | `{state?, reason?, detail?, exitKind?}` |
| `thread.started` | `{providerThreadId}` (updates the resume cursor) |
| `thread.token-usage.updated` | `{usage: {usedTokens, maxTokens?, inputTokens?, outputTokens?, cachedInputTokens?, reasoningTokens?}}` (spec 08's context meter) |
| `turn.started`, `turn.completed`, `turn.aborted` | `{state: completed \| failed \| interrupted \| cancelled, stopReason?, usage?, totalCostUsd?, errorMessage?, errorSubtype?}` |
| `turn.plan.updated` | `{plan: [{step, status: pending \| inProgress \| completed}]}` |
| `turn.proposed.delta`, `turn.proposed.completed` | `{delta}`, `{planMarkdown}` |
| `item.started`, `item.updated`, `item.completed` | `{itemType, status: inProgress \| completed \| failed \| declined, title?, detail?, data?, agentId?, parentToolUseId?}` |
| `content.delta` | `{streamKind: assistant_text \| reasoning_text \| reasoning_summary_text \| plan_text \| command_output \| file_change_output, delta}` |
| `request.opened`, `request.resolved` | `{requestType, detail?, args?: {toolName, input, toolUseId}}`, `{decision}` |
| `user-input.requested`, `user-input.resolved` | `{questions: [{id, header, question, options: [{label, description}], allowCustomAnswer?, multiSelect}], responseMode?: "message"}`, `{answers}` |
| `task.started`, `task.progress`, `task.completed` | sub-agents: `{taskId, agentId, title?, description?, status?}` |
| `account.rate-limits.updated` | `{status: allowed \| allowed_warning \| rejected, resetsAt?, windows?}`, `resetsAt` an ISO 8601 time |
| `runtime.retry` | `{attempt, maxRetries, delayMs, status}` (Unframed's addition; t3code folds retries into a state reason) |
| `runtime.warning`, `runtime.error` | `{message, class?, detail?}` |

Item types: `command_execution`, `file_change`, `mcp_tool_call`, `dynamic_tool_call`, `collab_agent_tool_call`, `web_search`, `image_view`, `assistant_message`, `reasoning`, `plan`, `context_compaction`, `error`. Request types: `command_execution_approval`, `file_read_approval`, `file_change_approval`, `mcp_elicitation_approval`, `permission_approval`, `dynamic_tool_call`.

Every event carries `{eventId, provider, threadId (the chat), createdAt, turnId?, itemId?, requestId?}`.

**The Claude adapter** drives one long-lived Agent SDK `query()` per chat, fed by a streaming prompt: an unbounded queue of user messages turned into an async iterable, so the conversation keeps its context. Options:

| Option | Value |
| --- | --- |
| `pathToClaudeCodeExecutable` | the detected executable, always |
| `env` | the hydrated run environment (PATH, `CLAUDE_CONFIG_DIR` when set, HOME untouched) |
| `cwd` | the project folder |
| `additionalDirectories` | the attachments folder |
| `model`, `effort` | from the chat's model selection and traits |
| `settings` | `{alwaysThinkingEnabled, fastMode}` from the traits, when the model offers them |
| `systemPrompt` | `{type: "preset", preset: "claude_code", append: <Unframed instructions>}` using the text in `assets/prompts/agent-system.md` |
| `tools` | the Claude Code preset (no restriction) |
| `allowedTools` | every `mcp__unframed__*` name the server registers (the two canvas tools, and from spec 09 the artifact and preview tools): auto-allowed, not a restriction |
| `settingSources` | `["user", "project", "local"]` |
| `mcpServers` | `{unframed: {type: "http", url, headers: {Authorization: "Bearer <token>"}}}` |
| `permissionMode` | from the runtime mode (table below) |
| `allowDangerouslySkipPermissions` | `true` only with `full-access` |
| `canUseTool` | the permission adapter below |
| `includePartialMessages` | `true` |
| `maxTurns` | 30 |
| `resume` | the stored session id, when there is one |
| `abortController` | one per session |

Mapping, as t3code does it: text deltas become `content.delta assistant_text`; thinking deltas `reasoning_summary_text`; a `tool_use` block becomes `item.started` with its item type classified by tool name (Read of an image: `image_view`; Task or agent tools: `collab_agent_tool_call`; Bash and shell: `command_execution`; Edit, Write and patch tools: `file_change`; any `mcp__` tool: `mcp_tool_call`; WebSearch: `web_search`; else `dynamic_tool_call`); a user `tool_result` becomes `item.completed` (`failed` when it is an error); `system` `init` is `session.configured` and runs the canvas tools check; `system` `api_retry` becomes `runtime.retry`; `rate_limit_event` becomes `account.rate-limits.updated`; `task_*` system messages become `task.*`, and a sub-agent's own tool blocks keep its `agentId` while its text is dropped; the `result` message becomes `turn.completed` with usage, `totalCostUsd`, the stop reason and, on failure, the SDK's `subtype` as `errorSubtype`. A success result whose API status was 529 is a failure. With no partial messages (an older CLI) the assistant message's own text is used. The context window size comes from the result's model usage.

A model change between turns calls the query's own model switch; the interaction mode is applied per turn with the query's permission-mode switch (`plan` for plan, the runtime mode's SDK mode otherwise). **Interrupt** is t3code's hard stop: pending requests and questions resolve as cancelled, the turn completes as `interrupted`, the session closes, and the next message resumes it. **Rollback** (for Edit from here) forks the stored session at the last message to keep and restarts on the fork.

**The Codex adapter** spawns `<codex executable> app-server` with the hydrated environment and speaks newline-delimited JSON messages `{id, method, params}` (no `jsonrpc` field), typed from Codex's generated schemas. The MCP server goes in as launch arguments `-c mcp_servers.unframed.url=<endpoint>` and `-c mcp_servers.unframed.bearer_token_env_var="UNFRAMED_MCP_TOKEN"`, with the token in that variable. In order:

1. `initialize {clientInfo: {name: "unframed", title: "Unframed", version}, capabilities: {experimentalApi: true}}`, then the `initialized` notification.
2. `thread/start {cwd: <project folder>, approvalPolicy, sandbox, approvalsReviewer, model?, developerInstructions: <Unframed instructions>}`; with a stored thread id, `thread/resume {threadId, ...same, excludeTurns: true}`, falling back to `thread/start` when Codex no longer knows the thread. The resume cursor is `{threadId}`.
3. Per turn: `turn/start {threadId, input: [{type: "text", text}, {type: "localImage", path}...], approvalPolicy, approvalsReviewer, sandboxPolicy, model?, effort?, collaborationMode?}`.
4. `turn/interrupt {threadId, turnId}` after settling pending requests.
5. `thread/rollback {threadId, numTurns}` for Edit from here.

Server requests: `item/commandExecution/requestApproval` and `item/fileChange/requestApproval` open a request and are answered `{decision}` with `accept`, `acceptForSession`, `decline` or `cancel`; `item/tool/requestUserInput` opens a question, answered `{answers}`; `mcpServer/elicitation/request` for Unframed's own server is accepted without asking; any other server request answers method-not-found. Notifications map as t3code maps them: `turn/started`, `turn/completed`, `turn/aborted`, `item/started`, `item/completed`, `item/agentMessage/delta` (assistant text), `item/reasoning/textDelta` and `summaryTextDelta` (reasoning), `item/commandExecution/outputDelta`, `turn/plan/updated`, `item/plan/delta` and a completed `plan` item (proposed plan), `thread/tokenUsage/updated`, `account/rateLimits/updated`, `collabAgent/*` (sub-agents), `error` (a warning when Codex will retry, else an error). A turn that failed with Codex's usage-limit error becomes a rate-limit `rejected` notice.

Codex models and reasoning efforts come from the app-server's paged `model/list` (each model's supported efforts and default), fetched with the status when Codex is ready.

Both adapters report, on the provider status, the **slash commands** and **skills** the composer offers (spec 08): Claude's are `/compact` plus the commands the probe's initialization lists, and skills scanned from `<config dir or ~/.claude>/skills/*/SKILL.md` and `<project folder>/.claude/skills/*/SKILL.md` (the config dir copy wins on a name clash; skills disabled in Claude's settings are left out); Codex's are `compact` and `feedback` plus `skills/list {cwds: [<project folder>]}`.

### Permissions

t3code's four runtime modes, exactly. The labels and hints are spec 08's.

| Runtime mode | Claude `permissionMode` | Codex `approvalPolicy` / `sandbox` / reviewer |
| --- | --- | --- |
| `approval-required` (Supervised) | none sent (the SDK default: asks for commands and edits) | `untrusted` / `read-only` / `user` |
| `auto-accept-edits` (Auto-accept edits) | `acceptEdits` | `on-request` / `workspace-write` / `user` |
| `auto` (Auto) | `auto` | `on-request` / `workspace-write` / `auto_review` |
| `full-access` (Full access), the default | `bypassPermissions` with `allowDangerouslySkipPermissions` | `never` / `danger-full-access` / `user` |

Codex's per-turn `sandboxPolicy` follows the same pattern (`readOnly`, `workspaceWrite`, `dangerFullAccess`). Plan is an interaction mode, not a runtime mode: Claude switches the session to `plan` for that turn; Codex gets `collaborationMode {mode: "plan", settings: {model, reasoning_effort (default "medium"), developer_instructions}}` with the plan-mode instructions from `assets/prompts/plan-mode.md`.

The pure **permission policy** module (in `domain`) answers what the Claude `canUseTool` adapter must do, in this order:

1. `AskUserQuestion`, in every mode: open a question (`user-input.requested`, each question's id is its text, because the SDK matches answers by it), wait, and allow with the answers. A cancel denies with the cancel message.
2. `ExitPlanMode`: capture `input.plan` (trimmed) as the turn's proposed plan (`turn.proposed.completed`, de-duplicated by tool id or text) and deny with the text in `assets/prompts/plan-captured.md`, which tells the agent to stop and wait.
3. Unframed's own tools (`mcp__unframed__*`): allowed in every runtime mode without asking. They are scoped to this project, and every canvas change is revertable. In plan interaction mode `canvas_write` and, from spec 09, `page_write` and `motion_write` are denied with the text in `assets/prompts/plan-no-writes.md`; the read tools and preview tools stay allowed.
4. `full-access`: allow.
5. Anything else: open a request (`request.opened` with the request type classified from the tool: read-only tools are `file_read_approval`, shell-like `command_execution_approval`, file-writing `file_change_approval`, else `dynamic_tool_call`), wait for the answer, then:
   - `accept`: allow.
   - `acceptForSession`: allow, with `updatedPermissions` built from the SDK's own permission suggestions with their destination set to `session` (or, when there are none, one `addRules` rule for the tool name, behaviour allow, destination session).
   - `decline`: deny with the text in `assets/prompts/declined.md` ("The person declined this. Do not try it again; say what you would have done, or find another way.").
   - `cancel`: deny with "User cancelled tool execution." and interrupt the turn.

A pending request is chat state: it is an activity, so it survives a reload and a reconnecting rail reads it from the projection. One chat has at most one open request at a time, because the turn is blocked on it. A session that closes answers its open request as `cancel`. A request's target (the command, path, pattern or URL) is stored in full; spec 08 shows it and says how much it clipped.

A runtime mode change mid-turn (`thread.runtime-mode.set`) is told to the live session at once (Claude's permission-mode switch; Codex on the next turn's parameters) and every later `canUseTool` decision reads the chat's current mode.

### The chat store

Rebuilt 1:1 on t3code's orchestration, cut down to what a chat on a canvas needs (no branches, worktrees, pull requests, archive, settle, snooze or pin). Four parts, each its own module:

- **Decider** (pure, in `domain`): `decide(command, readModel) -> events | rejection`. It never does I/O.
- **Projector** (pure, in `domain`): `project(readModel, event) -> readModel`, plus the SQL projectors that keep the read tables.
- **Engine**: one queue per project that takes commands one at a time. For each command: look up its receipt; run the decider against the in-memory read model; then in ONE SQLite transaction append every event, apply the SQL projectors and write the accepted receipt. Only after the commit does the in-memory model change and do subscribers get the events. A command that produces no events is an error ("Command produced no events."). A rejected command writes a rejected receipt with its message and changes nothing.
- **Reactors**: side effects run after the intent is committed and report back through internal commands. An acknowledged command means the intent is recorded, not that the provider has answered.

Everything lives in the project database (spec 01's `unframed.sqlite`, the same file as spec 02's sync room, opened only through spec 01's project database module), so copying the folder copies the chats. The chat store registers a closer with spec 01's open-project registry (its command queue, its subscriptions, every live provider session of the project and their MCP tokens), which spec 10 relies on for rename, delete and folder moves.

**Receipts make dispatch idempotent.** Every command carries a `commandId`. The same `commandId` again returns the stored result (`{sequence}`) when it was accepted, the stored rejection when it was rejected, and a conflict error when it names a different chat.

**Tables** (t3code's, trimmed):

| Table | Columns |
| --- | --- |
| `orchestration_events` | `sequence` (global, autoincrement), `event_id`, `aggregate_kind` (`thread`), `stream_id`, `stream_version` (per chat, from 0, unique with the stream), `event_type`, `occurred_at`, `command_id`, `causation_event_id`, `correlation_id`, `actor_kind` (`client`, `server`, `provider`), `payload_json`, `metadata_json` |
| `orchestration_command_receipts` | `command_id` (key), `aggregate_id`, `accepted_at`, `result_sequence`, `status` (`accepted`, `rejected`), `error` |
| `provider_session_runtime` | `thread_id` (key), `provider`, `runtime_mode`, `status`, `last_seen_at`, `resume_cursor_json` |
| `projection_threads` | one row per chat: the chat record below |
| `projection_thread_messages` | `message_id`, `thread_id`, `turn_id`, `role` (`user`, `assistant`, `reasoning`), `text`, `is_streaming`, `attachments_json`, `context_json`, `created_at`, `updated_at` |
| `projection_thread_activities` | `activity_id`, `thread_id`, `turn_id`, `tone` (`info`, `tool`, `approval`, `error`), `kind`, `summary`, `payload_json`, `sequence`, `created_at` |
| `projection_thread_sessions` | `thread_id`, `status`, `provider`, `active_turn_id`, `last_error`, `updated_at` |
| `projection_turns` | `thread_id`, `turn_id`, `turn_count`, `pending_message_id`, `assistant_message_id`, `state`, `requested_at`, `started_at`, `completed_at`, `usage_json`, `files_json`, `reverted_json` |
| `projection_pending_approvals` | `request_id`, `thread_id`, `turn_id`, `status` (`pending`, `resolved`), `decision`, `created_at`, `resolved_at` |
| `projection_thread_proposed_plans` | `plan_id`, `thread_id`, `turn_id`, `plan_markdown`, `implemented_at`, `implementation_thread_id`, `created_at`, `updated_at` |
| `projection_state` | `projector`, `last_applied_sequence`, `updated_at` |
| `turn_changes` | see "Canvas change log, turn changes and revert" below (`canvas_changes` is spec 02's) |

Bootstrap replays each projector from its own cursor. Persisted events must stay decodable forever: a schema change adds optional fields, never renames.

**The chat record** (the read model of one chat, `projection_threads` plus its children):

```
Chat = {
  id, projectId, createdAt, updatedAt, deletedAt: string | null,
  title: string,                          // "" until someone names it; at most 60 characters
  titledBy: "user" | "agent" | null,
  tags: ShapeId[],                        // artifacts it touched, first-touch order
  modelSelection: { provider: "claude" | "codex", model: string, traits: Traits },
  runtimeMode: "approval-required" | "auto-accept-edits" | "auto" | "full-access",
  interactionMode: "default" | "plan",
  lastClock: number | null,               // room clock when its last turn settled
  latestTurn: { turnId, turnCount, state: "running" | "interrupted" | "completed" | "error",
                requestedAt, startedAt, completedAt, assistantMessageId } | null,
  session: { status: "idle" | "starting" | "running" | "ready" | "interrupted" | "stopped" | "error",
             activeTurnId, lastError } | null,
  messages, activities, proposedPlans, turns
}
Traits = { effort?: "low" | "medium" | "high" | "xhigh" | "max", thinking?: boolean, fastMode?: boolean }
Message = { id, role, text, turnId, streaming, createdAt, updatedAt,
            attachments?: [{id, name, type, kind, size}],
            context?: { selection: ShapeId[] } }
```

Defaults: `runtimeMode` `full-access`, `interactionMode` `default`, `model` "" (the provider's first non-legacy model), traits empty (the model's own defaults). The provider is fixed when the chat is created; the model and traits can change between turns.

A chat's summary, for the rail's tabs, is `{id, title, titledBy, preview (first user message, 80 characters), tags, provider, model, status, hasPendingApproval, hasPendingUserInput, hasActionableProposedPlan, turnCount, createdAt, updatedAt}`, where `status` is `running` when the latest turn is running, `failed` when it ended in error, else `idle`.

**Pending approvals and questions are derived from activities**, as in t3code: an `approval.requested` activity opens one and `approval.resolved` closes it (matched by `requestId`); the same for `user-input.requested` and `user-input.resolved`.

**Commands** (the web dispatches the first group; reactors dispatch the second):

| Command | Payload (besides `commandId`, `projectId`, `threadId`) | Rejected when |
| --- | --- | --- |
| `thread.create` | `modelSelection`, `runtimeMode?` (default `full-access`), `interactionMode?` (default `default`), `tags?`, `createdAt` | the id exists: "Thread '<id>' already exists and cannot be created twice." |
| `thread.delete` | | the chat does not exist |
| `thread.meta.update` | `title?`, `modelSelection?` | `modelSelection` names another provider: "A chat stays on the provider it started on."; a model change while a turn runs: "A turn is running; change the model when it finishes." |
| `thread.runtime-mode.set` | `runtimeMode` | never mid-turn; applies to the next tool call |
| `thread.interaction-mode.set` | `interactionMode` | |
| `thread.turn.start` | `message {messageId, text, attachments, context}`, `steer?: boolean`, `modelSelection?`, `sourceProposedPlan?`, `createdAt` | a turn is running and `steer` is not set: "The agent is still answering the previous message." (with `steer: true` the message joins the running turn); no text and no attachments: "Say something first."; over the text or attachment limits (the t3code messages under Attachments) |
| `thread.turn.interrupt` | `turnId?` | |
| `thread.approval.respond` | `requestId`, `decision` (`accept`, `acceptForSession`, `decline`, `cancel`) | no such pending request: "That request is no longer waiting for an answer." |
| `thread.user-input.respond` | `requestId`, `answers` | already answered: "This question has already been answered."; not pending: "This question is no longer pending."; an unanswered question: "Answer each question before sending." |
| `thread.user-input.dismiss` | `requestId` | the question blocks the turn: "This question needs an answer. Answer it or stop the turn." |
| `thread.turn.revert` | `turnCount` | a turn of this chat is running: "Wait for the turn to finish before reverting."; already reverted: "That turn is already reverted." |
| `thread.checkpoint.revert` | `turnCount`, `restoreCanvas: boolean` | a turn is running; `turnCount` beyond the current count |
| `thread.session.stop` | | |
| internal: `thread.session.set`, `thread.message.assistant.delta`, `thread.message.assistant.complete`, `thread.message.reasoning.delta`, `thread.message.reasoning.complete`, `thread.proposed-plan.upsert`, `thread.activity.append`, `thread.tags.add`, `thread.turn.files.complete`, `thread.turn.reverted.complete`, `thread.title.generate.complete`, `thread.turn.settle` | | |

`thread.turn.start` takes `runtimeMode` and `interactionMode` from the chat, never from the command. Model and traits in the command, when given, are applied to the chat first (same rule as `thread.meta.update`).

**Events**: `thread.created`, `thread.deleted`, `thread.meta-updated`, `thread.runtime-mode-set`, `thread.interaction-mode-set`, `thread.message-sent` (user, assistant and reasoning, with `streaming`), `thread.turn-start-requested`, `thread.turn-interrupt-requested`, `thread.approval-response-requested`, `thread.user-input-response-requested`, `thread.checkpoint-revert-requested`, `thread.reverted`, `thread.turn-revert-requested`, `thread.session-stop-requested`, `thread.session-set`, `thread.proposed-plan-upserted`, `thread.activity-appended`, `thread.tagged`, `thread.turn-files-completed`, `thread.turn-reverted`, `thread.turn-settled`. Each carries t3code's base fields: `sequence`, `eventId`, `aggregateKind`, `aggregateId`, `occurredAt`, `commandId`, `causationEventId`, `correlationId`, `metadata`.

Projector rules worth stating:

- A streaming assistant message appends its delta; a completed one with non-empty text replaces the text.
- `thread.session-set` leaving `running` settles the running turn: `idle` or `ready` becomes `completed`, `error` becomes `error`, `interrupted` or `stopped` becomes `interrupted`.
- `thread.turn-settled` stamps `lastClock` (the room clock when the turn stopped touching it).
- `thread.reverted {turnCount}` keeps the turns up to `turnCount` and their messages, activities and plans, and drops the rest. `thread.checkpoint.revert` emits it together with `thread.checkpoint-revert-requested` (which names the dropped turns), so a message sent right after the rewind is numbered after the kept turns; the reactor then reverts the canvas and rolls the provider back before any later turn of the chat is sent. With `restoreCanvas: true` it then appends a `checkpoint.reverted` activity with no turn (so it outlives the dropped turns), `{turnCount, restored: [shape ids], skipped: [{id, by: person | another chat | a later turn}]}`, which spec 08's rail reads to say which shapes were left alone.
- `thread.turn-revert-requested` marks the turn, so a second `thread.turn.revert` is refused before the first lands.
- `thread.tagged {ids}` appends ids the chat does not have yet, in order.

**Reactors**:

- **Provider command reactor**: on `thread.turn-start-requested`, build the preamble (see below), start or reuse the chat's provider session, send the turn; a failure to start becomes a `provider.turn.start.failed` error activity and session `error`. It also forwards interrupts, approval and question answers, mode changes (a live session is told the new mode) and session stops.
- **Provider runtime ingestion**: turns the adapter's canonical runtime events into internal commands. Text deltas become `thread.message.assistant.delta` (message id `assistant:<itemId>`); reasoning deltas become reasoning messages; a plan becomes `thread.proposed-plan.upsert` (plan id `plan:<chatId>:turn:<n>`); lifecycle becomes `thread.session.set`; tool items, requests, questions, retries, rate limits and errors become `thread.activity.append`.
- **Turn settle reactor**: when a turn leaves `running`, it stamps `lastClock`, writes the turn's file list (`thread.turn.files.complete`, from the turn changes), writes the sidecar, and on the chat's first completed turn asks for a title.
- **Tag reactor**: tags from the first message and from every artifact write (see Tags).
- **Deletion reactor**: on `thread.deleted`, stops the provider session and revokes its MCP token.

**Titling.** After the chat's first turn settles, when `titledBy` is not `user`, one small request on the chat's own provider (Claude: a one-turn query with no tools, no setting sources, no MCP servers and the naming system prompt; Codex: a one-turn ephemeral thread with a read-only sandbox and approvals off) using the prompt in `assets/prompts/chat-title.md`, fed the first message and the first 400 characters of the answer. The first line of the reply, with surrounding quotes stripped, trimmed, at most 60 characters, becomes the title with `titledBy: "agent"`, unless the person named the chat in the meantime. A rename by the person sets `titledBy: "user"`; clearing the name sets `title: ""` and `titledBy: null`, so the agent may name it again. Any failure is silent. The title is announced by `thread.meta-updated`.

**Sessions.** One live provider session per chat. It closes after 10 minutes with no turn running and no pending request, and the next message resumes it from the stored resume cursor (Claude: its session id and the message to resume at; Codex: its thread id). Resume also covers an engine restart.

**Restart reconciliation.** At boot, and whenever a chat is read, a chat whose session is `starting` or `running` (or has an active turn) with no live session in this process is settled: session `error`, the running turn `error`, `lastError` the quit-mid-turn sentence from `assets/prompts/failures.md` ("Unframed stopped while this turn was running, so it never finished. Send again to carry on where it left off."), and its pending approval and question resolved as cancelled. The next `thread.turn.start` continues the same chat.

**RPC methods** (Effect RPC over the socket of spec 01):

| Method | Input | Result |
| --- | --- | --- |
| `orchestration.dispatchCommand` | a command | `{sequence}` |
| `orchestration.subscribeShell` | `{projectId, afterSequence?}` | stream: `{kind: "snapshot", chats}`, `{kind: "synchronized"}`, then `{kind: "chat-upserted", chat}` / `{kind: "chat-removed", id}`, each with `sequence` |
| `orchestration.subscribeThread` | `{projectId, threadId, afterSequence?}` | stream: `{kind: "snapshot", snapshot: {snapshotSequence, thread}}`, `{kind: "synchronized"}`, `{kind: "event", event}`; with `afterSequence` the engine replays the chat's events past it when it can, else sends a snapshot; the web de-duplicates by sequence |
| `orchestration.searchThreads` | `{projectId, query, limit?}` | spec 08 |
| `orchestration.getTurnDiff`, `orchestration.getFullThreadDiff` | | spec 08 |
| `providers.getStatuses` | `{refresh?, projectId?}` | provider statuses |
| `attachments.createUploadUrl` | `{name, mimeType, sizeBytes}` | `{relativeUrl, expiresAt}` (see Attachments) |

Text and reasoning deltas are events too (`thread.message-sent` with `streaming: true`), as in t3code, so a reconnecting rail replays a half-streamed reply exactly.

A rejected command answers spec 01's `UnframedError` with the decider's sentence as `message`: `not_found` when the chat or the request it names does not exist, `conflict` when the chat's state refuses it (a running turn, an id that exists, an answered question, a reverted turn, another provider), and `bad_request` for everything else (an empty message, a limit, a schema failure). There is no other failure shape.

### Canvas change log, turn changes and revert

The canvas change log is spec 02's `canvas_changes` table; this spec adds no second log. It reads that log through `changedSince` and the rows it holds, and classifies each row's origin for the change note and for Revert's skip reasons:

| Classified as | Spec 02 origin |
| --- | --- |
| `person` | `session` (any tab), and `server` with id `run:<runId>`, since a run is something the person started |
| `chat:<chatId>` | `server` with id `chat:<chatId>`, a tool call of that chat |
| `revert:<chatId>:<turn>` | `server` with id `revert:<chatId>:<turn>`, a revert of that turn, with the person who asked counted as its author |
| `system` | `system` (starter seeding, collision repair, media rewriting) |

This spec adds one table to the project database, `turn_changes`, which only the engine writes.

**Turn changes** record, per turn, every shape that turn's tool calls touched: `{chatId, turn, shapeId, before, after}` where `before` is the shape record before the turn first touched it (null when the turn created it) and `after` is the record after the turn last touched it (null when the turn deleted it). Several writes in one turn to one shape collapse into one row: the first `before`, the last `after`. A page or motion row also records its file before and after, which is what spec 08's diffs read.

**Revert** (`thread.turn.revert {turnCount}`): for each row of that turn, compare the shape's current record with `after` (absence equals null).

- Equal: restore `before` (delete the shape when `before` is null, recreate it when `after` is null, otherwise put the whole record back).
- Not equal: skip the shape. Someone changed it since: the person, another chat, or a later turn of this chat.

All restores go to the room as one write with origin `revert:<chatId>:<turn>`. The revert is recorded on the chat as a `thread.turn-reverted` event carrying `{turn, restored: [ids], skipped: [{id, by}], at}`, where `by` is `person`, `another chat` or `a later turn`, read from the change log. A reverted turn stays reverted: its recap card shows it and offers no second revert. Revert is refused while the same chat has a turn running ("Wait for the turn to finish before reverting."). Files are never deleted by a revert; a page shape simply points back at its previous file. Tags are pointers and are not removed.

The person's own Cmd-Z is tldraw's local undo (spec 02) and walks only their edits in their tab. It never undoes an agent change; Revert is the only way to take one back.

### Tags

A chat's `tags` are the shape ids of the artifacts (pages and motions) it has touched. They come from exactly two places:

1. The first message: the engine asks the canvas which of the message's selected ids are artifacts (it never trusts the web to say) and adds those.
2. Every artifact a tool call writes to or edits: spec 09's `page_write` and `motion_write`, created or updated, and every `canvas_write` op whose target (or created shape) is a page or motion, including `move`, `resize`, `delete` and a deletion that cascades from a group. This closes the old gap where a plain canvas edit to an artifact did not tag the chat.

Adding a tag the chat already has is a no-op and emits nothing. Tags are pointers, never dependencies: deleting an artifact leaves the chat and its tags as they are, and a stale tag simply matches nothing. There is no confirmation when deleting an artifact a turn is working on; the next write fails and the agent says so.

### What the model is told before each message

The model's copy of a message is the person's text preceded by a preamble; the stored message is the person's text alone. The preamble has up to three parts, each on its own paragraph:

1. **Selection**: `Selected: <kind> <id> ("<label>"), <kind> <id> ("<label>").` for every selected id that still exists. The label is the title, else the original file name, else the first 40 characters of text; omitted when there is none.
2. **Change note**, when the canvas changed since this chat's last turn ended (its `lastClock`): counted from the change log past `lastClock`, excluding `system` rows and this chat's own `chat:` rows. A change is one distinct shape changed by one origin. The sentence names changes by the person, changes by another chat, and reverts of this chat's turns. Use the sentence template in `assets/prompts/change-note.md`. It always begins "Since your last turn the canvas changed" and ends "Read it again before acting."
3. **Attachments**: one line per attachment, `Attached image "<name>": <absolute path>` or `Attached file "<name>": <absolute path>`.

`lastClock` is stamped when a turn settles, and nowhere else.

The system prompt tells the agent how to read the selection. Selection is context, never a target field: one artifact selected is what the message is about unless the sentence says otherwise; nothing selected means something new should be made when the sentence asks for something; several selected means the agent decides from the sentence (the same edit to all, an edit to one, a different edit to each, a new artifact made from copies of them, or a question) and asks in its reply only when the sentence is genuinely ambiguous. It never asks which mode was meant, and it never changes what is selected. There is no `target` anywhere in the protocol.

### Attachments

t3code's flow and limits. The pure classification and limit checks live in `domain`, so the composer and the engine never disagree about what a file is.

- **Upload**: `attachments.createUploadUrl {name, mimeType, sizeBytes}` returns `{relativeUrl, expiresAt}`: a signed, one-use upload path on the engine's origin, valid 10 minutes. The web then `POST`s the raw bytes to it. The body must be exactly `sizeBytes` long. The answer is `{attachment: {id, name, type, kind, size}}`. The same loopback checks apply as everywhere.
- **Kinds**: `image` (gif, jpeg, png, webp, sent to the model natively) and `file` (anything else, given by path). An empty or `application/octet-stream` type is inferred from the extension. A reported type beats the extension, so a PDF renamed `.png` is still a file. HEIC and HEIF are converted to JPEG in the browser before upload (spec 08); SVG and other image types the model cannot take natively are files.
- **Limits**: at most 100 attachments per message; an image at most 10 MiB (the browser downscales a larger one before upload, spec 08); all images in one message together at most 80 MiB; any other file at most 50 MiB; nothing empty. The message text itself is at most 120,000 characters.
- **Messages** (t3code's): `You can attach up to 100 files per message.`; `'<name>' is empty or could not be read.`; `'<name>' exceeds the <N> MB attachment limit.`; `Images can total up to 80 MiB per message or question response. Use smaller images or send fewer at once.`; `Prompt is <N> character(s) over the 120,000-character limit. Shorten or split it before sending.`
- **Storage**: `<data folder>/attachments/<id>`, where `id` is the first 32 hex characters of the SHA-256 of the bytes plus an extension (the name's own when it matches `^\.[a-z0-9]{1,10}$`, else the image type's, else `.bin`). Written with exclusive create, so the same bytes twice are one file with one id. An id containing `..`, `/`, `\` or NUL is refused.
- **Reaching the model**: a message names attachments by id only; the engine re-derives kind and type from the stored file, so a message cannot claim a file is something it is not, and cannot name a file elsewhere on the machine. The absolute path goes in the preamble. Images are also read at the provider boundary and sent natively (base64 image blocks for Claude, `localImage` inputs for Codex); an unreadable one keeps only its path line.
- **Access**: the attachments folder is the one directory granted beyond the project folder (Claude `additionalDirectories`). Its siblings (`.env`, the job store) are never granted. The granted list is reported on the session event. A path in a prompt grants nothing by itself; the provider's sandbox and the runtime mode still decide.
- **Records**: a stored message keeps `{id, name, type, kind, size}` per attachment, never bytes.

### Failures, retries and limits

A turn that fails keeps whatever the agent already said, and the failure sentence is appended below it as a new paragraph. The sentence is chosen by the provider's failure subtype; use the text in `assets/prompts/failures.md`, which holds:

- `error_during_execution`, `error_max_turns`, `error_max_budget_usd`, `error_max_structured_output_retries`: one sentence each
- any other subtype: `The agent failed: <subtype>.`
- no subtype: `The agent reported an error.`
- the quit-mid-turn sentence (below)

Codex failures map onto the same sentences where they have an equivalent (a turn that ran out of steps is `error_max_turns`); any other Codex error is `The agent failed: <message>.`

A provider retry becomes a `retry` activity `{attempt, maxRetries, delayMs, status}`; spec 08 renders it. A rate-limit notice becomes a `rate-limit` activity `{status: allowed | allowed_warning | rejected, resetsAt?}`, where `resetsAt` is an ISO 8601 time. Only `rejected` and `allowed_warning` are ever shown; `allowed` clears a shown notice.

**A chat quit mid-turn.** Sessions live in the engine process and cannot outlive it. At boot, and on every read, a chat whose projection says a turn is running while no live session exists for it reads as failed with the quit-mid-turn sentence, and any pending approval or question on it is cleared (nobody is left to answer it). The next message continues the same chat and resumes the provider conversation.

### The agent turn sidecar

Every settled turn, failed or not, writes `<epochMs>-agent[-n].json` into the project folder (the first free `-n`):

```
{ kind: "agent-turn", chatId, turn, provider, model, billing: "subscription",
  usage: {...provider token counts...}, estimatedUsd?, durationMs?, at: ISO }
```

There is never a `cost` field. `estimatedUsd` is the provider's own estimate, for information, present only when the provider reports one.

### The scripted agent

With `UNFRAMED_TEST_AGENT_SCRIPT` set (unset in a plain clone, so inert), every chat's adapter is the scripted adapter. It implements the same adapter interface and emits the same canonical runtime events. It replaces the model and nothing else: the same MCP tool handlers, the same room, the same files, the same permission decisions, the same projections. No route, header, command field or setting can turn it on. While it is set, both providers report `ready` with `auth {email: "scripted@unframed.test", plan: "Script"}` and one model row `{id: "scripted", name: "Scripted"}`, so the web can be driven with no CLI installed; provider detection itself is tested in an engine without the variable.

The variable names a JSON file (one script) or a folder (every `*.json` in it, sorted by name). A script:

```
{ when?: "<regex>", turns: [ Turn, ... ] }        // a bare array means { turns }
Turn = { text: string,
         tools?: [{name, input}],          // Unframed tools, run through the real handlers
         provider?: [{name, input}],       // provider tools: permission decision only, never executed
         retries?: [{attempt, maxRetries, delayMs, status}],
         question?: {questions: [...]},    // asks the person, waits for the answer
         tasks?: [{title, status}],        // sub-agents started and finished during the turn
         rateLimit?: {status, resetsAt?},  // a usage-limit notice; resetsAt an ISO 8601 time
         plan?: string,                    // captured as a proposed plan (plan mode)
         usage?: {usedTokens, maxTokens?, totalProcessedTokens?},  // token usage as the turn ends (spec 08's meter)
         title?: string, isError?: boolean, errorSubtype?: string,
         expectPreamble?: "<regex>", refusedText?: string }
```

- `when` is matched case-insensitively against a chat's first message. The chosen script sticks to that chat for its whole life. Fallbacks: a script with no `when`, then the only script when just one was loaded. With several and no match the turn fails with `no agent script matches "<first 60 characters>"`.
- Turn N answers the chat's Nth message; past the end the turn fails with `agent script <name> has <n> turn(s); the chat is on turn <m>`.
- `expectPreamble` must match the preamble the turn was given, or the turn fails with `agent script <name> turn <n>: preamble did not match /<re>/: it was "<preamble>"`.
- Order within a turn: on turn 1, the canvas tools check and the session event; then retries and the rate-limit notice; then sub-agent tasks; then the question, if any, waiting for the answer; then each `provider` call goes through the real permission decision for the chat's mode (asking the person when the mode says so, and waiting); a decline stops the rest of the turn and the answer is `refusedText`; then each `tools` call runs the real handler; then `usage`, when given, is reported as `thread.token-usage.updated`; then the text streams as one delta and the turn settles.
- `title` is used as the chat's name on turn 1 instead of asking a model; empty means no name.
- A script file that is not an object, has no turns, or has a turn without a `text` string fails to load with `agent script <name>: <reason>`.
- For tests, the scripted agent writes each session's MCP endpoint and token to `<data folder>/scripted-agent/<chatId>.json`, and each provider rollback it is asked for (in turns) as a line of `<data folder>/scripted-agent/<chatId>.rollbacks`. Both exist only under the test variable.

The fixtures are in `assets/fixtures/`, already in this format (its README says which shapes each one expects a test to seed).

## Testing Decisions

A good test here drives a chat the way the web does (dispatching commands and reading subscriptions over the RPC socket, and changing the canvas through a sync client) and asserts on what the engine then holds: the chat's projection, the canvas, the files in the project folder, the sidecar. It never reaches into the event table, a reactor or an adapter's internals.

- **Domain seam** for everything with many cases: provider classification and its messages, PATH merging, shim following, `codex login status` parsing, Claude model row merging, skill frontmatter parsing, the decider (every rejection string), the projector (streaming append, turn settling, revert pruning, tags), batch preparation for `canvas_write` (every refusal, provisional id mapping, marker stripping), the change note sentence, the permission policy (the five-step order and the mode mappings), attachment classification and limits, failure messages, and the adapters' pure mapping from recorded Claude SDK messages and recorded Codex notifications to canonical runtime events.
- **Engine seam** for everything a turn spans: the real engine forked into a temporary data folder with `UNFRAMED_TEST_AGENT_SCRIPT` pointing at a fixture folder. Scripted turns run the real MCP handlers, the real sync room, the real file writes, the real permission policy and the real projections, so one test can assert that a bulk edit is one step, that a revert skips a shape a sync client edited, and that the next turn's preamble says so. Canvas state is seeded by connecting a sync client and writing shapes. Provider detection runs against fake `claude` and `codex` executables placed on a temporary PATH or named through `CLAUDE_PATH`/`CODEX_PATH`; the Codex adapter runs end to end against a fake `codex app-server` (a small script that speaks the newline-delimited protocol and replays a recorded session).
- **Manual, and said so**: a real Claude turn and a real Codex turn against the person's own CLI (they spend quota, so they are the manual acceptance test, run once per adapter change), and the zero-token Claude probe against a real CLI.

Prior art: t3code's own orchestration tests (decider and projector cases as plain inputs and outputs, engine tests through dispatch and subscribe) and the old app's scripted-agent flow test, which forked the real server and drove chats through its routes. The fixtures in `assets/fixtures/` are the scenarios that flow test covered.

The test-only variables this spec uses, `UNFRAMED_TEST_AGENT_SCRIPT`, `UNFRAMED_TEST_AGENT_IDLE_MS` and `UNFRAMED_TEST_UPLOAD_URL_TTL_MS`, are defined in spec 01's test-only table.

## Tasks

1. **Provider classification.** The pure classifier turns a version result and a probe result into the five statuses with their exact messages. Seam: domain.
2. **Run environment rules.** PATH merge (process first, shell appended, no duplicates), `CLAUDE_CONFIG_DIR` only when set, HOME never overridden and filled only when missing. Seam: domain.
3. **Windows shim following.** PATHEXT lookup and `.cmd`/`.bat`/`.ps1` to `bin/claude.exe` then `cli.js`, else the bare name. Seam: domain.
4. **Codex login status parsing.** Ready with plan, signed out, and unknown for anything else. Seam: domain.
5. **Claude model rows.** SDK rows first named from the catalogue, `[1m]` suffixed " · 1M", `default` dropped, remaining catalogue rows appended with the full effort list. Seam: domain.
6. **Provider statuses over RPC.** `providers.getStatuses` reports `not_installed` with no binary, `wont_run` for a binary that exits non-zero, and Codex `ready`/`signed_out`/`auth_unknown` from a fake `codex`; the executable path is absent from the answer. Seam: engine.
7. **Status cache.** A second call within 5 minutes does not re-spawn the fake binary; `refresh: true` does; saving `CODEX_PATH` forgets the cache. Seam: engine.
8. **Paths only through settings.** A `thread.create` or `thread.turn.start` carrying any path-like extra field is rejected by the schema, and the binary run is always the configured one. Seam: engine.
9. **Decider: chat lifecycle.** `thread.create`, `thread.delete`, `thread.meta.update` with every rejection string, including the fixed provider. Seam: domain.
10. **Projector: messages and turns.** Streaming deltas append, completion replaces, `session-set` leaving running settles the turn with the right state. Seam: domain.
11. **Event store and receipts.** Dispatching one `commandId` twice returns the same `{sequence}`; a rejected command returns the same rejection again and changes nothing. Seam: engine.
12. **Subscriptions.** `subscribeShell` and `subscribeThread` send snapshot, synchronized, then live events; resubscribing with `afterSequence` replays only what was missed. Seam: engine.
13. **Chats live in the project.** A chat created, then the engine restarted, reads back identically; copying the project folder elsewhere and opening it there shows the chat. Seam: engine.
14. **Scripted agent: one turn.** With a fixture folder set, a first message picks the script by `when`, streams its text, settles the turn and stores the assistant message; the second message uses the same script's turn 2. Seam: engine.
15. **Scripted agent: load and match errors.** A malformed script fails to load with its reason; no match fails the turn with the no-match sentence; running past the last turn fails with the turn-count sentence. Seam: engine.
16. **Turn sidecar.** Every settled turn writes `<epochMs>-agent.json` with `billing: "subscription"` and no `cost` key, failed turns included. Seam: engine.
17. **MCP server auth.** The MCP route refuses a request with no token or a revoked token (401) and a non-loopback `Origin` (403); with a session's token, listing tools returns the two canvas tools. Seam: engine.
18. **Canvas tools check.** The pure check reports every missing `mcp__unframed__*` name in the exact failure sentence; a scripted turn runs the check on turn 1. Seam: domain.
19. **`canvas_read`.** Over a seeded canvas (prompts, an image with a mark on it, a group with members, a page with dial values, a result with a recipe), the tool returns each shape's documented fields and the message's selection, and never a byte of media. Seam: engine.
20. **Batch preparation.** Every refusal message, `new:` provisional id mapping across `id`, `parent` and members, prompt `@id`s from the canvas counter, run markers stripped. Seam: domain.
21. **`canvas_write` applies one batch.** A scripted `canvas_write` of several ops lands in the room as one change, a connected sync client sees it, and the result maps every provisional id. A batch with one bad op changes nothing. Seam: engine.
22. **`canvas_write` group ops.** `reparent` and `rename` follow spec 06's rules for every shape with an `@id`; a rename rewrites `@` references in the same write. Seam: engine (the rename of each kind: domain).
23. **Tags from the first message.** A first message whose selection holds a page, an image and a motion tags the chat with the page and the motion only, as decided by the canvas, not by the message. Seam: engine.
24. **Tags from writes.** A `canvas_write` that only moves a page, and one that resizes a motion tag the chat with that page and that motion, once each; one that only edits a prompt tags nothing; deleting the page afterwards leaves the tag. (Tags from the artifact tools are spec 09's task.) Seam: engine.
25. **Change log origins.** Reading spec 02's change log, a sync client's edit classifies as `person`, a run's placeholder write (`run:<runId>`) as `person` too, a scripted write as `chat:<id>`, and system rows are excluded from counts. Seam: engine.
26. **Change note sentence.** Counts per origin in distinct shapes, the singular and plural wording, the revert clause, and no sentence when nothing changed. Seam: domain.
27. **Preamble reaches the agent.** A scripted turn 2 with `expectPreamble` sees the selection line and the change note after a sync client edits between turns (the bulk-edit fixture). Seam: engine.
28. **Turn changes and revert.** Reverting a turn restores every shape it changed, recreates one it deleted, removes one it created, and points a page back at its previous file, as one change with a `revert:` origin. Seam: engine.
29. **Revert skips later edits.** A shape a sync client edited after the turn is left alone and named in `thread.turn-reverted` with `by: "person"`; the next turn's preamble mentions the revert. Seam: engine.
30. **Revert refusals.** Refused while a turn of the same chat runs, and a second time on the same turn. Seam: engine.
31. **Permission policy.** The five-step order for Claude's `canUseTool` (question, plan capture, Unframed tools, full access, ask), the accept-for-session permission update, and the decline and cancel messages. Seam: domain.
32. **Mode mappings.** Each runtime mode's Claude permission mode and flag, and Codex approval policy, sandbox, reviewer and turn sandbox policy; plan's collaboration mode. Seam: domain.
33. **Default is Full access.** A new chat reads `full-access`, and a scripted provider call (`rm -rf build`, the permission fixture) proceeds without a request. Seam: engine.
34. **Supervised asks.** In `approval-required` the same call opens a request; `accept` lets the turn finish; `decline` ends it with the fixture's `refusedText`; `cancel` interrupts the turn. Seam: engine.
35. **Accept for session.** After `acceptForSession`, the same kind of call later in the chat does not ask again; a new chat asks. Seam: engine.
36. **Pending request survives reconnect.** A subscriber that connects while a turn is parked on a request sees it in the snapshot and can answer it. Seam: engine.
37. **Mode change mid-turn.** Switching a parked chat from Supervised to Full access applies to its next tool call. Seam: engine.
38. **Plan mode.** In plan interaction mode a scripted `plan` becomes the turn's proposed plan, and a scripted `canvas_write` is refused with the plan message while `canvas_read` still runs. Seam: engine.
39. **Questions.** A scripted `question` opens a user-input request; `thread.user-input.respond` releases the turn; the rejection strings for answered, not pending and incomplete answers. Seam: engine.
40. **Attachment rules.** Classification with type inference, the per-image, total-image, per-file and count limits, and every message string. Seam: domain.
41. **Attachment upload.** `attachments.createUploadUrl` then `POST` stores the file under the data folder, never the project; the same bytes twice give one file and one id; a body whose length differs from `sizeBytes`, an expired URL and a reused URL are refused. Seam: engine.
42. **Attachments reach the turn.** A message with an attached image puts its path line in the preamble (the attachment fixture) and stores the attachment's name, type, kind and size on the message, never bytes. Seam: engine.
43. **Failure messages.** Each known subtype, an unknown subtype, no subtype, and the Codex fallbacks. Seam: domain.
44. **A failed turn.** The failure fixture keeps any text already streamed, appends the failure sentence, records the retry activity, marks the turn `error` and the chat `failed`. Seam: engine.
45. **Rate limits.** A scripted `rateLimit` of `rejected` and of `allowed_warning` becomes a rate-limit activity; `allowed` after them clears it. Seam: engine.
46. **Quit mid-turn.** Kill the engine while a scripted turn is parked on a request, restart it: the chat reads failed with the quit-mid-turn sentence and no pending request; the next message continues the same chat and resumes the session. Seam: engine.
47. **Interrupt.** `thread.turn.interrupt` on a parked turn cancels its request, settles the turn `interrupted`, and the next message resumes. Seam: engine.
48. **Titling.** After turn 1 the title fixture names the chat (trimmed); a rename by the person before or after the agent's name wins; clearing the name lets the agent name it on its next first-turn opportunity; no name is requested after turn 2. Seam: engine.
49. **Idle close.** With `UNFRAMED_TEST_AGENT_IDLE_MS` short, a quiet session closes, its MCP token stops working, and the next message resumes it. Seam: engine.
50. **Edit from here, engine side.** `thread.checkpoint.revert {turnCount, restoreCanvas: true}` drops the later turns from the chat, reverts their canvas changes newest first with the skip rule, and rolls back the provider conversation; with `restoreCanvas: false` the canvas is untouched. Seam: engine.
51. **Chat deletion.** `thread.delete` stops the session and revokes its token; its canvas changes and files stay. Seam: engine.
52. **Claude event mapping.** Recorded SDK messages (partial text, tool use and results, init, api_retry, rate limit, task, success and error results, a 529) map to the documented canonical events. Seam: domain.
53. **Codex event mapping.** Recorded app-server notifications and requests map to the documented canonical events and answers. Seam: domain.
54. **Codex runs a chat.** Against a fake `codex app-server`, a chat on Codex initializes, starts a thread in the project folder with the mode's policies and the MCP `-c` arguments, streams a reply, raises a command approval the person answers, and resumes by thread id after an idle close. Seam: engine.
55. **Skills and slash commands.** Skill folders under the config dir and the project's `.claude/skills` parse from their frontmatter, the config dir winning a name clash and disabled skills left out; Codex's fixed commands are listed. Seam: domain.

## Out of Scope

- Providers other than Claude and Codex (t3code's Cursor, OpenCode, Grok, Antigravity).
- t3code's terminal, mobile app, remote access and pull request linking (decision Q16), and so its branch, worktree, archive, settle, snooze and pin commands.
- Git checkpoints of the project folder: a turn's canvas changes and artifact files are the checkpoint.
- Several accounts per provider beyond one `CLAUDE_CONFIG_DIR` (t3code's instances and shadow homes).
- A usage dashboard; only the in-chat usage-limit notice exists.
- Cleaning up attachments no chat uses any more, and superseded page and motion files.
- Undoing an agent change with Cmd-Z: Revert is the only way (decision Q23).
- A per-request dangerous-command list and Auto as the default mode (dropped by decision Q32).

## Further Notes

- Protocol names keep t3code's `thread.*` spelling so its code can be followed line by line. In prose, the UI and every sentence a person reads, it is always a chat.
- Full access now passes the SDK's skip-permissions flag, as t3code does. The old app never passed it; decision Q32 reverses that.
- The old app counted "changes" as journal entries. tldraw sync has no batches of that size, so a change is now one distinct shape per origin. The sentence still begins "Since your last turn the canvas changed", which the bulk-edit fixture matches.
- Spec 09 adds the artifact tools and the preview tools to this spec's MCP server, and the required-tool check grows with them.
- The fixtures in `assets/fixtures/` use the ops above (`canvas_write` ops named by `type`, `update` with `props`, `shapeId` inputs). Each test seeds the shapes a fixture names (`m1`, `m2`, `i3`, as the fixtures README says); `bad-shape.json` expects `m1` to be missing. `question.json` is the agent asking the person a question; `canvas-question.json` is a question about the canvas.

### Assets this spec needs

- `assets/prompts/agent-system.md`: the text appended to Claude Code's system prompt and given to Codex as developer instructions. Source: old `server/agent.js` `SYSTEM_PROMPT`. It must be rewritten for the new canvas (shapes and the selection as input, no wires or output nodes, `canvas_write`'s new ops, the selection rules: one artifact selected is the subject, none means make something new, several means decide from the sentence and ask only when genuinely ambiguous).
- `assets/prompts/tool-descriptions.md`: the `canvas_read` and `canvas_write` descriptions this spec uses (the file also lists where the artifact tools' text lives, which is spec 09's). Source: old `server/agentTools.js` (`canvas_read` and `canvas_write` rewritten for the new shapes and ops; `page_write`, `page_read`, `motion_write`, `motion_read`, `DIALS_CONTRACT` and `DIALS_TIMELINE` verbatim, with `nodeId` renamed `shapeId`).
- `assets/prompts/failures.md`: old `server/agent.js` `FAILURES` and the two `failureMessage` fallbacks, plus `QUIT_MID_TURN` from old `server/threads.js`.
- `assets/prompts/change-note.md`: old `server/agentTools.js` `changeSentence`, with a clause added for reverts of this chat's turns.
- `assets/prompts/declined.md`: old `server/agent.js` `DECLINED`.
- `assets/prompts/chat-title.md`: old `server/agent.js` `askForTitle` prompt and its system prompt.
- `assets/prompts/plan-captured.md`: t3code `apps/server/src/provider/Layers/ClaudeAdapter.ts` ExitPlanMode deny message (MIT).
- `assets/prompts/plan-mode.md`: t3code `apps/server/src/provider/Layers/CodexDeveloperInstructions.ts` plan-mode block (MIT).
- `assets/prompts/plan-no-writes.md`: new; one sentence telling the agent that plan mode changes nothing and the change belongs in its plan.
- `assets/models/claude-catalogue.json`: old `server/providers.js` `CLAUDE_CATALOGUE` (ids, names, aliases, legacy flags; from t3code's model manifest, MIT).
- `assets/fixtures/*.json`: the old `server/fixtures/agent/` scripts, rewritten as described above.
