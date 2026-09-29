# Build status

The first build of the rewrite, finished. One row per spec. A new session told "resume the build" reads this file; there is nothing left to resume except the items under "Needs you".

Integration branch: `build`, cut from the seed commit `ff38001` on `main`. Nothing is pushed, tagged or released. The person opens the pull requests.

## Final report

All eleven specs are built and merged into `build`: 581 tasks, each tested at the seam its spec names.

Final verification, from a clean install (`node_modules` and `dist` removed) on `build`:

| Step | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | ok; pnpm skips puppeteer's download script |
| `pnpm typecheck` | exit 0 |
| `pnpm test` | 1788 of 1788 in 155 files, 216 s |
| `pnpm test:browser` | 303 of 303, 6.6 min, 4 workers, installed Chrome |
| `pnpm build` | ok; bundle root holds `LICENSE`, `THIRD_PARTY_NOTICES`, `client/` (with `dist/` and the npm shim), `package.json` (name `unframed`, version 0.1.0), `server/index.js` |
| bundle smoke test (`UNFRAMED_BUNDLE_DIR=dist pnpm test:bundle`) | 7 of 7 |
| CI workflows | no step creates a GitHub Release |

## Specs

| # | Spec | Wave | State | Merge commit | Note |
| --- | --- | --- | --- | --- | --- |
| 01 | engine foundation | 1 | merged | f480398 | 54/54 tasks |
| 02 | canvas | 2 | merged | 901847a, fixes 19a4177 | 60/60 tasks. Later fix: the context menu closed itself when a right-click beat tldraw's delayed refocus (product bug) |
| 03 | image generation | 3 | merged | f9649ab, fixes 5621a6a, 3cb90d0, 40cea11 | 54/54 tasks. Later fixes: the Chrome close hang in local test runs; an Escape pressed as a composer menu showed closed the whole composer, then closed nothing; the composer now closes the open tray menu wherever focus is (product bug) |
| 04 | video generation | 4 | merged | ae89c78 | 66/66 tasks; merged after 05 |
| 05 | text, multi-run and Free | 4 | merged | c1bb5a2 | 40/40 tasks |
| 06 | groups, recipes and the library | 5 | merged | 5f399d1 | 39/39 tasks |
| 07 | agent runtime | 6 | merged | ba20d56 | 55/55 tasks |
| 08 | agent chat | 7 | merged | 6c70830, fix b05f1c7 | 47/47 tasks. Later fix: a tool call finishing in the same millisecond as the reply read "Stopped" (product bug). Covers spec 03 task 36's Agent tray and spec 06 task 15's Agent button |
| 09 | artifacts | 8 | merged | 949cdd3 | 62/62 tasks |
| 10 | settings and OpenRouter | 7 | merged | b7a1b78, fixture fix 18312a7 | 58/58 tasks plus the `oauth.cancel` render rule; merged after 08 |
| 11 | legacy import | 9 | merged | c264c38 | 46/46 tasks; covers spec 03's imported-recipe Regenerate and Recipe |

## Performance budgets

Final run on `build` after the clean install: hosted shape (production web served by the engine with `UNFRAMED_CLIENT_DIST` at `127.0.0.1`, artifacts from the preview origin on `localhost`), headless Chrome 147, this Mac at 120 Hz (display frame 8.3 ms), one worker, three repeats. Load average was about 10 from other work on the machine. Ranges are across the three repeats.

| Spec | Measure | Budget | Measured |
| --- | --- | --- | --- |
| 02 | drag one image, 300 shapes: other shapes rendered | 0 | 0 |
| 02 | same drag: renders of the dragged shape | at most 1 per move | 1 in total |
| 02 | same drag: median frame gap | ≤ 16.7 ms | 8.30 ms |
| 02 | same drag: frames over 33 ms | ≤ 2 % | 0.51 to 0.53 % |
| 02 | pan: shapes rendered | 0 | 0 |
| 02 | pan: median frame gap, frames over 33 ms | not budgeted | 8.30 ms, 0.36 to 0.37 % |
| 02 | 40 images of 6000 × 4000, zoom 55 % to 376 %: median frame gap | ≤ 16.7 ms | 8.30 ms |
| 02 | same zoom: frames over 33 ms | ≤ 2 % | 0.00 % |
| 02 | same zoom: peak decoded image memory | under 518 MB | 87 MB |
| 09 | ten busy pages and five motions, 4 s pan, 3 running (1 pinned, 2 selected): median frame gap | ≤ 16.7 ms | 8.30 ms |
| 09 | same pan: frames over 33 ms | ≤ 2 % | 0.60 to 0.80 % |
| 09 | same pan: long tasks over 50 ms | 0 | 0 |
| 09 | same board, 6 running (3 pinned, 3 selected, the most spec 09 allows): median / over 33 ms / long tasks | not asserted by task 62 | 8.30 ms / 4.22 to 4.44 % / 0 |

The six-running case misses the 2 % line. Task 62 does not say how many artifacts run during the pan, so the build asserts three and reports six. Headless Chrome is not Electron: the numbers inside the desktop app still need a check there.

## Decisions

Made by the person:

1. Repository license (spec 01, the published bundle): MIT. The root `LICENSE` names Matteo Aliano as copyright holder. Spec 01 says the bundle carries it.

Settled by the orchestrator from the specs:

- Spec 10, `oauth.cancel` after `done` (9949bd9): the cancel deletes the key, so it is a key removal under index contract 5 and spec 10's own removal step 4. It fails pending render jobs with the key-removed error and answers `{ endedRenders }`, the same as Remove key.

Open for the person:

- Spec 09: accept six running artifacts at 4.2 to 4.4 % of frames over 33 ms, or lower the pin cap (3) or the live-through-selection cap (3).

## Deferred items

- Spec 01: the Electron 44 boot and the `dist` branch publish run only in the tag workflow. `scripts/electronSmoke.ts` ran with plain Node as the binary; `scripts/publishDist.sh` never ran.
- Spec 04, task 21: the test moves the image through the room, not with a mouse drag, because dragging a selected shape moves the whole selection.
- Spec 05: logic duplicated between `textRuns.ts` and spec 03's `runs.ts` (run-id minting, the `of` lookup, top-index lookup), and between the image and text catalogue functions.
- Spec 05: a text result whose sidecar could not be written gets `sidecar: null`; duplicating it drops its result meta.
- Spec 06: review smells left alone, 10 copies of `messageOf` and a paste fix-up that overlaps domain `instantiate`.
- Spec 07: the Claude adapter and the zero-token probe never ran against a real CLI (spec 07 makes that a manual acceptance test). The Codex adapter ran end to end against a fake `codex app-server` only.
- Spec 07: `runtime.ts` is 800 lines, and some contract and domain types are defined twice (a compile-time check in `layer.ts` catches drift).
- Spec 08: `AgentTray.tsx` is 686 lines.
- Spec 09: the real HyperFrames render is untested; tests use the `UNFRAMED_TEST_RENDERER` stub.
- Spec 09: `The render failed.` (a failure with no message) is unreachable in tests, because the stub's `fail` mode always carries a message.
- Spec 09: `sharp`, a native addon, is installed through `@hyperframes/studio-server`. The render path never loads it today (spec 01 forbids native addons on runtime paths). Recheck on a HyperFrames upgrade.
- Spec 09: a shape's last live still is kept for the session only.
- Spec 10: Cancel's `renderCleanupError` display in the web has no browser test; the engine side is tested.
- Spec 11: every sweep write prunes done and failed jobs older than 7 days, so an old finished job's clip from an imported `jobs.json` may never be placed if the sweep writes before its project is first opened.
- The context-menu fix in `packages/web/src/canvas/ContextMenu.tsx` cancels the menu library's delayed refocus through an internal event name that tldraw bundles. A tldraw upgrade that renames it brings the bug back without failing anything else.

## Needs you

1. Add the `TLDRAW_LICENSE_KEY` repository secret. The tag workflow fails without it; the PR workflow builds without it.
2. Choose the GitHub remote. This checkout has none. The shell pins `github:<owner>/<repo>#engine-v<semver>-dist`, so the owner and repo name are part of the shell's dependency line.
3. Open the pull requests from `build` into `main`.
4. Try the paid paths once with your own OpenRouter key: an image run, a text run, a video render collected to the canvas, and Connect OpenRouter through the real PKCE flow. No test reached openrouter.ai.
5. Run the manual acceptance checks no test can: a Claude chat and the zero-token probe on the real `claude` CLI, a Codex chat on the real `codex app-server`, and one real HyperFrames motion render.
6. Make the desktop shell changes, in the private shell repo:
   - move to Electron 44 (the bundle targets its Node; an older shell cannot run it);
   - target the new DOM hooks: `.unframed-chrome-left` and `.unframed-chrome-right` (were `.toolbar-card-left` and `.toolbar-card-right`), `data-unframed-theme` on `<html>` (was `data-astryx-theme`), `--unframed-text-secondary` (was `--color-text-secondary`);
   - handle the `{type: "reveal", files}` IPC message;
   - pin the engine as `github:<owner>/<repo>#engine-v<semver>-dist`, and stop building the client (the bundle's `client/` shim keeps the old `npm ci && npm run build` step harmless until then);
   - package the Claude Agent SDK without its bundled native CLI packages (spec 07 always passes `pathToClaudeCodeExecutable`);
   - set `"puppeteer": {"skipDownload": true}` in the shell's manifest or install with `PUPPETEER_SKIP_DOWNLOAD=1`, because the bundle now depends on HyperFrames, which brings puppeteer.
7. Check the frame budgets inside the desktop app (Electron), and decide the six-running artifact question above.
8. Optional: update Chrome on this Mac to 148 or later, which honours `--disable-updater-scheduler`; `packages/web/test/chrome.sh` stays harmless after that.

## Orchestration notes and watch list

- Local Playwright runs use the installed Chrome through `packages/web/test/chrome.sh`, which sends Chrome's output to `/dev/null`. Chrome 147's `GoogleUpdater` otherwise holds that output open and `browser.close()` hangs, leaving orphaned workers. Run browser tests with `--global-timeout`, and kill orphans by path (`<checkout>/node_modules/.pnpm/playwright.*/workerProcessEntry`), never with a bare `pkill -f workerProcessEntry`.
- Browser specs that touch the system clipboard run one at a time in their own Playwright project.
- Browser test engines point `CLAUDE_PATH` and `CODEX_PATH` at missing files and use `SHELL=/bin/sh`, so provider detection never starts real CLIs. A hosted engine gets the fixture OpenRouter key unless its test writes a `.env`; a test that writes one and wants a key must include `OPENROUTER_API_KEY`.
- `pnpm -s typecheck` prints nothing when it fails. Read the exit code.
- Spec agents stall after 10 minutes of a silent command. Briefs capped commands at 5 minutes and banned background commands, whose notifications reach the orchestrator. Background sub-agents a spec agent starts also report to the orchestrator, so briefs told agents to start them in the foreground.
- Seen failing once under load and passing on rerun, not fixed: `artifactLive.spec.ts:139`, `previews.spec.ts:16`, `composerTray.spec.ts:20` and `:76`, `previewTools.test.ts`, `catalogue.test.ts`, `bundle.test.ts` (30 s timeout), and two `startGeneration` engines that printed nothing in 15 s. None failed in the final clean-install runs.
