# Using a user's existing Claude / Codex / OpenCode subscription — research notes

Researched 2026-08-21. Question: **how does `pingdotgg/t3code` pick up a locally installed,
already-logged-in Claude Code / Codex / OpenCode / Grok subscription with zero setup, is it a
sanctioned mechanism, and could Unframed offer the same for text output nodes as an
alternative to OpenRouter?**

Primary sources only: t3code's own source (shallow clone of `main`, 2026-08-21), Anthropic's
docs and support articles, OpenAI's Codex docs, and Unframed's own code. Every factual line
carries the URL or file path that owns it. Lines marked **(inference)** are my reasoning, not a
quoted source. Not legal advice.

## TL;DR

- **There is no magic detection and no OAuth.** t3code never authenticates anybody. It spawns
  the provider's own CLI binary as a child process on the user's machine, and the CLI reads its
  own credentials from its own config dir (`~/.claude`, `$CODEX_HOME`). t3code's README says so
  outright: *"Install and authenticate at least one provider before use"*
  (<https://github.com/pingdotgg/t3code>). The "zero setup" feeling is just that the binary is
  already on `PATH` and already logged in.
- **Three different transports, one per provider.** Claude → the official Agent SDK pointed at
  the local binary, plus `claude -p` for one-shot structured text. Codex → `codex exec` with
  `--output-schema`. OpenCode → its own local HTTP server. Grok/Cursor → ACP.
- **Detection is a two-step probe:** run `<binary> --version` (tells you *installed*), then ask
  the Agent SDK for `initializationResult()` without ever sending a prompt (tells you
  *logged in*, plus the account email and subscription tier, for zero tokens and zero money).
- **Anthropic's position is genuinely two-sided and the distinction matters.** The Agent SDK
  overview forbids third-party developers *offering claude.ai login*; the support article
  explicitly names *"third-party apps that authenticate with your Claude subscription through
  the Agent SDK"* as a real, accounted-for category. Reconciling them: you may not build your
  own claude.ai OAuth flow; you may spawn a CLI the user logged in themselves. **(inference)**
- **OpenAI has not put the equivalent in writing.** The closest thing is an OpenAI engineer on
  the Codex repo saying the code is Apache-2.0 and you may fork it, then explicitly declining
  to answer the ToS question.
- **For Unframed this is a text-node-only feature.** Neither `claude -p` nor `codex exec`
  generates images or video. Image and video output nodes stay on OpenRouter regardless.
- **What it costs to be wrong is asymmetric:** the mechanism is cheap to build and the ToS
  exposure lands on the commercial side, i.e. the private repo, not this one.

## 1. What t3code actually is

An "agent harness control surface" — a Node WebSocket server that wraps provider CLIs and
serves web, desktop, and mobile clients. Supported providers per the README: Codex, Claude,
Cursor, Grok Build, OpenCode (<https://github.com/pingdotgg/t3code>).

The README is unambiguous that setup is the user's job:

> "T3 Code currently supports Codex, Claude, Cursor, Grok Build and OpenCode. Install and
> authenticate at least one provider before use"
> — <https://github.com/pingdotgg/t3code/blob/main/README.md>

So the thing that felt like auto-detection is: t3code found a binary on `PATH` that was already
holding a valid session. That is the whole trick. **(inference)**

## 2. How each provider is driven

All of it lives under `apps/server/src/provider/Drivers/` and
`apps/server/src/textGeneration/` in the t3code clone.

| Provider | Driver kind | Transport | npm package it manages |
| --- | --- | --- | --- |
| Claude Code | `claudeAgent` | Agent SDK (`claudeQuery`) + `claude -p` | `@anthropic-ai/claude-code` |
| Codex | `codex` | `codex exec` subprocess | `@openai/codex` |
| OpenCode | `opencode` | local HTTP server process | `opencode-ai` |
| Grok / Cursor | `grok` / `cursor` | ACP (agent client protocol) | — |

Source: `apps/server/src/provider/Drivers/{Claude,Codex,OpenCode,Grok,Cursor}Driver.ts`, each
declaring `DRIVER_KIND` and `npmPackageName`.

### 2.1 Claude — the one that matters most for Unframed

Two distinct paths, and t3code uses both for different jobs.

**(a) One-shot structured text — `claude -p`.** This is the exact shape Unframed's text output
node needs. From `apps/server/src/textGeneration/ClaudeTextGeneration.ts`, the spawned argv is:

```
claude -p
  --output-format json
  --json-schema <json-schema-string>
  --model <api-model-id>
  [--effort <low|medium|high>]
  [--settings <json>]
  --dangerously-skip-permissions
```

The prompt goes in on **stdin**, not as an argv arg. stdout is a JSON envelope and only
`structured_output` is read:

```js
const ClaudeOutputEnvelope = Schema.Struct({ structured_output: Schema.Unknown });
```

Timeout is 180 s (`CLAUDE_TIMEOUT_MS = 180_000`). Non-zero exit → stderr becomes the error
detail. Anthropic documents this same non-SDK escape hatch: *"To drive the same agent loop from
another language, run the CLI as a subprocess with the `-p` flag and `--output-format json`"*
(<https://code.claude.com/docs/en/agent-sdk/overview>).

**(b) The auth/capability probe — Agent SDK, prompt that never yields.** This is the clever bit,
from `apps/server/src/provider/Layers/ClaudeProvider.ts` (`probeClaudeCapabilities`):

```js
const q = claudeQuery({
  // Never yield — we only need initialization data, not a conversation.
  // This prevents any prompt from reaching the Anthropic API.
  prompt: (async function* () { await waitForAbortSignal(abort.signal); })(),
  options: buildClaudeCapabilitiesProbeQueryOptions({ executablePath, abortController, environment, cwd }),
});
const init = await q.initializationResult();
// init.account → { email, subscriptionType, tokenSource, apiProvider }
```

An async generator that awaits an abort signal and never yields a message. `initializationResult()`
still resolves, carrying `account.email`, `account.subscriptionType` and `account.tokenSource` —
so you learn *who is logged in and on what plan* without spending a token. Result cached for
5 minutes (`CAPABILITIES_PROBE_TTL = Duration.minutes(5)`).

`checkClaudeProviderStatus` in the same file layers that on top of a `--version` run, and the
distinction between the two failure modes is the whole UX:

- spawn fails with a command-missing cause → `installed: false`, *"Claude Agent CLI (`claude`) is
  not installed or not on PATH."*
- `--version` works but the probe fails → `installed: true`, `auth: { status: "unknown" }`,
  *"Could not verify Claude authentication status from initialization result."*
- both work → `status: "ready"`, `auth: { status: "authenticated", email, … }`

**(c) Config isolation — and a trap worth stealing verbatim.** `Drivers/ClaudeHome.ts` sets
`CLAUDE_CONFIG_DIR`, and its comment explains why not `HOME`:

> "Isolate this instance's config via CLAUDE_CONFIG_DIR rather than HOME. Overriding HOME also
> relocates the macOS login keychain lookup ($HOME/Library/Keychains), so the spawned CLI can't
> find its stored OAuth credentials and reports 'Not logged in'."

So: on macOS the subscription credential lives in the **login keychain**, not in a file. Any
child process that loses `HOME` loses the subscription.

### 2.2 Codex

`apps/server/src/textGeneration/CodexTextGeneration.ts` spawns:

```
codex exec [launch args] --ephemeral --skip-git-repo-check
  --model <id>
  --config <k=v> [--config service_tier="…"]
  --output-schema <schema-file>
  --output-last-message <output-file>
  [--image <path>]…
```

Note the schema and the result travel through **temp files**, not stdout, and `CODEX_HOME` scopes
the credentials. Every one of those flags is in OpenAI's own CLI reference: `--output-schema`
takes a JSON Schema file, `--output-last-message, -o` writes the final assistant message to a
file, `--json` emits newline-delimited events, `--image, -i` attaches images to the prompt, and
credentials persist in `$CODEX_HOME`
(<https://learn.chatgpt.com/docs/developer-commands?surface=cli>, the current target of
`developers.openai.com/codex/cli/reference`). The same page recommends pairing `--json` with
`--output-last-message` for CI — i.e. non-interactive use is a documented workflow.

Auth methods per that page: `codex login` (browser OAuth), `codex login --with-api-key` (stdin),
`codex login --with-access-token` (stdin).

### 2.3 The `PATH` problem — the actual reason "zero setup" is hard in a packaged app

`apps/server/src/os-jank.ts` exists solely for this. A GUI-launched app on macOS does not inherit
the user's shell `PATH`, so `claude` and `codex` are invisible even though the terminal finds them
instantly. t3code's `fixPath()`:

1. iterates `listLoginShellCandidates(platform, env.SHELL)` and runs each login shell to read its
   `PATH` (`readPathFromLoginShell`),
2. on darwin, falls back to `readPathFromLaunchctl()` if no shell answered,
3. merges the result into `env.PATH` (`mergePathEntries`),
4. separately, `hydratePosixHome()` fills in `HOME` if empty — which, per §2.1(c), is what keeps
   the keychain reachable.

There is also `Drivers/ClaudeExecutable.ts`, a Windows-only wrinkle: the Agent SDK's
`pathToClaudeCodeExecutable` spawns without a shell and without `PATHEXT` resolution, so a bare
`claude` or an npm `claude.cmd` shim fails (`spawn EINVAL` since Node 20.12). It resolves the shim
to the real package entry — `node_modules/@anthropic-ai/claude-code/bin/claude.exe`, or `cli.js`
on older versions.

The default configured binary is just the bare command name — `makeBinaryPathSetting("claude")` /
`("codex")` in `packages/contracts/src/settings.ts` — user-overridable to an absolute path.

## 3. Is this sanctioned? Read both Anthropic pages, not one

This is the part worth being precise about, because the two official pages point in opposite
directions until you notice what each is actually forbidding.

**The Agent SDK overview carries this note:**

> "Unless previously approved, Anthropic does not allow third party developers to offer
> claude.ai login or rate limits for their products, including agents built on the Claude Agent
> SDK. Use the API key authentication methods described in the Quickstart instead."
> — <https://code.claude.com/docs/en/agent-sdk/overview>

**The support article names the opposite case as a real category.** "Use the Claude Agent SDK with
your Claude plan" lists what a (planned) monthly Agent SDK credit would cover, and one of the
covered items is *"third-party apps that authenticate with your Claude subscription through the
Agent SDK."* It excludes interactive Claude Code in the terminal or IDE, Claude conversations on
web/desktop/mobile, and Claude Cowork. It also carries a status banner:

> "We're pausing the changes to Claude Agent SDK usage described below. For now, nothing has
> changed: Claude Agent SDK, `claude -p`, and third-party app usage still draw from your
> subscription's usage limits."
> — <https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan>
> (banner dated 2026-06-15)

**How they reconcile (inference).** The prohibition is on a developer *offering* claude.ai login —
building an OAuth flow into your product so that your product signs users into claude.ai and
consumes their subscription as your product's inference supply. What t3code does is categorically
different: it offers no login at all, holds no credential, and never sees one. The user installs
Anthropic's own CLI, runs Anthropic's own login, and the credential stays in their keychain; the
app spawns that binary locally. That is what the support article means by "third-party app usage,"
and it is a named, metered, accounted-for thing rather than a loophole.

Two consequences worth writing down:

- Today, runs through a user's plan **draw from their normal subscription limits**. There is no
  credit and no approval process to apply to (the pause removed both).
- Use of the Agent SDK is governed by **Anthropic's Commercial Terms of Service**, explicitly
  including when used to power products you make available to your own customers
  (<https://code.claude.com/docs/en/agent-sdk/overview>). That is a commercial-side question, so
  it belongs to the private repo, not here.

**Branding is a hard constraint, and it is specific.** Same page: permitted are "Claude Agent",
"Claude" inside a menu already labelled "Agents", and "{YourAgentName} Powered by Claude". *Not*
permitted: "Claude Code", "Claude Code Agent", or Claude Code-branded ASCII/visual elements. So an
Unframed model picker may not list a provider called "Claude Code."

**OpenAI has not written the equivalent down.** In `openai/codex` discussion #8338, asked directly
whether forking the CLI and using "Sign in with ChatGPT" complies with the ToS, an OpenAI
maintainer (`etraut-openai`) confirmed the license and declined the legal question:

> "The codex CLI sources are licensed under a permissive Apache license, and you're welcome to
> fork the repo and make modifications to suit your own needs."

> "I'm an engineer, not a lawyer, so I'm not qualified to answer your questions in detail."
> — <https://github.com/openai/codex/discussions/8338>

**(inference)** Spawning the *unmodified, official* `codex` binary is a materially weaker claim
than forking it, and OpenAI's own docs document non-interactive `codex exec` for automation. But
there is no OpenAI statement equivalent to Anthropic's support article, so Codex support carries
strictly more uncertainty than Claude support does.

## 4. What Unframed could actually do with this

### 4.1 Where it fits, and where it does not

Unframed's text output node already has exactly the right shape: `TextOutputNode.onRun` →
`POST /api/text` → OpenRouter `chat/completions` → answer into `node.data.result`, which feeds
back into other prompts by `@id`. A local-CLI provider is **a second backend for `/api/text` and
nothing else** — same route, same response shape, same sidecar.

It does **not** extend to image or video output:

- `claude -p` produces text. No image generation exists in Claude Code.
- Codex has image generation in the ChatGPT **app**, not in the CLI agent loop; the CLI's
  `--image` flag *attaches* images to a prompt (input), it does not produce them
  (<https://learn.chatgpt.com/docs/developer-commands?surface=cli>). t3code contains no
  `gpt-image` / `imagegen` reference anywhere in its server source — confirming it treats these
  providers as text/agent only. **The claim that "Codex generates images" is true of the ChatGPT
  app and false of the CLI**, which is the only surface a local integration can reach.
  (Confidence: medium-high. The negative was checked against the official CLI reference and
  t3code's source; I found no primary OpenAI page stating outright "the CLI cannot generate
  images," only the absence of any flag or skill that would.)

So: image and video output nodes stay on OpenRouter, permanently, regardless of what happens here.
The upside is confined to text — prompt authoring, prompt optimisation, audit/review chains, and a
future chat — which is precisely the set of things the user described.

### 4.2 The shape of a minimal implementation

Mapped onto this repo's existing conventions:

1. **A detection route.** `GET /api/providers` (or a field on `/api/health`), returning per
   provider `{ installed, version, authenticated, plan }`. Built exactly like
   `checkClaudeProviderStatus`: `<binary> --version` for installed, then the never-yielding Agent
   SDK probe for authenticated. Cache it — t3code uses 5 minutes.
2. **`PATH`/`HOME` hydration in the desktop shell.** Non-negotiable for the packaged app, per §2.3.
   This belongs in `../Unframed-app`, not here, since a `npm run dev` clone inherits the shell
   `PATH` for free. **(inference)**
3. **A text backend switch.** `/api/text` picks OpenRouter (default) or a local CLI, driven by the
   model id the node carries. Keep the response shape identical so `TextOutputNode` does not learn
   about providers.
4. **Model ids that survive a catalogue.** `docs/models.md` owns catalogues; a local provider's
   models are not fetchable from OpenRouter, so they need their own list. t3code hardcodes
   `BUILT_IN_MODELS` per provider and gates entries on the CLI version
   (`getBuiltInClaudeModelsForVersion`) — the CLI has to be new enough to know the model.
5. **A new module with tests**, per this repo's split rule: the argv builder, the stdout envelope
   parser and the detection-state mapper are pure and testable under bare `node`; the spawn is thin
   I/O. Same shape as `env.js` / `jobs.js`.

### 4.3 Five things that will bite, worth deciding up front

1. **The security guards get a much sharper edge.** `CLAUDE.md` records that a website once
   reached `/api/pick-folder` and opened a native folder dialog, and that the three-layer
   loopback/`Origin`/`Host` defence is what stops it. A route that spawns an arbitrary configured
   binary with a user-supplied prompt is strictly more dangerous than one that opens a dialog. The
   binary path must be settings-only and validated the way `env.js`'s `PATTERNS` validate — never
   taken from a request body. **(inference)**
2. **Do not copy `--dangerously-skip-permissions`.** t3code passes it because it is a coding
   agent that must edit files. Unframed wants text out of a prompt and nothing else, so the right
   configuration is *no tools at all* — which removes the need for that flag rather than
   suppressing its consequences. Passing it in a media tool would hand a prompt-shaped input the
   ability to run commands on the user's machine. **(inference)**
3. **The sidecar has no cost to write.** Every run currently leaves `<timestamp>-*.json` with
   prompt, params and cost, and a batch's spend is a sum over one field. A subscription run has no
   metered price. Writing `cost: 0` would silently corrupt that sum; the sidecar needs to record
   the provider and an explicit "not metered" rather than a zero. **(inference)**
4. **Failure modes multiply, and they are all local.** Not installed; installed but logged out;
   logged in but rate-limited by the plan; CLI too old for the requested model; binary present but
   unspawnable (the Windows shim case); 180 s timeout. Each needs its own message, because "it
   didn't work" is unactionable when the fix is `claude login`.
5. **This is a dependency on someone else's CLI's argv.** `--json-schema`, `--effort` and
   `--settings` are flags of a tool that ships weekly. t3code absorbs this with a version probe
   and per-version model gating; a thinner integration will break on an upgrade instead.

## 5. What the sources do not answer

- **Whether Anthropic considers a *media* tool spawning `claude -p` the same as a coding tool
  doing it.** The support article's category is "third-party apps," with no carve-out by app
  genre, and nothing suggests the domain matters — but nothing says it explicitly either.
- **Whether "previously approved" is a live process.** The overview note implies approval exists;
  the support article's pause states there is no approval process. No application route is
  documented anywhere I could find.
- **What OpenAI's actual position is on wrapping the unmodified `codex` binary with ChatGPT
  sign-in.** Only the engineer's non-answer above exists. Every confident claim I found on this
  was on a non-primary SEO site (`codex-docs.com`, `bugswiki.com`, `t3codedocs.com` — the last
  301-redirects to `bugswiki.com`, which is a strong signal it is not OpenAI's or t3code's), and I
  have deliberately not cited any of them.
- **Whether rate limits differ for subprocess use vs interactive use.** The support article's
  exclusion list separates "interactive Claude Code in the terminal or IDE" from "third-party
  apps," which implies they are accounted differently, but the pause means the currently
  effective behaviour is the undifferentiated one: everything draws from the same subscription
  limits.
- **Grok's exact CLI contract.** t3code drives it over ACP rather than a text-generation
  subprocess, so I did not chase it; it is the least relevant of the four to Unframed.

## Sources

- t3code: <https://github.com/pingdotgg/t3code>, README at
  <https://github.com/pingdotgg/t3code/blob/main/README.md>. Code read from a shallow clone of
  `main` on 2026-08-21: `apps/server/src/provider/Drivers/{ClaudeDriver,ClaudeHome,ClaudeExecutable,CodexDriver,OpenCodeDriver,GrokDriver,CursorDriver}.ts`,
  `apps/server/src/provider/Layers/ClaudeProvider.ts`,
  `apps/server/src/textGeneration/{ClaudeTextGeneration,CodexTextGeneration,OpenCodeTextGeneration}.ts`,
  `apps/server/src/os-jank.ts`, `packages/contracts/src/settings.ts`.
- Anthropic Agent SDK overview (third-party note, subprocess guidance, branding, commercial
  terms): <https://code.claude.com/docs/en/agent-sdk/overview>
- Anthropic support, "Use the Claude Agent SDK with your Claude plan" (third-party app category,
  2026-06-15 pause): <https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan>
- OpenAI Codex CLI command reference (`codex exec` flags, auth methods, `$CODEX_HOME`,
  automation guidance): <https://learn.chatgpt.com/docs/developer-commands?surface=cli>
- OpenAI, `openai/codex` discussion #8338 (fork/ToS answer):
  <https://github.com/openai/codex/discussions/8338>
- Unframed's own `CLAUDE.md` for the routes, guards, sidecar and split rules this would touch.
