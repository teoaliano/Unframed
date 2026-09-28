# Build status

The first build of the rewrite. One row per spec. The orchestrator updates this file and commits it on `build` after every change of state. A new session told "resume the build" reads this file and carries on from it.

Integration branch: `build`, cut from the seed commit `ff38001` on `main`. Nothing is pushed, tagged or released. The person opens the pull requests at the end.

## Toolchain

Checked 2026-09-28: Node v24.21.0, pnpm 9.15.4 through Corepack, Google Chrome, ffmpeg 8.1, claude 2.1.280, codex-cli 0.156.1. Nothing missing.

## Specs

| # | Spec | Wave | State | Merge commit | Note |
| --- | --- | --- | --- | --- | --- |
| 01 | engine foundation | 1 | building | | |
| 02 | canvas | 2 | pending | | |
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

None yet. Each entry names the decision, the answer, and the spec it changed.

## Deferred items

None yet.
