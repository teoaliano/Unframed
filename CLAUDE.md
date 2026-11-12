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
3. **Unreleased work lives on `dev` or behind a feature flag.** Work that should not reach users yet goes by pull request into the `dev` branch, which merges into `main` by pull request once it is ready, and takes `main` back in regularly. Nothing is tagged from `dev`. Work that lands on `main` before it should ship goes behind a feature flag.

## Feature flags

Every pull request that adds or changes what a user sees either ships or lands behind a flag. When the person has not said which, ask before opening the pull request. The engine reads the flags from `UNFRAMED_FEATURES` (comma-separated names, or `all`). Production sets nothing, so every flag is off for users; `pnpm dev`, the test harnesses and the dev app turn on `all`.

- **Flag a feature**: add its name to `FEATURES` in `packages/contracts/src/settings.ts` and its refusal line to `FEATURE_OFF_MESSAGES` in `packages/domain/src/features.ts`. Gate the interface with `useFeature` from `packages/web/src/features.ts`, the engine calls with `featureOn` in `packages/engine/src/rpc/handlers.ts`, and the agent tools through the `Features` their catalogue and batch rules take. Off means hidden or read-only: work saved while the flag was on still opens and renders.
- **Test the off state** next to the existing cases in `packages/engine/test/featureFlags.test.ts` and `packages/web/test/featureFlags.spec.ts`.
- **Ship a flagged feature** by a pull request that deletes its name from `FEATURES` and every gate on it. Users get it with the next release.

## The dev app

`pnpm dev:app` (Apple silicon only) builds "Unframed Dev" from this checkout as it stands, branch and uncommitted changes included, and installs it in `/Applications` beside the production app. It keeps its own data (`~/Library/Application Support/Unframed Dev`) and outputs (`~/Pictures/Unframed Dev`), never updates itself, and turns every flag on. It needs no tag or release: run it again to pick up new code, with `--open` to launch it afterwards. Export `TLDRAW_LICENSE_KEY` first, or its canvas shows tldraw's license notice.

## Commands

- `pnpm typecheck`, `pnpm test` (engine and domain seams), `pnpm test:browser` (browser seam; CI runs it on Linux with Playwright's Chromium, a local Mac run uses the installed Chrome).
- `pnpm test:perf` runs the frame-budget tests with the budgets enforced. Run it on real hardware: under `CI` the same tests run and assert everything except the timing thresholds, because a shared runner cannot hold them.

## Rules that are expensive to break

1. **Never create a GitHub Release for an engine tag.** The desktop app's updater reads this repo's latest Release and expects installers on it. Engine versions are plain git tags.
2. **Nothing about pricing, strategy or signing credentials belongs in this repo.** It is public. That material lives in the private shell repo.
3. **The tldraw watermark stays visible.** The license is a hobby license approved on that condition. The key comes from a build-time environment variable and is never committed.
4. **The hosting contract with the desktop shell** is a public interface: environment variable names, IPC messages, the stdout banner, the DOM hooks, the bundle layout. Changing any of them breaks installed apps.

## Design tokens: Figma and code are 1:1

The Figma file "🦾 Unframed" is the source of the design. Its variables live in `packages/web/src/theme/variables.tsv`, and `pnpm --filter @unframed/web tokens` writes `src/theme/tokens.css` from it. `pnpm typecheck` fails when code and Figma drift.

1. **Four collections.** Primitives (the Tailwind palette), Tokens (scales named as Tailwind names them: `spacing/2` is `p-2`, `size/4_5` is `size-4.5`, `radius/md` is `rounded-md`), Theme (cross-component meaning: `surface/background`, `text/muted`) and Components (one group per component: `menu/item/surface-highlighted` is `--menu-item-surface-highlighted`).
2. **A component paints only with its own tokens.** It never reads a Theme token or a palette colour directly; its tokens alias them. A new component or part gets new tokens in Figma first.
3. **Change a token in Figma, then export.** Run `packages/web/scripts/figma-export.js` in the file through the Figma plugin API, save the result over `variables.tsv`, run `tokens`, and commit both files with the code that uses them. Never edit `tokens.css` by hand.
4. **Sizes stay on the scales.** Spacing, sizes, radii, font sizes, line heights and opacities use Tailwind steps that exist in Tokens. A layout dimension that is not a step is a component token (`max-w-(--settings-dialog-width)`), not an arbitrary value.
5. **Named exceptions**, and only these, are listed in `scripts/tokens.ts` with their reasons: the font family (Figma names SF Pro, code asks for the system stack), primitive colours (Tailwind's oklch against Figma's hex), runtime variables set by Base UI and tldraw, em lengths that track text, literal colours that are data (masks, colour-picker fallbacks, a user kit's defaults), and z-index and motion, which Figma does not hold.

## Writing

Code has no comments, except licence and attribution notices, tool directives (such as `@ts-expect-error` or `eslint-disable`), and at most one short line guarding the desktop-shell hosting contract. The git log holds history. Docs: plain words, active voice, no em dashes.

## Maintainers

`gh` must be authenticated as the account that owns the repo when opening PRs or pushing tags (`gh auth status`, `gh auth switch --user <account>`). A private repo seen by the wrong account reports as missing, not forbidden.
