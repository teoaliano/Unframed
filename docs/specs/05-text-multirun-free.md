# 05 · Text, multi-run and Free

Depends on: 01 (engine foundation), 02 (canvas), 03 (image generation)

## Problem Statement

Spec 03 makes one image from a selection. Three things the old app could do are still missing. A person wants to run their selection through a text model (with the pictures attached so the model can see them) and get the answer back as text they can reference by `@id` in the next prompt, without that answer ever pulling in other prompts on its own. They want several images from one click, in parallel, summed as one batch, keeping whatever succeeded when some fail. And they want to describe a list of images in one prompt, or ask a text model to plan one, and have each item become its own generation, with each item able to pick which of the selected pictures it uses, and with a way to read exactly what will be sent before paying for it.

## Solution

The Generate tray gains two things.

The **text** medium. It runs the composed selection through a vision-capable text model, with every image slot attached. The answer lands on the canvas as a **text result**: a prompt-kind shape holding the answer, with its own `@id` and its cost. When another prompt references it, its text is substituted literally and never re-scanned.

The **Runs** prop for the image medium. A number from 1 to 10 fires that many parallel generations sharing one `batchId`, each with its `runIndex` and `runCount`; a partial batch reports `2 of 3 succeeded`. Its other value is **Free**: the topmost text in the selection is the list, split on standalone `---` lines, repaired by one text call when it is not already a list, with per-section `images: 2, 5` picks and `[n]` slots. **View final prompt** stops before any image is paid for and shows the assembled batch in an editable dialog, whose confirm reuses the batch id without a second text call.

## User Stories

1. As a person, I want to switch the composer's medium to text, so that the same selection can be run through a text model.
2. As a person, I want the text catalogue to list only vision-capable text models, so that the pictures I select are actually seen.
3. As a person, I want my selected images, composites and sketch attached to a text run, so that the model can plan from a picture.
4. As a person, I want my instruction appended after the selected prompts in a text run, so that it works the way it does for images.
5. As a person, I want the answer to land on the canvas as a text shape near my selection, so that I can read it, edit it and select it into the next run.
6. As a person, I want the answer to have its own `@id`, so that another prompt can pull it in by name.
7. As a person, I want a referenced answer substituted literally and never re-scanned for `@` tokens, so that model output can never pull in other prompts or loop.
8. As a person, I want the answer's cost and `@id` on its line, so that I know what it cost and what to type.
9. As a person, I want to edit a text result without it re-running, so that I can tidy the answer.
10. As a person, I want Regenerate and Recipe on a text result, so that I can get another answer or tweak the run.
11. As a person, I want to copy a text result out as a plain prompt, so that I can edit it into a prompt whose own `@` tokens resolve.
12. As a person, I want a placeholder that says the text run is in flight, so that I can see it working.
13. As a person, I want a failed text run to tell me why, so that I can fix it.
14. As a person, I want to set Runs to a number from 1 to 10, so that one click makes several images.
15. As a person, I want typed values clamped rather than refused (15 becomes 10, 0 becomes 1), so that the field never fights me.
16. As a person, I want the send button to read `Generate 4×`, so that I know how many I am paying for.
17. As a person, I want the estimate multiplied by the run count, so that the number I see is the batch.
18. As a person, I want the batch's results laid out in run order regardless of which finished first, so that the row reads left to right.
19. As a person, I want a partial batch to keep its successes and say `2 of 3 succeeded`, so that one failure does not cost me the rest.
20. As a person, I want every file and sidecar of a batch to share one `batchId`, so that a batch's spend is a sum over one field.
21. As a person, I want the toolbar to show a batch's image count and total when I select the whole batch, so that I can see what it cost together.
22. As a person, I want to choose Free as the value of Runs, so that the number of images comes from a list in my selection.
23. As a person, I want Free to read the topmost text result in my selection, or the topmost prompt when there is none, so that the list source is predictable.
24. As a person, I want a text result preferred over a prompt as the Free source, so that a context prompt above the list does not silently become the list.
25. As a person, I want the list split on lines containing only `---`, so that `---` inside prose is left alone.
26. As a person, I want a text that is not a list rewritten into one by a single text call, so that I can describe "3 versions of a fox" in prose.
27. As a person, I want that rewrite to leave a single-image description untouched, so that I am not billed for fragments.
28. As a person, I want a section that starts with `images: 2, 5` to send only those images, so that each run gets the references it needs.
29. As a person, I want a caption like `Image: 3 women in a row` left alone, so that a description is never deleted by mistake.
30. As a person, I want `[1]` and `[2]` inside a section to become "image 1" and "image 2" for that run, so that numbering inside a run matches what that run receives.
31. As a person, I want a section that is nothing but an `images:` line skipped and noted, so that I never pay for the shared context alone.
32. As a person, I want numbers that name no selected image dropped and noted, and a line whose numbers all miss to fall back to every image, so that a garbled directive costs a text call to fix, not a run with no reference.
33. As a person, I want to be told when the list was longer than 10 and only the first 10 ran, so that nothing is silently dropped.
34. As a person, I want to be told when the text was re-split, or when no sections were found and it ran as one image, so that I know what the repair did.
35. As a person, I want the estimate in Free to price one image and say `/ image`, so that I am not shown a count nobody knows yet.
36. As a person, I want a View final prompt option in Free, so that I can read the assembled batch before any image is paid for.
37. As a person, I want the preview to show the shared context, the editable list, and one row per run saying which images it gets, so that I see how the directives were read.
38. As a person, I want my edits in the preview to update the rows live and to be what gets sent, so that I can fix a directive without another text call.
39. As a person, I want the preview's edits not written back to the source, so that a text result keeps saying what the model actually produced.
40. As a person, I want Cancel in the preview to send nothing more, so that previewing is cheap.
41. As a person, I want the repair call's cost counted in the batch, so that the batch total is honest.
42. As the engine, I want every text run and repair call to leave a sidecar with its cost, so that the project folder records every cent.
43. As a maintainer, I want the whole Free pipeline after the list text is in hand to be one pure function used by both the preview and the send, so that what is previewed cannot drift from what is sent.

## Implementation Decisions

### Modules

**Free batch** (domain). The deep module of this spec. Interface: given a composition context (the same canvas description and selection spec 03's selection to request takes, plus the instruction), the chosen source's id and the list text, it returns `{ runs: [{ prompt, references, used, dropped }], truncated, empty, shared }`, where `used` is the picked image numbers or `null` for all. It is the single path from list text to the outputs that get sent: split, directive parse, slot expansion, prompt assembly, per-run references. The preview dialog derives its rows from the same call. It never throws; a cycle comes back as an error field, as in spec 03.

Its parts are exported for tests and for the source finder: **list splitting**, **pick parsing** (with slot expansion), **run references**.

**Free source** (domain). Given the composition context, returns the source shape (or none) and its list text.

**Runs value** (domain). The clamp rule and the Runs prop's value type.

**Batch hint** (domain, beside spec 03's toolbar state function). Computes `4 images · $0.6720` from the selected results' meta.

**Text run service** (engine). Mirrors spec 03's run service for the text medium: placeholder, one upstream chat call, fill or remove, sidecar, events. Shares its adapter with **text completion** (engine), the shape-less call Free's repair uses.

**Text medium** and **Runs prop** (web). Registered into spec 03's medium registry and tray.

**Final prompt dialog** (web).

### The text medium

Registered with label `text`, catalogue `text`, no model-driven props, no Runs, no estimate. The tray shows the model chip and nothing else, and `+ add prop` is hidden. The send button reads `Run`, and shows a spinner while the run is acknowledged.

Composition is spec 03's selection to request, unchanged: the same order, the same joining, the same instruction rule, the same `@id` rules, the same composites and sketch. Every image slot and every video slot is attached. There is no cap warning and no video warning for text.

Tray messages:

- Empty prompt: send disabled, `Nothing to run. Select a prompt, or type an instruction.`
- A cycle: send disabled, the error line.
- No key: as spec 03.

Catalogue: `models.list({ medium: 'text' })` fetches `GET https://openrouter.ai/api/v1/models` and keeps only models whose `architecture.output_modalities` includes `text` and whose `architecture.input_modalities` includes `image`, mapped to `{ id, name, created }` with no `params`. Default `OPENROUTER_TEXT_MODEL`. Same default-appending, sorting and failure fallback as spec 03. The model dialog title is `Text models`.

The landed shape, a **text result**:

- A prompt-kind shape (spec 02's text shape) whose text is the answer, with spec 03's result meta (`medium: 'text'`). It gets its own `@id`, named the way spec 02 names a new prompt.
- It hugs its text by spec 02's prompt rules.
- Its line reads `$0.0012 · @<id>` (cost to four decimals), or `@<id>` when the cost is null.
- It is editable like any prompt. Editing never re-runs. Its text is always substituted literally, never re-scanned (spec 03's resolver), before and after an edit.
- Copies keep the result meta, so a copy is still a text result.
- The context menu gains `Copy as prompt` on a text result: it places a plain prompt with the same text beside it (spec 03's result placement, anchored on the text result), with no result meta, so its `@` tokens resolve normally.
- The result bar (spec 03's toolbar states) shows Regenerate (primary, Button `default`), Recipe (Button `ghost`), separator, Agent. There is no Vary.

In flight: a placeholder text result is written into the room at once, holding no text, with spec 03's run marker, showing a spinner and `Running…`. On success its text is set to the answer and its marker cleared. On failure it is deleted and the run report toast shows `0 of 1 succeeded. <message>`. Every run marker rule of spec 03 applies unchanged.

Regenerate runs the recipe exactly (recorded model, selection prompt, instruction, reference files) and lands a new text result beside the old one. Recipe opens the composer in recipe mode with the text medium.

### RPC methods

- `run.text(request)` returns `{ runId, batchId, placeholders: [shapeId] }` once the placeholder is in the room. Request: `{ project, model?, selectionPrompt, instruction, prompt, references: Ref[], sources, anchor, of? }` with spec 03's `Ref` and `anchor`. Events on spec 03's `run.subscribe`, with `count: 1`.
- `text.complete({ project, prompt, system?, model?, references?, batchId? })` returns `{ text, cost }` and writes a sidecar. It lands nothing. Only Free's repair calls it with `system`; every other caller omits it.

Validation, failing the call with its message (spec 01's `UnframedError`, coded as spec 03 codes the same refusals) and writing nothing: no key (spec 03's message); an empty prompt after trimming: `Prompt is empty. Select a prompt, or type an instruction.`; a missing reference file and a non-https link as spec 03.

Upstream: `POST https://openrouter.ai/api/v1/chat/completions` with `Authorization: Bearer <key>` and JSON `{ model, messages, usage: { include: true } }`. `messages` is `[{ role: 'user', content }]`, or `[{ role: 'system', content: system }, { role: 'user', content }]` when `system` is a non-empty string. `content` is `[{ type: 'text', text: prompt }]` followed by one `{ type: 'image_url', image_url: { url } }` or `{ type: 'video_url', video_url: { url } }` part per reference, project files inlined as data URLs exactly as spec 03 does. The answer is `choices[0].message.content`. The cost is `usage.cost`, or `null`.

Failures use spec 03's messages (unreachable, body lost, non-JSON, 402, other status), plus: an answer that is missing or blank after trimming: `The model returned no text.`

The engine logs `  text →  <n> chars  (sent <i> image, <v> video refs)  ($0.0012)`.

### Multi-run

The Runs prop is registered for the image medium only.

- Label `Runs`. It is not a model trait, so a model change does not reset it.
- Its tray chip shows `4×`, or `Free`. At 1 it is not in the tray, and `+ add prop` lists it as `Runs 1`. Remove sets it back to 1.
- Its chip is the tray's chip (spec 03). It opens a popup, the kit's Popover at 200 px, holding a number field (the kit's NumberField, accessible name `Number of runs`, 1 to 10), a `Free` option (the kit's Toggle, pressed while Free is chosen), a separator and `Remove` (Button `ghost`). When Free is chosen, the popup also shows a checkbox `View final prompt` (the kit's Checkbox with its Label).
- Typing: only digits are kept, at most two; the value is rounded, a non-number becomes 1, and the result is clamped to 1 to 10. The field keeps what was typed while focused and shows the clamped value on blur. Focusing or pressing the number field selects a fixed count (leaves Free).
- `Free` has the tooltip `Free takes the number of runs from the selection. Select a prompt or text result listing what to generate, as sections split by lines containing only ---, or prose a text model can split, and each item becomes one image.`
- The cap of 10 lives in the runs value module and every limit message quotes it from there.

A fixed count N sends spec 03's `run.image` with N identical outputs. The web mints the batch id at send as `b-<epochMs>`. The engine gives outputs `runIndex` 1 to N and `runCount` N, fires them concurrently, and places all N placeholders at once in run order, so the row reads in run order whatever finishes first. Files get the `-<runIndex>` suffix (spec 03).

Send label: `Generate` at 1 or in Free, `Generate N×` for N above 1. The estimate multiplies by N.

Run report (spec 03's toast): `2 of 3 succeeded. <errors joined with "; ">` when any failed. For a Free batch, the notes (below) are shown too, in the same toast after the outcome line, or alone as an info toast when every output succeeded.

Batch hint: when the selection is exactly every result on the canvas sharing one `batchId`, and there are at least two, the toolbar hint reads `<n> images · $<total>`, where total is the sum of the members' costs plus the batch's `batchExtraCost` once, to four decimals. With no costs known it reads `<n> images`.

Spec 03's result meta field `batchExtraCost` is set on every member of a Free batch to the repair call's cost when a repair ran.

### Free

Free is a value of Runs, image medium only.

Source: walk the composition's flattened order (spec 03: top to bottom, groups expanded in place). The source is the first text result; if there is none, the first prompt. A group is never itself the source, but its members take part in the walk. The list text is a text result's text verbatim, or a prompt's text with its `@id` references resolved, where a reference to the source itself fails as a cycle.

Tray messages in Free:

- No source: send disabled, `Select a prompt or a text result. Each item turns into one generation: a "---" separated list, or prose a text model can split.`
- An empty text result: `The text result is empty. It lists what to generate.`
- An empty prompt: `The prompt is empty. It lists what to generate.`
- The estimate prices one image: `est. ~$0.042 / image`.

Pipeline on send:

1. Mint the batch id.
2. Split the list text (below). If it has fewer than two sections, make one repair call (below) with the same batch id. If the repaired text splits into more than one section, it becomes the list text, with the note `re-split into <n> sections`. Otherwise the original list text is kept, with the note `no sections found, running as a single generation`.
3. Build the batch with Free batch.
4. No runs: the error `That list has no sections to run.` shown in the composer.
5. With View final prompt on, open the final prompt dialog and stop. Otherwise send `run.image` with one output per run and the batch id, and show the notes with the run report.

Splitting: a line whose content, trimmed, is exactly `---` ends a section. Each section is trimmed; empty sections are dropped. Only the first 10 are kept; `truncated` is how many more there were.

Repair call: `text.complete` with `system` set to the repair system prompt and `prompt` set to the repair user turn, both from `assets/prompts/free-repair.md`. The system prompt's image block is included only when the composition has at least one image slot, with that count filled in. The model is the source's recorded model when the source is a text result, else the default text model. Its cost becomes the batch's `batchExtraCost`. Its sidecar carries the batch id.

Pick parsing, per section:

- Only the first non-empty line is examined. It is a directive only when the whole trimmed line matches, case-insensitively, `images` or `image`, optional spaces, `:`, optional spaces, then one or more integers separated by commas or spaces, and nothing else.
- Its numbers are the positive integers in it, duplicates collapsed, first-listed order kept.
- If at least one number results, the line is removed and the section's picks are those numbers. Otherwise the line stays in the text and the section gets every image.
- Slot expansion: every `[<digits>]` in the remaining section text becomes `image <digits>`.
- A section left with no text is dropped and counted in `empty`. Truncation is counted before this drop.

Run references, per section:

- No picks: every reference slot of the composition, in order.
- Picks: a pick `n` names the `n`th image slot (1-based, images only, composites and the sketch included). `used` is the picks that name one, `dropped` the rest. If `used` is empty, every reference slot is sent and `used` is `null`. Otherwise the references are the used images in listed order, then every video slot unchanged.

Prompt assembly: `shared` is the composition's prompt parts with the source's text blanked, so neither the source nor a reference to it smuggles the list back in. Each run's prompt is `shared`, the section, and the instruction, each omitted when empty, joined with a blank line.

Notes, joined with ` · `, repair notes first:

- `list had <runs + empty + truncated> items, running the first <runs + empty>` when truncated.
- `skipped <n> section with no prompt text` or `skipped <n> sections with no prompt text`.
- `no image 5 selected` or `no images 2, 5 selected`: the distinct dropped numbers across all runs, ascending.

Recipes for Free outputs: each output's recipe records its own run exactly, so Regenerate repeats that one run. Its `selectionPrompt` is `shared` and the section joined, its `instruction` the instruction, its `references` that run's references. Recipe mode for a Free output sets Runs to 1. The image sidecar adds `free: { picks: number[] | null, dropped: number[] }`.

### The final prompt dialog

A modal dialog, 640 px wide (the kit's Dialog, spec 12), opened by step 5 above. Nothing but the repair call has been paid for when it opens.

- Title `Final prompt`. Subtitle `4 generations. Nothing has been sent yet.` (`1 generation.` in the singular), or `This list cannot be assembled yet.` when the current text has an error.
- `Shared by every run` (label) and the shared text, read-only, when not empty. When an instruction was typed, `Added after every section` (label) and the instruction, read-only.
- `Sections` (label) and an editable text area of 12 rows (the kit's Textarea in the mono stack, 12 rows tall), spellcheck off, seeded with the list text as the pipeline has it (the repaired text when the repair was used, the source text otherwise), with its separators and directives intact.
- Rows derived live from the text area through Free batch, one per run: `Run 1` on the left, `images 1, 5` or `all images` on the right.
- Live warnings: `3 more sections beyond the 10-run cap will not run.` (singular `1 more section`), `2 sections with no prompt text will not run.` (singular `1 section`), and the dropped-images note.
- The repair notes, as an info line in `text-xs` muted text.
- Errors: a cycle's message, or `The list source is no longer selected.` when the source shape is gone.
- Each warning is the kit's Alert `warning`, each error the kit's Alert `error`.
- The rows and warnings scroll; the buttons do not.
- Buttons, in the kit's dialog footer: `Cancel` (Button `outline`), and `Generate N×` (primary, Button `default`), disabled on an error or zero runs.

Confirm re-runs Free batch on the text as confirmed, against the canvas as it is at that moment, and sends `run.image` with the same batch id. There is no second text call. Its notes are recomputed from the confirmed text, plus the repair notes. Edits are never written back to the source shape. Cancel and Esc close the dialog and send nothing. The staged batch lives only in the web and is lost on reload, which costs nothing but the text call already made.

### Persisted formats

Text sidecar, `<stamp>-text-<slug>.json` in the project folder, `stamp` and `slug` as spec 03 (slug of the prompt, `image` when empty), written exclusively with spec 03's `-2` to `-5` retries. The first block is kept from the old app field for field; `recipe` is present only for runs that landed a text result:

```ts
type TextSidecar = {
  kind: 'text'
  prompt: string; model: string; result: string
  referenceCount: number; references: { images: number; videos: number }
  batchId: string | null; cost: number | null; createdAt: string
  recipe?: ResultRecipe      // spec 03's recipe schema: medium 'text', params {}, of.action never 'vary'
}
```

A sidecar write failure is logged and does not fail the run. The image sidecar's `free` field and the result meta's `batchExtraCost` are described above. Last-used values (spec 03) store the Runs value (`1` to `10` or `free`) and View final prompt for the image medium, and the model for the text medium.

## Testing Decisions

A good test drives one of the three seams and asserts only on what it exposes. Prior art is spec 03's: table-driven Vitest cases named by behaviour at the domain seam, the engine forked against stub upstreams, Playwright against the built client.

- **Domain seam**: the runs clamp; list splitting (standalone `---` only, trimming, empties, the cap, `truncated`); pick parsing (first line only, the whole-line match, captions left alone, duplicates, order, zero and negative numbers, the line kept when nothing usable, slot expansion in both branches); run references (no picks, picks with videos appended, dropped numbers, all-dropped fallback); Free source (text result preferred, first in flattened order, group members walked, `@id` expanded before splitting, a self-reference as a cycle); Free batch (shared context with the source blanked, instruction last, directive-only sections dropped and counted, truncation counted first); the notes' wording; the batch hint.
- **Engine seam**: `models.list` for text (the modality filter, fallback); `text.complete` (with and without `system`, message shape, references inlined, cost, sidecar, every failure message, blank answer); `run.text` (placeholder first, filled with the answer and result meta, deleted on failure, events, sidecar with recipe); `run.image` with N outputs (runIndex and runCount, concurrency, run-order placement, a partial batch).
- **Browser seam**: the text medium end to end; a text result referenced by another prompt substitutes literally; Copy as prompt; the Runs prop menu and clamp; `Generate N×`; the batch hint; Free with a ready list, with a repair call, with picks; the final prompt dialog rows, live edits, confirm without a second text call (asserted on the stub's request count) and Cancel.

## Tasks

1. Runs value: clamp rule and the cap constant. Seam: domain.
2. List splitting: standalone `---` separators, trimming, empty sections dropped, first 10 kept, `truncated` counted. Seam: domain.
3. Pick parsing: directive recognised only on the first non-empty line and only as a whole-line match; captions left in place. Seam: domain.
4. Pick parsing: numbers split on commas and spaces, positive integers only, duplicates collapsed, order kept; the line kept when no usable number. Seam: domain.
5. Slot expansion: `[n]` becomes `image n` in both the directive and the no-directive branch. Seam: domain.
6. Run references: no picks sends every slot; picks send the named images in listed order then all videos; dropped numbers reported; all-dropped falls back to every slot. Seam: domain.
7. Free source: first text result in flattened order wins; else first prompt; group members walked; a group is never the source. Seam: domain.
8. Free source: a prompt's `@id` references expanded before splitting; a text result read verbatim; a self-reference is a cycle. Seam: domain.
9. Free batch: shared context with the source blanked (a reference to the source resolves to nothing); each run is shared, section, instruction. Seam: domain.
10. Free batch: directive-only sections dropped and counted in `empty` after truncation is counted. Seam: domain.
11. Notes: truncation, skipped sections, dropped images, singular and plural, joined with ` · `, repair notes first. Seam: domain.
12. Batch hint: count and total with `batchExtraCost` counted once; no costs; not shown for a partial selection of a batch. Seam: domain.
13. `models.list` for text: modality filter, mapping without params, default appended, fallback. Seam: engine.
14. `text.complete`: user-only message, content parts with inlined references, `usage.include`, the answer and cost returned, sidecar written without a recipe. Seam: engine.
15. `text.complete` with `system`: a system message first; a blank `system` is ignored. Seam: engine.
16. `text.complete` failures: no key, empty prompt, missing file, unreachable, body lost, non-JSON, 402, other status, blank answer. Seam: engine.
17. `run.text`: placeholder in the room before the reply, filled with the answer and result meta on success, deleted on failure, events, sidecar with recipe. Seam: engine.
18. Text sidecar naming: `-text-` infix, slug, exclusive write with retries. Seam: engine.
19. `run.image` with N outputs: runIndex 1 to N, runCount N, all placeholders placed at once in run order, filled as each lands in any order. Seam: engine.
20. `run.image` partial batch: mixed outcomes report `succeeded`, `failed` and distinct errors; successes stay. Seam: engine.
21. Text medium in the composer: medium switch shows `text`; the tray shows only the model; `Run`; empty-prompt message. Seam: browser.
22. Text run end to end: a text result lands beside the selection with the answer, its `@id` and `$cost · @id` line. Seam: browser.
23. A prompt referencing a text result by `@id` sends the answer literally, including an answer that contains `@` tokens. Seam: browser.
24. Editing a text result changes what it contributes, does not re-run, and stays literal. Seam: browser.
25. Text result bar: Regenerate and Recipe, no Vary; Regenerate lands a second answer from the recorded recipe. Seam: browser.
26. `Copy as prompt` places a plain prompt whose `@` tokens resolve. Seam: browser.
27. Runs prop: `+ add prop` lists `Runs 1`; the chip shows `4×`; Remove resets to 1; model change leaves it. Seam: browser.
28. Runs field: digits only, clamped on input, typed draft kept until blur; focusing it leaves Free. Seam: browser.
29. Multi-run send: `Generate 4×`, the estimate multiplied, four results in run order, one batch id across all four sidecars. Seam: browser.
30. Partial batch toast `2 of 3 succeeded. ...` with the successes on the canvas. Seam: browser.
31. Batch hint on selecting every member of a batch. Seam: browser.
32. Free value: tooltip, `View final prompt` checkbox, `Generate` label, `/ image` estimate, the no-source and empty-source messages. Seam: browser.
33. Free with a ready `---` list: one image per section, no text call. Seam: browser.
34. Free with prose: one repair call with the system and user turn from the asset, the image block only when images are selected, the re-split note; a repair that still gives one section runs the original text as one image with its note. Seam: browser.
35. Free with `images:` picks: each run receives only its images; dropped-number and skipped-section notes in the report toast. Seam: browser.
36. Final prompt dialog: opens after the repair without any image call; shared text, instruction, sections, rows, warnings, notes. Seam: browser.
37. Final prompt dialog: editing updates rows live; confirm sends the edited batch with the staged batch id and no second text call; edits not written back. Seam: browser.
38. Final prompt dialog: Cancel and Esc send nothing; a cycle typed into the text disables Generate with the message. Seam: browser.
39. Recipe on a Free output: recipe mode with Runs set to 1 and that run's prompt and references. Seam: browser.
40. Last-used values keep Runs, Free and View final prompt for image and the model for text. Seam: browser.

## Out of Scope

- Free mode for video, and directives that pick videos.
- Runs for the text and video media: a text run and a video run are one call each, as before.
- Writing preview edits back to the list source.
- A per-image "every run or one run each" toggle (rejected in the old design: the text model already reads the intent in the prose, so it should carry the distribution).
- The video medium (spec 04), recipe groups carrying Runs (spec 06).

## Further Notes

Kept from the old app, exactly: text runs through vision text models with images attached, literal substitution of answers, the 1 to 10 cap and its clamp, parallel batches with shared `batchId`, `runIndex`, `runCount` and the `X of N succeeded` report, the Free source precedence, splitting, the repair call's system and user split, pick parsing, slot expansion, the all-dropped fallback, directive-only sections dropped, every note and dialog string (with "wired" reworded to "selected"), and the text sidecar fields. Changed by decision: a text run lands a text result shape instead of filling a node (Q4); Free is a value of the composer's Runs prop and its source is the topmost selected text (Q17).

Why the repair prompt is shaped as it is, so nobody "simplifies" it: asked merely to split, models copy the whole text once per section, so every image renders every subject and the batch costs several times over. The prompt insists each section is a complete prompt for one image and that a single-image description comes back untouched. The rules go in the system role and the text in the user turn behind `Text to rewrite:`, because a description that says "apply that style to image 3" was otherwise obeyed as an instruction. Bracket slots exist because a model told to renumber copies "image 3" straight through into a run holding two attachments; a different token shape cannot be echoed by reflex, and the worked example restarts the brackets per section. The directive line is deleted only once it yields a usable number, because deleting a real caption is a paid image of nothing anyone asked for, while a stray bookkeeping line is only noise.

One limitation stays stated rather than fixed: a separate prompt in the shared context that refers to images by number can contradict a run's renumbering, since the shared text is prepended verbatim. Let the list source own the image references.

### Assets this spec needs

- `assets/prompts/free-repair.md`: the Free repair call's text, in three labelled parts. (1) The system prompt's base block, always sent. (2) The system prompt's image block, sent only when at least one image is selected, including its count sentence as a template with the image count and singular and plural forms, and the worked example. (3) The user turn prefix `Text to rewrite:` followed by a blank line, then the list text. Source: old repo `client/src/nodes/ImageOutputNode.jsx`, the `ask` array and the `runText` call inside `onGenerate`.
