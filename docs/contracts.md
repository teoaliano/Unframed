# Contracts

What installed apps and the app's security depend on today. Everything else in Unframed is free to change. These facts hold until the owner deliberately changes one, and a change to the hosting contract needs a matching desktop shell release, because installed copies of the shell run against whatever engine they pin.

## Hosting contract with the desktop shell

The shell (`apps/desktop/src/main.js`) installs the engine bundle as an npm dependency pinned to a git tag (`github:<owner>/Unframed#engine-v<semver>-dist`), forks `server/index.js` with an IPC channel and loads the engine's origin in a window. Renaming anything in this section breaks installed apps.

### Environment variables the shell sets

The engine reads these from its process environment only, never from `.env`, and they are absent from `.env.example`. A plain clone leaves them all unset, so standalone and hosted runs take one code path.

| Variable | What the shell sets | Effect in the engine |
| --- | --- | --- |
| `ELECTRON_RUN_AS_NODE` | `1` | Electron runs as plain Node, which gives `fork()` its IPC channel. The engine also copies it into the outside agent setups, so the stdio shim runs under the same binary. |
| `UNFRAMED_DATA_DIR` | the app's `userData` folder | `.env`, `preferences.json`, `mcp-endpoint.json`, `agent-connections.json` and the default output folder live there. Unset, the data folder is the install root. |
| `UNFRAMED_CLIENT_DIST` | `<bundle>/client/dist` | the engine serves that built web at `/` on its own origin. It is also the marker that the engine is hosted, which gates the `reveal` IPC message. |
| `PORT` | `0` | an OS-assigned API port, reported in the `ready` message. A value that is not a whole number from 0 to 65535 stops the boot. |
| `OUTPUT_DIR` | `<Pictures>/Unframed` | a settings variable, not a hosting one: a folder saved in the app's settings is written to `.env`, and `.env` wins over the environment, so the person's choice beats the shell's default. |

Other hosting variables the shell does not set today, all unset in a clone: `UNFRAMED_PREVIEW_PORT` (the preview origin's port in place of 18787, `0` meaning OS-assigned), `UNFRAMED_OAUTH_BOUNCE` (the public page the OpenRouter consent screen redirects through), `UNFRAMED_CHROME_PATH` (the first Chromium binary motion rendering tries) and `UNFRAMED_AGENT_DEBUG` (any non-empty value logs every stderr line of a local agent session). The shell itself reads `UNFRAMED_ENGINE_DIR` to point at a local clone in place of the installed bundle.

Hosting variables stay out of `.env.example` because `.env` overrides the environment: an empty line there would shadow the value the shell sets.

### Process lifecycle and IPC messages

The engine starts the preview origin listener, then the API listener on `127.0.0.1:<PORT>`, prints the banner, writes `mcp-endpoint.json` into the data folder, and sends `ready`. The message shapes are `EngineIpcMessage` in `packages/contracts/src/ipc.ts`:

- `{ "type": "ready", "port": <API port>, "previewPort": <preview port> }`, sent once after both listeners are bound. Without an IPC channel the engine sends nothing and runs the same way. The shell waits 30 seconds for it.
- `{ "type": "reveal", "files": <absolute paths> }`, sent by `files.reveal` only when the process has an IPC channel and `UNFRAMED_CLIENT_DIST` is set. `files` is the folder alone when no named file survived. The shell reveals them natively.

A port that cannot be bound prints the error and exits with code 1, which the shell reports as "the engine exited". A taken preview port never stops the boot: the engine takes an OS-assigned port for that run and logs it.

On SIGTERM or SIGINT the engine stops accepting connections, closes every WebSocket with code 1001, runs its shutdown hooks (abandoning any still running 1.5 seconds after the stop began) and exits with code 0 within 1.9 seconds, because the shell gives up after 2 seconds. An unhandled promise rejection is logged and does not exit; an uncaught exception is logged and exits with code 1.

### The stdout banner

Printed on stdout with a two-space indent and a blank line before and after:

```
  Unframed server  →  http://localhost:<port>
  image:    <image model>
  text:     <text model>
  video:    <video model>
  api key:  <loaded | MISSING: add one in the app (settings icon, top right)>
  preview:  http://127.0.0.1:<preview port>
  output:   <absolute output folder>
```

The shell's CI (`.github/workflows/desktop.yml`) greps the engine log for `Unframed server`, so that phrase never changes. Every later log line starts with two spaces.

### DOM hooks the shell targets

| Hook | What the web guarantees |
| --- | --- |
| `.unframed-chrome-left` | exactly one element, the top-left chrome card. Its position is plain layered CSS with no `!important`, so the shell's injected CSS moves it (the macOS traffic-light inset, the window drag region). |
| `.unframed-chrome-right` | exactly one element, the top-right chrome card. It holds Settings on macOS and Linux and stays empty on Windows, where Settings sits at the far left of the left card. The shell moves it below the Windows caption buttons. |
| `.unframed-tabs` | the project tab strip, one element between the two cards. |
| `data-unframed-theme` on `<html>` | `"light"` or `"dark"`, the theme shown now, updated live. |
| `--unframed-text-secondary` on `<html>` | the current theme's secondary text colour as hex, readable with `getComputedStyle(document.documentElement)`. |
| `<body>` background | an explicit, opaque `background-color` equal to the canvas background. The shell paints its own title bar from it. |
| `<title>` | `Unframed`, set once in `index.html`. The web never changes `document.title`, so the shell's override sticks. |
| `<body>` children | the web mounts into `#root` and never removes or reorders other children of `<body>`, so the shell's appended update pill and `body::before` drag strip survive. |
| external links | opened with `target="_blank"` or `window.open(url, "_blank")`, which the shell routes to the system browser. The `unframed-update://` scheme belongs to the shell and the web never uses it. |

### The tldraw license key

The web build reads `TLDRAW_LICENSE_KEY` from the build environment and embeds it in the built client (`packages/web/vite.config.ts`, `packages/web/src/license.ts`). It is never committed, never read by the engine at runtime and never logged. A build without it succeeds and runs unlicensed on localhost. The tag build (`.github/workflows/engine-release.yml`) takes it from a repository secret and fails when the secret is empty.

### The published bundle

`pnpm build` (`scripts/build.ts`) writes a flat bundle. At its root:

- `package.json`: `name` exactly `unframed` (the shell's dependency key), `version` equal to the engine package version, `"type": "module"`, `main` `server/index.js`, `dependencies` limited to the runtime packages that cannot be inlined (`RUNTIME_DEPENDENCIES`: the Claude Agent SDK, the HyperFrames packages, GSAP, puppeteer-core), no dev tooling, and `"puppeteer": { "skipDownload": true }` so an install never downloads a browser.
- `server/index.js`: plain ESM, the fork entry, with every workspace package and inlinable dependency bundled in (plus any chunk files beside it).
- `server/mcp.js`: plain ESM, the stdio shim an outside MCP client runs through the Electron binary with `ELECTRON_RUN_AS_NODE=1`. The shell never runs it.
- `client/dist/`: the built web.
- `client/package.json` and `client/package-lock.json`: a no-op `build` script with no dependencies, so an older shell's `npm --prefix <engine>/client ci && npm --prefix <engine>/client run build` succeeds and leaves `client/dist` alone.
- `LICENSE` (MIT) and `THIRD_PARTY_NOTICES`.

The bundle targets the Node inside the Electron release the shell ships. Pushing a tag `engine-v<semver>` commits the bundle to the `dist` branch as one fast-forward commit tagged `engine-v<semver>-dist`, which the shell pins. Engine tags are plain git tags and never become GitHub Releases: the shell's updater reads this repo's latest Release and expects installers on it.

## Security and data invariants

- **Loopback only.** The engine binds `127.0.0.1` and never widens it. A request with a non-loopback `Origin`, or a `Host` that is absent or not loopback, is refused with 403 before any handler, static file or WebSocket upgrade runs (`packages/domain/src/loopbackGuard.ts`); the `Host` check stops DNS rebinding. No response carries a CORS allow header, and `OPTIONS` answers 204 with none.
- **The share server is the one exception.** It is a separate loopback server that a tunnel exposes to a public hostname for the life of a render job, so it checks no `Host` or `Origin`. It is safe only because it answers one route shape, `/share/<token>`, and nothing else may be mounted on it.
- **The OpenRouter key never leaves the engine.** The web learns only whether a key exists and its last four characters. Test origin overrides are accepted only when they are loopback, so a test variable can never send the key off the machine.
- **Pages are never served from the app's origin.** Artifact HTML is served only by the preview origin on its own port. The app origin's file route serves `.html` and scripts as `text/plain` with `Content-Security-Policy: sandbox`.
- **Every paid run leaves a sidecar** with its cost, and batch members share a `batchId`. An agent turn's sidecar says `billing: "subscription"` and has no `cost` field at all, because a zero would corrupt a spend sum.
- **A paid render is never stranded.** A render job is written as pending before the run is acknowledged, and anything that could orphan it (moving the output folder, renaming or deleting a project, removing the key) resolves it visibly first.
- **One code path, standalone or hosted.** Hosted behaviour switches on only through environment variables that a plain clone leaves unset.
- **The tldraw watermark stays visible.** The license is a hobby license approved on that condition. Nothing may hide or cover it.
- **Project folders are self-contained.** No project state lives outside its folder. The exceptions live in the data folder and hold no project state that a project needs to open: agent attachments, the preferences store, the outside connection store, the MCP discovery file and the two output-folder stores.
- **The canvas thread belongs to the canvas.** Nothing on the canvas may run on the thread that pans and zooms it. Artifact documents load from the preview origin under the other loopback name, so the browser runs them in their own process, and only selected, pinned or edited artifacts run at all; the rest show snapshots. Images display from previews and send originals. Performance budgets are measured in the hosted shape, the way the shell loads the app, not only in the dev setup.

## Test seams

Every test goes through one of three seams. Tests drive the public interface only and never reach into internals; if a behaviour cannot be reached from one of them, the design is wrong, not the seam list.

1. **Engine seam.** The real engine process, forked into a temporary data folder with `PORT=0` and `UNFRAMED_PREVIEW_PORT=0`, every OpenRouter call pointed at an in-test stub through `UNFRAMED_TEST_OPENROUTER_ORIGIN`, and the agent provider replaced by a scripted agent. Tests use the RPC socket, the sync socket, the plain HTTP routes, the IPC messages and the files the engine writes. Nothing that spends money runs here. Run with `pnpm test`.
2. **Domain seam.** The pure modules in `packages/domain`, called directly. For rules with many cases: request composition from a selection, `@id` resolution, Free-mode splitting, pricing estimates, dial shorthand, job-store pruning, `.env` editing, permission decisions, tab rules. Run with `pnpm test`.
3. **Browser seam.** Playwright driving the built web client served by an engine at the engine seam (stubbed upstreams, scripted agent). For anything a person does on the canvas or in a dialog; assert on what is on screen and on what the engine then holds. Run with `pnpm test:browser`.

### Test-only variables

Every one starts with `UNFRAMED_TEST_`, is read from the process environment only (never `.env`) and is inert when unset. The engine reads them in `packages/engine/src/config.ts`. Anything that redirects network traffic accepts loopback origins only.

| Variable | Effect |
| --- | --- |
| `UNFRAMED_TEST_OPENROUTER_ORIGIN` | replaces `https://openrouter.ai` in every OpenRouter URL the engine builds (generation, catalogues, pricing, video, OAuth, key status). Accepted only as an `http://127.0.0.1:<port>` or `http://localhost:<port>` origin; any other value is ignored and logged as `test origin ignored: <value> is not a loopback origin`. |
| `UNFRAMED_TEST_NATIVE_LOG` | a file path. Reveal and the folder picker spawn no OS commands; each command is appended as one JSON line `{"cmd", "args"}`. |
| `UNFRAMED_TEST_PICK_FOLDER` | with the native log set, the folder picker's answer: `none` (no picker here), `cancel` (a cancelled dialog) or a path. |
| `UNFRAMED_TEST_SHUTDOWN_HOOK_MS` | registers one extra shutdown hook that takes this many milliseconds. |
| `UNFRAMED_TEST_MIGRATION` | SQL the project database runs as one extra migration at the end of its list. |
| `UNFRAMED_TEST_CANVAS` | `1` makes the `testCanvas.read`, `testCanvas.apply` and `testCanvas.changedSince` RPC methods answer; unset, they answer `unavailable`. |
| `UNFRAMED_TEST_TUNNEL` | `loopback` serves shares on the share server's own loopback address; `never` makes every reachability probe fail at once. |
| `UNFRAMED_TEST_SWEEP_MS` | the render sweep's interval, in place of 30 s. |
| `UNFRAMED_TEST_SHARE_TTL_MS` | the share link TTL, in place of 30 min. |
| `UNFRAMED_TEST_AGENT_SCRIPT` | a JSON script file or a folder of them (`assets/fixtures/`); every chat runs on the scripted adapter. |
| `UNFRAMED_TEST_AGENT_IDLE_MS` | the agent session idle close, in place of 10 min. |
| `UNFRAMED_TEST_OUTSIDE_TURN_IDLE_MS` | how long an outside turn stays open after its last call, in place of 2 min. |
| `UNFRAMED_TEST_UPLOAD_URL_TTL_MS` | an attachment upload URL's lifetime, in place of 10 min. |
| `UNFRAMED_TEST_RENDERER` | `ok`, `fail` or `no-chrome` stand in for the motion renderer and the Chrome search. |

The browser harness also sets `UNFRAMED_TEST_WEB_DIST` (`packages/web/test/globalSetup.ts`) to the web build it serves, and the bundle test reads `UNFRAMED_BUNDLE_DIR` to reuse a bundle CI already built. Neither is read by the engine.
