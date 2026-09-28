# 01 · Engine foundation

Depends on: none (read 00-index first)

## Problem Statement

Unframed needs a local engine that a person can run from a clone with two commands, and that the private desktop shell can fork as a child process and point a window at, without the two ever becoming separate programs. Everything later (the canvas, generation, the agent, artifacts) needs somewhere to live: a process that binds loopback only, holds the OpenRouter key and never hands it out, keeps the person's settings in a `.env` file that survives restarts, lists and creates projects, serves project files, and speaks one RPC protocol to the web client. The shell already depends on an exact hosting contract (environment variables, two IPC messages, a stdout banner, a handful of DOM hooks, and an installable package layout). Break any of it and every installed copy of the app fails in a place nobody is watching.

The repository starts empty.

## Solution

A pnpm monorepo on Node 24 with four packages (engine, web, contracts, domain). The engine is one process with one entry point. It binds `127.0.0.1`, refuses cross-origin and rebound requests before any handler runs (HTTP and WebSocket upgrades alike), serves the built web client on its own origin when told to, and answers the web over Effect RPC on one WebSocket, following t3code's transport. Settings live in a `.env` file written through one serialised, atomic, validated funnel and applied to the running process without a restart. The engine reports readiness and file reveals to a parent over IPC only when it is actually hosted. CI tests every pull request, and on every engine tag it builds a flat, installable bundle (an ESM `server/index.js` plus `client/dist`) and pushes it to a `dist` branch, never to a GitHub Release.

This spec also fixes the new DOM hook names the shell will target, the tldraw license key build variable, the one table of test-only environment variables every later spec's engine seam uses, and three engine-wide services later specs build on: the project database, the open-project registry and the preferences store.

## User Stories

1. As a person who cloned the repo, I want `pnpm install` then `pnpm dev` to start the engine and the web client together, so that I can use Unframed with nothing else installed.
2. As a person who cloned the repo, I want the engine to start with no `.env` file at all, so that setup happens in the app, not in a text editor.
3. As a person, I want the engine to print where it is listening, which models it will use, whether a key is loaded, and where it saves output, so that I can see at a glance that it started correctly.
4. As a person, I want the engine to answer only programs on my own machine, so that nobody on my network can spend my OpenRouter credit or read my files.
5. As a person, I want a website I happen to visit to be unable to read the engine's answers or trigger its actions, so that visiting a page cannot open a folder dialog on my desktop or read my key hint.
6. As a person, I want a DNS-rebound page to be refused even though it looks same-origin, so that the loopback promise holds against that attack too.
7. As a person, I want the same refusals on the WebSocket the app uses, so that the socket is not a side door.
8. As a person, I want my OpenRouter key to stay inside the engine, with the app only ever learning whether one exists and its last four characters, so that nothing in the browser can leak it.
9. As a person, I want my settings (key, default models, output folder, agent command paths, Claude config folder) saved to `.env`, so that they survive a restart the same way a hand-typed line does.
10. As a person, I want a setting I save to take effect immediately, so that I never have to restart the engine.
11. As a person, I want a value that could corrupt `.env` or inject a header to be refused with a message that says what is wrong, so that a typo cannot break the file.
12. As a person, I want `.env` to be readable only by my user account, so that other accounts on the machine cannot read my key.
13. As a person, I want a crash in the middle of saving to leave either the old `.env` or the new one, never half of one, so that I never lose a key nothing can re-fetch.
14. As a person, I want two saves that land at the same moment to both take effect, so that neither silently undoes the other.
15. As a person, I want a `.env` that cannot be read (a permissions problem) to stop the save with a message, rather than be treated as empty and rewritten without my key, so that a disk fault never deletes my settings.
16. As a person, I want clearing an agent command path to delete its line, so that the command is found on PATH again and a value my shell provides is not shadowed by an empty one.
17. As a person upgrading from an old `.env`, I want the old `OPENROUTER_MODEL` name still read as the image model, and retired the first time I save the new name, so that my old setting keeps working and the file does not end up with two lines that disagree.
18. As a person, I want a new output folder to be created before it is saved, and refused with a message if it cannot be, so that a bad path fails now and not at generation time.
19. As a person, I want to see my projects (the folders in my output folder) and create a new one by name, so that I can keep work apart.
20. As a person, I want a project name I type to be turned into a safe folder name, and refused if that name is taken, so that names never escape the output folder or overwrite a project.
21. As a person, I want to reveal generated files in Finder, Explorer or my file manager, so that I can find what Unframed saved.
22. As a person on Linux without a file picker, I want the folder picker to tell me to type the path instead, so that I am not left waiting on nothing.
23. As a person, I want cancelling the folder picker to change nothing, so that cancelling is not an error.
24. As a person, I want the app to tell me when the local engine cannot be reached, so that I know to wait or restart it rather than stare at a blank screen.
25. As a person, I want one bad request to fail on its own and never take the engine down, so that my other work keeps going.
26. As a person, I want an oversized or malformed message to be refused with a message that says the size and the limit, so that I know what to remove.
27. As a person, I want the tldraw watermark to stay visible, so that Unframed respects its license.
28. As the desktop shell, I want to fork the engine with `PORT=0` and receive `{type: "ready", port, previewPort}` over IPC, so that I can point a window at a port the OS chose.
29. As the desktop shell, I want the engine to serve the built canvas from the same origin as its API and socket when I set `UNFRAMED_CLIENT_DIST`, so that my window needs no CORS and no `file://` handling.
30. As the desktop shell, I want `.env` and the default output folder to live under `UNFRAMED_DATA_DIR`, so that settings are written somewhere writable and survive app updates.
31. As the desktop shell, I want file reveals sent to me as `{type: "reveal", files}` when I host the engine, so that I can reveal files natively without an Apple Event entitlement and consent prompt.
32. As the desktop shell, I want the engine to exit cleanly within two seconds of SIGTERM, so that quitting the app never leaves an orphan engine polling OpenRouter.
33. As the desktop shell, I want the stdout banner to keep the words "Unframed server", so that my CI can assert the packaged engine started.
34. As the desktop shell, I want to install the engine from a git ref as a flat package with prebuilt JavaScript and a prebuilt client, so that installing it needs no workspace resolution and no TypeScript build.
35. As the desktop shell, I want the bundle to run under my Electron's Node in `ELECTRON_RUN_AS_NODE` mode, so that I ship one runtime.
36. As the desktop shell, I want stable, documented DOM hooks (two chrome cards, a theme attribute, a secondary text colour variable, an explicit body background), so that my injected CSS and update pill keep working across engine versions.
37. As the desktop shell, I want the engine's hosted behaviour gated only on variables I set, so that a clone never behaves as if hosted.
38. As a developer running `node --watch`, I want reveals to open the OS file manager even though watch mode gives the engine an IPC channel, so that a dev run never sends reveals into the void.
39. As a developer, I want to point the engine at a debug log of the local agent's stderr with `UNFRAMED_AGENT_DEBUG`, so that I can see why an agent session fails.
40. As a developer, I want to point motion rendering at a specific Chromium binary with `UNFRAMED_CHROME_PATH`, so that an unusual install still renders.
41. As a test author, I want to fork the real engine into a temporary data folder on an OS-assigned port with every OpenRouter URL pointed at a local stub, so that engine tests exercise the real routes and never spend money.
42. As a test author, I want reveal and folder-picker calls recorded instead of opening windows, so that CI can assert them on a headless machine.
43. As a maintainer, I want every pull request tested (typecheck, unit, engine, browser, bundle smoke), so that nothing broken reaches `main`, which the shell pins from.
44. As a maintainer, I want pushing an `engine-v<version>` tag to build and publish the bundle to the `dist` branch automatically, so that releasing the engine is one tag and never a hand-made artifact.
45. As a maintainer, I want CI to refuse a tag whose version does not match the engine package version, so that the version an app reports matches the code it runs.
46. As a maintainer, I want CI never to create a GitHub Release for an engine tag, so that the shell's updater, which reads the latest Release, never breaks.
47. As a maintainer, I want the tldraw license key supplied by a build-time environment variable and never committed, so that the key stays out of the source tree.
48. As a maintainer, I want the domain package to hold every pure rule with no I/O, so that the rules with many cases are tested directly and fast.
49. As a person using the desktop app, I want the choices the app remembers for me (the project I was in, how the library is laid out, the composer's last settings) to survive quitting and relaunching, even though each launch serves the app from a new port, so that the app does not forget me every morning.
50. As a maintainer, I want each project's state in one SQLite file that one module opens, so that copying a project folder copies everything and no subsystem invents a second file.

## Implementation Decisions

### Packages

- **engine**: the server process. Deep module with a small interface: start (read config, bind listeners, report ready) and stop (graceful shutdown). Everything else is internal: the HTTP router, the RPC server, the settings store, the project store, native adapters (reveal, folder picker).
- **web**: the React client, built with Vite, styled with Tailwind and Base UI. It talks to the engine only through relative URLs (`/ws`, `/api/...`), never an absolute host.
- **contracts**: Effect Schemas for every RPC method, event and persisted record. Both engine and web import it. No runtime logic beyond schemas.
- **domain**: pure functions with no I/O and no clock or randomness of their own (time and randomness are parameters). This spec puts here: the slug rule, the loopback guard decision, the `.env` upsert and validators, the setting value normaliser, the reveal and folder-picker command plans.

TypeScript strict everywhere. pnpm workspaces. `engines.node` is `>=24`. No native Node addons anywhere in the engine or its dependencies' runtime paths, because an addon compiled for Node does not load under Electron's ABI. SQLite, where later specs need it, goes through Node's built-in `node:sqlite`, as t3code does.

Root scripts:

| Script | Does |
| --- | --- |
| `pnpm dev` | runs the engine from source with restart on change (default port 8787) and the Vite dev server (default port 5173) together |
| `pnpm engine` | engine only |
| `pnpm web` | Vite dev server only |
| `pnpm typecheck` | `tsc --noEmit` across all packages |
| `pnpm test` | Vitest across domain and engine (domain seam and engine seam) |
| `pnpm test:browser` | Playwright (browser seam) against a built web served by an engine at the engine seam |
| `pnpm build` | builds the web and the engine bundle into the flat bundle layout below |

### The install root and the data folder

- The **install root** is the repository root when run from a clone, and the bundle root when run from the published bundle.
- The **data folder** is `UNFRAMED_DATA_DIR` when set, else the install root. `.env` lives at `<data folder>/.env`.
- The **output folder** is `OUTPUT_DIR` resolved against the data folder (an absolute path passes through unchanged). Default `./output`. The output folder is gitignored in the repo.
- Both resolutions are one function each, used by both the read path and the write path. Writing `.env` somewhere the next boot does not read loses the key silently.

### Environment variables

Settings variables (may appear in `.env`; `.env` values override the process environment for these, which is also what lets a saved output folder beat the shell's `OUTPUT_DIR`):

| Variable | Default | Validator (after trimming) | Editable in app | Clearable with `''` |
| --- | --- | --- | --- | --- |
| `OPENROUTER_API_KEY` | none | `^sk-or-[\w.-]{8,200}$` | yes | no (removal is its own action) |
| `OPENROUTER_IMAGE_MODEL` | `openai/gpt-image-2` | `^[\w.-]+\/[\w.:-]+$` | yes | no |
| `OPENROUTER_TEXT_MODEL` | `google/gemini-3.5-flash-lite` | same as image | yes | no |
| `OPENROUTER_VIDEO_MODEL` | `bytedance/seedance-2.0` | same as image | yes | no |
| `OUTPUT_DIR` | `./output` | `^[^\n\r"'#]{1,400}$` | yes | no |
| `CLAUDE_PATH` | empty (found on PATH) | `^[^\n\r"'#;&|$`<>(){}\s][^\n\r"'#;&|$`<>(){}]{0,399}$` | yes | yes |
| `CODEX_PATH` | empty (found on PATH) | same as `CLAUDE_PATH` | yes | yes |
| `CLAUDE_CONFIG_DIR` | empty (default `~/.claude`) | `^(\/|[A-Za-z]:\\)[^\n\r"'#]{0,399}$` | yes | yes |
| `PORT` | `8787` | integer 0 to 65535; `0` means OS-assigned | no | no |
| `OPENROUTER_MODEL` | none | legacy, read only | no | deleted on first image model write |

An empty value in `.env` counts as unset. The image model is read as `OPENROUTER_IMAGE_MODEL`, else `OPENROUTER_MODEL`, else the default.

Hosting variables (read from the process environment only, never written to `.env`, absent from `.env.example`; all unset in a clone):

| Variable | Effect when set |
| --- | --- |
| `UNFRAMED_DATA_DIR` | moves `.env` and the default output folder there |
| `UNFRAMED_CLIENT_DIST` | serves that directory's built web client on the engine's origin; also the marker that the engine is hosted, which gates the IPC reveal |
| `PORT=0` | OS-assigned port, reported over IPC |
| `UNFRAMED_OAUTH_BOUNCE` | the public page the OpenRouter consent screen redirects through (spec 10); unset means direct loopback |
| `UNFRAMED_CHROME_PATH` | the first Chromium binary motion rendering tries (spec 09) |
| `UNFRAMED_AGENT_DEBUG` | any non-empty value logs every stderr line of a local agent session as `  [agent <chat id>] <line>` (spec 07) |

Why hosting variables stay out of `.env.example`: `.env` overrides the environment, so a line left present but empty there would shadow the value the shell sets.

Client dev variables: `UNFRAMED_CLIENT_PORT` (Vite port, default 5173; when set the port is strict) and `UNFRAMED_SERVER_PORT` (the engine port the Vite proxy targets, default 8787).

`.env.example` at the repo root contains exactly: `OPENROUTER_API_KEY=` (empty), `OPENROUTER_IMAGE_MODEL=openai/gpt-image-2`, `OPENROUTER_TEXT_MODEL=google/gemini-3.5-flash-lite`, `OPENROUTER_VIDEO_MODEL=bytedance/seedance-2.0`, `OUTPUT_DIR=./output`, `PORT=8787`, each on its own line, with a one-line comment header saying the app writes this file itself and copying it is optional.

### Test-only variables

This is the one table of every test-only variable in the build. A spec that uses one refers to this table and does not define it again; a new hook is added here, in the spec that needs it, with a row naming that spec. All start with `UNFRAMED_TEST_`. They are read from the process environment only, never from `.env`, and are inert when unset.

| Variable | Used by | Effect |
| --- | --- | --- |
| `UNFRAMED_TEST_OPENROUTER_ORIGIN` | 01, 03, 04, 05, 10 | replaces `https://openrouter.ai` in every OpenRouter URL the engine builds: image generation and the image catalogue and pricing endpoints (spec 03), video create, status and catalogue and the unofficial `/api/frontend/v1/models/find` endpoint (spec 04), chat completions and the models listing (spec 05), the OAuth authorize page, the key exchange and the key status endpoint (spec 10). There is no per-URL override: every OpenRouter call goes through this one origin. Accepted only when it is an `http://127.0.0.1:<port>` or `http://localhost:<port>` origin; any other value is ignored and the engine logs `  test origin ignored: <value> is not a loopback origin` at boot, so the variable can never send the key anywhere but this machine |
| `UNFRAMED_TEST_NATIVE_LOG` | 01 | a file path. When set, reveal and the folder picker never spawn OS commands. Each command the engine would have run is appended as one JSON line `{"cmd": string, "args": string[]}` |
| `UNFRAMED_TEST_PICK_FOLDER` | 01, 10 | with `UNFRAMED_TEST_NATIVE_LOG` set, the folder picker's answer: `none` behaves as "no picker on this machine", `cancel` as a cancelled dialog, any other value as the chosen path |
| `UNFRAMED_TEST_TUNNEL` | 04 | `loopback` makes the share service's tunnel return the share server's own `http://127.0.0.1:<port>` and its reachability probe a plain `HEAD` against it; `never` makes every probe fail at once |
| `UNFRAMED_TEST_SWEEP_MS` | 04 | the render sweep's interval in milliseconds, in place of 30 s |
| `UNFRAMED_TEST_SHARE_TTL_MS` | 04 | the share link TTL in milliseconds, in place of 30 min; the expiry check then runs at the smaller of 60 s and this value |
| `UNFRAMED_TEST_AGENT_SCRIPT` | 07, 08, 09 | a JSON script file or a folder of them. Every chat's provider adapter becomes the scripted adapter spec 07 defines |
| `UNFRAMED_TEST_AGENT_IDLE_MS` | 07 | the agent session idle close in milliseconds, in place of 10 min |
| `UNFRAMED_TEST_RENDERER` | 09 | replaces the motion renderer and the Chrome search: `ok`, `fail` or `no-chrome`, each behaving as spec 09 states |

Anything that redirects network traffic follows the loopback-only rule of the origin override.

### Engine process lifecycle

Boot order:

1. Resolve the data folder, read `.env` from it, merge settings over the process environment.
2. Start the preview origin listener on `127.0.0.1` with an OS-assigned port. In this spec it applies the same Host check as the API (below) and answers 404 to every path; spec 09 adds its one route.
3. Start the API listener on `127.0.0.1:<PORT>`. Never `0.0.0.0`, never `::1`. There is no option to widen the bind.
4. Print the banner, then send the ready message.

The banner, on stdout, exactly (two-space indent, a blank line before and after):

```
  Unframed server  →  http://localhost:<port>
  image:    <image model>
  text:     <text model>
  video:    <video model>
  api key:  <loaded | MISSING: add one in the app (settings icon, top right)>
  preview:  http://127.0.0.1:<preview port>
  output:   <absolute output folder>
```

The shell's CI greps for `Unframed server`. That phrase must never change. Every later log line the engine prints starts with two spaces.

Ready: when the process has an IPC channel, it sends `{ "type": "ready", "port": <API port>, "previewPort": <preview port> }` once, after both listeners are bound. Without a channel it sends nothing and runs identically.

Listen failure (port in use, permission): print the error and exit with code 1, so the shell's "engine exited" path fires.

Shutdown: on SIGTERM or SIGINT the engine stops accepting connections, closes every WebSocket with close code 1001, runs every registered shutdown hook (later specs register: flush sync rooms and databases, close the share tunnel, stop the render sweep, end agent sessions), and exits with code 0. The whole sequence must finish within 2 seconds, because the shell waits 2 seconds before giving up. A hook that has not finished by 1.5 seconds is abandoned and the engine exits anyway. Timers the engine starts (sweeps, TTL checks) never keep the process alive on their own.

Crash safety: an unhandled promise rejection is logged as `  unhandled rejection: <stack>` and does not exit the process. An uncaught exception is logged and exits with code 1. No request handler may let either happen: every operation that can fail is inside Effect's typed error channel and answered (see error model).

### Loopback guards

One pure decision in domain, used by the API listener, the WebSocket upgrade path and the preview origin. Inputs: the `Origin` header (may be absent) and the `Host` header (may be absent). Rules, in order:

1. An `Origin` that is present and does not match `^https?://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$` (case-insensitive) is refused with status 403 and `{ "error": "Unframed answers only same-machine requests." }`.
2. A `Host` that is absent or does not match `^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$` (case-insensitive) is refused with status 403 and `{ "error": "Unframed answers only requests addressed to localhost." }`.
3. Otherwise allowed.

Case-insensitive on purpose: `LOCALHOST` is the same machine. The anchors and the digits-only port are what refuse `localhost.evil.example`.

The guard runs before any handler, static file or upgrade. No response ever carries `Access-Control-Allow-Origin` or any other CORS allow header, for any origin, including loopback ones. An `OPTIONS` preflight is answered 204 with no allow headers, so the browser blocks the real request. This costs nothing: the web is always same-origin with the engine (Vite proxies server-side in dev; the engine serves the web when hosted).

WebSocket upgrades (the RPC socket here, the sync socket in spec 02) run the same decision on the upgrade request. A refused upgrade is answered with a plain HTTP 403 response carrying the same JSON body, and the socket is destroyed without a handshake.

A top-level browser navigation GET (the OAuth callback in spec 10) carries no `Origin` and a loopback `Host`, so it passes.

### RPC transport

As t3code does: Effect RPC over one WebSocket at the path `/ws`, JSON serialisation, an `RpcGroup` defined in contracts, served by the engine and consumed by the web through Effect's RPC client. Method names are `<area>.<verb>`. Streaming methods (subscriptions) are Effect RPC streams.

Inbound frame limit: 60 MB (62,914,560 bytes). A larger frame closes that socket with code 1009. The web, on a 1009 close, fails every call that was in flight on it with: `This is too large to send in one request. The limit is 60.0MB. Removing the largest images or videos from the board will bring it back under.` A frame that is not valid JSON closes that socket with code 1007 and logs `  ws: closed a socket that sent a frame that was not JSON`. Neither affects other sockets.

Error model. Every method's failure schema is one tagged error:

```
UnframedError { _tag: "UnframedError", code: "bad_request" | "not_found" | "conflict" | "unavailable" | "upstream" | "internal", message: string, details?: Record<string, unknown> }
```

This is the only failure shape any RPC method in any spec answers. A later spec lists its failures as `code: message` pairs; when the web needs to tell two failures with the same code apart, the spec names a `details.reason` string (spec 04 does this for video starts), never a second error shape. `message` is a full sentence meant for the person, and is what the web shows. `code` maps to the HTTP status the same failure would have on an HTTP route (400, 404, 409, 501, 502, 500). `upstream` means OpenRouter, or another service the engine called, failed or answered with an error. A payload that fails schema decoding is answered `bad_request` with a message naming the field. A defect (an unexpected throw inside a handler) is caught at the RPC server boundary, logged as `  <method> failed: <stack>`, and answered `internal` with `Something went wrong: <message>`.

Web client: connects to `ws(s)://<location.host>/ws`. On a drop it reconnects with backoff starting at 1 s, doubling, capped at 10 s. Subscriptions re-subscribe after reconnect. What a person sees while the socket is down is spec 02's connection-lost notice; this spec shows no notice of its own.

Methods this spec delivers:

| Method | Input | Success | Failures (code: message) |
| --- | --- | --- | --- |
| `server.health` | none | `Health` | none |
| `settings.get` | none | `Settings` | none |
| `settings.update` | `SettingsPatch` | `Settings` | see settings rules |
| `settings.subscribe` | none | stream of `Settings`: the current value first, then one per change from any source | none |
| `settings.pickFolder` | none | `{ path: string }`, `''` when cancelled | `unavailable`: `No folder picker available here. Type the path instead.` |
| `projects.list` | none | `{ projects: string[] }` | `internal`: `Could not list the output folder: <reason>` |
| `projects.create` | `{ name: string }` | `{ name: string }` (the slug) | `bad_request`: `Enter a project name.`; `conflict`: `A project named "<slug>" already exists.`; `internal`: `Could not create the project: <reason>` |
| `files.reveal` | `{ project?: string, fileNames: string[] }` | `{ revealed: number \| "folder" }` | `not_found`: `No files for this project yet.` |

Schemas (in contracts):

```
Settings { hasKey: boolean, keyHint: string, imageModel: string, textModel: string, videoModel: string, outputDir: string, claudePath: string, codexPath: string, claudeConfigDir: string, previewPort: number }
Health   = Settings & { ok: true }
SettingsPatch { key?, imageModel?, textModel?, videoModel?, outputDir?, claudePath?, codexPath?, claudeConfigDir?: string }
```

`keyHint` is the last 4 characters of the key, or `''`. `outputDir` is the resolved absolute path. No response anywhere carries the key itself. The preferences methods (`preferences.get`, `preferences.set`, `preferences.subscribe`) are defined under "Preferences store" below. Later specs add methods to the same group (spec 10 adds `settings.removeKey`, the `oauth.*` methods, `projects.rename`, `projects.delete`).

### Settings store

A deep module: `read()` returns the current settings, `update(patch)` validates, writes and applies, `subscribe()` streams changes. Callers never see `.env` text.

Update rules, in order:

1. For each field present in the patch: trim it. For the three clearable fields, `''` becomes "delete this line". Otherwise validate against the table above. The first failure answers `bad_request` with:
   - key: `That does not look like an OpenRouter key. Keys start with "sk-or-".`
   - outputDir: `That folder path has characters that cannot be saved.`
   - claudePath, codexPath: `That does not look like a command name or a path to one.`
   - claudeConfigDir: `The config folder has to be an absolute path.`
   - any model: `That does not look like a model slug. Expected something like "openai/gpt-image-2".`
2. No fields left: `bad_request`, `Nothing to save.`
3. An image model write also deletes `OPENROUTER_MODEL`.
4. A new output folder is created (recursively) before anything is written. Failure: `bad_request`, `Cannot use that folder: <reason>`, and nothing is written.
5. Write `.env` (write rules below). Failure: `internal`, `Could not write .env: <reason>`, and nothing in the running process changes.
6. Apply every changed value to the running process. From this moment every later request uses them. A change to `CLAUDE_PATH` or `CLAUDE_CONFIG_DIR` invalidates the cached Claude status, and a change to `CODEX_PATH` the cached Codex status (spec 07).
7. Emit the new `Settings` on `settings.subscribe`.

Spec 10 inserts more steps into this sequence (cancelling a pending OAuth attempt, moving render jobs, closing open projects).

Write rules (the only code that writes `.env`):

- Writes are queued on one chain. Each write reads the current file, applies the upsert, and writes. A failed write rejects its own caller and never blocks or fails the next one.
- Read: a missing file is treated as empty. Any other read error aborts the write with that error. Never treat an unreadable file as empty, because the upsert of an empty text drops every other line, the key included.
- Write to a temp file next to `.env` named `.env.<pid>-<epoch ms>.tmp` with mode 0600, then rename over `.env`. The rename carries the mode, so an older 0644 file is tightened by the next write. If the rename fails, delete the temp file (best effort) and rethrow, so no plaintext copy of the key is left behind.

Upsert rules (pure, in domain; input is the file text and a map of variable to value or null):

- `null`: delete every line that starts with `<NAME>=`, including its line ending.
- a value: replace the first line that starts with `<NAME>=` with `<NAME>=<value>`, keeping that line's own ending (`\n`, `\r\n` or none), and delete every later line for the same name. dotenv keeps the last assignment, so leaving a later duplicate would let the stale value win.
- a value with no existing line: append `<NAME>=<value>\n`, first adding `\n` if the text is non-empty and does not end with one.
- Every other line (comments, blank lines, variables Unframed does not know) is left byte for byte.
- Values are written unquoted. The validators forbid quotes, `#` and line breaks, so none is needed.

### Projects

A project name becomes a folder name through the slug rule (domain): lowercase, every run of characters outside `a-z0-9` becomes `-`, leading and trailing `-` removed, cut to 40 characters. An empty result is refused (`Enter a project name.`). The slug is also what stops a name escaping the output folder. Every method that takes a project name slugs it first.

- `projects.list`: creates the output folder if missing, returns the names of its direct subdirectories, sorted by name. Files at that level (`jobs.json`, `presets.json`) are not projects.
- `projects.create`: slug; if a folder of that name exists, `conflict`; else create it and open its project database (below), so every project created by this app has one. Spec 02 extends creation to seed the canvas with starter content.

### Open-project registry

A deep module with three calls: `register(project, name, close)`, `close(project)` and `closeAll()`. Every subsystem that holds a project's resources open registers one closer for that project when it first opens them. `close(project)` runs every closer registered for that project, newest first, each with its own error catch and the 1.5 s budget of the shutdown sequence, forgets them, and reports every closer that failed (by name and reason) to its caller without stopping the others. After a close, the next use of the project opens it afresh. Shutdown calls `closeAll()`.

Registered by: this spec's project database (its handle); spec 02 (the sync room: flush, then disconnect its clients); spec 07 (the chat store's queue and subscriptions, live provider sessions and their MCP tokens); spec 09 (the project's preview browser tabs and in-memory render records). A later spec that holds per-project state registers here too. Spec 10 calls `close(project)` before renaming or deleting a project and for every open project before an output folder change.

### Project database

Each project has exactly one SQLite file, `<project folder>/unframed.sqlite`, used through `node:sqlite` in WAL mode. The **project database** module (engine) is the only code that opens it. `open(project)` returns the handle, creating the file when it does not exist, applies pending migrations, and registers the handle's closer with the open-project registry. Every other module that needs the file asks this one; none opens the file itself or keeps a second SQLite file in the project folder.

Later specs add their tables to this file by name, as numbered migrations in the module's one ordered list, each applied once inside a transaction at open:

| Tables | Added by |
| --- | --- |
| tldraw sync storage, `canvas_changes` | 02 |
| `orchestration_events`, `orchestration_command_receipts`, `provider_session_runtime`, the `projection_*` tables, `turn_changes` | 07 |
| `legacy_import_report` | 11 |

Spec 11 adds one step before `open` creates the file: a folder that still holds an old graph is imported first. A persisted row must stay readable by every later version: a migration adds tables and optional columns, never renames or drops them.

### Preferences store

Per-person UI preferences live in the engine, not in the browser. The packaged app forks the engine with `PORT=0`, so the web's origin changes on every launch and anything in `localStorage` is gone the next time the app opens. The web therefore uses `localStorage` only for things that may be lost harmlessly, and says so where it does; everything a later spec calls "remembered" goes here.

- File: `<data folder>/preferences.json`, one JSON object mapping a key to a JSON value, pretty-printed with two-space indent. Written through one serialised chain, temp file then rename, like `.env`. A missing or unparsable file reads as `{}` and is replaced whole on the next write: losing a preference costs one click, refusing to boot over one costs more.
- Keys match `^[a-z][A-Za-z0-9.:_-]{0,120}$`. A value serialises to at most 4 MB. `null` deletes the key.
- RPC:

| Method | Input | Success | Failures |
| --- | --- | --- | --- |
| `preferences.get` | `{ keys?: string[] }` | `{ values: Record<string, unknown> }`, every key when `keys` is omitted | none |
| `preferences.set` | `{ key: string, value: unknown }` | `{}` | `bad_request`: `That is not a preference name.`; `bad_request`: `That preference is too large to save.`; `internal`: `Could not save the preference: <reason>` |
| `preferences.subscribe` | `{ keys?: string[] }` | stream of `{ key, value }`: the current value of each key first, then one per change from any socket | none |

Keys in use, each owned by the spec named:

| Key | Owner | Value |
| --- | --- | --- |
| `project.active` | 02 | the active project's name |
| `lastUsed.image`, `lastUsed.video`, `lastUsed.text` | 03 (04 and 05 add fields) | the composer's last-used values for that medium |
| `library.view` | 06 | `"card"` or `"list"` |
| `agent.followUp` | 08 (control in spec 10's dialog) | `"queue"` or `"steer"` |
| `agent.stash.<project>` | 08 | that project's stashed prompts |
| `agent.diffLayout` | 08 | `"stacked"` or `"split"` |

A later spec that remembers something adds its key to this table.

### Project file serving (HTTP)

`GET /api/file/<project>/<name>` (and `HEAD`). The project is slugged; `name` is reduced to its basename, so a path in it cannot escape. Serves the file with a content type from its extension, supports byte-range requests (videos must seek), `Cache-Control: no-cache`, `X-Content-Type-Options: nosniff`. A missing file answers 404 `{ "error": "File not found." }`. This route never serves `.html` as `text/html`: HTML files are served as `text/plain`, because a page is never rendered from the app's origin (00-index contract 3). The loopback guard applies.

### Serving the web

When `UNFRAMED_CLIENT_DIST` is set, the engine serves that directory at `/`: `index.html` for `/` with `Cache-Control: no-cache`, hashed assets with `Cache-Control: public, max-age=31536000, immutable`, 404 for anything else that is not `/ws` or `/api/...`. No SPA catch-all. When unset, `/` answers 404, and the web is served by Vite in dev.

Vite dev server: proxies `/ws` (WebSocket) and `/api` to `http://localhost:<UNFRAMED_SERVER_PORT or 8787>` without changing the origin, so the forwarded `Host` stays `localhost:5173` and the browser's `Origin` is loopback; both pass the guards.

### Reveal in file manager

`files.reveal { project?, fileNames }`: the folder is the project folder, or the output folder when `project` is omitted. A missing folder answers `not_found`. Each name is reduced to its basename; names that do not exist on disk are dropped.

- Hosted (the process has an IPC channel AND `UNFRAMED_CLIENT_DIST` is set): send `{ "type": "reveal", "files": <absolute paths, or [folder] when none survived> }` and answer `{ revealed: <count> }` or `{ revealed: "folder" }`. Gated on the variable, not on the channel alone: a dev run under a file watcher has an IPC channel whose parent drops unknown messages, and gating on the channel sent every dev reveal nowhere while answering success.
- Standalone, the command plan (pure, in domain, from platform, surviving files, folder):
  - macOS: files whose path contains `"` are dropped (a quote would break out of the script string). With any left, run `osascript -e` with a Finder script that reveals all of them and activates Finder; answer the count. With none, `open <folder>`; answer `"folder"`.
  - Windows: exactly one file, `explorer /select,<file>`, answer 1. Otherwise `explorer <folder>`, answer `"folder"`.
  - Linux and others: `xdg-open <folder>`, answer `"folder"`.
- Commands are spawned detached with stdio ignored; the answer does not wait for them.

### Native folder picker

`settings.pickFolder` spawns the OS dialog on the engine's machine, because a browser cannot hand back a real path.

- macOS: `osascript -e` with `POSIX path of (choose folder with prompt "Choose where Unframed saves its output" default location POSIX file "<current output folder>")`.
- Windows: `powershell -NoProfile -Command` with a script that shows a `System.Windows.Forms.FolderBrowserDialog` and prints the selected path when the dialog returns OK.
- Linux: `zenity --file-selection --directory --filename=<current output folder>/`.
- The command cannot be spawned (binary missing): `unavailable`, `No folder picker available here. Type the path instead.`
- Exit code 0: the first line of trimmed stdout is the path. Any other exit: `''` (cancelled, not an error).

The picker only returns a path. Saving it is a separate `settings.update`.

### HTTP body limits and error answers

No route in this spec parses a JSON body, but every later one does it through one shared parser, which lives here. Any HTTP route that parses a JSON body caps it at 60 MB and answers:

- too large: 413 `{ "error": "This is too large to send in one request (<size>MB). The limit is <limit>MB. Removing the largest images or videos from the board will bring it back under." }`, where sizes are MB to one decimal and the size part is omitted when the request did not declare a length;
- not JSON: 400 `{ "error": "That request was not valid JSON." }`;
- anything a handler did not answer itself: 500 `{ "error": "Something went wrong: <message>" }`, logged as `  <METHOD> <url> failed: <stack>`.

Every HTTP error answer is JSON with an `error` string, except routes a person's browser lands on directly (spec 10's OAuth callback answers HTML).

### DOM hooks the shell targets

A contract with the desktop shell. Renaming any of these is a breaking change that needs a matching shell release.

| Hook | Contract |
| --- | --- |
| `.unframed-chrome-left` | exactly one element: the top-left floating chrome card (logo and project menu, filled by spec 02). Its position comes from ordinary CSS properties with no `!important`, so the shell's injected CSS can move it |
| `.unframed-chrome-right` | exactly one element: the top-right floating chrome card (agent, settings, help). Same rule |
| `data-unframed-theme` on `<html>` | `"light"` or `"dark"`: the theme currently shown, updated live when it changes |
| `--unframed-text-secondary` on `<html>` | the secondary text colour of the current theme, readable with `getComputedStyle(document.documentElement)` |
| `<body>` background | an explicit, opaque `background-color` equal to the canvas background of the current theme |
| `<title>` | `Unframed`, set once in `index.html`. The web never changes `document.title` afterwards, so the shell's override sticks |
| `<body>` children | the web mounts into `#root` and never removes or reorders other children of `<body>`, so an element the shell appends (its update pill) survives |
| external links | opened with `target="_blank"` or `window.open(url, "_blank")`, which the shell routes to the system browser. The `unframed-update://` scheme belongs to the shell and the web never uses it |

In this spec the web renders an app frame with both chrome cards present (empty), the theme attribute and variable set from the ported theme values in `assets/theme/`, following the system light or dark preference. Spec 02 fills the cards and owns the theme.

### tldraw license key

The web build reads `TLDRAW_LICENSE_KEY` from the build environment and embeds it in the built client, where spec 02 passes it to tldraw. It is never committed, never read at runtime by the engine, and never logged. A build without it succeeds (a local dev run on localhost works unlicensed). The tag-triggered CI build takes it from a repository secret and fails if the secret is empty. Nothing may hide or cover the tldraw watermark.

### The published bundle

Built by `pnpm build`, published by CI. Layout at the bundle root:

- `package.json`: `name` exactly `unframed` (the shell's dependency key depends on it), `version` equal to the engine package version, `"type": "module"`, `main` `server/index.js`, `dependencies` limited to runtime packages that cannot be inlined (packages that locate their own files on disk at runtime or spawn binaries, such as the Claude Agent SDK, the HyperFrames packages and GSAP), no `devDependencies`, no `workspaces`, no lifecycle scripts.
- `server/index.js`: plain ESM JavaScript, the fork entry. All workspace code and every inlinable dependency are bundled into it (plus sibling chunk files under `server/` if the bundler splits). No TypeScript, no workspace references, no source maps, no test files.
- `client/dist/`: the built web.
- `client/package.json` and `client/package-lock.json`: a compatibility shim for a shell that still runs `npm --prefix <engine>/client ci && npm --prefix <engine>/client run build`. The manifest has no dependencies and a `build` script that does nothing and exits 0, and the lockfile matches it, so that command succeeds and leaves `client/dist` untouched. It can be removed once the shell stops building the client.
- `LICENSE` and `THIRD_PARTY_NOTICES` (crediting t3code, MIT, among the rest).

The bundle's Node floor is the Node inside the Electron release the shell ships. The shell moves to Electron 44 as part of adopting this rewrite; the bundle targets that release's Node. An older shell cannot run it.

### CI

- On every pull request (forks included) and every push to `main`, on Node 24: `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm test`, install Playwright's Chromium, `pnpm test:browser`, then `pnpm build` and the bundle smoke test (fork the built `server/index.js` with the hosted variables, a temp data folder and `PORT=0`, assert the ready message and the banner, fetch `/` and get the web).
- On push of a tag matching `engine-v<semver>`: everything above, with `TLDRAW_LICENSE_KEY` from the repository secret; fail unless `<semver>` equals the engine package version; boot the bundle under Electron 44 in `ELECTRON_RUN_AS_NODE=1` mode through `fork` with an IPC channel and assert the ready message; then commit the bundle as one new commit on the `dist` branch (its tree is the bundle root only, a fast-forward on top of the previous dist commit, never a force-push) and tag that commit `engine-v<semver>-dist`. The shell pins `github:<owner>/<repo>#engine-v<semver>-dist`.
- CI never runs `gh release create` or any Release API call. An engine tag must never become a GitHub Release.

## Testing Decisions

A good test drives the system through one of the three seams in 00-index and asserts on what comes out: RPC answers, HTTP responses, IPC messages, stdout, files on disk, and what a person sees. It never imports engine internals or reads engine state directly.

- **Domain seam** for the pure rules with many cases: the slug rule, the loopback guard decision, `.env` upsert, the validators and clearable-field normalising, the reveal and folder-picker command plans.
- **Engine seam** for everything the process does. This spec builds the harness every later spec reuses: fork the engine (from source in `pnpm test`, from the built bundle in the bundle smoke test) with a fresh temp data folder, `PORT=0`, an IPC channel, `UNFRAMED_TEST_OPENROUTER_ORIGIN` pointed at an in-test stub HTTP server, and `UNFRAMED_TEST_NATIVE_LOG` pointed at a temp file; wait for the ready message; expose an RPC client, an HTTP client, the captured stdout and IPC messages, and the data folder; kill and clean up. Tests that need a variant (no IPC channel, hosted marker, a pre-written `.env`) take options.
- **Browser seam** for the web frame: Playwright against the built web served by an engine at the engine seam with `UNFRAMED_CLIENT_DIST` set.
- Nothing that spends money runs in any seam. There is no prior art in this repo (it starts empty); follow t3code's server tests for driving Effect RPC over a real socket.

## Tasks

1. Monorepo skeleton: pnpm workspace with engine, web, contracts and domain packages, strict TypeScript, Vitest wired to `pnpm test`, and the slug rule in domain with its cases (runs of symbols, leading and trailing dashes, 40-character cut, empty result). Seam: domain.
2. Engine-seam harness plus an engine that boots and prints the banner; the test forks it into a temp data folder and finds `Unframed server  →  http://localhost:<port>` and the six following lines on stdout. Seam: engine.
3. `PORT=0` with an IPC channel sends exactly one `{type: "ready", port, previewPort}` after both listeners are bound; both ports accept connections on `127.0.0.1`. Seam: engine.
4. Forked without an IPC channel, the engine boots and answers the same, and sends nothing. Seam: engine.
5. The preview origin listener answers 404 to every path and applies the Host check. Seam: engine.
6. Listen failure: with `PORT` set to a port the test already holds, the engine prints the error and exits with code 1. Seam: engine.
7. Loopback guard decision table: loopback origins with and without ports, `LOCALHOST`, `[::1]`, absent Origin, `localhost.evil.example`, `127.0.0.2`, non-digit ports, absent Host. Seam: domain.
8. HTTP guard: a non-loopback `Origin` gets 403 with the same-machine message; a non-loopback `Host` gets 403 with the localhost message; no response carries any CORS allow header, even for a loopback `Origin`; `OPTIONS` answers 204 with no allow headers. Seam: engine.
9. RPC socket at `/ws` with `server.health` returning `ok: true` and the settings snapshot. Seam: engine.
10. WebSocket upgrade guard: an upgrade with a non-loopback `Origin` or `Host` is refused with an HTTP 403 and no handshake. Seam: engine.
11. RPC error model: a payload that fails decoding answers `bad_request` naming the field; the socket stays open and `server.health` still answers. Seam: engine.
12. Frame limits: a frame over 60 MB closes that socket with 1009, a non-JSON frame closes it with 1007, and a second open socket keeps working. Seam: engine.
13. `.env` upsert rules: replace in place keeping the line ending, collapse later duplicates, append with a separating newline, null deletes every occurrence, other lines untouched byte for byte. Seam: domain.
14. Validators and normalising: each variable's accepted and refused values, trimming, `''` becomes delete for the three clearable fields only. Seam: domain.
15. Boot reads settings: a pre-written `.env` in the data folder shows in `server.health`; `.env` beats the process environment; defaults apply when unset; empty values count as unset; `OUTPUT_DIR` resolves against the data folder and an absolute one passes through. Seam: engine.
16. Legacy image model: `.env` holding only `OPENROUTER_MODEL` reports it as the image model. Seam: engine.
17. `settings.update` saves and applies live: a model change appears in `server.health` without a restart and in `.env`; no temp file is left behind; the file mode is 0600, including when a 0644 file existed before. Seam: engine.
18. `settings.update` refusals: each field's message, `Nothing to save.` for an empty patch, and `.env` unchanged after a refusal. Seam: engine.
19. Writing the image model deletes the `OPENROUTER_MODEL` line. Seam: engine.
20. Clearing `claudePath`, `codexPath` or `claudeConfigDir` with `''` deletes the line. Seam: engine.
21. Two concurrent `settings.update` calls for different fields both land in `.env` and in the running process. Seam: engine.
22. An unreadable `.env` (a directory at that path) makes `settings.update` answer `internal` with `Could not write .env: <reason>`, changes nothing, and the engine keeps answering. Seam: engine.
23. A new output folder that cannot be created (its parent is a file) answers `Cannot use that folder: <reason>` and writes nothing; a creatable one is created before `.env` is written. Seam: engine.
24. `settings.subscribe` emits the current settings first, then one value per change, including changes made by another socket. Seam: engine.
25. The key never leaves: with a key saved, no RPC answer or HTTP response contains it; `keyHint` is its last four characters. Seam: engine.
26. Hosting and test variables are process-environment only: a `.env` line for `UNFRAMED_DATA_DIR` or `UNFRAMED_TEST_OPENROUTER_ORIGIN` has no effect; `.env.example` contains exactly the documented lines. Seam: engine.
27. `UNFRAMED_TEST_OPENROUTER_ORIGIN` set to a non-loopback URL is ignored with the documented log line. Seam: engine.
28. `UNFRAMED_DATA_DIR` puts `.env` and the default output folder under it, and nothing is written to the install root. Seam: engine.
29. `projects.list` creates a missing output folder, lists only subdirectories, sorted, ignoring `jobs.json` and `presets.json`. Seam: engine.
30. `projects.list` with the output folder path occupied by a file answers `Could not list the output folder: <reason>` and the engine keeps answering. Seam: engine.
31. `projects.create` slugs the name, creates the folder, refuses an existing name with `conflict`, and refuses an empty slug with `Enter a project name.` Seam: engine.
32. Project file serving: a file in a project is served with its content type; a range request answers 206 with the right bytes; `../` in either segment cannot escape; a missing file answers 404 `File not found.`; an `.html` file is served as `text/plain`. Seam: engine.
33. Reveal command plans per platform: macOS reveal with quote filtering and folder fallback, Windows single-file select versus folder, Linux folder. Seam: domain.
34. Hosted reveal: with an IPC channel and `UNFRAMED_CLIENT_DIST` set, `files.reveal` sends `{type: "reveal", files}` with absolute paths of existing files only, or `[folder]` when none exist, and spawns nothing. Seam: engine.
35. Reveal gating: with an IPC channel but no `UNFRAMED_CLIENT_DIST`, no IPC message is sent and the standalone command is recorded in the native log. Seam: engine.
36. `files.reveal` on a project with no folder answers `not_found`, `No files for this project yet.` Seam: engine.
37. Folder picker command plans per platform, and the first-line and exit-code rules. Seam: domain.
38. `settings.pickFolder` answers the chosen path, `''` for cancel, and `unavailable` with `No folder picker available here. Type the path instead.` when no picker exists, driven by `UNFRAMED_TEST_PICK_FOLDER`. Seam: engine.
39. HTTP body policy messages: the 413 sentence from a declared length and a limit (MB to one decimal, size part omitted when no length was declared), the 400 sentence, and the 500 sentence from an error message. Seam: domain. (No route in this spec parses a JSON body; the first spec that adds one adds the engine-seam test that its route answers these three shapes.)
40. Graceful shutdown: SIGTERM and SIGINT each make the engine close sockets with 1001 and exit with code 0 within 2 seconds; a shutdown hook that hangs is abandoned at 1.5 seconds. Seam: engine.
41. Serving the web: with `UNFRAMED_CLIENT_DIST` set, `/` serves `index.html` with `no-cache`, hashed assets are `immutable`, unknown paths are 404; unset, `/` is 404. Seam: engine.
42. Web frame: the built web connects to `/ws`, shows the app frame, and has both chrome cards, `data-unframed-theme`, `--unframed-text-secondary`, an opaque body background and the title `Unframed`, following the emulated light and dark colour scheme. Seam: browser.
43. Web survives an element appended to `<body>` by the page's host and never changes `document.title`. Seam: browser.
44. RPC reconnect: with the engine stopped and restarted, the web's socket reconnects on its own (backoff 1 s doubling to 10 s) and a `settings.subscribe` stream opened before the drop delivers again after it. The notice a person sees meanwhile is spec 02's. Seam: browser.
45. Dev proxy: the Vite dev server proxies `/ws` and `/api` to the engine and both pass the loopback guards. Seam: browser.
46. tldraw license key plumbing: a web build with `TLDRAW_LICENSE_KEY=test-key` serves assets containing `test-key`; a build without it succeeds and contains no key. Seam: engine (against the built bundle).
47. Flat bundle: `pnpm build` produces the documented layout; the smoke test forks `server/index.js` with the hosted variables and gets the ready message, the banner and the web at `/`. Seam: engine.
48. Bundle installability: packing the bundle and installing it with plain `npm install` into an empty folder works with no workspace resolution and no build step, and the installed `server/index.js` boots. Seam: engine.
49. Client shim: `npm --prefix <bundle>/client ci` then `npm --prefix <bundle>/client run build` both exit 0 and leave `client/dist` byte for byte unchanged. Seam: engine.
50. PR workflow: CI runs typecheck, `pnpm test`, `pnpm test:browser` and the bundle smoke test on Node 24 for pull requests (including forks) and pushes to `main`. Seam: engine (the bundle smoke test is the check that proves the workflow runs the published artifact).
51. Tag workflow: on `engine-v<semver>` CI refuses a version mismatch, requires the license secret, boots the bundle under Electron 44 in Node mode with an IPC channel, commits the bundle to `dist` and tags it `engine-v<semver>-dist`, and makes no Release call. Seam: engine (the Electron-mode boot).
52. Project database: `projects.create` leaves `unframed.sqlite` in the new folder with the migration list applied once; a second engine start applies nothing; no other SQLite file appears in the folder. Seam: engine.
53. Open-project registry: after `projects.create` opened a project's database, SIGTERM closes it through `closeAll()` within the shutdown budget, leaving no `unframed.sqlite-wal` file behind. Later specs test their own closers through the operations that call `close(project)` (spec 10). Seam: engine.
54. Preferences store: `preferences.set` then `preferences.get` round-trips a value; `null` deletes it; a bad key and an oversized value are refused with their messages; a second socket's `preferences.subscribe` sees the change; an unparsable `preferences.json` reads as `{}` and the next set replaces it; a value survives an engine restart on a new port. Seam: engine.

## Out of Scope

- The canvas, the sync socket and project starter content (spec 02).
- Generation, model catalogues and pricing (specs 03 to 05).
- The render job store and its sweep, share links and the tunnel (spec 04).
- The preview origin's route and its headers (spec 09).
- The settings dialog, the OAuth key flow, key removal, output folder moves of render jobs, project rename and delete (spec 10).
- Remote access, pairing tokens, LAN or tunnel access to the engine: not built. The engine is loopback only with no opt-in.
- t3code's terminal, mobile app, remote access and pull-request linking: not built.
- Any Electron code. The engine never imports Electron or any shell API; the shell lives in a separate private repository and nothing here references it.

## Further Notes

- Why the hosted reveal gates on `UNFRAMED_CLIENT_DIST`: a file watcher running the engine gives it an IPC channel, and the watcher drops messages it does not recognise, so a gate on the channel alone makes every dev reveal answer success and open nothing. An environment variable unset in a clone is the only safe marker of hosted behaviour; plumbing a dev run also has is not.
- Why nothing is echoed cross-origin, not even to loopback: an allowlist of loopback origins hands a readable API to any page on any other loopback port (another dev server, or an XSS in some local tool). Spec 10's `oauth.start` answer carries the PKCE challenge, and anything that can read it can install a key from its own account.
- Why the Host check exists alongside the Origin check: a DNS-rebound page is same-origin with the engine and sends no `Origin`; its `Host` is the name it dialled, which is not loopback.
- Why bind loopback when the header checks exist: a non-browser client writes its own headers, so only refusing the connection holds against it.
- Old DOM hook names, for the shell's migration only: the chrome cards were `.toolbar-card-left` and `.toolbar-card-right`, the theme attribute was `data-astryx-theme` (the shell fell back to `documentElement`), and the variable was `--color-text-secondary`. The shell updates to the new names with its Electron 44 move.
- The old engine used four separate test URL overrides (auth keys, key info, chat completions, video status). They are replaced by the single origin override above.
- Old UI and log copy that contained em dashes has been rewritten with periods, commas or colons (the banner's missing-key line, the 413 message). The phrase `Unframed server` and the arrow after it are unchanged.
- Repository process rules carry over into the new repo's own CLAUDE.md: changes land by pull request, never a direct push to `main`; engine versions are plain tags and never Releases; nothing about pricing, strategy or signing credentials is committed.

### Assets this spec needs

- `assets/theme/`: the light and dark token values (body, card, surface, popover, overlay backgrounds; secondary text colour), extracted from the old theme definition (`client/src/theme.js` and the `:root` block of `client/src/styles.css`).
- `assets/brand/favicon.svg`: from the old `client/public/favicon.svg`.
- No model-facing prompt text.
