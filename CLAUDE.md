# CLAUDE.md

This file loads into every session. It holds the rules that apply to any change. What the app does lives in `docs/specs/`.

## What this is

Unframed: a local, pay-per-generation image, video and text generator on a tldraw canvas. You select material on the canvas and either Generate (a paid OpenRouter call) or hand the selection to a local coding agent (Claude or Codex on your own subscription). `docs/specs/00-index.md` has the product, the stack, the vocabulary, the test seams and the build order. Read it before anything else.

## The old implementation

This codebase replaced an older Unframed (a React Flow canvas with output nodes) in engine 0.6.0. The old code survives only in git history, before the merge that brought this one in. It is not a source: the specs in `docs/specs/` describe what the app does, and when one is missing or ambiguous, ask the person rather than mining the old history.

- `.reference/t3code/` (gitignored) is a clone of t3code (MIT), the reference the agent and composer specs follow. Clone it with `git clone --depth 1 https://github.com/pingdotgg/t3code .reference/t3code`.
- `assets/` holds files carried over on purpose: brand marks, theme values, model-facing prompt text to use verbatim, the design canvas, screenshots of the old app, legacy sample files, scripted-agent scenarios. They are data, not code.

## How work happens here

1. **Specs are built in order**, one `/implement` run each: `/implement docs/specs/NN-<slug>.md`. The index lists the order; `BUILD-STATUS.md` at the root, once it exists, says which are done. A spec may rely on everything before it and nothing after it.
2. **Implementation Decisions are binding; Out of Scope is left alone.** A task whose seam does not work is a spec problem: stop and say so rather than inventing a new seam.
3. **Three test seams, no others** (defined in the index): the engine seam, the domain seam, the browser seam. Every behaviour is tested through one of them.
4. **Changes land by pull request, never a direct push to `main`**, not even one-liners. The desktop shell ships builds from tags on `main`. During the first build everything lands on the local `build` branch and the person opens the pull requests.
5. **When a spec's behaviour changes after it is built**, update the spec in the same PR, so the spec stays the description of the app.

## Commands

- `pnpm typecheck`, `pnpm test` (engine and domain seams), `pnpm test:browser` (browser seam; CI runs it on Linux with Playwright's Chromium, a local Mac run uses the installed Chrome).
- `pnpm test:perf` runs the frame-budget specs (specs 02, 09 and 12) with the budgets enforced. Run it on real hardware: under `CI` the same specs run and assert everything except the timing thresholds, because a shared runner cannot hold them.

## Rules that are expensive to break

1. **Never create a GitHub Release for an engine tag.** The desktop app's updater reads this repo's latest Release and expects installers on it. Engine versions are plain git tags. Spec 01 defines the published bundle.
2. **Nothing about pricing, strategy or signing credentials belongs in this repo.** It is public. That material lives in the private shell repo.
3. **The tldraw watermark stays visible.** The license is a hobby license approved on that condition. The key comes from a build-time environment variable (spec 01) and is never committed.
4. **The hosting contract with the desktop shell** (spec 01) is a public interface: environment variable names, IPC messages, the stdout banner, the DOM hooks, the bundle layout. Changing any of them breaks installed apps.

## Writing

Code comments earn their length only when deleting them would let someone make a wrong change. The git log holds history. Docs and comments: plain words, active voice, no em dashes.

## Maintainers

`gh` must be authenticated as the account that owns the repo when opening PRs or pushing tags (`gh auth status`, `gh auth switch --user <account>`). A private repo seen by the wrong account reports as missing, not forbidden.
