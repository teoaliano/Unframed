# The agent, and the local providers it runs on

Owns: how Claude and Codex on the user's machine are detected, how an agent thread runs
and what it is allowed to touch, and the routes behind the Agent panel. Design and the
decisions behind it: `docs/superpowers/specs/2026-09-04-agent-canvas-slice-1-design.md`.
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
everything around them. In this slice it can only **read** the canvas (one tool,
`canvas_read`). Writing — creating a page asset, editing nodes — is the next slice.

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

### Routes

Nested under the project, because the record lives in its folder and follows it through
a rename:

| Route | Does |
| --- | --- |
| `POST /api/projects/:name/threads` | create (`{ provider, model }`) |
| `GET /api/projects/:name/threads` | list, newest first |
| `GET /api/projects/:name/threads/:id` | the record |
| `POST …/:id/messages` | one turn: `{ text, selection }`; 409 while the previous one runs |
| `GET …/:id/events?since=` | SSE: `state`, stored events past `since`, `live`, then everything as it happens |
| `POST …/:id/interrupt` | stop the running turn |
| `DELETE …/:id` | remove the record |

The browser's selection travels with each message. The server never holds it otherwise;
`canvas_read` reports the latest one for that thread.

## The Agent panel (`client/src/agent/AgentPanel.jsx`)

The Agent button in the chrome opens a right-hand panel with the project's Canvas
thread. Everything durable is the server's; the panel mirrors the record and applies the
stream. With no provider ready it shows what was checked, how to install, and Check
again, with Send disabled — that is the design's state 10. Settings has a Local agents
section with the same statuses and the path overrides.

## Codex

Detected and shown alongside Claude. Sessions run on Claude in this slice: Codex needs
the same tools reachable over stdio rather than in-process, a second transport for the
same tool definitions, and it is the first follow-up.
