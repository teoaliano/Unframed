# Hosted mode: running the engine under a desktop shell — design

Let a desktop shell (Electron) run Unframed as an ordinary application, without
forking the project into two codebases. This document covers the changes in *this*
repo. The shell itself lives in a separate repo and pins a tag from here.

## The constraint that shapes everything

Unframed is two programs: an **engine** (Express — talks to OpenRouter, writes
files, holds the API key) and a **window** (the React canvas, which knows nothing
about the filesystem and asks the engine for everything).

A desktop app needs the engine started for it, its config written somewhere
writable, and its port discoverable. The naive way to get all three is a second
entry point — and that is the failure mode to avoid. **A second code path is a
second Unframed, and every feature would have to be built twice.**

So every change here is gated on an environment variable that is unset in a clone.
`npm run dev` behaves exactly as it did before; the same `server/index.js` runs in
both worlds.

## Architecture

The shell starts the engine as a child process, waits for it to report ready, and
points a window at it.

```
shell (main process)
  ├─ resolves writable data dirs
  ├─ spawns engine child  ──env──►  UNFRAMED_DATA_DIR
  │                                 UNFRAMED_CLIENT_DIST
  │                                 OUTPUT_DIR
  │                                 PORT=0
  │     ◄── process.send({ type: 'ready', port })
  ├─ loads window at http://127.0.0.1:<port>
  └─ kills the engine on quit
```

Express serves both the built client and `/api`, so the window is same-origin: no
CORS, no `file://` handling, and **no client changes at all** — every call in
`client/src/api.js` is already relative.

### Rejected alternatives

- **Import the engine into the shell's main process.** `server/index.js` calls
  `app.listen()` and `dotenv.config()` at import time, so absorbing it means
  refactoring it into an exported `start()` — a real change that must then keep
  working for the clone flow. An engine crash would also take the whole app down.
  Not worth avoiding a readiness handshake.
- **Replace `/api` with shell IPC.** The most native option and a rewrite: every
  request in `api.js` becomes an IPC channel, and the clone flow still needs HTTP.
  The outcome is two Unframeds. Rejected outright.
- **Tauri instead of Electron.** The engine genuinely needs Node (express,
  localtunnel, fs, spawns), so Tauri means rewriting ~950 lines in Rust or
  bundling Node as a sidecar and losing the size advantage.

## The changes

1. **One overridable base directory.** `.env` and the output folder resolve
   against the project root, which in a packaged app is inside a read-only
   bundle — a key written there fails, or vanishes on the next update.
   `UNFRAMED_DATA_DIR` overrides it, defaulting to the root.

   The resolution lives in `server/env.js` (`envFile`, `outputPath`) rather than
   inline at the five call sites, so the read path and the write path cannot
   drift. Writing `.env` somewhere the next boot does not read it loses the user's
   API key with no error, which is why it is tested rather than trusted.

2. **Serve the built client.** `express.static()` mounted only when
   `UNFRAMED_CLIENT_DIST` points at a directory. No SPA catch-all — the app has no
   router, so static alone is correct.

3. **Ephemeral port and ready signal.** `PORT=0` lets the OS pick a free port,
   which removes any fight over 8787. The parent cannot guess it, so the real port
   is read off the listening server and reported with
   `process.send({ type: 'ready', port })`. That single line is the whole
   handshake.

4. **Reveal through the parent.** With a parent process present, `/api/reveal`
   sends `process.send({ type: 'reveal', files })` instead of spawning `osascript`;
   the shell answers with its own native reveal, which covers all three platforms.

   This exists for a specific reason. The `osascript` path sends an Apple Event to
   Finder, and under the hardened runtime that notarization requires that needs the
   `com.apple.security.automation.apple-events` entitlement plus a "wants to
   control Finder" consent prompt on first use. Routing through the parent removes
   both. Standalone, `process.send` is undefined and the original path runs
   unchanged.

   **`/api/pick-folder` deliberately keeps `osascript`.** Its only flaw is that the
   dialog can open behind the window, and a native swap needs request/response
   plumbing rather than the fire-and-forget send reveal uses. Not worth it yet.

## Testing

`server/host.test.js` forks the real server — throwaway data dir, ephemeral port —
and asserts the contract the shell depends on: the ready message carries a real
non-default port, the API answers on it, the built canvas is served same-origin,
a saved setting lands in the data dir, and reveal arrives over IPC rather than
opening Finder.

This is possible *because* of this work. `index.js` previously had no test of its
own, because it calls `app.listen` and reads the real `.env` at import, so a test
would have run against the developer's actual output directory. A temp data dir and
an ephemeral port are exactly what removed both objections.

Anything needing only a request and a response can go in that file. Nothing that
spends money should.

## Version tagging

The shell pins an engine version by tag, and the same repo also hosts the shell's
release downloads. Those must not collide:

| | Tag | GitHub Release? | Read by |
| --- | --- | --- | --- |
| Engine version | `engine-v0.2.0` | **No** — plain git tag | the shell's dependency pin |
| App version | `v1.0.0` | **Yes**, installers attached | the shell's updater |

> **The rule: engine versions never become GitHub Releases.**

The updater asks GitHub for the *latest release* and expects installers attached to
it. A git tag with no Release object is invisible to it, so the two never collide —
and the `engine-` prefix makes the distinction visible rather than remembered.
Publishing an engine version as a Release breaks update checks for everyone.
