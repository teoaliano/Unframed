# CLAUDE.md

This file loads into every session. It holds the rules that apply to any change. What the app does lives in `docs/specs/`.

## What this is

Unframed: a local, pay-per-generation image, video and text generator on a tldraw canvas. You select material on the canvas and either Generate (a paid OpenRouter call) or hand the selection to a local coding agent (Claude or Codex on your own subscription). `docs/specs/00-index.md` has the product, the stack, the vocabulary, the test seams and the build order. Read it before anything else.

## Clean room: never read the old code

This repo is a from-scratch rewrite of an older Unframed. The old code exists on this machine and on GitHub. **You must never read it, search it, clone it, fetch it or ask a subagent to.** That covers any checkout of the old engine or of the private desktop shell, by absolute or relative path, and their GitHub repositories. The point of the rewrite is to leave the old implementation's debt behind, and an agent that copies from it brings the debt along.

- The specs describe every behaviour, limit, message and file format you need. If one is missing or ambiguous, stop and ask the person. Do not go looking for the answer outside this repo.
- Never search or list outside this repository's root, even to "just check". Two exceptions: `.reference/t3code/`, a gitignored clone of t3code (MIT) that the specs tell you to follow, and the skill files in `~/.claude/skills/`, which `/implement` and the build orchestrator read.
- `.claude/settings.json` and `.claude/hooks/clean-room.mjs` enforce this. Never edit, disable or work around them.
- `assets/` holds files carried over on purpose: brand marks, theme values, model-facing prompt text to use verbatim, the design canvas, screenshots of the old app, legacy sample files, scripted-agent scenarios. They are data, not code.

## How work happens here

1. **Specs are built in order**, one `/implement` run each: `/implement docs/specs/NN-<slug>.md`. The index lists the order; `BUILD-STATUS.md` at the root, once it exists, says which are done. A spec may rely on everything before it and nothing after it.
2. **Implementation Decisions are binding; Out of Scope is left alone.** A task whose seam does not work is a spec problem: stop and say so rather than inventing a new seam.
3. **Three test seams, no others** (defined in the index): the engine seam, the domain seam, the browser seam. Every behaviour is tested through one of them.
4. **Changes land by pull request, never a direct push to `main`**, not even one-liners. The desktop shell ships builds from tags on `main`. During the first build everything lands on the local `build` branch and the person opens the pull requests.
5. **When a spec's behaviour changes after it is built**, update the spec in the same PR, so the spec stays the description of the app.

## Rules that are expensive to break

1. **Never create a GitHub Release for an engine tag.** The desktop app's updater reads this repo's latest Release and expects installers on it. Engine versions are plain git tags. Spec 01 defines the published bundle.
2. **Nothing about pricing, strategy or signing credentials belongs in this repo.** It is public. That material lives in the private shell repo.
3. **The tldraw watermark stays visible.** The license is a hobby license approved on that condition. The key comes from a build-time environment variable (spec 01) and is never committed.
4. **The hosting contract with the desktop shell** (spec 01) is a public interface: environment variable names, IPC messages, the stdout banner, the DOM hooks, the bundle layout. Changing any of them breaks installed apps.

## Writing

Code comments earn their length only when deleting them would let someone make a wrong change. The git log holds history. Docs and comments: plain words, active voice, no em dashes.

## Maintainers

`gh` must be authenticated as the account that owns the repo when opening PRs or pushing tags (`gh auth status`, `gh auth switch --user <account>`). A private repo seen by the wrong account reports as missing, not forbidden.
