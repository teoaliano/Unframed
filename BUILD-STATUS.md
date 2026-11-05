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

Spec 12's run on `build`, with the dev server stopped: `pnpm typecheck` exit 0 (it now runs the lint); `pnpm test` 1789 of 1789 (two engine tests fail in a checkout where `pnpm dev` has written `.env`, `preferences.json` and `output/` to the repo root, and pass in a clean worktree); `pnpm test:browser` 336 of 338, and the two failures are fixed: an Escape that reached a Settings model select before its search field closed the whole dialog (product bug), and the rail test read the slide's transform one frame early.

## Specs

Specs 18 to 21 are merged to `main` through PRs #165, #172, #175, #177 and #178, with fixes in #179 to #183, #187 and #188.

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
| 12 | design system | 10 | merged | 4935b8b to 834be6d (merges 2d7b5fa, 39a1d4a, f15d45f), review fixes 2d7627f to bde5664 | 25/25 tasks. Written after the first build, at the person's request. Decisions settled during the run are under "Decisions" |
| 13 | design-system catalogue | 11 | merged | see git log | 4/4 tasks. Written after spec 12's live review, at the person's request: a dev-only page at `/design-system/` on the web dev server |
| 14 | external agents | 12 | merged | PR #110, amended in #130, built in #131 to #142 | 46 tasks in the spec. Built after the first build; the commit log shows the series, and it was not re-verified task by task |
| 15 | audio | 13 | built, PR open | | 43/43 tasks built. Every task is tested at the seam it names, except one case: the 120 s speech timeout and the 30 s timeout of the other ElevenLabs calls are in the code, with their sentences tested at the domain seam, but no engine test waits them out (spec 15 allows no per-call test override). Still open, awaiting the person's paid call (Further Notes): whether `character-cost` is credits after the model's rate, and whether Eleven v4 takes WAV. Spec 14's `file_add` takes MP3, WAV and M4A |
| 16 | nodes | | built, PR open | | 29 of 31 tasks tested at the seam each names; see "Spec 16 tests" below for where. Open: task 27's snapshot of a node's page version (the node shows a title card; the version drags out as a page shape with spec 09's snapshot and live rules), and task 31, the page-input evaluation, the person's paid step (`pageSendDefaults` stays empty, so a page wire refuses its run until its choices are made). Audio is a node medium; audio is never a wire source. The node page writer closes spec 18 task 2, spec 19 task 10 and spec 20 tasks 16 and 44 |
| 17 | project tabs | | merged | PRs #143, #146, #148, #149, #150 | 21 tasks. Its ten-tab budget runs in the isolated project of `pnpm test:browser` |
| 18 | element editing | | merged | PR #172; fixes #180, #183 | 41/41 tasks. Task 2's node page writer came with spec 16. Built by parallel Haiku agents, on `build/18-element-editing` |
| 19 | kits and tokens | | merged | PR #175; fix #181 | 42/43 tasks. Task 43 is the person's step (rendering outside Unframed). Task 10's node page writer came with spec 16 |
| 20 | components | | merged | PR #177; fix #179 | 47 of 47 tasks. Task 44 (`wireRefusal` refuses a component) and task 16's node page writer came with spec 16. Written with 18 |
| 21 | motion timeline | | merged | PRs #165 (task 1), #178; fixes #187, #188 | Every task is built except task 4, the probe report (`docs/research/motion-editability.md`), which is the person's step and is not done. Task 2, the render comparison, was run on PR #165. Task 40 is the budget in `motionPerformance.spec.ts`, which `pnpm test:perf` runs; the strip mounts only the rows in view. The fix PRs also close the build's gaps (a set's diamond moves, hidden rows are greyed, the label column collapses under 900 px, quick frame steps all count) and the review's polish (Design tab names for values, a dashed snap guide, overlapping bars in lanes, the Design tab header wraps) |

## Spec 16 tests

| Task | Seam | Where |
| --- | --- | --- |
| 1 wire rules | domain | `packages/domain/test/nodes/wires.test.ts` |
| 2 role by source | domain | `packages/domain/test/nodes/request.test.ts` ("role by source") |
| 3 node request | domain | `packages/domain/test/nodes/request.test.ts` ("node request") |
| 4 fingerprint and status | domain | `packages/domain/test/nodes/status.test.ts` (marks on a wired picture and member order included) |
| 5 chain planner | domain | `packages/domain/test/nodes/chain.test.ts` |
| 6 flow rules | domain | `packages/domain/test/nodes/flowsPages.test.ts` ("flows") |
| 7 contracts, the room and wire ends | engine | `packages/engine/test/wireEnds.test.ts` (a wire whose ends are not shape ids refused; one naming a missing shape dropped; wires dropped after Revert and after any removal) |
| 8 node run service | engine | `packages/engine/test/nodeRuns.test.ts` ("node.run"), `nodeAudio.test.ts` |
| 9 boot resolution | engine | `packages/engine/test/nodeBoot.test.ts` |
| 10 chain runner | engine | `packages/engine/test/nodeRuns.test.ts` ("chain.run", "one run at a time", "what was confirmed is what runs"), `nodeVideo.test.ts` |
| 11 spend in chains | engine | `packages/engine/test/agentNodes.test.ts` (summed limit naming the step, real cost settled), `agentNodeApproval.test.ts` (once per chain, plan mode) |
| 12 Run downstream | engine | `packages/engine/test/nodeRuns.test.ts` (the pending choice, the all choice, the node itself first); the menu counts at the browser seam in `nodeRuns.spec.ts` |
| 13 version operations | engine | `packages/engine/test/nodeRuns.test.ts` ("versions") |
| 14 agent tools | engine | `packages/engine/test/agentNodes.test.ts` |
| 15 flow save | engine | `packages/engine/test/nodeWriters.test.ts` ("flow.save"); insert is the tab's, in task 24 |
| 16 node shape util | browser | `packages/web/test/nodeCard.spec.ts` (summary and live, size limits, header kept while the body scrolls, label) |
| 17 node composer | browser | `packages/web/test/nodeCard.spec.ts` (instruction persists, Cmd+Enter, last-used values on a new node) |
| 18 wire drawing | browser | `packages/web/test/wires.spec.ts`, `wireCopies.spec.ts` |
| 19 role chips | browser | `packages/web/test/wires.spec.ts` |
| 20 versions strip | browser | `packages/web/test/nodeRuns.spec.ts` ("versions") |
| 21 status and runs | browser | `packages/web/test/nodeCard.spec.ts` |
| 22 chains on the canvas | browser | `packages/web/test/nodeRuns.spec.ts` |
| 23 undo | browser | `packages/web/test/nodeCard.spec.ts` ("Undo") |
| 24 library | browser | `packages/web/test/nodeFlows.spec.ts` |
| 25 page output, domain | domain | `packages/domain/test/nodes/flowsPages.test.ts` ("page answer") |
| 26 page output, engine | engine | `packages/engine/test/nodeRuns.test.ts` ("pages"), `nodeWriters.test.ts` (tags, ids, tokens, pins) |
| 27 page output, browser | browser | `packages/web/test/nodePages.spec.ts` (title card preview and drag out; no snapshot, open) |
| 28 page inputs, domain | domain | `packages/domain/test/nodes/flowsPages.test.ts` ("page inputs") |
| 29 page inputs, engine | engine | `packages/engine/test/nodeWriters.test.ts` (capture, reuse, retake, linked files, no Chrome) |
| 30 page inputs, browser | browser | `packages/web/test/wires.spec.ts` (HTML, Picture, Both, Files) |
| 31 evaluation | the person | not run |
| frame budget | browser | `packages/web/test/nodePerformance.spec.ts`, in `pnpm test:perf` |

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

After spec 12's restyle, same shape and machine, one worker, three repeats:

| Spec | Measure | Budget | Measured |
| --- | --- | --- | --- |
| 02 | drag one image, 300 shapes: median frame gap, frames over 33 ms | ≤ 16.7 ms, ≤ 2 % | 8.30 ms, 0.51 to 0.53 % |
| 02 | pan: median frame gap, frames over 33 ms | not budgeted | 8.30 ms, 0.36 to 0.37 % |
| 02 | 40 large images, zoom: median frame gap, frames over 33 ms, peak decoded memory | ≤ 16.7 ms, ≤ 2 %, under 518 MB | 8.30 ms, 0.00 %, 87 MB |
| 09 | artifact pan, 3 running: median, over 33 ms, long tasks | ≤ 16.7 ms, ≤ 2 %, 0 | 8.30 ms, 0.81 to 1.01 %, 0 |
| 09 | same board, 6 running: over 33 ms | not asserted | 4.18 to 5.05 % |
| 12 | pan 300 shapes under the glass Generate composer: frames over 33 ms | ≤ 2 % (spec 02's) | 0.35 to 0.74 % |
| 12 | pan 300 shapes with the rail open under the glass selection toolbar: frames over 33 ms | ≤ 2 % (spec 02's) | 0.38 to 1.12 % with the rail solid; on glass the rail reached 2.27 % in one run |

The six-running case misses the 2 % line. Task 62 does not say how many artifacts run during the pan, so the build asserts three and reports six. Headless Chrome is not Electron: the numbers inside the desktop app still need a check there.

## Decisions

Made by the person:

1. Repository license (spec 01, the published bundle): MIT. The root `LICENSE` names Matteo Aliano as copyright holder. Spec 01 says the bundle carries it.
2. Spec 12, design system: restyle every surface on t3code's tokens and Base UI kit, and theme tldraw's UI to match. Take t3code's palette whole (canvas included), its default light and dark theme only (no named themes or appearance settings), and test at the browser seam plus t3code's lint rules as a build check.

Settled by the orchestrator from the specs:

- Spec 10, `oauth.cancel` after `done` (9949bd9): the cancel deletes the key, so it is a key removal under index contract 5 and spec 10's own removal step 4. It fails pending render jobs with the key-removed error and answers `{ endedRenders }`, the same as Remove key.

Settled during spec 12, for the person's sign-off:

- The Generate send is t3code's message-action labelled pill, not a round button. Task 11 now says so (bde5664).
- Scroll to end is a kit Button on glass, and the current project is the kit's checked radio row, which gives spec 10's check and tint.
- Role badges keep the one blue hue they have always shared, through the same hue helper as provider tokens and library chips.
- The rail sits on solid `--background`: on glass it crossed spec 02's pan budget in one run of three.
- The lint allows only spec 01's two contract classes as unknown classes. Where Unframed renders tldraw's own classes, each carries a one-line disable reason.
- The shell hooks keep their old formats: `theme.ts` writes `--unframed-text-secondary` as hex and the body background as an inline colour that computes to `rgb()`, since the kit's tokens are oklch. The desktop shell was not run against them.
- DialKit stays dark in both schemes with the dark token values written out in `vendors.css`; `artifactDials.spec.ts` fails if they drift from `theme.css`.
- The Agent tray stays 440 px. No spec states its width; spec 12 names 420 px for the Generate composer only.
- The sweep for controls no kit component rendered skips the diff panel, whose rows @pierre/diffs renders in a shadow root.

Open for the person:

- Spec 09: accept six running artifacts at 4.2 to 4.4 % of frames over 33 ms, or lower the pin cap (3) or the live-through-selection cap (3).

## Deferred items

- Spec 16 is not built, so its node page writer does not stamp element ids or inject the bridge tag yet (spec 18, Element ids). Spec 16's build adds it.
- Spec 18: an element chip's excerpt rebuilds the start tag from the tag, `data-hf-id`, `data-uf-name`, `src` and inline style, because the web holds no source bytes; it can differ from the file.
- Spec 18: the Image section shows for one selected element only.
- Spec 19: token chips are missing for border colour, padding and margin sides, and shadow; those fields show the computed value.
- Spec 19: a text style's off-token Use token writes all five longhands.
- Spec 19: the Used by count path has no browser test.
- Spec 20: a token written inside a shorthand in a component rule (`background: var(...)`) is not offered as a token rule edit; only a rule's own longhand declaration is.
- Spec 20: `component.updates` can answer empty right after an undo, because the engine reads the room before the undo syncs; the editor retries up to 8 times at 250 ms instead of the engine waiting.
- Spec 01: the Electron 44 boot and the `dist` branch publish run only in the tag workflow. `scripts/electronSmoke.ts` ran with plain Node as the binary; `scripts/publishDist.sh` never ran.
- Spec 05: logic duplicated between `textRuns.ts` and spec 03's `runs.ts` (run-id minting, the `of` lookup, top-index lookup), and between the image and text catalogue functions.
- Spec 05: a text result whose sidecar could not be written gets `sidecar: null`; duplicating it drops its result meta.
- Spec 06: review smells left alone: 16 copies of `messageOf` and a paste fix-up that overlaps domain `instantiate`.
- Spec 07: `packages/engine/src/agent/runtime.ts` is 1093 lines, and some contract and domain types are defined twice (a compile-time check in `layer.ts` catches drift).
- Spec 08: `AgentTray.tsx` is 1303 lines.
- Spec 09: `The render failed.` (a failure with no message) is unreachable in tests, because the stub's `fail` mode always carries a message.
- Spec 09: `sharp`, a native addon, is installed through `@hyperframes/studio-server`. The render path never loads it today (spec 01 forbids native addons on runtime paths). Recheck on a HyperFrames upgrade.
- Spec 09: a shape's last live still is kept for the session only.
- Spec 10: Cancel's `renderCleanupError` display in the web has no browser test; the engine side is tested.
- Spec 11: every sweep write prunes done and failed jobs older than 7 days, so an old finished job's clip from an imported `jobs.json` may never be placed if the sweep writes before its project is first opened.
- Spec 12: `GenerateTray.tsx` copies the kit's field frame and focus ring into its classes instead of using InputGroup.
- Spec 12: a few tests find elements by third-party class names that spec 12's test hooks section does not exempt (lucide icon classes in `addMenu.spec.ts` and `toasts.spec.ts`, DialKit's classes in `artifactDials.spec.ts`).
- Spec 12: the sweep does not open the legacy import screens; `legacyImport.spec.ts` checks their kit slots.
- The context-menu fix in `packages/web/src/canvas/ContextMenu.tsx` cancels the menu library's delayed refocus through an internal event name that tldraw bundles. A tldraw upgrade that renames it brings the bug back without failing anything else.
- Undo and selection: tldraw records selection changes as undo steps, so after opening an editor (which selects the shape) and closing it, the first Cmd-Z restores the earlier selection and the next one undoes the edit before it. This is canvas-wide tldraw behaviour, not specific to spec 20; changing it would change undo everywhere.

## Needs you

1. Add the `TLDRAW_LICENSE_KEY` repository secret. The tag workflow fails without it; the PR workflow builds without it.
2. Choose the GitHub remote. This checkout has none. The shell pins `github:<owner>/<repo>#engine-v<semver>-dist`, so the owner and repo name are part of the shell's dependency line.
3. Open the pull requests from `build` into `main`.
4. Try the paid paths once with your own OpenRouter key: an image run, a text run, a video render collected to the canvas, and Connect OpenRouter through the real PKCE flow. No test reached openrouter.ai.
5. Run the manual acceptance checks no test can: a Claude chat and the zero-token probe on the real `claude` CLI, a Codex chat on the real `codex app-server`, and one real HyperFrames motion render.
6. Make the desktop shell changes, in the private shell repo:
   - move to Electron 44 (the bundle targets its Node; an older shell cannot run it);
   - use `assets/brand/app-icon.png` (1024 × 1024) for the app's window and dock icon: the mark changed;
   - expect `.unframed-chrome-right` to be empty: Agent moved to the bottom bar and Settings to the top-left card, which is now wider; the element stays so the shell's CSS still finds it;
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
- Seen failing once under load and passing on rerun, not fixed: `agentComposer.spec.ts:34` (the Escape after removing a chip, twice in full runs, 8 of 8 alone), `artifactLive.spec.ts:139`, `previews.spec.ts:16`, `composerTray.spec.ts:20` and `:76`, `previewTools.test.ts`, `catalogue.test.ts`, `bundle.test.ts` (30 s timeout), and two `startGeneration` engines that printed nothing in 15 s. None failed in the final clean-install runs.
