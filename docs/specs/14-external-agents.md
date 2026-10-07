# 14 · External agents

Depends on: 01 to 13 (read 00-index first). It builds on spec 07's MCP server, chat store, turn changes and revert, spec 08's rail, spec 09's artifact and preview tools, and spec 10's settings dialog.

## Problem Statement

The only agent that can touch the canvas today is the one Unframed starts itself. A person who works in Claude Code in a terminal, in Codex inside their IDE, or in the Claude or Codex desktop app, inside some other repository, cannot reach the canvas from there. They cannot ask "read the landing page on my Unframed board and build it into this site", or "put three layout prototypes for this component on the canvas so I can compare them". They copy HTML out of the project folder by hand, or describe the board to the agent in words.

Spec 07 already serves the canvas tools over MCP, but only to sessions Unframed starts. Each session gets a token that lives as long as the session, and the engine's port changes on every launch of the desktop app, so nothing outside the app could find the endpoint even if it had a token.

## Solution

A person opens Settings, presses **Connect an agent**, picks the client (Claude Code, Codex, the Claude desktop app, or another MCP client) and gets a ready setup: one command to paste in a terminal, or one config block to paste into a file. The setup carries a **connection token**, shown once. From then on, while Unframed is open, that client lists the projects, reads a project's canvas (shapes, prompts, names, parameters, page and motion files and their code), and creates and edits pages, motions and canvas shapes with the same tools the in-app agent uses.

The setup runs a small **stdio shim** that ships with the engine. The shim reads a **discovery file** the engine writes into its data folder at every launch, and relays the client's MCP messages to the engine's existing `/mcp` endpoint on loopback, with the token. When Unframed is closed, the shim stays up and answers every tool call with "Unframed is not open". When Unframed opens again on a new port, the same shim finds it with no restart of the client.

Every outside call shows up in the app. The first call a connection makes into a project creates that connection's chat in the project, named after the connection. Its tool calls appear in the chat's work log, its writes are grouped into turns with a recap card each, and **Revert this turn** works the way it does for the in-app agent. The person can revoke a connection in Settings, and its next call is refused.

The engine still binds loopback only. Nothing here opens it to the network.

## User Stories

Connecting

1. As a person, I want a Connect an agent button in Settings, so that hooking up an outside agent starts in one place.
2. As a person, I want to choose Claude Code, Codex, the Claude desktop app or another MCP client, so that the setup I get is the one my tool understands.
3. As a person, I want to give a connection a name, so that I can tell "Work laptop Claude Code" from "Codex in the IDE" later.
4. As a person using Claude Code, I want one command to paste into my terminal, so that I do not edit a JSON file by hand.
5. As a person using Codex, I want one command, or a block for `~/.codex/config.toml`, so that the CLI, the IDE extension and the Codex app all pick it up.
6. As a person using the Claude desktop app, I want the block for its config file and where that file lives, so that I can add it without searching.
7. As a person, I want a Copy button on the setup, so that I never retype a token.
8. As a person, I want the setup to work from any repository on my machine, so that I can call Unframed from whichever project I am in.
9. As a person, I want the token shown once with a plain warning, so that I know to keep it out of shared or committed files.
10. As a person, I want the setup to keep working after I quit and reopen Unframed, so that I set it up once.
11. As a person, I want an outside agent to be told plainly that Unframed is not open when I have quit it, so that it says so instead of failing in a confusing way.

Reading

12. As an outside agent, I want to list the projects with their folders and which one is open in the app, so that I can pick the one the person means.
13. As an outside agent, I want to read a project's canvas as shapes with ids, kinds, positions, text, names, file names, recipes and saved parameters, so that I know what is on the board.
14. As an outside agent, I want to read a page's or motion's HTML, so that I can lift a prototype into the repository I work in.
15. As an outside agent, I want the project folder's path, so that I can open the images and clips the canvas names.
16. As an outside agent, I want to be told when the canvas changed since my last call, by the person, another chat or a revert, so that I read again instead of acting on a stale board.

Writing

17. As an outside agent, I want to create and edit canvas shapes with the same ops as the in-app agent, so that I can lay out a board from my terminal.
18. As an outside agent, I want to write pages and motions, new or as new versions of existing ones, so that I can put prototypes on the canvas.
19. As an outside agent, I want to open what I wrote in a headless browser and check it, so that I can verify my work the way the in-app agent does.
20. As an outside agent, I want clear refusals with the same sentences the in-app agent gets, so that I can correct myself.

Seeing and undoing outside work

21. As a person, I want each connection to get its own chat in the project it works in, so that I can see what it did.
22. As a person, I want the outside chat named after the connection, so that I know which agent it was.
23. As a person, I want the outside agent's tool calls in that chat's work log, reads included, so that I can see when something outside the app looks at my canvas.
24. As a person, I want a live dot on the outside chat while it is working, so that I know a change may land.
25. As a person, I want the outside agent's writes grouped into turns with a recap card each, so that I can see what each burst of work touched.
26. As a person, I want Revert this turn on outside work, with the same skip rule for shapes I edited since, so that outside changes are as safe as in-app ones.
27. As a person, I want to revert outside work even while the agent is still active, so that I can stop a bad change without waiting.
28. As a person, I want the outside chat's tags to follow the artifacts it touched, so that selecting an artifact shows the outside chat too.
29. As a person, I want my in-app chats told when an outside agent changed the canvas, so that the in-app agent re-reads before acting.
30. As a person, I want the outside chat's composer to say it cannot send there and offer a new in-app chat instead, so that I never type into a chat nobody will read.
31. As a person, I want the toolbar's Agent button never to continue an outside chat, so that my message always reaches an agent that answers.
32. As a person, I want outside work that was cut off by quitting the app kept and revertable, so that a quit loses nothing.

Revoking and safety

33. As a person, I want to see each connection with its client and when it was last used, so that I can spot one I forgot.
34. As a person, I want to revoke a connection after a confirmation, so that a token I leaked stops working at once.
35. As a person, I want a revoked connection's chats and changes to stay, so that revoking never removes work.
36. As a person, I want the engine still to answer only my own machine, so that a connection never opens Unframed to the network.
37. As a person, I want a connection unable to read my OpenRouter key, change settings, read other chats, or create, rename or delete projects, so that a token reaches the canvas and nothing more.
38. As a person, I want Unframed's own in-app agents never to pick up the outside connection from my user config, so that in-app work stays attributed to the in-app chat.
39. As a maintainer, I want the token stored only as a hash on disk, so that a copy of the data folder does not hand out access.
40. As the desktop shell, I want nothing I rely on to change, so that installed apps keep working with this engine.

## Implementation Decisions

### Words

- **Outside agent**: an agent Unframed did not start (Claude Code, Codex, the Claude or Codex desktop app, any MCP client) that reaches the engine through a connection.
- **Connection**: a named token the person made in Settings. One connection belongs to one client setup.
- **Outside chat**: the chat a connection's calls show in. One per connection per project.
- **Outside turn**: a run of one connection's tool calls into one project, grouped by the idle rule below.

In protocol names the word is `outside`. In UI copy it is "outside Unframed".

### Modules

| Module | Where | Interface | Depth |
| --- | --- | --- | --- |
| Connection store | engine | `create(name, client) -> {connection, token}`, `list()`, `revoke(id)`, `resolve(token) -> connection \| undefined`, `touch(id)` | deep: token minting, hashing, the file, revocation behind five calls |
| Connection setup | domain | `connectionSetup({client, platform, execPath, shimPath, dataDir, token, runAsNode}) -> {steps: [{text, code?, language?}]}` | pure; the quoting and every client's format live here |
| Discovery file | engine | written at boot, removed at shutdown | small |
| Outside binding | engine, in front of spec 07's MCP route | turns a connection token plus a `project` argument into spec 07's `{project, chatId}` binding, opening the outside turn | deep: the chat lookup, the idle rule, change notes, activities |
| Outside turn rule | domain | `outsideTurn({openTurn, lastCallAt, now, idleMs}) -> continue \| settle-then-open \| open` | pure |
| Stdio shim | engine package, its own entry | a process: stdin and stdout MCP, env `UNFRAMED_MCP_TOKEN`, arg `--data-dir` | deep: discovery, relay, offline answers |
| Settings section and outside chat UI | web | spec 10's dialog section, spec 08's rail | small |

The seams stay the three of the index. The shim is driven as a child process at the engine seam.

### Discovery: a stdio shim over a discovery file

The packaged app forks the engine with `PORT=0`, so the API port changes on every launch. This spec picks a stdio shim that reads a discovery file, and not a stable port, for four reasons:

1. **It survives restarts.** The client starts the shim once and keeps it. The shim reads the discovery file on every message, so when Unframed reopens on a new port the client's MCP server is still connected. With a URL in the client config, a new port means a dead server until the person edits the config.
2. **Every client speaks stdio.** The Claude desktop app takes only stdio servers for local tools. Claude Code, Codex (CLI, IDE extension and app) and generic MCP clients all take stdio too. One setup shape covers them all.
3. **No port to collide.** A fixed port can be taken by another program, and the dev engine and the packaged app running at once would fight for it. A fixed, well-known loopback port is also a fixed target for anything on the machine.
4. **It keeps the hosting contract.** The shell sets `PORT=0` on purpose. A stable port would need a second listener the shell does not know about, or a change to how the shell forks the engine.

**The discovery file** is `<data folder>/mcp-endpoint.json`, mode 0600, written with spec 01's temp-then-rename rule after the API listener is bound and before the ready message:

```
{ "port": <API port>, "pid": <engine pid>, "version": "<engine version>", "startedAt": "<ISO>" }
```

A shutdown hook deletes it when it still names this engine's pid. A crash leaves it behind; the shim's pid check below handles that. The engine writes it in every run, hosted or not, so one code path covers a clone and the desktop app (index contract 6).

**The shim** is a second entry of the engine package, beside the engine's own entry: `server/mcp.js` in the published bundle, the shim's TypeScript source beside `main.ts` in a clone (Node 24 runs it directly, as `pnpm engine` runs the engine). It imports only Node built-ins and the tool definitions, and it never opens a project, a database or a socket other than its HTTP requests to the engine.

- **Started as** `<command> <shim path> --data-dir <data folder>` with `UNFRAMED_MCP_TOKEN=<token>` in its environment. `<command>` is the engine's own `process.execPath`: plain `node` in a clone, the desktop app's Electron binary when hosted. When the engine runs with `ELECTRON_RUN_AS_NODE=1` (the shell sets it, spec 01), the setup adds `ELECTRON_RUN_AS_NODE=1` to the shim's environment so the Electron binary runs it as Node. VS Code's `code` command runs its CLI the same way. The person needs no Node install of their own.
- **Reads** newline-delimited JSON-RPC from stdin and writes one JSON-RPC message per line to stdout. Nothing else goes to stdout; logs go to stderr.
- **Per message**: read the discovery file; check its `pid` is a live process; POST the message to `http://127.0.0.1:<port>/mcp` with `Authorization: Bearer <token>`; write the answer back. Notifications get no answer line.
- **Unframed not open** (no file, unreadable file, dead pid, or connection refused): `initialize` and `tools/list` are answered by the shim from its own copy of the outside tool list (built from the same source as the engine's, so the two cannot drift), and every `tools/call` answers a tool error `{"error": "Unframed is not open. Ask the person to open it, then try again."}`. The client sees a healthy server either way, so it never marks Unframed as failed and stops retrying.
- **401 from the engine**: every `tools/call` answers `{"error": "Unframed refused this connection. It was revoked or its token is wrong. The person can make a new one in Unframed's Settings."}`; `initialize` and `tools/list` answer from the shim's copy.
- **No token in its environment**: it starts, and every `tools/call` answers `{"error": "This Unframed connection has no token. Copy the setup from Unframed's Settings again."}`.
- It exits when stdin closes.

The pid check matters for security. Without it, a stale file left by a crash could point at a port that another program has since taken, and the shim would send the token there. A different user's program cannot read the 0600 file. The remaining case is a reused pid that is also listening on that exact port, which this spec accepts and notes below.

### Connections and tokens

- **Token**: `ufx_` then 64 hex characters (256 random bits). The prefix makes a leaked token recognisable in a config file or a log.
- **Store**: `<data folder>/agent-connections.json`, mode 0600, one serialised write chain with temp-then-rename, like spec 01's preferences store:

```
{ "connections": [ { "id": "<uuid>", "name": string, "client": "claude-code" | "codex" | "claude-desktop" | "other",
                     "tokenSha256": "<hex>", "createdAt": ISO, "lastUsedAt": ISO | null } ] }
```

- The plaintext token exists only in `create`'s answer and in the person's client config. The engine keeps the SHA-256 hash and compares hashes in constant time. A copy of the data folder carries no usable token.
- A missing file is no connections. An unparsable file reads as no connections, so every token is refused, and the engine logs `  agent connections: could not read agent-connections.json, so every outside connection is refused until one is made again.` Refusing is the safe failure; the next `create` rewrites the file.
- `lastUsedAt` is written at most once a minute per connection.
- **Name**: trimmed, 1 to 40 characters, else `bad_request`: `Name the connection.` or `Keep the name to 40 characters.` Names need not be unique.
- **Revoke** removes the entry. From that moment the token is refused with 401. A call already running finishes. Every open outside turn of that connection settles (below), its preview tabs close, and each of its outside chats gets an info activity `outside.disconnected`.
- The connection store is engine-wide, per-person state in the data folder, like the preferences store. It holds no project state.

RPC methods (spec 01's group, spec 01's error shape):

| Method | Input | Success | Failures |
| --- | --- | --- | --- |
| `agentConnections.list` | none | `{ connections: [{id, name, client, createdAt, lastUsedAt}] }`, newest first | none |
| `agentConnections.create` | `{ name, client }` | `{ connection, token, setup }`: `setup` is the connection setup module's steps for this platform | `bad_request` for the name; `internal`: `Could not save the connection: <reason>` |
| `agentConnections.revoke` | `{ id }` | `{}` | `not_found`: `That connection no longer exists.`; `internal`: `Could not revoke the connection: <reason>` |

No answer except `create`'s carries a token or a hash.

### The setup each client gets

Built by the pure connection setup module from the client, the platform, the engine's `process.execPath`, the shim path, the data folder, the token and whether `ELECTRON_RUN_AS_NODE` is set. Paths are quoted for the platform's shell (POSIX single quotes, Windows double quotes), because the data folder often holds a space (`Application Support`).

The server name in every setup is **`unframed-app`**, never `unframed`. Spec 07's in-app sessions already use `unframed`, and the in-app Codex session sets `mcp_servers.unframed.url` on the command line, which would merge into a user entry of the same name.

| Client | Steps |
| --- | --- |
| `claude-code` | "Run this in a terminal:" then `claude mcp add --scope user --env UNFRAMED_MCP_TOKEN=<token> [--env ELECTRON_RUN_AS_NODE=1] unframed-app -- <command> <shim> --data-dir <data folder>`. User scope on purpose: project scope writes `.mcp.json` into the repository, where it gets committed. A line says the Claude desktop app's Code tab uses the same setup. |
| `codex` | "Run this in a terminal:" then `codex mcp add unframed-app --env UNFRAMED_MCP_TOKEN=<token> [--env ELECTRON_RUN_AS_NODE=1] -- <command> <shim> --data-dir <data folder>`; then "Or add this to ~/.codex/config.toml:" and the `[mcp_servers.unframed-app]` table with `command`, `args` and `env`. A line says the Codex IDE extension and the Codex app read the same file. |
| `claude-desktop` | "Add this to the `mcpServers` object in" the config file's path (macOS `~/Library/Application Support/Claude/claude_desktop_config.json`, Windows `%APPDATA%\Claude\claude_desktop_config.json`), then the `"unframed-app": {command, args, env}` JSON, then "Restart the Claude app." |
| `other` | "Add this stdio server to your MCP client:" then the same JSON as `claude-desktop`. |

Each client's exact syntax is checked against that client's own documentation when the task is built. If a client no longer accepts a step as written, the task stops and says so (CLAUDE.md: a seam that does not work is a spec problem).

**Moving the app** breaks the setup, because it names the app's current path. The person makes a new connection. See the open questions.

### Keeping in-app sessions off the outside connection

Spec 07's in-app sessions load the person's own settings (`settingSources` user, project and local for Claude; `~/.codex/config.toml` for Codex). A user-scope `unframed-app` server would load into every in-app session, and its writes would land in the outside chat, not the in-app chat. So:

- Claude in-app sessions add `mcp__unframed-app` to `disallowedTools`, which denies every tool of that server.
- Codex in-app sessions add `-c mcp_servers.unframed-app.enabled=false` to their launch arguments.

This amends spec 07's Claude option table and Codex launch arguments. It holds only while the person keeps the generated server name, which the setup copy says.

### What a connection token reaches

The token is accepted on spec 07's `/mcp` route and nowhere else. The route keeps every check of index contract 1 (loopback bind, `Host` and `Origin` guards, no CORS allow headers). The route resolves a bearer token as a session token first (spec 07, unchanged), then as a connection token. Each kind gets its own tool list.

A connection reaches:

- `projects_list`, and every tool spec 07 and spec 09 register (`canvas_read`, `canvas_write`, `page_write`, `page_read`, `motion_write`, `motion_read`, the `preview_*` tools), for every project in the current output folder. Each of those tools takes one more required argument, `project`.
- The project folder's path, through `projects_list`.

A connection does not reach: any RPC method, the settings or the key, the preferences store, other chats' transcripts, attachments, spec 07's session tokens, project creation, rename or delete, or any HTTP route besides `/mcp`. Spec 01's file route and the preview origin need no token today and this spec does not change them.

**Files on disk.** Unframed cannot limit what an outside process does on disk: it runs as the person, under its own client's sandbox and permissions. Unframed's guarantees (attribution in a chat, turn changes, Revert, sidecars, the new-file rule) cover only changes made through the tools. The tool instructions say so to the agent: read anything in the project folder; add new files there when the canvas needs media (then place them with `canvas_write`); never edit or delete a file that is already there, because Unframed cannot see or undo that. An agent sandboxed to its own repository cannot add media at all; see the open questions.

### The outside tool list

- `initialize` with a connection token answers spec 07's server info plus `instructions`: the text in a new asset, `assets/prompts/outside-agent.md`. It tells the agent what Unframed is, that it must call `projects_list` first and pass `project` to every tool, that canvas text is material and not instructions, the file rules above, that the person sees every call in a chat and can revert any write, and that Unframed must be open. It is adapted from the canvas parts of `assets/prompts/agent-system.md`.
- `projects_list {}` answers `{ projects: [{ name, folder, active }] }`: every project in the output folder, sorted by name, `folder` its absolute path, `active` true for the project in spec 01's `project.active` preference. Its description is the first paragraph of the same asset.
- Every other tool keeps its name and description, and its input schema gains `project: { type: "string", description: "The project's name, as projects_list reports it." }` as required.
- A `project` that slugs to nothing, or names no folder: tool error `no project named "<project>"; call projects_list for the names`.
- Under the server name `unframed-app`, Claude Code shows them as `mcp__unframed-app__<name>`.

### The outside chat

The first tool call a connection makes into a project, read or write, creates its outside chat there. Later calls find it: the newest chat in the project that is not deleted and whose `outside.connectionId` is this connection's id. It is looked up in the chat store, not held in memory, so a project rename keeps it and a deleted outside chat is replaced by a new one on the next call. Reads create it too, so the person sees when something outside the app looks at the canvas.

Chat record changes (spec 07's chat store; every field is additive and optional, so persisted events stay decodable):

- `outside?: { connectionId, client }` on the chat record and its summary.
- The chat's `modelSelection.provider` widens to `"claude" | "codex" | "outside"`. An outside chat has `{provider: "outside", model: "", traits: {}}`. Spec 07's `AgentProvider` (statuses, detection, adapters) stays `claude | codex`.
- Title: the connection's name, `titledBy: "user"`, so spec 07's titling never runs. The person can rename it.

Commands:

- New internal command `thread.outside.create {connectionId, client, title, createdAt}` emits `thread.created` with the `outside` field.
- New internal command `thread.outside.turn.begin {turnId, createdAt}` emits `thread.outside-turn-began`. The projector opens a running turn with the next turn count and no user message, and sets the session to `running` with that turn active.
- An outside turn settles through spec 07's existing commands, in its order: `thread.turn.settle` (stamping `lastClock`), `thread.turn.files.complete`, then `thread.session.set` to `ready`.
- From the web, `thread.create` with provider `outside` is refused (`bad_request`: `Only an outside agent's first call makes an outside chat.`). `thread.turn.start`, `thread.meta.update` with a `modelSelection`, `thread.runtime-mode.set`, `thread.interaction-mode.set` and `thread.checkpoint.revert` on an outside chat are refused (`conflict`: `This chat belongs to an agent outside Unframed. Talk to it where it runs.`). `thread.meta.update` with a title, `thread.delete` (while no turn is open) and `thread.turn.revert` work.

What the outside chat holds and does:

- **Activities**: every outside tool call appends the same activities runtime ingestion appends for an in-app `mcp_tool_call` item (started, then completed or failed, with the tool name and input), so spec 08's work log labels them unchanged ("Read the canvas", "Changed the canvas (N changes)", "Wrote page <title>"). Spec 09's artifact tools append their `artifact.written` activity as they do now.
- **Selection**: `canvas_read` answers `selection: []` for an outside chat, because no message carried one. See the open questions.
- **Plan mode** does not apply: an outside chat's interaction mode is always `default`.
- **Tags**: spec 07's tag reactor, unchanged. Writes to artifacts tag the outside chat.
- **Turn changes**: recorded under the open outside turn exactly as for an in-app turn.
- **Sidecars**: artifact files the outside agent writes get spec 09's agent sidecar with the outside chat's id and turn. An outside turn writes **no** agent-turn sidecar: Unframed did not run that agent and knows nothing of its usage or billing.
- **No messages** from either side: the transcript is work log rows, recap cards and notes.

### Outside turns

An outside chat has no prompt boundary Unframed can see. MCP clients do not tell a server when the person sends a new message. So turns are grouped by idle time:

- A tool call into a project with no open outside turn for this connection opens one (`thread.outside.turn.begin`).
- A call within **2 minutes** of the previous call joins the open turn.
- The open turn settles 2 minutes after its last call ends. `UNFRAMED_TEST_OUTSIDE_TURN_IDLE_MS` (a new row in spec 01's test-only table) replaces the 2 minutes.
- It also settles when the connection is revoked, when the project closes through spec 01's open-project registry (rename, delete, output folder change, shutdown), and when the person reverts it.
- A call that arrives after the turn settled opens the next turn.

Two minutes is a proposal, flagged in the open questions. Shorter splits one long piece of work (an agent can spend over a minute writing one large page) into several turns. Longer merges the work of two prompts into one turn, so one Revert undoes both.

**Revert of an open outside turn** is allowed, unlike spec 07's rule for in-app chats ("Wait for the turn to finish before reverting."), because the person cannot stop an outside agent from inside Unframed. `thread.turn.revert` on the open turn first settles it, then reverts it with spec 07's skip rule. The agent's next call opens a new turn and carries the revert in its change note.

**Engine restart.** Spec 07's reconciliation marks an in-app turn that a quit cut off as failed. An outside turn found open at boot settles as `completed` instead, with its turn changes intact and revertable. Nothing failed: the agent simply stopped being heard.

**Preview tabs.** Spec 09 closes a chat's preview tab when its session closes. For an outside chat that is when its outside turn settles, and on revoke.

### Change notes for outside agents

An outside agent gets no preamble. Instead, when the canvas changed since this outside chat's last call ended, by the person, another chat or a revert of this chat's turns, the tool result carries a second text content item before the JSON: the change note sentence from spec 07 (`assets/prompts/change-note.md`, counted from the change log past the outside chat's last call clock, excluding `system` rows and this chat's own rows). The engine keeps that clock per outside chat in memory and starts it at the chat's `lastClock` after a restart.

In-app chats need no change: an outside write has origin `chat:<outside chat id>`, so spec 07's change note already counts it as "another chat".

### Settings

A new block in spec 10's settings dialog, directly after Local agents, inside the part shown only with a key (spec 10 hides sections 5 to 7 without one; see the open questions):

- Heading `Agents outside Unframed`, then the line `Let Claude Code, Codex or another MCP client on this computer read and change your canvas while Unframed is open.`
- One row per connection: the name, the client's label (`Claude Code`, `Codex`, `Claude app`, `MCP client`), and `Last used <relative time>` or `Never used`, then a ghost `Revoke` button.
- An outline `Connect an agent` button with a plug icon.

**Connect an agent** opens the kit Dialog (spec 12), 520 px:

1. The client as a kit radio group: `Claude Code`, `Codex`, `Claude desktop app`, `Another MCP client`. Default Claude Code.
2. A name field labelled `Name`, filled with the client's label until the person types.
3. Footer: ghost `Cancel`, primary `Create connection` (Spinner while saving).

After creating, the same dialog shows the setup: each step's text, and its code in t3code's code block frame with `Copy` (turning `Copied` for 1.2 s), as spec 08's code blocks do. Under the steps, the kit's warning Alert: `This setup holds a key to your canvas. Unframed shows it once. Keep it out of files you share or commit.` Footer: primary `Done`. Closing the dialog drops the token from the web's memory.

**Revoke** asks in the kit's alert dialog: title `Revoke <name>?`, description `The agent loses access at once. Its chats and the changes it made stay.`, destructive action `Revoke`. Then the row is gone.

### The outside chat in the rail

- **Tab**: the chat's title, a live dot while its outside turn is open, tooltip `<title> · <client label>, outside Unframed`.
- **Transcript**: work log rows and spec 08's recap card per turn, with Open, Locate, View diff and Revert this turn. Revert shows on the open turn too (above). While a turn is open the activity line reads `Working from outside Unframed…` with spec 08's elapsed clock.
- **Notes**: an empty outside chat never exists (its first call makes a row). After revoke, an info line at the foot: `Disconnected. This connection was revoked in Settings.`
- **Composer**: with an outside chat active, the Agent tray is replaced by a line, `<title> works from outside Unframed. Talk to it where it runs.`, and an outline `New chat` button that starts an in-app chat. No Send, no pickers, no Edit from here.
- **Continuable chat** (spec 08's domain rule): outside chats are never continuable, so the toolbar's Agent button and the editor's add-a-parameter box never send into one.
- Search, tags, the filter and Delete work as for any chat.

### The hosting contract with the desktop shell

Everything here is additive, and an installed shell keeps working with no change:

- **Environment variables**: none new from the shell. The engine reads `ELECTRON_RUN_AS_NODE`, Electron's own variable that the shell already sets, only to write it into the setup.
- **IPC messages**: unchanged.
- **Banner**: unchanged. The discovery file is not announced on stdout.
- **DOM hooks**: unchanged.
- **Bundle layout**: one new file, `server/mcp.js`, beside `server/index.js`. Spec 01 allows only chunk files there today, so this is a new entry, but nothing in the shell lists that folder. The shell never runs it; the person's MCP client does, through the Electron binary.
- **Data folder**: two new files, `mcp-endpoint.json` and `agent-connections.json`. The shell reads neither.

Still to check inside the desktop app, by hand: that `ELECTRON_RUN_AS_NODE=1 <app binary> <bundle>/server/mcp.js` runs where the shell installs the bundle (inside or outside an asar archive), launched by Claude Code, Codex and the Claude app.

### Rules this spec bends

Each bend is deliberate. The task that builds it updates the bent passage in the same commit (see Spec text).

1. **Index contract 1** lists "the MCP endpoint for the local agents, behind a per-session bearer token (spec 07)". The endpoint now also accepts long-lived connection tokens, held by processes Unframed did not start. Every loopback check stays. Why: the person decided outside agents read and write from day one.
2. **Index contract 8** lists what may live outside a project folder. The connection store and the discovery file join the data-folder exceptions. Neither holds project state.
3. **Spec 01, Out of Scope**: "Remote access, pairing tokens, LAN or tunnel access to the engine: not built. The engine is loopback only with no opt-in." This spec builds pairing tokens for local clients. Remote, LAN and tunnel access stay unbuilt and the engine stays loopback only with no opt-in.
4. **Spec 01, Out of Scope** and **spec 07, Out of Scope** (decision Q16): "t3code's terminal, mobile app, remote access". A terminal agent now reaches the engine. This is not t3code's terminal drawer, which stays unbuilt, and not remote access, since everything runs on the same machine.
5. **Spec 01, the published bundle**: a second entry, `server/mcp.js`. **Spec 01, test-only variables**: a new row, `UNFRAMED_TEST_OUTSIDE_TURN_IDLE_MS`, used by 14.
6. **Spec 07, the MCP server**: "each provider session gets a fresh 256-bit token bound to one project and one chat, revoked when the session closes". A second token kind, bound to a connection, persisted, revoked only by the person.
7. **Spec 07, the chat record**: a chat's provider can be `outside`, and a turn can exist with no user message.
8. **Spec 07, revert**: an outside chat's open turn can be reverted (it settles first). In-app chats keep "Wait for the turn to finish before reverting."
9. **Spec 07, restart reconciliation**: an outside turn found open at boot settles `completed`, not failed with the quit-mid-turn sentence.
10. **Spec 07, the agent turn sidecar**: "Every settled turn, failed or not, writes `<epochMs>-agent[-n].json`". Outside turns write none. Index contract 4 still holds: no outside turn is a paid run and none carries a `cost`.
11. **Spec 07, provider adapters**: in-app Claude sessions add `mcp__unframed-app` to `disallowedTools`; in-app Codex sessions add `-c mcp_servers.unframed-app.enabled=false`.
12. **Spec 08**: the continuable chat rule excludes outside chats; the rail's composer, tab tooltip, activity line and Revert visibility differ for an outside chat.
13. **Spec 10, the settings dialog**: a new block after Local agents.

## Testing Decisions

A good test drives an outside agent the way a client does (MCP messages to `/mcp` with a connection token, or through the shim as a child process over stdio) and the person the way the web does (RPC and the rail), then asserts on what the engine holds: the chat's projection, the canvas, the files in the project folder, the store files in the data folder. It never reaches into the connection store's memory, the binding cache or a reactor.

- **Domain seam** for the pure rules with many cases: the connection setup per client and platform (quoting, the server name, the optional `ELECTRON_RUN_AS_NODE`, user scope), the outside turn rule, the decider's refusals for outside chats and the projector's turn without a message, the continuable chat rule excluding outside chats, and the Claude option mapping that disallows `mcp__unframed-app`.
- **Engine seam** for everything else on the engine side: the engine forked as spec 01's harness does, with `UNFRAMED_TEST_OUTSIDE_TURN_IDLE_MS` short. Tests read `mcp-endpoint.json` from the temp data folder, create a connection over RPC, and drive `/mcp` with spec 07's `McpClient` carrying the connection token. The shim runs as a real child process (`node <shim> --data-dir <temp data folder>`) with the token in its environment, and the test talks to it over stdin and stdout. Canvas state is seeded and checked with a sync client, as spec 07's tests do. The Codex launch argument is checked against spec 07's fake `codex app-server`, which records its arguments.
- **Browser seam** for the Settings block and the rail: Playwright against the built web served by an engine at the engine seam, while the test drives `/mcp` with the token the dialog showed.
- **Manual, and said so**: a real Claude Code, a real Codex and the real Claude desktop app each connected through the generated setup, once per change to the setup text; and the shim run through the packaged desktop app's Electron binary.

Prior art: spec 07's MCP auth test (task 17) and scripted-agent canvas tests, spec 09's artifact tool tests, spec 01's bundle smoke test for running a bundled entry, spec 10's settings dialog tests.

## Tasks

1. **Connection setup.** For each client on macOS, Linux and Windows: the steps and their exact code, paths with spaces quoted for the platform, the server name `unframed-app`, `--scope user` for Claude Code, the Codex `config.toml` table, the Claude app config path, and the `ELECTRON_RUN_AS_NODE` line only when asked for. Seam: domain.
2. **Outside turn rule.** No open turn opens one; a call within the idle time continues; a call after it settles and opens the next. Seam: domain.
3. **Decider and projector for outside chats.** `thread.outside.create` makes a chat with `outside` and provider `outside`; `thread.outside.turn.begin` opens a running turn with no message; every refusal sentence for web commands on an outside chat; `thread.create` with provider `outside` refused. Seam: domain.
4. **Continuable chat.** An outside chat tagged with every selected artifact is still never the continuable chat. Seam: domain.
5. **Discovery file.** After the ready message, `mcp-endpoint.json` holds the API port, the pid and the version, mode 0600; SIGTERM removes it; a second start writes the new port. Seam: engine.
6. **Create, list, revoke.** `agentConnections.create` answers a `ufx_` token once with the setup; `agentConnections.list` never carries a token or hash; `agent-connections.json` is mode 0600 and holds only the hash; name refusals; revoking an unknown id answers `not_found`. Seam: engine.
7. **The token on `/mcp`.** With a connection token, `initialize` answers the outside instructions and `tools/list` answers `projects_list` plus every registered tool with a required `project`; no token, a wrong token and a revoked token get 401; a non-loopback `Origin` gets 403. A connection persists across an engine restart; an unparsable store refuses every token and logs its line. Seam: engine.
8. **`projects_list`.** Every project with its absolute folder, sorted, and `active` on the one in `project.active`. Seam: engine.
9. **The outside chat appears.** A first `canvas_read` naming a project creates one outside chat there, titled with the connection's name, with tool activities for the call; a second call reuses it; another connection gets its own chat; an unknown project answers its refusal and creates nothing; a deleted outside chat is replaced on the next call. Seam: engine.
10. **`canvas_read` and `canvas_write` from outside.** The read matches the in-app view with `selection: []`. A write lands as one room change with origin `chat:<outside chat id>`, a sync client sees it, and it is recorded under the open outside turn; writing to a page tags the outside chat. Seam: engine.
11. **Artifact tools from outside.** `page_write` and `motion_write` create and update artifacts with their files, library and agent sidecars naming the outside chat and turn; `page_read` returns the HTML. Seam: engine.
12. **Turns by idle time.** Calls within the test idle time form one turn; after it the turn settles (`lastClock`, its files) with no agent-turn sidecar in the project folder, and the next call opens turn 2. Seam: engine.
13. **Revert outside work.** `thread.turn.revert` on a settled outside turn restores the canvas and skips a shape a sync client edited since; on the open turn it settles the turn first, then reverts it. Seam: engine.
14. **Change notes both ways.** After a sync client edits the canvas, the outside agent's next tool result starts with the change note; after a revert of its turn, the note names the revert. An in-app chat's next preamble counts the outside write as another chat (spec 07's bulk-edit fixture pattern with `expectPreamble`). Seam: engine.
15. **Revoke.** After `agentConnections.revoke`, the next call gets 401, the open outside turn settles, the outside chats and their canvas changes stay, and each gets the `outside.disconnected` activity. Seam: engine.
16. **Quit mid-turn.** Kill the engine with SIGKILL while an outside turn is open and restart it: the turn reads `completed`, not failed, and reverts. Seam: engine.
17. **Project lifecycle.** Renaming a project through spec 10 settles its open outside turn; the next call naming the new name finds the same outside chat; the old name answers the no-project refusal. Seam: engine.
18. **The shim relays.** A shim child process with the token answers `initialize` and `tools/list` (equal to the engine's outside list) and a `tools/call` round trip through the engine; stdout carries only JSON-RPC lines; a notification gets no line. Seam: engine.
19. **The shim survives the app.** With no engine running, the shim answers `initialize` and `tools/list` from its own copy and `tools/call` with the not-open error; a stale discovery file with a dead pid behaves the same; then an engine starts on a new port and the same shim process reaches it. A revoked token answers the refused sentence; no token answers the no-token sentence. Seam: engine.
20. **In-app Claude sessions skip the outside server.** The Claude option mapping adds `mcp__unframed-app` to `disallowedTools` in every runtime mode. Seam: domain.
21. **In-app Codex sessions skip the outside server.** The fake `codex app-server` records `-c mcp_servers.unframed-app.enabled=false` among its launch arguments. Seam: engine.
22. **Bundle.** `pnpm build` writes `server/mcp.js`; the bundle smoke test starts the bundled engine, then the bundled shim, and lists the tools through it. Seam: engine.
23. **Connect an agent.** In Settings, the block lists no connections, Connect an agent opens the dialog, choosing Codex and a name shows Codex's steps with Copy and the warning, Done closes it, and the row shows `Never used`; after the test drives `/mcp` with the shown token, reopening shows `Last used`. Seam: browser.
24. **Revoke in Settings.** Revoke asks first, then the row is gone, the next `/mcp` call gets 401, and the outside chat in the rail shows the disconnected line. Seam: browser.
25. **The outside chat in the rail.** Driving `/mcp` from the test, the rail shows the outside chat's tab with its live dot while the turn is open, work log rows with spec 08's labels, the activity line, and a recap card whose Revert this turn restores the canvas; the composer shows the outside line and New chat; the toolbar's Agent button with the touched artifact selected says "new chat". Seam: browser.

## Out of Scope

- Remote, LAN or tunnel access to the engine, and any outside client on another machine.
- A headless engine, or any way to reach the canvas while Unframed is closed (decision 3).
- Streamable HTTP setups that point a client straight at `/mcp`. The endpoint would accept them, but the port changes every launch, so no setup offers one.
- Outside agents creating, renaming or deleting projects, changing settings, reading the key, reading or sending messages in other chats, or uploading attachments.
- Sending messages to an outside agent from Unframed, and outside agents posting messages into their chat.
- Per-project connection tokens or read-only connections.
- Showing the token again after the setup dialog closes.
- Undoing changes an outside agent makes to files directly on disk, outside the tools.
- t3code's terminal drawer, mobile app and remote environments, which stay unbuilt (decision Q16).

## Further Notes

### Open questions for the person

The decisions given settle what this spec builds. These do not, and the spec marks its own answer to each as a proposal:

1. **What one Revert undoes.** Turns are grouped by 2 minutes of quiet (proposed). The alternatives: every write call is its own turn (precise, but a recap card per call), or one turn per client session (one Revert undoes a whole terminal session). Which unit should Revert take back, and is 2 minutes right?
2. **One chat per connection per project, forever** (decision 4 as read here), or a new chat each time the client starts a session (each `claude` run in a terminal)? With the first, a connection used daily grows one long chat.
3. **Which projects a connection reaches.** Every project in the output folder (proposed, from "list projects" in decision 1), or one project chosen when the connection is made?
4. **The person's selection.** Should `canvas_read` give outside agents what is selected in the app, so "make the selected ones red" works from a terminal? Proposed: not now, `selection` is empty.
5. **Media from a sandboxed agent.** An outside agent sandboxed to its own repository cannot write into the project folder, so it cannot add an image. Should there be a tool that copies a file from the agent's machine into a project? Proposed: not now.
6. **The token shown once** (proposed, so the engine stores only a hash), or shown again from Settings (which means storing it in plaintext)?
7. **Settings without an OpenRouter key.** The block sits with the agent settings, which spec 10 hides until a key exists. Should a person who only uses outside agents see it without a key?
8. **Moving the app** breaks every setup, because the setup names the app binary's path. Acceptable (proposed), or should the engine install a stable launcher, for example `~/.unframed/bin/unframed-mcp`, and point setups at it?
9. **Turn sidecars.** Outside turns write none (proposed). Should they write one with `billing: "external"` and no usage, so every turn of every chat leaves a file?
10. **A message from the outside agent.** Should outside agents be able to post a short summary into their chat, so the transcript says what they did in words and not only in tool rows? Proposed: not now.

### Other notes

- Why the same `/mcp` path and not a second route: the tools, their refusals and their handlers are spec 07's and spec 09's, unchanged. The token decides who is calling, and the outside binding adds `project` and the chat. A second route would be a second copy of the MCP server to keep in step.
- Why reads create the outside chat: a person should see that something outside the app read their canvas, even when it changed nothing.
- The residual risk in discovery: after a crash, if a reused pid belongs to a process listening on the stale port, the shim sends the token there. That needs a crash, a pid reuse and a port match at once, and revoking the connection ends it. A challenge-response before the token is sent would close it, at the cost of a second request per message; this spec does not build it.
- Codex starts stdio MCP servers with a short list of environment variables plus the server's own `env` table, which is why the token and `ELECTRON_RUN_AS_NODE` go in the setup's `env` and not in the person's shell.
- The connection token is the one secret in the person's client config files (`~/.claude.json`, `~/.codex/config.toml`, the Claude app's config). Those files are readable by the person's account, the same as `.env`.

### Spec text

Each task updates the passages it bends, in the same commit, so the specs describe the app as built:

- 00 index: contract 1 names connection tokens beside session tokens; contract 8 adds the connection store and discovery file; the vocabulary gains **outside agent**, **connection** and **outside chat**.
- 01: Out of Scope (pairing tokens; the terminal line), the published bundle (`server/mcp.js`), the test-only table (`UNFRAMED_TEST_OUTSIDE_TURN_IDLE_MS`, used by 14).
- 07: the MCP server section (the second token kind), the chat record (provider `outside`, the `outside` field, a turn with no message), revert, restart reconciliation, the turn sidecar, the Claude option table and Codex launch arguments, Out of Scope (Q16).
- 08: the continuable chat rule, the rail's composer and tab for an outside chat.
- 10: the settings dialog's new block.

### Assets this spec needs

- `assets/prompts/outside-agent.md`: new. The `initialize` instructions for a connection and, as its first paragraph, the `projects_list` description. Adapted from the canvas parts of `assets/prompts/agent-system.md`, plus the project argument, the file rules and the not-open behaviour.
