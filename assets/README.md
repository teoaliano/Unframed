# Assets

Files carried over on purpose: data, not code. One line per file: what it is, and the code that uses it where there is one. Two folders keep their own per-file list and get one line here: `screenshots/` and `legacy-samples/`.

## brand/

- `brand/favicon.svg`: the app's favicon, linked from `packages/web/index.html`.
- `brand/logo.svg`: the app's logo, the mark alone in `currentColor`, cut from `app-icon.svg`. Used by `packages/web/src/chrome/Corners.tsx`.
- `brand/app-icon.svg` and `brand/app-icon.png` (1024 × 1024): the full app icon tile, the source for `apps/desktop/build/icon.png`.
- `brand/provider-logos/claude.svg`: the Claude mark for the model picker (`packages/web/src/agent/composer/pickers.tsx`), painted in `currentColor` (from t3code, MIT).
- `brand/provider-logos/codex.svg`: the OpenAI mark for Codex in the model picker (`packages/web/src/agent/composer/pickers.tsx`), painted in `currentColor` (from t3code, MIT).

## design/

The design canvas for selection-based generation. Open the `.dc.html` files in a browser.

- `design/canvas.json`: where each artboard sits on the design canvas, and its title.
- `design/Main.dc.html`: "Generate from a selection", the composer opened on a selection.
- `design/Selected.dc.html`: a selection made, with Generate and Agent on the bar.
- `design/Group.dc.html`: a named group as a selection you keep.
- `design/Agent.dc.html`: the composer in its Agent tray on a page.
- `design/Result.dc.html`: what a result shape carries and its actions (Regenerate, Vary, Recipe).
- `design/Composer.dc.html`: the composer's three bands.
- `design/QuietLine.dc.html`: option A for the composer's settings, one footer line.
- `design/OptionA.dc.html`: the recipe option where only the result records the run.
- `design/OptionB.dc.html`: the recipe option where a group holds standing settings.
- `design/OptionC.dc.html`: the recipe option where a result stays wired to its sources.

## fixtures/

Scripted-agent scripts in the format `packages/engine/src/agent/adapters/scripted.ts` reads. The engine and browser tests load them through `UNFRAMED_TEST_AGENT_SCRIPT`; `fixtures/README.md` holds the conventions.

- `fixtures/README.md`: the seeded shape ids and the rules every fixture follows.
- `fixtures/attachment.json`: a message with an attached image; checks the attachment line in the preamble.
- `fixtures/bad-shape.json`: `motion_write` on a shape that no longer exists, refused.
- `fixtures/bulk-edit.json`: one `canvas_write` that retitles two motions, then a second turn that expects the change note.
- `fixtures/canvas-question.json`: a question about the board, answered after `canvas_read`.
- `fixtures/dials.json`: `motion_write` that exposes three parameters.
- `fixtures/failure.json`: a 529 retry, then a failed turn with `error_max_turns`.
- `fixtures/implement-plan.json`: the first message of a chat started by "Implement in a new chat"; writes the page.
- `fixtures/markdown.json`: a reply with headings, a table, lists, a task list, a quote, a code block and a link.
- `fixtures/padded.json`: a command whose dangerous tail hides behind padding.
- `fixtures/permission.json`: `rm -rf build`, then `rm -rf dist`, for the runtime modes and approvals.
- `fixtures/plan.json`: plan mode: `canvas_read` runs, `canvas_write` is refused, a plan is captured; turn 2 builds the page after Implement.
- `fixtures/question.json`: the agent asks the person two questions (single and multi-select) and waits.
- `fixtures/rate-limit.json`: a usage-limit warning, then a rejected turn, then `allowed` clearing the notice.
- `fixtures/revise.json`: `motion_read` then `motion_write` on an existing motion.
- `fixtures/stitch.json`: two motions read and stitched into one new motion.
- `fixtures/subagents.json`: three sub-agent tasks, one of them failed.
- `fixtures/title.json`: the chat named from the script on turn 1 and not again on turn 2.
- `fixtures/render-stub.mp4`: a one-second clip the `ok` stub renderer returns (`packages/engine/src/artifacts/layer.ts`).

## legacy-samples/

- `legacy-samples/`: old-format projects, `jobs.json` and `presets.json` used as fixtures for the legacy import (`packages/domain/src/legacy/`); `legacy-samples/README.md` lists every file.

## models/

- `models/claude-catalogue.json`: the static Claude model catalogue (ids, names, aliases, legacy flags) that names the SDK's model rows (from t3code, MIT). Held by `packages/domain/src/agent/claudeCatalogue.ts`.

## prompts/

Model-facing text, used verbatim. Each file says which code holds it and what its placeholders are; tests hold the constants in `packages/domain/src/agent/prompts.ts`, `packages/domain/src/artifacts/prompts.ts`, `packages/domain/src/freeRepair.ts`, `packages/web/src/library/systemPresets.ts` and `packages/engine/src/canvas/starter.ts` to the fenced `text` blocks.

- `prompts/add-parameter-instruction.md`: the message the editor's "Add a parameter" box sends to the artifact's chat.
- `prompts/agent-system.md`: the Unframed instructions appended to Claude Code's system prompt and sent to Codex as developer instructions.
- `prompts/artifact-edit-tools.md`: the `page_edit` and `motion_edit` descriptions and their arguments.
- `prompts/artifact-read-tools.md`: the `page_read` and `motion_read` descriptions.
- `prompts/change-note.md`: the preamble sentence that says the canvas changed since the chat's last turn.
- `prompts/chat-title.md`: the system prompt and prompt that name a chat after its first turn.
- `prompts/declined.md`: what the agent is told when the person declines a request.
- `prompts/dials-contract.md`: the parameters paragraph appended to both artifact write descriptions.
- `prompts/dials-timeline.md`: the timeline paragraph appended to the `motion_write` description.
- `prompts/failures.md`: the failure sentences by subtype, the two fallbacks and the quit-mid-turn sentence.
- `prompts/artifact-performance.md`: the performance paragraph appended to the page and motion write tools.
- `prompts/free-repair.md`: the Free mode repair call's system prompt parts and user turn prefix.
- `prompts/implement-plan.md`: the prefix sent before a plan when the person implements it (from t3code, MIT).
- `prompts/motion-write-tool.md`: the `motion_write` description and its arguments.
- `prompts/page-write-tool.md`: the `page_write` description and its arguments.
- `prompts/plan-captured.md`: the deny message for Claude's `ExitPlanMode` once its plan is captured (from t3code, MIT).
- `prompts/plan-mode.md`: the Codex plan-mode developer instructions (from t3code, MIT).
- `prompts/plan-no-writes.md`: the deny message for a write tool in plan mode.
- `prompts/preset-layerize-plan.md`: the Layerize preset's planner prompt.
- `prompts/preset-prose-to-json.md`: the Prose to JSON preset's instructions.
- `prompts/preview-tool-descriptions.md`: the twelve preview tool descriptions and their arguments (from t3code, MIT).
- `prompts/starter-canvas.md`: the scene and subject prompts a new canvas starts with.
- `prompts/tool-descriptions.md`: the `canvas_read` and `canvas_write` descriptions, and where the artifact tool descriptions live.

## screenshots/

- `screenshots/`: the old app at 1440 by 900, light and dark, kept as history, not the visual reference; `screenshots/README.md` says what each picture shows.

## theme/

- `theme/README.md`: what the old theme values were. History only: the app uses t3code's tokens.
- `theme/resolved-tokens.json`: every CSS custom property the old app resolved, as light and dark pairs.

## perf/

- `perf/busy-page.html`, `perf/README.md`: the artifact performance fixture (`packages/web/test/artifactPerformance.spec.ts`) and how the old app was measured.
