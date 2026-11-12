# CLAUDE.md

This file loads into every session. It holds the rules that apply to any change.

## What this is

Unframed: a local, pay-per-generation image, video and text generator on a tldraw canvas. You select material on the canvas and either Generate (a paid OpenRouter call) or hand the selection to a local coding agent (Claude or Codex on your own subscription). The code and its tests are the description of what the app does.

## The old implementation

This codebase replaced an older Unframed (a React Flow canvas with output nodes) in engine 0.6.0. The old code survives only in git history, before the merge that brought this one in. It is not a source: when the current behaviour is missing or ambiguous, ask the person rather than mining the old history.

- `.reference/t3code/` (gitignored) is a clone of t3code (MIT), the reference the agent chat and composer follow. Clone it with `git clone --depth 1 https://github.com/pingdotgg/t3code .reference/t3code`.
- `assets/` holds files carried over on purpose: brand marks, theme values, model-facing prompt text to use verbatim, the design canvas, screenshots of the old app, legacy sample files, scripted-agent scenarios. They are data, not code. The Markdown files in `assets/prompts/` and `assets/design-md/` are loaded by the app and its tests.

## How work happens here

1. **Four test seams, no others**: the engine seam (`packages/engine/test`, Vitest against a real engine), the domain seam (`packages/domain/test`, Vitest on pure logic), the browser seam (`packages/web/test`, Playwright against the running app), and the shell seam for the desktop app in `apps/desktop` (`npm test` there: `node --test` against fakes of Electron and electron-updater, plus `e2e/update.mjs`, a real signed update on a Mac). Every behaviour is tested through one of them.
2. **Changes land by pull request, never a direct push to `main`**, not even one-liners. The desktop shell ships builds from tags on `main`.
3. **Unreleased work lives on `dev` or behind a feature.** Work that should not reach users yet goes by pull request into the `dev` branch, which merges into `main` by pull request once it is ready, and takes `main` back in regularly. Nothing is tagged from `dev`. A feature already on `main` that should not ship is turned off by the engine's `UNFRAMED_FEATURES` variable: production builds turn on none. `pnpm dev:app` builds "Unframed Dev" from the current checkout and installs it beside the production app, with its own data folder, no updates and every feature on.

## Commands

- `pnpm typecheck`, `pnpm test` (engine and domain seams), `pnpm test:browser` (browser seam; CI runs it on Linux with Playwright's Chromium, a local Mac run uses the installed Chrome).
- `pnpm test:perf` runs the frame-budget tests with the budgets enforced. Run it on real hardware: under `CI` the same tests run and assert everything except the timing thresholds, because a shared runner cannot hold them.

## Rules that are expensive to break

1. **Never create a GitHub Release for an engine tag.** The desktop app's updater reads this repo's latest Release and expects installers on it. Engine versions are plain git tags.
2. **Nothing about pricing, strategy or signing credentials belongs in this repo.** It is public. That material lives in the private shell repo.
3. **The tldraw watermark stays visible.** The license is a hobby license approved on that condition. The key comes from a build-time environment variable and is never committed.
4. **The hosting contract with the desktop shell** is a public interface: environment variable names, IPC messages, the stdout banner, the DOM hooks, the bundle layout. Changing any of them breaks installed apps.

## Writing

Code has no comments, except licence and attribution notices, tool directives (such as `@ts-expect-error` or `eslint-disable`), and at most one short line guarding the desktop-shell hosting contract. The git log holds history. Docs: plain words, active voice, no em dashes.

## Maintainers

`gh` must be authenticated as the account that owns the repo when opening PRs or pushing tags (`gh auth status`, `gh auth switch --user <account>`). A private repo seen by the wrong account reports as missing, not forbidden.
