# Build status

The first build of the rewrite. One row per spec. The orchestrator updates this file and commits it on `build` after every change of state. A new session told "resume the build" reads this file and carries on from it.

Integration branch: `build`, cut from the seed commit `ff38001` on `main`. Nothing is pushed, tagged or released. The person opens the pull requests at the end.

## Toolchain

Checked 2026-09-28: Node v24.21.0, pnpm 9.15.4 through Corepack, Google Chrome, ffmpeg 8.1, claude 2.1.280, codex-cli 0.156.1. Nothing missing.

## Specs

| # | Spec | Wave | State | Merge commit | Note |
| --- | --- | --- | --- | --- | --- |
| 01 | engine foundation | 1 | merged | f480398 | 54/54 tasks; 311 tests, 7 browser tests green on build |
| 02 | canvas | 2 | merged | 901847a, fixes 19a4177 | 60/60 tasks; all budgets met (see below). Fixes: context menu closed itself when a right-click beat tldraw's delayed refocus (product bug), and `settledRecord` now outwaits the sync client's 1 s send interval |
| 03 | image generation | 3 | merged | f9649ab, fixes 5621a6a | 54/54 tasks; 626 tests, 112 browser tests green on build in 3.0 min. Task 36's Agent tray part waits for spec 08 |
| 04 | video generation | 4 | merged | ae89c78 | 66/66 tasks; merged after 05 (the agent resolved 13 conflicts, all two additions to one spot); 994 tests, 150 browser tests green on build |
| 05 | text, multi-run and Free | 4 | merged | c1bb5a2 | 40/40 tasks; 790 tests green, 134 of 135 browser tests (the one failure is the spec 02 right-click flake, sent back to the spec 02 agent) |
| 06 | groups, recipes and the library | 5 | merged | 5f399d1 | 39/39 tasks; 1144 tests, 185 browser tests green on build. Task 15's Agent button waits for spec 08 |
| 07 | agent runtime | 6 | merged | ba20d56 | 55/55 tasks; 1356 tests, 185 browser tests green on build |
| 08 | agent chat | 7 | building | | merge before 10 |
| 09 | artifacts | 8 | pending | | |
| 10 | settings and OpenRouter | 7 | building | | merge after 08 |
| 11 | legacy import | 9 | pending | | |

## Decisions

Each entry names the decision, the answer, and the spec it changed.

1. Repository license (spec 01, the published bundle): MIT. The root `LICENSE` names Matteo Aliano as copyright holder. Spec 01 now says the bundle carries the MIT root `LICENSE`.

## Deferred items

- Spec 03, task 36: the Agent tray part is untestable until spec 08 fills the `agentTray` slot. The spec 08 agent must cover it.
- Spec 03: Regenerate and Recipe for imported (approximate) recipes belong to spec 11.
- Spec 07: the Claude adapter and the zero-token probe never ran against a real CLI (spec 07 makes that a manual acceptance test; tests must not spend quota). The Codex adapter is covered end to end with a fake `codex app-server`.
- Spec 07: the bundle lists `@anthropic-ai/claude-agent-sdk` as its one runtime dependency, and a plain `npm install` of the bundle pulls the SDK's native CLI packages. Spec 07 says the packaged app ships the SDK without its native CLI, so the desktop shell's packaging must drop them.
- Spec 07: review items left alone, the 800-line `runtime.ts` and duplicated contract and domain type definitions (a compile-time check in `layer.ts` catches drift).
- Spec 06, task 15: the recipe bar's Agent button shows only once spec 08 registers the Agent tray. The spec 08 agent must cover it.
- Spec 06: review smells left alone, the 10 copies of `messageOf` across files and the paste fix-up that overlaps domain `instantiate`.
- Spec 04: if a pending render job's project folder is gone, the collector fails and the sweep retries every tick, downloading the clip each time. Spec 10 fails such records before it deletes or moves a project; the spec 10 agent must check the sweep stops.
- Spec 04, task 21: the test moves the image through the room, not with a mouse drag, because dragging a selected shape moves the whole selection.
- Spec 05: some logic is duplicated between `textRuns.ts` and spec 03's `runs.ts` (run-id minting, the `of` lookup, top-index lookup), and between the image and text catalogue functions. The agent left spec 03's files alone because spec 04 edits them in parallel. Fold them together after wave 4.
- Spec 05: a text result whose sidecar could not be written gets `sidecar: null`, and duplicating it drops its result meta, because the copy rules read null as an unfilled placeholder.
- Spec 01: the Electron 44 boot and the `dist` branch publish run only in the tag workflow. The agent checked `scripts/electronSmoke.ts` with plain Node as the binary and did not run `scripts/publishDist.sh` locally.

## Performance budgets

Measured by the spec agent in the hosted shape (production web served by the engine with `UNFRAMED_CLIENT_DIST`, headless Chrome, this Mac at 120 Hz). The final run at the end of the build replaces these.

| Spec | Measure | Budget | Measured |
| --- | --- | --- | --- |
| 02 | drag one image, 50 moves, 300 shapes: other shapes rendered | 0 | 0 |
| 02 | same drag: renders of the dragged shape | at most 1 per move | 1 in total |
| 02 | same drag: median frame gap | ≤ 16.7 ms | 8.30 ms |
| 02 | same drag: frames over 33 ms | ≤ 2 % | 0.43 % |
| 02 | pan 60 steps: shapes rendered | 0 | 0 |
| 02 | 40 images of 6000 × 4000, zoom 55 % to 376 %: median frame gap | ≤ 16.7 ms | 8.30 ms |
| 02 | same zoom: frames over 33 ms | ≤ 2 % | 0.47 % |
| 02 | same zoom: peak decoded image memory | under 518 MB | 87 MB |

## Orchestration notes

- Local Playwright runs use the installed Chrome. Chrome 147 on this Mac starts `GoogleUpdater` about 19 s after launch, which holds Chrome's stdout and stderr open, so `browser.close()` waited seconds to minutes and left orphaned workers. Since the spec 03 fixes, a local Mac run starts Chrome through `packages/web/test/chrome.sh`, which sends its output to `/dev/null`. Chrome 148 or later honours `--disable-updater-scheduler` and would fix it too. Still run browser tests with `--global-timeout`, and kill -9 orphaned `workerProcessEntry.js` processes before a rerun.
- Browser specs that touch the system clipboard run one at a time in their own Playwright project (spec 03 fixes). New clipboard tests go there.
- A spec agent stalls (10 minutes with no stream progress) when one command runs long with no output, such as a browser suite hung in teardown. Briefs cap each command at 5 minutes with `--global-timeout 280000 --reporter=list`, and tell agents not to use background commands, whose notifications reach the orchestrator. A stalled agent resumes with SendMessage and keeps its context.
- Never run a bare `pkill -f workerProcessEntry`: it kills every worktree's Playwright workers. Kill by path (`<checkout>/node_modules/.pnpm/playwright.*/workerProcessEntry`) or orphans only.
- Fixed in 19a4177: the right-click flake (`menuActions` "Reveal", `contextMenu.spec.ts:86`), `promptPin.spec.ts` and the `mediaResize.spec.ts` crop flake. The context-menu fix in `packages/web/src/canvas/ContextMenu.tsx` cancels the menu library's delayed refocus through an internal event name that tldraw bundles. A tldraw upgrade that renames it brings the flake back silently.
- `packages/engine/test/bundle.test.ts` timed out once at 30 s in a loaded full run in the spec 04 worktree and passed alone. Watch it.
- `composerTray.spec.ts:20` and `:76` failed together once in a full run on build at load average 11 (composer not visible in 5 s; model chip click timed out), then passed 21 of 21 alone and in the next full run. Watch them.

- Background sub-agents that a spec agent starts (the code-review reviewers) report to the orchestrator, not to the spec agent. The brief tells spec agents to start their sub-agents in the foreground. If one still waits, the orchestrator forwards the results with SendMessage.
