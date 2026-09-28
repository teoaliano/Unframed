# Build status

The first build of the rewrite. One row per spec. The orchestrator updates this file and commits it on `build` after every change of state. A new session told "resume the build" reads this file and carries on from it.

Integration branch: `build`, cut from the seed commit `ff38001` on `main`. Nothing is pushed, tagged or released. The person opens the pull requests at the end.

## Toolchain

Checked 2026-09-28: Node v24.21.0, pnpm 9.15.4 through Corepack, Google Chrome, ffmpeg 8.1, claude 2.1.280, codex-cli 0.156.1. Nothing missing.

## Specs

| # | Spec | Wave | State | Merge commit | Note |
| --- | --- | --- | --- | --- | --- |
| 01 | engine foundation | 1 | merged | f480398 | 54/54 tasks; 311 tests, 7 browser tests green on build |
| 02 | canvas | 2 | building | | |
| 03 | image generation | 3 | pending | | |
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

## Orchestration notes

- Background sub-agents that a spec agent starts (the code-review reviewers) report to the orchestrator, not to the spec agent. The brief tells spec agents to start their sub-agents in the foreground. If one still waits, the orchestrator forwards the results with SendMessage.
