# CLAUDE.md

This file loads into every session. It holds the rules that apply to any change.

## What this is

Unframed: a local, pay-per-generation image, video and text generator on a tldraw canvas. You select material on the canvas and either Generate (a paid OpenRouter call) or hand the selection to a local coding agent (Claude or Codex on your own subscription). The engine (`packages/engine`) is a local server that binds loopback only and holds the OpenRouter key; the web client (`packages/web`) is the canvas; `packages/contracts` holds the shared Effect Schemas and `packages/domain` the pure rules both sides import. The desktop shell (`apps/desktop`) forks the published engine bundle.

## The old implementation

This codebase replaced an older Unframed (a React Flow canvas with output nodes) in engine 0.6.0. The old code survives only in git history, before the merge that brought this one in. It is not a source: when it is unclear what the app should do, ask the person rather than mining the old history.

- `.reference/t3code/` (gitignored) is a clone of t3code (MIT), the reference the agent runtime and the chat composer follow. Clone it with `git clone --depth 1 https://github.com/pingdotgg/t3code .reference/t3code`.
- `assets/` holds files carried over on purpose: brand marks, theme values, model-facing prompt text to use verbatim, the design canvas, screenshots of the old app, legacy sample files, scripted-agent scenarios. They are data, not code.

## How work happens here

1. **Three test seams, no others** (described in `docs/contracts.md`): the engine seam, the domain seam, the browser seam. Every behaviour is tested through one of them.
2. **Changes land by pull request, never a direct push to `main`**, not even one-liners. The desktop shell ships builds from tags on `main`.

## Commands

- `pnpm typecheck`, `pnpm test` (engine and domain seams), `pnpm test:browser` (browser seam; CI runs it on Linux with Playwright's Chromium, a local Mac run uses the installed Chrome).
- `pnpm test:perf` runs the frame-budget suites with the budgets enforced: dragging and panning a 300-shape board, boards full of pages and motions, zooming forty very large images and the previews made for them, panning under the glass chrome, and ten open project tabs (heap, DOM, listeners and idle CPU). Run it on real hardware: under `CI` the same suites run and assert everything except the timing thresholds, because a shared runner cannot hold them.

## Rules that are expensive to break

`docs/contracts.md` holds the facts these rules protect: the hosting contract with the desktop shell, the security and data invariants, and the test seams. They hold until the owner deliberately changes them. Everything else in the app is free to change.

1. **Never create a GitHub Release for an engine tag.** The desktop app's updater reads this repo's latest Release and expects installers on it. Engine versions are plain git tags. `docs/contracts.md` describes the published bundle.
2. **Nothing about pricing, strategy or signing credentials belongs in this repo.** It is public. That material lives in the private shell repo.
3. **The tldraw watermark stays visible.** The license is a hobby license approved on that condition. The key comes from the build-time `TLDRAW_LICENSE_KEY` environment variable and is never committed.
4. **The hosting contract with the desktop shell** is a public interface: environment variable names, IPC messages, the stdout banner, the DOM hooks, the bundle layout. Changing any of them breaks installed apps.

## Writing

Code comments earn their length only when deleting them would let someone make a wrong change. The git log holds history. Docs and comments: plain words, active voice, no em dashes.

## Maintainers

`gh` must be authenticated as the account that owns the repo when opening PRs or pushing tags (`gh auth status`, `gh auth switch --user <account>`). A private repo seen by the wrong account reports as missing, not forbidden.
