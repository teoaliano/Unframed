# Assets

Reference material the specs in `docs/specs/` point at. One line per file: what it is, and which spec uses it. Two folders keep their own per-file list and get one line here: `screenshots/` and `legacy-samples/`.

## brand/

- `brand/favicon.svg`: the app's favicon. Specs 01 and 02.
- `brand/logo.svg`: the app's logo. Spec 02.
- `brand/provider-logos/claude.svg`: the Claude mark for the model picker, painted in `currentColor` (from t3code, MIT). Spec 08.
- `brand/provider-logos/codex.svg`: the OpenAI mark for Codex in the model picker, painted in `currentColor` (from t3code, MIT). Spec 08.

## design/

Open the `.dc.html` files in a browser. The index (00) describes the folder as the design canvas for selection-based generation.

- `design/canvas.json`: where each artboard sits on the design canvas, and its title. Index.
- `design/Main.dc.html`: "Generate from a selection", the composer opened on a selection. Spec 02 (selection look).
- `design/Selected.dc.html`: a selection made, with Generate and Agent on the bar. Spec 02 (selection look).
- `design/Group.dc.html`: a named group as a selection you keep. Spec 02 (selection look).
- `design/Agent.dc.html`: the composer in its Agent tray on a page. Index; the Agent tray is spec 08.
- `design/Result.dc.html`: what a result shape carries and its actions (Regenerate, Vary, Recipe). Index; results are spec 03.
- `design/Composer.dc.html`: the composer's three bands. Index; the composer is spec 03.
- `design/QuietLine.dc.html`: option A for the composer's settings, one footer line. Index.
- `design/OptionA.dc.html`: the recipe option where only the result records the run. Index.
- `design/OptionB.dc.html`: the recipe option where a group holds standing settings. Index; recipe groups are spec 06.
- `design/OptionC.dc.html`: the recipe option where a result stays wired to its sources. Index.

## fixtures/

Scripted-agent scripts in spec 07's format. Specs 07 and 08 use them all; `fixtures/README.md` holds the conventions.

- `fixtures/README.md`: the seeded shape ids and the rules every fixture follows. Specs 07 and 08.
- `fixtures/attachment.json`: a message with an attached image; checks the attachment line in the preamble. Spec 07.
- `fixtures/bad-shape.json`: `motion_write` on a shape that no longer exists, refused. Spec 07.
- `fixtures/bulk-edit.json`: one `canvas_write` that retitles two motions, then a second turn that expects the change note. Spec 07.
- `fixtures/canvas-question.json`: a question about the board, answered after `canvas_read`. Specs 07 and 08.
- `fixtures/dials.json`: `motion_write` that exposes three parameters. Specs 07 and 09.
- `fixtures/failure.json`: a 529 retry, then a failed turn with `error_max_turns`. Specs 07 and 08.
- `fixtures/implement-plan.json`: the first message of a chat started by "Implement in a new chat"; writes the page. Spec 08.
- `fixtures/markdown.json`: a reply with headings, a table, lists, a task list, a quote, a code block and a link. Spec 08.
- `fixtures/padded.json`: a command whose dangerous tail hides behind padding. Specs 07 and 08.
- `fixtures/permission.json`: `rm -rf build`, then `rm -rf dist`, for the runtime modes and approvals. Specs 07 and 08.
- `fixtures/plan.json`: plan mode: `canvas_read` runs, `canvas_write` is refused, a plan is captured; turn 2 builds the page after Implement. Specs 07 and 08.
- `fixtures/question.json`: the agent asks the person two questions (single and multi-select) and waits. Specs 07 and 08.
- `fixtures/rate-limit.json`: a usage-limit warning, then a rejected turn, then `allowed` clearing the notice. Specs 07 and 08.
- `fixtures/revise.json`: `motion_read` then `motion_write` on an existing motion. Specs 07 and 09.
- `fixtures/stitch.json`: two motions read and stitched into one new motion. Specs 07 and 09.
- `fixtures/subagents.json`: three sub-agent tasks, one of them failed. Spec 08.
- `fixtures/title.json`: the chat named from the script on turn 1 and not again on turn 2. Spec 07.
- `fixtures/render-stub.mp4`: a one-second clip the `ok` stub renderer returns. Spec 09.

## legacy-samples/

- `legacy-samples/`: old-format projects, `jobs.json` and `presets.json` used as fixtures for the legacy import; `legacy-samples/README.md` lists every file. Spec 11.

## models/

- `models/claude-catalogue.json`: the static Claude model catalogue (ids, names, aliases, legacy flags) that names the SDK's model rows (from t3code, MIT). Spec 07.

## prompts/

Model-facing text. Each file says where it is used and what its placeholders are.

- `prompts/add-parameter-instruction.md`: the message the editor's "Add a parameter" box sends to the artifact's chat. Spec 09.
- `prompts/agent-system.md`: the Unframed instructions appended to Claude Code's system prompt and sent to Codex as developer instructions. Spec 07.
- `prompts/artifact-read-tools.md`: the `page_read` and `motion_read` descriptions. Specs 07 and 09.
- `prompts/change-note.md`: the preamble sentence that says the canvas changed since the chat's last turn. Spec 07.
- `prompts/chat-title.md`: the system prompt and prompt that name a chat after its first turn. Spec 07.
- `prompts/declined.md`: what the agent is told when the person declines a request. Spec 07.
- `prompts/dials-contract.md`: the parameters paragraph appended to both artifact write descriptions. Specs 07 and 09.
- `prompts/dials-timeline.md`: the timeline paragraph appended to the `motion_write` description. Specs 07 and 09.
- `prompts/failures.md`: the failure sentences by subtype, the two fallbacks and the quit-mid-turn sentence. Spec 07.
- `prompts/free-repair.md`: the Free mode repair call's system prompt parts and user turn prefix. Spec 05.
- `prompts/implement-plan.md`: the prefix sent before a plan when the person implements it (from t3code, MIT). Spec 08.
- `prompts/motion-write-tool.md`: the `motion_write` description and its arguments. Specs 07 and 09.
- `prompts/page-write-tool.md`: the `page_write` description and its arguments. Specs 07 and 09.
- `prompts/plan-captured.md`: the deny message for Claude's `ExitPlanMode` once its plan is captured (from t3code, MIT). Spec 07.
- `prompts/plan-mode.md`: the Codex plan-mode developer instructions (from t3code, MIT). Spec 07.
- `prompts/plan-no-writes.md`: the deny message for a write tool in plan mode. Spec 07.
- `prompts/preset-layerize-plan.md`: the Layerize preset's planner prompt. Spec 06.
- `prompts/preset-prose-to-json.md`: the Prose to JSON preset's instructions. Spec 06.
- `prompts/preview-tool-descriptions.md`: the twelve preview tool descriptions and their arguments (from t3code, MIT). Spec 08.
- `prompts/starter-canvas.md`: the scene and subject prompts a new canvas starts with. Spec 02.
- `prompts/tool-descriptions.md`: the `canvas_read` and `canvas_write` descriptions, and where the four artifact tool descriptions live. Spec 07.

## screenshots/

- `screenshots/`: the old app at 1440 by 900, light and dark, for visual parity; `screenshots/README.md` says what each picture shows. Spec 02.

## theme/

- `theme/README.md`: how to use the theme values. Specs 01, 02 and 06.
- `theme/resolved-tokens.json`: every CSS custom property the old app resolved, as light and dark pairs. Specs 01, 02 and 06.

- `perf/busy-page.html`, `perf/README.md`: the artifact performance fixture and how the old app was measured (spec 09, spec 02).
- `prompts/artifact-performance.md`: the performance paragraph appended to the page and motion write tools (spec 09).
