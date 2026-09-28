# Build status

The first build of the rewrite. One row per spec. The orchestrator updates this file and commits it on `build` after every change of state. A new session told "resume the build" reads this file and carries on from it.

Integration branch: `build`, cut from the seed commit `ff38001` on `main`. Nothing is pushed, tagged or released. The person opens the pull requests at the end.

## Toolchain

Checked 2026-09-28: Node v24.21.0, pnpm 9.15.4 through Corepack, Google Chrome, ffmpeg 8.1, claude 2.1.280, codex-cli 0.156.1. Nothing missing.

## Specs

| # | Spec | Wave | State | Merge commit | Note |
| --- | --- | --- | --- | --- | --- |
| 01 | engine foundation | 1 | merged | f480398 | 54/54 tasks; 311 tests, 7 browser tests green on build |
| 02 | canvas | 2 | merged | 901847a | 60/60 tasks; 421 tests, 83 browser tests green on build; all budgets met (see below) |
| 03 | image generation | 3 | building | | |
| 04 | video generation | 4 | pending | | merge after 05 |
| 05 | text, multi-run and Free | 4 | pending | | merge before 04 |
| 06 | groups, recipes and the library | 5 | pending | | |
| 07 | agent runtime | 6 | pending | | |
| 08 | agent chat | 7 | pending | | merge before 10 |
| 09 | artifacts | 8 | pending | | |
| 10 | settings and OpenRouter | 7 | pending | | merge after 08 |
| 11 | legacy import | 9 | pending | | |

## Decisions

Each entry names the decision, the answer, and the spec it changed.

1. Repository license (spec 01, the published bundle): MIT. The root `LICENSE` names Matteo Aliano as copyright holder. Spec 01 now says the bundle carries the MIT root `LICENSE`.

## Deferred items

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

- Local Playwright runs use the installed Chrome. Chrome sometimes starts only its crash handlers and never opens, and Playwright then waits with no output. Run browser tests with `--global-timeout` and kill and rerun on a hang.
- `menuActions.spec.ts` "Reveal shows the right-clicked file" failed once in a full run on `build` after the spec 02 merge and passed on every rerun (3 alone, then the full suite). Watch it.

- Background sub-agents that a spec agent starts (the code-review reviewers) report to the orchestrator, not to the spec agent. The brief tells spec agents to start their sub-agents in the foreground. If one still waits, the orchestrator forwards the results with SendMessage.
