# 03 · Image generation

Depends on: 01 (engine foundation), 02 (canvas)

## Problem Statement

A person has material on the canvas: prompts, pictures, clips, drawings. They want to turn some of it into a new image with one paid model call, see what that call will cost before they make it, and get the result back on the canvas as an ordinary image they can feed into the next run. The old app did this with output nodes and wires. The rewrite has no wires and no output nodes: the selection is the input set. So there has to be one place, over the selection, that says what will be made, from what, with which model and settings, for how much, and one pure rule that turns a selection into exactly the request that gets sent. Every result must remember how it was made, so it can be repeated or varied without anything on the canvas holding settings between runs.

## Solution

A selection toolbar floats over every selection. When the selection has something to generate from, its primary button is **Generate**, with **Agent** beside it. Generate grows the bar into the **composer** with its **Generate tray**: three bands, the medium switch and source count above the box, the per-run instruction and the send button in the box, and a props tray below with the model, the props the model declares, and the price. Cmd+Enter generates, Esc closes.

A pure domain module composes the request from the selection: top-to-bottom order, prompts joined with blank lines, `@id` resolution, groups expanded in place, images numbered per kind, sketches composited onto the image they sit on or rendered as a standalone sketch image. While the composer is open, every selected shape shows the role it will play.

The engine proxies OpenRouter's image catalogue and per-model pricing, runs the call, writes the image and its sidecar into the project folder, and lands the result on the canvas as an image shape near the selection. The result carries its **recipe**. Selecting a result offers Regenerate, Vary and Recipe, and draws a dashed provenance tether to its sources that carries nothing.

This spec builds the composer shell shared with the Agent tray (specs 07 and 08) and leaves a slot for it. It builds the image medium only. Specs 04 and 05 register the video and text media, the Runs prop and Free mode into the same shell.

## User Stories

1. As a person, I want a toolbar to appear over whatever I select, so that the actions for that selection are next to it.
2. As a person, I want Generate to be the primary button when my selection has something to generate from, so that the paid action is one click away.
3. As a person, I want Agent beside Generate as a sibling, never a mode, so that the two paths are never told apart by what happens to be selected.
4. As a person, I want a selection with nothing usable in it (an empty image alone) to show only Agent, so that I am not offered a Generate that cannot work.
5. As a person, I want the toolbar to say "3 selected" for a loose selection, so that I know how many shapes go in.
6. As a person, I want the toolbar to say "@character" when I select a group named character, so that a named set reads by its name.
7. As a person, I want a single filled page or motion to offer Open, so that the old artifact behaviour is kept.
8. As a person, I want the toolbar to hide while I drag shapes, drag the canvas or box-select, so that it does not fight the gesture.
9. As a person, I want the wheel over the toolbar to still pan and zoom the canvas, so that the toolbar never freezes the board.
10. As a person, I want the toolbar centred above my selection, flipped below when there is no room, and kept inside the window, so that it is always reachable.
11. As a person, I want clicking Generate to grow the bar into the composer on the same centre and bottom edge, so that it reads as one element changing shape.
12. As a person, I want to switch the medium between image, video and text above the box, so that one composer makes every kind of output.
13. As a person, I want the source count above the box, so that I see what the run is made from while I type.
14. As a person, I want to type a per-run instruction that is appended after the selected prompts and is not saved into the canvas, so that one-off direction does not litter the board.
15. As a person, I want `@id` references in my instruction to resolve like a prompt's, so that I can pull a prompt in by name while typing.
16. As a person, I want Cmd+Enter to generate and plain Enter to add a line, so that a paid call never fires from a stray Return.
17. As a person, I want Esc to close the composer back to the bar, so that I can back out without clicking.
18. As a person, I want clicking another shape while the composer is open to add it to the selection, so that I can build the input set without closing the composer.
19. As a person, I want clicking empty canvas to close the composer, so that leaving is obvious.
20. As a person, I want the model and every prop that will be sent shown in a tray below the box, so that nothing is sent that I cannot see.
21. As a person, I want "+ add prop" to list the props this model declares that are not yet in the tray, so that I can add a setting without hunting for it.
22. As a person, I want to click a prop to change its value and remove it from the same menu, so that a prop comes off the way it went on.
23. As a person, I want only the props the selected model declares, with exactly its values, so that I never set a knob that does nothing.
24. As a person, I want props to reset to their defaults when I change model, so that the old model's values do not silently vanish at send time.
25. As a person, I want the composer to open on the values I last used, so that the first run of a new idea is not configured from scratch.
26. As a person, I want to pick a model from a searchable, sortable table with the newest first, so that I can find a model in a catalogue that changes weekly.
27. As a person, I want each provider in the model table coloured distinctly, so that I can scan rows by provider.
28. As a person, I want a link from the model dialog to the same catalogue on OpenRouter, so that I can read more about a model.
29. As a person, I want Esc in the model dialog to close only the dialog, so that I do not lose the composer behind it.
30. As a person, I want the price estimate beside the send button when it can be known exactly, and nothing when it cannot, so that I am never shown a guess dressed as a number.
31. As a person, I want the result's actual cost on the result after the run, so that I know what I spent.
32. As a person, I want a warning when I select more images than the model takes, naming the number, so that I learn before I pay.
33. As a person, I want a warning when a video is in an image run, so that I know it will probably be ignored.
34. As a person, I want every selected shape to show its role ("image 1", "video 1", or a dash when unused) while the composer is open, so that I can say "image 2" in my prompt and mean it.
35. As a person, I want the top-to-bottom position of shapes to decide prompt order and image numbers, so that the canvas layout is the order.
36. As a person, I want a group to take one slot in that order with its members in their own order inside it, so that "that box is image 2 and 3" reads off the canvas.
37. As a person, I want `@group` in a prompt to pull in the group's prompt text but never attach its pictures, so that a mention never sends an image I cannot see being sent.
38. As a person, I want an unknown `@word` left exactly as I typed it, so that "@golden hour" keeps its word.
39. As a person, I want a circular reference to stop the run with a message naming the loop, so that I can fix it.
40. As a person, I want a text result's answer substituted literally and never re-scanned for `@` tokens, so that model output cannot pull in other prompts.
41. As a person, I want marks I draw on an image sent composited with that image, in that image's slot, at the image's native resolution, so that my scribble on the photo reaches the model as one picture.
42. As a person, I want a cropped image sent as its crop, so that what I see is what is sent.
43. As a person, I want loose marks I select to be sent as one sketch image in their own slot with their own "image N" badge, so that a drawing alone can be a reference.
44. As a person, I want my canvas image to stay clean and my marks editable after a run, so that sketching for a run does not flatten my work.
45. As a person, I want each result to land as an ordinary image shape near my selection, so that I can select it into the next run with no conversion step.
46. As a person, I want a placeholder where the result will land while it generates, so that I can see the run in flight.
47. As a person, I want Regenerate on a result to repeat its recipe exactly, so that I get another take on the same thing.
48. As a person, I want Vary on a result to repeat its recipe with the result itself as an extra reference, so that I get a variation of that picture.
49. As a person, I want Recipe on a result to reopen the composer filled in, so that "same thing, bigger" is two clicks.
50. As a person, I want a dashed tether from a selected result to its sources, drawn only while the result is selected, so that I can see where it came from without a wire.
51. As a person, I want deleting a source to never break a result or its Regenerate, so that the canvas has no live dependencies.
52. As a person, I want the result's model, size and cost under it when selected, so that I can compare versions.
53. As a person, I want a failed run to tell me why in a toast, so that I can fix it.
54. As a person, I want a message when my OpenRouter account is out of credit or my key has hit its cap, naming both causes, so that I try the right fix.
55. As a person, I want a copied or pasted result never to carry a live run marker, so that a copy never pretends to be generating.
56. As a person, I want a result I restore with Cmd-Z after its run finished to come back filled in, so that undo does not leave an empty placeholder.
57. As a person, I want every generated image and its sidecar written into the project folder, never overwriting another file, so that the folder is a complete record of what I paid for.
58. As a person, I want a run to finish and land even if I close the tab while it runs, so that I never pay for an image that never reaches the canvas.
59. As the engine, I want placeholders left by a run that died with the process cleared at boot, so that nothing on the canvas claims to be generating forever.
60. As a maintainer, I want the selection-to-request rule in one pure module used by the badges, the composer and the request, so that what a badge promises is what gets sent.

## Implementation Decisions

### Modules

**Selection to request** (domain). The deep module of this spec. Interface: one function that takes a description of the canvas (every shape the rule needs, as plain records: id, kind, page bounds, z rank, parent group, prompt text or file or link, crop, whether it is a text result, a group's name) plus the selected ids, the instruction and the medium, and returns a **composition**:

- `promptParts`: the resolved text of each contributing shape, in order.
- `prompt`: the parts plus the instruction, joined.
- `references`: an ordered list of slots, each `{ kind: 'image' | 'video', number, source }`, where `source` is one of: a project file, an https link (a pasted video link, spec 02), a **composite** to render (`{ image, marks, crop }`), or a **sketch** to render (`{ marks }`).
- `roles`: a map from shape id to its badge text.
- `usable`: whether anything in the selection can be generated from.
- `sources`: the ids of every shape that contributed (for the recipe and the tether).
- `warnings` and `error` (see Warnings below).

It never renders, never touches the network, and never throws: a circular reference comes back as `error`. The composer, the badges and the send path all call it. The engine imports it for tests only; it does not recompose.

**Reference resolver** (domain). `@id` resolution, used by selection to request and by spec 05. Kept separate because spec 06's rename and spec 05's Free source both need it without the rest.

**Model params** (domain). Given a catalogue entry and a medium, returns the props the model declares and their allowed values, the reference cap, and a `supported(prop, value)` check. Also the defaults and the reset rule.

**Image estimate** (domain). Given one model's endpoint pricing and the tray values, returns a number or null. Plus the display formatter.

**Result placement** (domain). Given an anchor box, output sizes and the bounds of existing shapes, returns positions.

**Image dimensions** (domain). Given the first bytes of an image file, returns its pixel width and height (PNG, JPEG, WebP, GIF, SVG). The engine needs it because it creates image shapes itself.

**Run service** (engine). Owns a run from acknowledgement to the last landed output: validates, writes placeholders into the project's sync room, calls OpenRouter once per output, writes files and sidecars, fills or removes placeholders, reports events, and remembers outcomes. Adapter to OpenRouter's image endpoint behind one seam so tests point it at a stub.

**Catalogue proxy** (engine). `models.list` and `models.imagePricing`.

**Last-used values** (web). Read and written as spec 01 preferences (see Persisted formats); no engine module of its own.

**Composer** (web). One component, two trays. The shell is t3code's composer (Tiptap editor, chips), shared with the Agent tray. The shell owns placement, the grow-from-bar morph, Esc, the send key, the draft and the selection binding. A tray owns its top band, its tray band and what send does. This spec builds the shell and the Generate tray. The Agent tray is a slot the shell renders when opened from Agent; spec 08 fills it. Until then the Agent button is not rendered.

**Medium registry** (web). The Generate tray reads its media from a registry: each medium supplies its label, catalogue name, props derivation, estimate, send action and warnings. This spec registers `image`. Specs 04 and 05 register `video` and `text`. The medium switch shows only registered media.

**Selection toolbar** (web). Decides its buttons from the selection (see Toolbar states), places itself, and opens the composer.

**Role badges and tether** (web). Canvas overlays drawn from the composition and the selected result's recipe.

### The selection to request rule

Ordering:

- Every selected shape is placed in one list sorted by the top edge of its page bounds, smallest first. Ties break by left edge, then by z rank. This single order decides prompt order and image numbers.
- A selected group takes one slot at its own top edge. Its members fill that slot in their own top-to-bottom order inside it (same tie rules). A member is never counted twice: if a member and its group are both selected, it counts in the group's slot only. Membership rules are spec 02's.
- Artifacts (page, motion) contribute nothing, loose or inside a group.

Text:

- A prompt contributes its text with `@id` references resolved. A text result (spec 05) contributes its text literally.
- Each part is trimmed; empty parts are dropped. Parts are joined with one blank line (`\n\n`).
- The instruction is resolved like a prompt's text and appended as the last part. It is not saved anywhere on the canvas.

`@id` resolution:

- A token is `@` followed by one or more word characters or hyphens. It resolves against every prompt, text result and group on the canvas, not only the selection.
- A prompt resolves to its own text with its tokens resolved recursively.
- A text result resolves to its text, inserted literally, never re-scanned for tokens. This is also what makes a reference loop through a text result terminate.
- A group resolves to the resolved text of its prompt and text-result members, top to bottom inside the box, each trimmed, empties dropped, joined with a blank line. It never attaches a member's media. Media travels only by selection.
- An unknown token is left exactly as typed.
- A cycle fails with the message `Circular reference: a -> b -> a` (the ids along the loop, joined with ` -> `, ending on the repeated id).

Media and numbering:

- An image contributes a slot when it names a file. A video contributes a slot when it names a file or holds an https link. An empty image or video contributes nothing and is not usable.
- Slots are numbered per kind in list order: images `image 1`, `image 2`; videos `video 1`, `video 2`. A composite keeps its image's slot. A sketch counts as an image.
- Nothing is truncated to the model's reference cap. The badge must match what is sent, so over the cap the composer warns instead.

Sketches:

- A mark belongs to an image when its page bounds overlap the image's page bounds and its z rank is above the image's. When a mark overlaps several images it sits above, the topmost of them (highest z rank) wins. Ownership is computed against every image on the canvas, not only the selection.
- Marks owned by a selected image are composited into that image, whether or not the marks themselves are selected. What you see on the image is what is sent.
- A selected mark that is not owned by a selected image is loose. All loose marks in the selection render into one sketch image, which takes the slot of the first loose mark in the list order.
- An image with a crop, or with owned marks, is sent as a composite. Otherwise its file is sent unchanged.
- Rendering (web): a composite is the image's visible crop plus its owned marks, clipped to the image's frame, at the image's native resolution (the crop region's size in the file's own pixels; marks are scaled by file pixels per canvas unit). A sketch is the loose marks on a white background with 16 canvas units of padding, scaled so its longer side is 1024 pixels, capped at 2048. Both are PNG, rendered with tldraw's own export so they match the canvas. The canvas image stays clean and the marks stay editable shapes.
- Each Generate writes each composite and sketch it sent into the project folder through spec 02's upload path, named `composite-<original file base>.png` and `sketch.png` (spec 02's upload naming then prefixes the timestamp). Their sidecars use spec 02's upload sidecar with `source: "composite"` or `source: "sketch"`, plus `of` (the original file, composites only), `marks` (the mark ids) and `crop` (tldraw's crop record, or `null`). One Generate writes each composite once, shared by every output of its batch.

Usable: a selection is usable when its composition has at least one non-empty prompt part or at least one reference slot. A selection whose only text fails on a circular reference is usable too, so the composer opens and shows the error.

Roles (badges), shown only while the composer's Generate tray is open, on every selected shape that is media or an artifact, and on the sketch:

- a numbered slot shows `image N` or `video N`;
- a selected image or video that sends nothing (empty) and a selected artifact show a single dash glyph (U+2014 EM DASH);
- the sketch shows `image N` at the top-left of the loose marks' bounds;
- prompts, text results and marks show no badge (prompts already show their `@id`, spec 02).

Badges sit where spec 02 puts a bare media shape's one fact (top-left, outside the content). Each is the kit's Badge `label` variant (spec 12) tinted by its role: `image N` teal, `video N`, `first` and `last` orange, the dash neutral (zinc). Video media (spec 04) may add `first` and `last` roles through the same map.

### Warnings and errors in the Generate tray (image medium)

Shown under the box, above the tray, as status lines. A line that disables send is the kit's Alert (`warning` for a blocker, `error` for a failed start); a warning that lets the run go is `text-xs` muted text. Exact strings:

- Videos in an image run: `A video is selected, but image models do not take video input. It will be sent and probably ignored.` With several: `3 videos are selected, but image models do not take video input. They will be sent and probably ignored.` Videos are still sent.
- Over the cap (image slots, including composites and the sketch, above the model's `input_references` maximum): `5 images are selected, but this model takes at most 4. Deselect the rest, or pick a model that takes more.` When the cap is 1: `... but this model takes only one. ...`.
- Empty prompt (no parts and no instruction): send is disabled and the tray reads `Nothing says what to make. Select a prompt, or type an instruction.`
- Composition error (a cycle): send is disabled and the error line shows the message.
- No key (from the engine's health, spec 01): send is disabled and the tray reads `No OpenRouter key yet. Add one with the key icon in the top right (it becomes a settings gear once saved).`

### Toolbar states

Decided from the selection by a pure function in the web (tested at the domain seam alongside the composition):

| Selection | Bar |
| --- | --- |
| nothing | no bar |
| exactly one result (spec terms: a shape with a recipe) | Regenerate (primary), Vary, Recipe (ghost), separator, Agent; the result's line shows under it |
| exactly one result still generating | the hint `Generating…`, separator, Agent |
| exactly one page or motion with a file | Open, separator, Agent (spec 09 connects Open to its editor) |
| usable | Generate (primary), hint, separator, Agent |
| not usable | Agent only |

The hint is `@<name>` when the selection is exactly one group, otherwise `N selected` where N counts the selected shapes as tldraw counts them (a group is one). When the selection is exactly the members of one batch (spec 05), the hint is `4 images · $0.6720`. Vary is hidden for a text result (spec 05). Regenerate and Vary are disabled while that result's own run marker is set.

Look (spec 12): the bar is a `surface-glass` card with the kit's border, `rounded-xl` radius and small shadow. Its buttons are the kit's Button at `sm` size: the primary one (Generate, Regenerate, Open, Agent) is `default`, Vary is `outline`, Recipe is `ghost`. The separator is the kit's vertical Separator. The hint and the result's line are `text-xs` in the muted foreground.

Placement: centred above the selection's screen bounds, 12 px gap, clamped 8 px from the canvas's sides; flipped below the selection when there is no room above; when there is room neither above nor below, pinned inside the canvas at the top margin. The composer uses the same rule with its own size, so it grows upward on the same centre and bottom edge (downward when flipped). The morph animates size and position over 200 ms ease-out; under reduced motion it crossfades over 120 ms. The bar hides while a shape is dragged, while the canvas is dragged (not on wheel moves) and during a box selection. Pointer and click events on the bar and composer never reach the canvas. A wheel over them is forwarded to the canvas at the same pointer position, unless the element under the pointer scrolls itself (the instruction box once it overflows).

### The composer and its Generate tray

Width 420 px. Three bands. The bar grows into t3code's composer shell (spec 12): `rounded-3xl`, a glass fill of `--card` (dark: `--surface-raised`) at the glass opacity with the glass blur, the kit border, and `shadow-composer` in light (none in dark, as in t3code). The radius, fill and shadow change within the same 200 ms morph.

Top band: the medium switch (the kit's `segmented` ToggleGroup of the registered media, with radio semantics, lowercase labels `image`, `video`, `text`) on the left; the source count on the right in `text-xs` muted foreground, the same text as the toolbar hint (`3 selected`, `@character`), or `recipe · N sources` in recipe mode.

Box: the instruction editor (Tiptap, one paragraph per line, the `@` mention menu of spec 02's prompt editing), placeholder `What should this make?`, autofocused on open, inside the kit's field frame (input border, background, `rounded-lg`, the focus ring while the editor has focus). Attachments and chips are off in the Generate tray. The send button sits at the box's bottom right with the price estimate immediately to its left; it is the kit's Button `default` at `sm` size with an up arrow, in `--message-action` (the primary colour), since the kit has no round labelled button. Send label: `Generate` (spec 05 adds `Generate 4×`). Cmd+Enter (Ctrl+Enter off macOS) sends wherever focus is while the composer is open, except in a text field outside it or while one of its menus is open; Enter and Shift+Enter insert a line. While the send is being acknowledged, the button shows a spinner and is disabled; a second press does nothing.

Tray band, below the box's border: the model chip first, then one chip per prop that will be sent, side by side, then `+ add prop` at the end of the row. Every chip is one chip recipe (spec 12): the kit's Button `outline` at `compact` size (28 px); `+ add prop` is Button `ghost-muted` at the same size. The menus are the kit's Menu, a prop's values as radio items (the current one tinted and checked), the add menu as items with the value in the muted foreground. Chip text is the value (`2:3`, `high`, `1K`, `transparent`, `svg`); the model chip shows the part of the slug after the first `/`, with the full slug as its tooltip, and `Loading models…` until the catalogue arrives (disabled while the catalogue is empty).

- The model chip opens the model dialog.
- A prop chip opens a menu of that prop's allowed values with the current one checked, then a separator and `Remove`. Remove takes the prop out of the tray; a prop not in the tray is not sent.
- `+ add prop` opens a menu listing each declared prop not in the tray as `<Label> <current or default value>` (for example `Quality low`, `Background auto`). Picking one adds it to the tray and opens its value menu. When every declared prop is in the tray, `+ add prop` is hidden.
- Labels: `Size` (resolution tiers, or exact sizes), `Ratio` (aspect_ratio), `Quality`, `Background`, `Format` (output_format). Spec 05 adds `Runs`.

On open, the tray holds the last-used values for the medium (see below), else the defaults. The instruction starts empty every time, except in recipe mode. The draft survives selection changes while the composer stays open and is dropped on close.

Selection binding: clicking a shape while the composer is open adds it to the selection instead of replacing it. Clicking empty canvas closes the composer. Esc closes the composer from anywhere inside it, including the editor, unless a menu or the model dialog inside it is open, which closes first. The composition is recomputed on every change to the selection or to any shape the composition read.

On send: the web renders composites and the sketch, uploads them, builds the outputs, calls `run.image`, records last-used values, and on acknowledgement collapses the composer back to the bar. A failure before acknowledgement stays in the composer as an error line.

### Model-driven props

The image catalogue entry's `params` is OpenRouter's typed `supported_parameters` map. The model params module reads:

- an enum (`{ type: 'enum', values: [...] }` with at least one value) as a prop's allowed values; a plain non-empty array is accepted too (the video catalogue's shape, spec 04);
- a range (`{ type: 'range', min, max }`) for `input_references` as the reference cap (its `max`);
- for image: `resolution`, `aspect_ratio`, `quality`, `background`, `output_format`, and `input_references`. Nothing else.

A prop is offered only when the model declares it, with exactly its values. A value the model does not declare is never sent. `Format` is offered even when the model declares a single value, because that is the clearest statement that the model does not make a raster.

Exact sizes replace resolution and ratio: when a catalogue supplies exact `WIDTHxHEIGHT` sizes for a model, the `Size` prop offers those instead of the resolution tiers, `Ratio` is not offered, and `size` is sent alone. Each option is labelled `1470x630 · 21:9`, the ratio being the nearest of 21:9, 16:9, 3:2, 4:3, 1:1, 3:4, 2:3, 9:16, 9:21 when within 2% of the true ratio, otherwise no ratio. Today only the video catalogue supplies exact sizes (spec 04); the rule lives here because it is shared.

Defaults for image: `resolution: '1K'`, `quality: 'low'`, `aspect_ratio: '1:1'`, each placed in the tray only when the model declares it and the value is allowed. Changing model resets every model-driven prop (`quality`, `background`, `resolution`, `aspect_ratio`, `size`, `output_format`) to its default or removes it. Runs (spec 05) is not a model trait and is not reset.

### Last-used values (option A)

The composer opens on the app's last-used values per medium: the model (only when the person picked one in the model dialog), and the tray's props with their values. Written when a run is sent from the composer, never by Regenerate or Vary. A stored model that is absent from the catalogue falls back to the default model; stored props go through the same `supported` check as any other value. Changing a medium's default model clears that medium's stored model, so the new default takes effect: this spec adds that step to spec 01's `settings.update`, after the change is applied, as a `null` write of `model` in that medium's `lastUsed.<medium>` preference. The values are stored in spec 01's preferences store, not in the browser, so they survive the packaged app's new origin on every launch. A recipe group (spec 06) or recipe mode, when present, takes precedence over last-used values.

### The model dialog

A centred modal dialog, 680 px wide, one per open picker: the kit's Dialog (spec 12), its title in the kit's dialog title, the header link an InlineButton in the muted tone, the search field the kit's InputGroup with a search icon, the table the kit's Table, and each sortable column header a Button `ghost` at `xs` size with its sort arrow.

- Title: `Image models` (spec 04 and 05: `Video models`, `Text models`).
- Header link `Browse on OpenRouter`, opening in a new tab: image `https://openrouter.ai/models?output_modalities=image`, video `https://openrouter.ai/models?output_modalities=video`, text `https://openrouter.ai/models?output_modalities=text&input_modalities=image`.
- Search field, label `Search models` (visually hidden), placeholder `Search models…`. Matches, case-insensitively, the full slug or the display name.
- A table with three sortable columns, sorted by Released, newest first, by default:
  - **Model**: the slug after the first `/`. The cell is a button (InlineButton) that picks the model and closes the dialog. The current model is bold with a check icon labelled `Current model`.
  - **Provider**: a coloured token. The provider key is the slug's prefix before `/` with a leading `~` removed. Its label is the part before `:` of the first model in the catalogue under that key whose display name contains a colon, trimmed; if none has one, the key itself. The colour is assigned by the key's position in the catalogue's sorted list of provider keys, cycling through 11 hues in this order: blue, orange, purple, green, pink, teal, red, cyan, yellow, gray, neutral. The token is the kit's Badge `label`, tinted from `--label` set to the Tailwind palette colour of that hue at 500 (`--color-blue-500` and so on).
  - **Released**: OpenRouter's `created` (Unix seconds) formatted as a short local date (numeric year, short month, numeric day), right-aligned, 130 px; empty when absent. Sorting uses the number.
- No match: `No model matches. Clear the search.`
- The table scrolls inside the dialog with a sticky header: the header row is its own table with the same columns, above the scrolling rows.
- The dialog handles Escape itself, in the capture phase, and stops it there, so Esc closes only the dialog.

### Pricing

The estimate appears beside the send button only when it is an exact number. It is computed in the web from `models.imagePricing` for the selected model (cached per model for the session; a reply for a model no longer selected is discarded).

For one endpoint's SKU list, the price of one image:

1. Empty list: none.
2. Any SKU whose `unit` is not `image`: none (per-token and per-megapixel billing cannot be known in advance).
3. The SKUs with `billable: 'output_image'`. None: none. Exactly one: that one.
4. Several: a SKU's `variant` matches when every underscore-separated part of it (lowercased) equals one of the chosen values among `quality` and `resolution` (lowercased). If any variants match, those are the candidates; otherwise the SKUs with no variant. Exactly one candidate: that one. Otherwise none.
5. Add, per reference image sent, the sum of `cost_usd` of SKUs billed `input_image` or `input_reference`.

For the run: every endpoint must give a number and all must be equal, otherwise none. Multiply by the output count (1 in this spec; spec 05 multiplies by Runs). The reference count is every image slot that will be sent, over the cap included, so the estimate is an upper bound exactly when the cap warning is showing.

Display: `est. ~$0.17` with two decimals at $0.10 or more, three below (`est. ~$0.035`). Spec 05 appends ` / image` in Free.

Actual cost comes from the upstream response's `usage.cost` and is shown on the result's line with four decimals (`$0.1900`). A missing cost shows nothing.

### RPC methods and events

All over spec 01's RPC socket. Every failure is spec 01's `UnframedError`: the validation refusals below are `bad_request`, except no key (`unavailable`) and a reference file missing from the project folder (`not_found`). A failed output is not an RPC failure: it arrives as an `output` event.

- `models.list({ medium: 'image' })` returns `{ models: [{ id, name, created, params }], default }`. The engine fetches `GET https://openrouter.ai/api/v1/images/models` and maps each entry to `id`, `name` (or `id` when absent), `created` (or `null`), `params` (`supported_parameters`, or `null`). If the default model is missing it is appended as `{ id, name: id }`. Sorted by `id`. On any upstream failure it returns `{ models: [{ id: default, name: default }], default }`, never an error. `default` is `OPENROUTER_IMAGE_MODEL` (spec 01). Spec 04 and 05 add `video` and `text`.
- `models.imagePricing({ id })` returns `{ endpoints: Sku[][] }` from `GET https://openrouter.ai/api/v1/images/models/<id>/endpoints`, one SKU list per endpoint (its `pricing`, or `[]`). The id is interpolated into an upstream path, so it must match `^~?[\w.-]+\/[\w.-]+$` and must not contain `..`, else the error `Not a model slug.` Any upstream failure returns `{ endpoints: [] }`.
- `run.image(request)` starts a run and returns `{ runId, batchId, placeholders: [shapeId] }` once the placeholders are in the room. Request:

```ts
type ImageRunRequest = {
  project: string
  batchId?: string            // "b-<epochMs>"; minted by the engine when absent
  model?: string              // default model when absent
  params: { resolution?: string; quality?: string; aspect_ratio?: string;
            background?: string; output_format?: string; size?: string }
  selectionPrompt: string     // the parts, joined
  instruction: string
  outputs: { prompt: string; references: Ref[] }[]   // 1 to 10
  sources: string[]           // shape ids, for the recipe and tether
  anchor: { x: number; y: number; w: number; h: number }  // page coords
  of?: { shapeId: string; action: 'regenerate' | 'vary' | 'recipe' }
}
type Ref = RecipeRef                    // defined with the recipe schema below
```

- `recipe.copy({ project, from, sidecar, file })` returns `{ sidecar }`. A result pasted from project `from` brings its recipe: every file the recipe names (its references and their `original`) is copied into `project` through spec 02's copy, and the result's sidecar, its references renamed to the copies and its `file` set to `file` (the image's copy), is written beside `file` in place of that copy's own sidecar. A sidecar that is gone answers `not_found` with the `recipe.read` message below.
- `recipe.read({ project, shapeId })` returns the result's recipe from its sidecar, or, for a durable placeholder whose sidecar is not written yet (spec 04), from its render job record; otherwise the error (`not_found`) `This result's recipe is no longer in the project folder.`
- `run.subscribe({ project })` streams run events for that project:
  - `{ type: 'started', runId, batchId, count }`
  - `{ type: 'output', runId, runIndex, ok: true, shapeId, file, cost }`
  - `{ type: 'output', runId, runIndex, ok: false, error }`
  - `{ type: 'finished', runId, succeeded, failed, errors, orphaned }`

### The run, in the engine

Validation before acknowledgement, each failing the call with its message and writing nothing:

- No key: `No OpenRouter key yet. Add one with the key icon in the top right (it becomes a settings gear once saved).`
- Every output prompt empty after trimming: `Prompt is empty. Select a prompt, or type an instruction.`
- 0 or more than 10 outputs: `A run makes between 1 and 10 images.`
- A reference file (basename only; any path is stripped) not in the project folder: `Reference file not found in this project: <file>`
- A link that is not https: `A video link must start with https://.`

Then, in order: write one placeholder per output (see Placeholders and run markers), acknowledge, and fire every output's upstream call concurrently. Each output settles independently.

An image placeholder is 320 canvas units wide, its height from the requested `aspect_ratio` (`W:H`) or exact `size`, else square, placed by result placement (below), and shows a spinner and `Generating…`. It is filled, or deleted on failure, by the lifecycle in Placeholders and run markers.

Upstream call: `POST https://openrouter.ai/api/v1/images` with `Authorization: Bearer <key>` and JSON `{ model, prompt, ...params, input_references? }`. Only set params are sent; `quality: 'auto'` and `background: 'auto'` are not sent. `input_references` is present only when there is at least one reference, as `{ type: 'image_url', image_url: { url } }` or `{ type: 'video_url', video_url: { url } }`, with every project file read and inlined as a `data:<mime>;base64,...` URL at this boundary (mime by extension: png, jpg and jpeg, webp, gif, svg as `image/svg+xml`, mp4, webm, mov as `video/quicktime`, else `application/octet-stream`). Links are sent as given.

Response handling, each failure becoming that output's `error`:

- The fetch throws: `Could not reach OpenRouter: <message>`
- Reading the body fails: `Lost the connection while reading OpenRouter's answer: <message>. The run may still have completed and been charged. Check your OpenRouter activity page.`
- The body is not JSON: `Unexpected response from OpenRouter: <first 300 characters>`
- Status 402: `OpenRouter refused this as unpaid: either the account is out of credit, or this key has hit its own spending cap. Add credit at openrouter.ai/credits, or check the key's cap at openrouter.ai/settings/keys. (<upstream message>)`
- Any other non-2xx: `OpenRouter (<status>): <upstream message>`
- No `data[0].b64_json`: `OpenRouter returned no image data.`
- The image cannot be written: `Generated the image but failed to write it: <message>`

The upstream message is `error.message` when it is a string, else `error` when it is a string, else the first 300 characters of the raw body.

File naming: `<stamp>-<slug>[-<runIndex>].<ext>` in the project folder. `stamp` is the ISO timestamp with `:` and `.` replaced by `-`. `slug` is spec 01's slug rule applied to the prompt, `image` when empty. `-<runIndex>` is present only when the batch has more than one output. `ext` comes from the response's `media_type` (or `image/<output_format or png>` when absent): the subtype before any `+`, lowercased, if it is `[a-z0-9]+`, else `png`. The file is written exclusively (never overwriting). On a name collision it retries as `<base>-2`, `<base>-3` up to `<base>-5`; a sixth collision fails that output with the write error above. The sidecar is `<final base>.json`. A sidecar write failure is logged and does not fail the output. The engine logs `  generated → <path>  ($0.0420)` per output.

Run report: after the last output settles, the engine sends `finished`. `errors` holds the distinct failure messages. The web shows, when `failed > 0`, a toast: `<succeeded> of <count> succeeded. <errors joined with "; ">` (warning when some succeeded, error when none did). A full success shows no toast. `orphaned` counts outputs whose placeholder had been deleted before they landed (lifecycle step 4); when above zero the toast adds `<n> result(s) landed after their placeholder was deleted. The file is in the project folder.`

Durability: the run lives in the engine, not the tab. Closing or reloading the tab does not stop it; results land in the room and every tab sees them. Its outcome is kept in the run registry (Placeholders and run markers).

### Placeholders and run markers

This is the one mechanism for a result that is still being made, and this section is its only definition. Spec 04 (render jobs), spec 05 (text runs and batches) and spec 09 (motion renders) use it with the field names and lifecycle below and add nothing but what is marked as theirs.

- **Placeholder.** A shape the engine writes into the project's sync room through spec 02's `apply` with origin `run:<runId>`, before the call that started the work is answered. It is an ordinary shape of the kind the result will be (an image here, a text result in spec 05, a video in specs 04 and 09) holding no file or text yet. A placeholder for a paid run also carries its result meta (below) with `sidecar: null` until it is filled; a motion render's placeholder (spec 09) is not a paid result and carries none.
- **Run marker**, `meta.unframed.run`:

```ts
type RunMarker = {
  runId: string       // the run's id (this spec, spec 05); the render job id (spec 04); the motion render id (spec 09)
  runIndex: number    // 1-based position in its batch; 1 when alone
  startedAt: number   // epoch ms
  durable?: {         // spec 04 only: the work is a render job in the job store and outlives the process
    params: { prompt: string, model: string, duration: number | null,
              resolution: string | null, size: string | null }   // the job's params, the poll's fallback
  }
}
```

- **Run error**, `meta.unframed.runError: string`: set only on a durable placeholder whose work failed (spec 04). Nothing else sets it.
- Nothing but the engine writes either field. Spec 07's `canvas_write` strips both from anything the agent sends.
- **Lifecycle.**
  1. Written, with the marker, before the starting call answers.
  2. Filled when the work lands, in one engine change: the file (or the text), the height from the file's real pixel ratio at the shape's current width, the result meta's `sidecar`, and the marker removed.
  3. Failed: a non-durable placeholder is deleted and the failure goes to the tab that is watching (the run report toast here and in spec 05, the render row in spec 09). A durable placeholder stays, gets `runError`, and loses its marker, because its failure may arrive hours later with no tab open, and the shape is the only place left to say so.
  4. A placeholder the person deleted before its work landed is never recreated. The file and sidecar still land in the project folder, the engine logs `  <runId>: output <runIndex> landed after its placeholder was deleted → <path>`, and a run that reports to a tab counts it in `orphaned`. Undo that restores a deleted placeholder restores its marker, and the resolution below picks it up.
- **Resolution.** When a shape carrying a marker appears in the room (an undo restoring a deleted placeholder), and for every marker at boot and on first opening a project's room, the engine resolves it:
  - non-durable: the run is live in this process, leave it; it finished and that output succeeded, fill the shape as if it had just landed; it finished and that output failed, or the run is unknown, remove the marker and delete the shape if it has no file. At boot every non-durable run is unknown, since the process that ran it is gone.
  - durable (spec 04): look the job up in the render job store. Pending, leave it (the sweep and the tab's poll land it); done, fill it from the record's `savedPath`; failed, set `runError` from the record's `error` and remove the marker; no record, leave it, because the tab's poll can still collect a job the store never learned about from the marker's `params`.
- **Run registry.** The engine keeps every non-durable run's state (live, or finished with a per-output outcome of file or failure) for the life of the process, bounded to the last 200 runs. This spec's runs, spec 05's runs and spec 09's renders all register there; resolution reads it.
- **Copies.** Every copy path strips the marker, the run error and, from a placeholder that is not yet filled, the result meta: copy and paste, duplicate, cross-project paste, and library save (spec 06). A copied placeholder is an ordinary empty shape of its kind and can never claim someone else's run.

### Results, recipes and their actions

A result is an ordinary image shape (spec 02; a prompt in spec 05, a video in spec 04) with result meta:

```ts
type ResultMeta = {                 // meta.unframed.result
  sidecar: string | null            // file name of the sidecar in the project folder; null on an unfilled placeholder
  medium: 'image' | 'text' | 'video'
  model: string
  batchId: string; runIndex: number; runCount: number
  cost: number | null
  sources: string[]                 // shape ids, for the tether only
  batchExtraCost?: number           // spec 05: a Free batch's repair call, on every member
  recipe?: ResultRecipe             // spec 11 only: an imported result's approximate recipe
}
```

The recipe itself lives in the sidecar, never on the shape, with one exception: an imported result (spec 11) carries its approximate recipe as `recipe` here, because its old sidecar has none and is never rewritten. `recipe.read` answers from `recipe` when the shape has one.

**The recipe schema.** This is the one definition of a recipe. Specs 04, 05, 06 and 11 use these two types and do not redefine them.

```ts
type ResultRecipe = {               // what a result's sidecar holds: everything needed to repeat its run
  medium: 'image' | 'video' | 'text'
  model: string
  params: Record<string, string | number | boolean>  // the props that were sent, keys as the medium's tray names them (spec 04 adds inputMode, duration, generate_audio, shareLocalVideos)
  selectionPrompt: string           // the selection's composed prompt parts, joined (spec 05 Free: shared context and the section)
  instruction: string               // the per-run instruction, '' when none. A result's recipe always includes it
  references: RecipeRef[]           // exactly what was sent, in order; composites and sketches as the files that were sent
  sources: string[]                 // the contributing shape ids
  of?: { sidecar: string; action: 'regenerate' | 'vary' | 'recipe' }
  approximate?: true                // spec 11: imported from the old app, which never recorded references or the selection prompt
  sentPrompt?: string               // with approximate: the full prompt the old app sent
}
type RecipeRef = { kind: 'image' | 'video'; file: string; original?: string }
               | { kind: 'video'; url: string }              // https only
               // for video with params.inputMode 'first_frame' or 'first_last', references are the frames, first then last

type GroupRecipe = {                // a group's standing settings (spec 06), stored as meta.unframed.recipe on the group
  medium: 'image' | 'video' | 'text'
  model: string
  params: Record<string, string | number | boolean>
  runs: number | 'free'             // 1 to 10, or Free (spec 05); 1 for video and text
}
```

A group's standing recipe holds no text and no sources: no instruction, no selection prompt, no references. Its sources are always the group's members as they are when it runs (spec 06).

An **approximate** recipe (spec 11) has an empty `selectionPrompt` and `references`. Its Regenerate and Vary recompose the request from its `sources` as they are on the canvas now, by the selection to request rule, skipping any that are gone, with the recipe's model and params. Its Recipe mode shows `Imported from the old app. It sent:` and the `sentPrompt` above the box, and sends from the live sources.

Copies keep the result meta (the sidecar is in the same project). Cross-project paste copies the sidecar and every reference file its recipe names along with the image (spec 02 copies the image file; this spec adds the rest, through `recipe.copy`). A result whose recipe cannot come along pastes as an ordinary image, with the toast `Could not copy the result's recipe: <message>`.

The result's line, shown under a selected result: `<model part> · <W>×<H> · $<cost>` with any missing part omitted. `W×H` are the file's pixel dimensions.

Actions, all through `run.image` with a request built from `recipe.read`, anchored on the result's bounds:

- **Regenerate**: the recipe exactly, one output: the recorded model, params, selection prompt, instruction and reference files (composites and sketches as recorded, not re-rendered).
- **Vary**: the same, with the result's own file appended as the last image reference. Disabled, with the tooltip `This model takes at most <n> references, and this recipe already uses them.`, when that would exceed the cap.
- **Recipe**: opens the composer in recipe mode over the result: the medium, model, props and instruction prefilled from the recipe, the source band reading `recipe · N sources` (N = recorded reference slots plus recorded prompt parts), and sending uses the recorded selection prompt and references with whatever the person changed in the tray and the box. Any change to the selection while in recipe mode leaves recipe mode: the source band switches to the live selection and the tray and box keep their values. Badges are not shown in recipe mode.

Deleting a source shape never breaks a result: its actions read only the sidecar and the project files. A recorded reference file deleted from the folder fails the action with `Reference file not found in this project: <file>`.

Tether: while exactly one result is selected, a dashed line (1.5 px, dash 4 gap 5, the kit's `--border` colour) runs from each of its `sources` still on the canvas to the result, with an arrowhead at the result end. It is drawn as an overlay, is not a shape, cannot be selected, and carries nothing.

### Result placement

Anchor: the selection's page bounds (for Regenerate and Vary, the result's bounds). Outputs are laid in one row, in run order, left to right, 24 units apart, starting 40 units right of the anchor's right edge, top-aligned with the anchor. If the row's bounds intersect any existing shape's bounds, the row moves down in steps of 48 units until clear, up to 200 steps, after which the last position is used.

### Persisted formats

Image sidecar (`<base>.json`, beside the image). The first block is kept from the old app field for field; `recipe` is new:

```ts
type ImageSidecar = {
  prompt: string; model: string
  resolution?: string; quality?: string; aspect_ratio?: string
  output_format?: string; background: string | null; size?: string
  referenceCount: number; references: { images: number; videos: number }
  batchId: string; runIndex: number; runCount: number
  cost: number | null; createdAt: string; file: string
  recipe: ResultRecipe              // medium 'image'
  free?: { picks: number[] | null; dropped: number[] }   // spec 05
}
```

`original` names the canvas image a composite was rendered from. A sketch has no `original`.

Last-used values: the preferences `lastUsed.image`, `lastUsed.video` and `lastUsed.text` in spec 01's preferences store, each `{ model?: string; props: Record<string, string | number | boolean> }` (specs 04 and 05 add fields). A missing or unreadable preference means "none".

## Testing Decisions

A good test drives one of the three seams in 00-index and asserts only on what that seam exposes: return values, RPC replies and events, room contents, files written, what is on screen. No test reaches into a module's internals or mocks one of our own modules.

- **Domain seam** for every rule with many cases: ordering and tie-breaks, group expansion in place, member dedup, artifacts ignored, `@id` resolution (recursive, cycle message, unknown left as typed, text results literal and not re-scanned, group text without media), per-kind numbering, roles and the dash, usable, sketch ownership (overlap, z order, topmost wins, owned marks unselected, loose marks, the sketch's slot), caps and warnings, the toolbar-state function, model params (enum, array, range cap, supported, exact size replacing resolution and ratio, ratio labels, defaults, reset), the estimate (each numbered rule above, plus multi-endpoint agreement and reference billables), the formatter, result placement, image dimensions. Table-driven Vitest cases, one row per case, named by the behaviour.
- **Engine seam** for `models.list`, `models.imagePricing` (including the slug refusal), `run.image` against a stub image endpoint: placeholders appear in the room before the reply, files and sidecars are written with the right names and fields, collisions retry, every error branch produces its message, partial failure produces the `finished` event, a placeholder deleted mid-run is not recreated, a restored placeholder is resolved, boot clears stale markers, `recipe.read`. The stub can be told per request to succeed, fail with a status, return non-JSON, drop the body mid-read, or omit the image.
- **Browser seam** for the toolbar states and placement, the composer opening, morphing, Cmd+Enter, Enter, Esc, click-to-add and click-away, the tray and its menus, model dialog search, sort, pick and Escape, badges appearing only while the composer is open, a composite being uploaded when marks sit on an image, results landing and their line, the tether, Regenerate, Vary and Recipe, and copy stripping a marker.
- Component snapshots are not tests. Canvas state can be seeded by writing the project's canvas through the sync room before loading the page.

## Tasks

1. Reference resolver: resolve a prompt's `@id` tokens recursively against all prompts on the canvas; unknown tokens left as typed. Seam: domain.
2. Reference resolver: cycle detection with the exact `Circular reference: ...` message. Seam: domain.
3. Reference resolver: text results inserted literally and never re-scanned; a loop through a text result terminates. Seam: domain.
4. Reference resolver: a group resolves to its prompt and text-result members' text in box order, never media. Seam: domain.
5. Selection to request: top-edge ordering with left-edge and z-rank tie-breaks, parts trimmed, empties dropped, joined with a blank line, instruction appended and resolved. Seam: domain.
6. Selection to request: a group expands in place; a member selected with its group counts once; artifacts contribute nothing. Seam: domain.
7. Selection to request: media slots numbered per kind; empty media contributes nothing; https video links become link slots. Seam: domain.
8. Selection to request: roles map with `image N`, `video N` and the dash for empty media and artifacts. Seam: domain.
9. Selection to request: sketch ownership (overlap, above in z, topmost wins, computed against all images). Seam: domain.
10. Selection to request: owned marks make a composite in the image's slot; a crop alone makes a composite; loose selected marks make one sketch in the first loose mark's slot; the sketch counts as an image. Seam: domain.
11. Selection to request: `usable`, `sources`, and the over-cap and video warnings with their exact strings. Seam: domain.
12. Toolbar state function: every row of the toolbar states table, including the `@name` hint and the batch hint. Seam: domain.
13. Model params: enum and array values, the `input_references` cap, `supported`, and the image prop set. Seam: domain.
14. Model params: exact sizes replace resolution and ratio; ratio labels snap within 2%. Seam: domain.
15. Model params: defaults applied only when declared and allowed; reset on model change leaves Runs alone. Seam: domain.
16. Image estimate: rules 1 to 3 (no list, a non-image unit, one output SKU). Seam: domain.
17. Image estimate: variant matching by parts, bare fallback, ambiguity gives none. Seam: domain.
18. Image estimate: reference billables, multi-endpoint agreement, output count; the formatter's two and three decimal cases. Seam: domain.
19. Result placement: a row right of the anchor, stepping down past existing shapes, capped at 200 steps. Seam: domain.
20. Image dimensions: PNG, JPEG, WebP, GIF and SVG headers. Seam: domain.
21. `models.list` for image: mapping, default appended, sorted, fallback on upstream failure. Seam: engine.
22. `models.imagePricing`: SKU lists per endpoint, slug refusal, empty on failure. Seam: engine.
23. Last-used values are stored as the `lastUsed.<medium>` preferences on send, never on Regenerate or Vary, and a `settings.update` of a default model deletes that medium's stored `model`. Seam: engine.
24. `run.image` validation: no key, empty prompts, output count, missing reference file, non-https link; nothing written. Seam: engine.
25. `run.image` happy path: placeholders in the room before the reply, upstream payload shape (only set params, `auto` dropped, references inlined), file and sidecar written, placeholder filled with the file and result meta, `output` and `finished` events. Seam: engine.
26. `run.image` file naming: stamp, slug rules, runIndex suffix only for batches, extension from `media_type`, exclusive write with retries to `-5`. Seam: engine.
27. `run.image` upstream failures: unreachable, body lost mid-read, non-JSON, 402, other status, no image data, write failure; each deletes its placeholder and reports its message. Seam: engine.
28. `run.image` partial failure: mixed outcomes produce `succeeded`, `failed` and distinct `errors`. Seam: engine.
29. Run durability: the run finishes and lands with no web client connected. Seam: engine.
30. Run markers: a placeholder deleted mid-run is not recreated and is counted in `orphaned`. Seam: engine.
31. Run markers: a restored placeholder is filled when its output succeeded, deleted when it failed or the run is unknown. Seam: engine.
32. Run markers: stale markers resolved at boot and on first room open. Seam: engine.
33. `recipe.read`, and its message when the sidecar is gone. Seam: engine.
34. Selection toolbar: appears over a selection with Generate, hint and Agent slot; Agent-only for an unusable selection; `@name` for a group; Open for a filled artifact. Seam: browser.
35. Selection toolbar: placement above, flip below, clamp; hidden during drag, canvas drag and box select; wheel forwarded to the canvas. Seam: browser.
36. Composer shell: grows from the bar on the same centre and bottom edge; Esc and click-away close it; clicking a shape adds it to the selection; the Agent tray slot renders when opened from Agent. Seam: browser.
37. Generate tray top band: medium switch with only registered media, source count and `@name`. Seam: browser.
38. Generate tray box: instruction editor with placeholder and `@` menu; Cmd+Enter sends; Enter adds a line; spinner and single send while acknowledging. Seam: browser.
39. Generate tray: warnings and the disabled states (empty prompt, cycle, no key). Seam: browser.
40. Tray band: model chip, prop chips with value menus and Remove, `+ add prop` listing undeclared-in-tray props with values; defaults present only when declared. Seam: browser.
41. Model change resets props in the tray. Seam: browser.
42. Model dialog: title, browse link, search, default Released sort, column sorts, provider tokens, pick and close, current model marked, empty message. Seam: browser.
43. Model dialog: Escape closes only the dialog. Seam: browser.
44. Price estimate beside send, hidden when not exact; stale pricing replies discarded after a model change. Seam: browser.
45. Last-used values: the composer reopens on the last sent model and props; a missing model falls back to the default. Seam: browser.
46. Role badges appear on selected shapes only while the Generate tray is open, and match the request that is sent. Seam: browser.
47. Composites and the sketch: marks on a selected image upload one composite and send it in the image's slot; loose marks upload one sketch; the canvas image and marks are unchanged afterwards. Seam: browser.
48. Results land as image shapes to the right of the selection, placeholders first; the result's line shows model, size and cost. Seam: browser.
49. Run report toast on partial and total failure, none on full success. Seam: browser.
50. Tether: drawn to surviving sources only while one result is selected; not selectable; gone on deselect. Seam: browser.
51. Regenerate: one new result beside the old from the recorded recipe, working after a source is deleted. Seam: browser.
52. Vary: the result appended as the last reference; disabled at the cap with its tooltip. Seam: browser.
53. Recipe: composer reopens in recipe mode prefilled; a selection change leaves recipe mode keeping tray and box. Seam: browser.
54. Copy and paste of a generating placeholder yields an empty image shape with no marker; copying a result keeps its result meta. Seam: browser.

## Out of Scope

- The video medium, its input modes, render jobs and share links (spec 04).
- The text medium, the Runs prop, batches of more than one output, Free mode and its preview (spec 05).
- Recipe groups and the library (spec 06).
- The Agent tray, chats and everything the agent does (specs 07 and 08).
- Opening an artifact in the editor (spec 09; this spec only shows the Open button).
- Settings, the key flow and default models (spec 10).
- Live source wiring: a result re-reading its sources as they are now was rejected (decision Q3, option C). Regenerate uses the recorded recipe.
- A result strip, "Add to canvas" and "Clear": results land on the canvas directly now, so the old output node's strip has no home.
- A seed control, and capability tags in the model dialog.

## Further Notes

Kept from the old app, exactly: the ordering and joining rule, `@id` semantics, per-kind numbering, the over-cap and video warnings (reworded from "wired" to "selected"), model-driven props and their defaults and reset, exact sizes replacing resolution and ratio, the model dialog, the pricing rules and formats, the upstream payload, every error message (the lost-body message had its dash replaced by a sentence break), file naming and collision retries, the sidecar fields, and batch ids. Changed by decision: the selection replaces wires and output nodes (Q5, Q37, Q38), results land on the canvas with recipes (Q3 option A), badges show only while the composer is open (Q18), sketches and crops (Q40 to Q42), and Base UI menus replace native selects (Q29).

The estimate's silence is deliberate: most image models bill per token or per megapixel, and a guess dressed as a number is worse than no number.

The reference cap is not enforced by truncation because the badges must match what is sent; teaching the badges each model's cap would make the numbering depend on the model, which the person cannot see on the canvas.

### Assets this spec needs

None. This spec sends no model-facing prompt text.
