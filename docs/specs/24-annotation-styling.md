# 24 · Annotation styling

Depends on: 01 to 23 (read 00-index first). It changes spec 18's Design panel on the canvas, spec 03's selection toolbar and spec 02's chrome rule for the style panel. The passages it changes are listed under "Rules this spec bends".

## Problem Statement

Selecting a sticky note, a drawing or a line of text on the canvas opens spec 18's Design panel, a 320 px column docked to the right edge. It is built for exact values, and it is the right tool when a person wants them. For the everyday case it is too much: the person wants the note yellow, the arrow thicker, the text bigger. They have to look away from the shape to a column at the edge of the window, and the column takes 320 px of canvas every time they touch a note. FigJam and Miro put these few choices next to the shape, in the small bar that appears over the selection, and keep the full inspector out of the way until it is asked for.

## Solution

Prompts and marks (text, sticky notes, geo shapes, arrows, drawings, lines and highlights) are styled from the **style row**: a short set of controls at the start of the selection toolbar, before the hint, Agent and Generate. Each control is one small button or field that opens a popover: colour swatches, a stroke width, a dash, a font, a size, bold and alignment. The row shows only the controls every selected shape takes.

The Design panel stays, closed by default. The last control in the style row is a **Design panel** toggle, the same kit Toggle that opens the Parameters panel for an artifact. It opens the docked panel with spec 18's full controls, reads as pressed while the panel is open, and the choice is remembered: once open, the panel shows for every later prompt or mark selection, across projects and launches, until the person closes it.

With a creation tool on (Prompt, Draw, Highlight, Line, Arrow, Note or a geo shape), a **tool tray** pops up above that tool's button in the bottom toolbar, with the same compact controls for the next shape. With the Design panel open, the panel sets the next shape as it does today and the tool tray stays hidden.

## User Stories

1. As a person, I want style controls in the bar over a selected sticky note, so that I change its colour without looking away from it.
2. As a person, I want the same controls over a selected prompt, so that text on the board styles the same way whether or not I generate from it.
3. As a person, I want the style controls first and Agent and Generate last, so that the actions stay where my hand expects them on every selection.
4. As a person, I want only the controls that fit the selected shapes, so that a drawing offers stroke choices and not fonts.
5. As a person, I want a mixed selection of a note and a prompt to offer what they share, so that one change reaches both.
6. As a person, I want a swatch palette for each colour, so that picking a colour is one click.
7. As a person, I want a Default swatch, so that I can put a shape back to the colour the canvas gives it in each scheme.
8. As a person, I want a None swatch for a fill, so that a rectangle can be an outline only.
9. As a person, I want a custom hex field under the swatches, so that I can still type an exact colour.
10. As a person, I want stroke width presets, so that thin, medium, thick and heavy are one click each.
11. As a person, I want a dash choice for strokes, so that I can make a line dashed or dotted.
12. As a person, I want a font menu with Draw, Sans, Serif and Mono, so that text changes character in one click.
13. As a person, I want a size field I can type into and step with the arrow keys, so that text grows by the amount I want.
14. As a person, I want a Bold toggle, so that I can stress a note without opening a panel.
15. As a person, I want an alignment menu, so that I can centre text in a note.
16. As a person, I want differing values across the selection to read as Mixed, so that I know a change will even them out.
17. As a person, I want each change to be one undo step, so that Cmd-Z takes back exactly what I did.
18. As a person, I want the docked Design panel closed by default, so that the canvas keeps its width while I annotate.
19. As a person, I want a Design panel toggle at the end of the style row, so that the exact controls are one click away.
20. As a person, I want the toggle to read as pressed while the panel is open, so that I can see the state.
21. As a person, I want the panel to stay open for my next selections once I open it, so that a styling session does not need a click per shape.
22. As a person, I want the panel to remember that it is open after a restart, so that my way of working survives the app closing.
23. As a person, I want a Close button in the panel header, so that I can close it from the panel itself.
24. As a person, I want the style row to keep showing while the panel is open, so that the toggle that closes it is always next to the selection.
25. As a person, I want a style tray above the drawing tool I picked, so that I set the pen colour and width before I draw.
26. As a person, I want the tool tray to stay open while I draw, so that I can change the colour between strokes.
27. As a person, I want the tool tray to set only the next shapes, so that it never changes what is already on the board.
28. As a person, I want the tool tray hidden while the Design panel is open, so that I am never offered the same choice twice.
29. As a person, I want the tool tray to go away when I go back to Select, so that it is not in the way of the board.
30. As a person, I want Esc in a style popover to close the popover only, so that I do not lose my selection.
31. As a person, I want a tooltip on every style control, so that an icon is never a guess.
32. As a person, I want the style row to go away while I drag, so that it does not fight the gesture, as the bar already does.
33. As a person, I want images, videos, artifacts, groups and nodes in a selection to be left out of the style row, so that the row only touches what it can style.
34. As a person, I want the style row on the iPad too, so that I can annotate by touch.
35. As a person, I want the tldraw watermark left uncovered by the row, the tray and the panel, so that the licence terms are met.

## Implementation Decisions

### Terms this spec adds

- **Style row**: the group of style controls at the start of the selection toolbar.
- **Style control**: one control in the style row or the tool tray. The set is `fill`, `stroke`, `strokeWidth`, `dash`, `font`, `size`, `bold`, `align`, `textColor`.
- **Tool tray**: the popover above the active creation tool in the bottom toolbar, holding the style controls for the next shape.
- **Annotation shapes**: the designable kinds of spec 18 (prompt and the marks text, note, geo, arrow, draw, line, highlight). This spec uses "prompts and marks" in user-facing text and `DesignableType` in code.

### Which controls each kind takes

| Kind | Style controls, in this order |
| --- | --- |
| Text (prompt) | font, size, bold, align, textColor |
| Sticky note | fill, font, size, bold, align, textColor |
| Geo shape | fill, stroke, strokeWidth, font, size |
| Arrow | stroke, strokeWidth, dash |
| Drawing | stroke, strokeWidth, dash |
| Line | stroke, strokeWidth, dash |
| Highlight | stroke, strokeWidth |

- A selection shows the controls every annotation shape in it takes, in the canonical order `fill, stroke, strokeWidth, dash, font, size, bold, align, textColor`. Images, videos, audio, artifacts, groups and nodes in the selection are left out, as spec 18's panel leaves them out. With no annotation shape selected, there is no style row.
- When the intersection is empty (a note and a line), the row holds only the Design panel toggle.
- A pure domain function decides this: `styleControlsFor(types: readonly DesignableType[]): readonly StyleControl[]`. It lives beside `shapeDesign` in the domain package.

### What each control writes

Every control writes through the same functions as spec 18's panel (`designPatched`, `metaWithDesign`, tldraw's style props), so a value set inline and one set in the panel are the same value. Each change is one undo step.

| Control | Look | Writes |
| --- | --- | --- |
| fill | a 20 px swatch button, `Fill` (`Colour` on a note) | `fillColor`; on a geo shape or a drawing it also sets tldraw's `fill` to solid. The None swatch sets `fill` to none and clears the colour. A note has no None swatch |
| stroke | a 20 px swatch button with a ring, `Stroke` | `strokeColor` |
| textColor | a swatch button showing a letter A in the colour, `Text colour` | `textColor` |
| strokeWidth | an icon button showing the current weight, `Stroke width` | a menu of four presets: Thin 1, Medium 2, Thick 4, Heavy 8 (px), each to `strokeWidth`. A width set in the panel that is none of these shows its number in the button and no preset checked |
| dash | an icon button, `Dash` | a menu of Draw, Solid, Dashed, Dotted, to tldraw's `dash` |
| font | a text button showing the font name, `Font` | a menu of Draw, Sans, Serif, Mono, written as the panel writes them (tldraw's `font`, family cleared). A custom family set in the panel shows its name and is listed checked at the top of the menu |
| size | a 52 px kit number field, `Size` | `fontSize` px; applies on Enter or when the field is left; arrows step by 1, Shift by 10; a refused value puts the field back |
| bold | the kit Toggle with the Bold icon, `Bold` | pressed when the weight is 600 or more; pressing writes `fontWeight` 700, releasing writes 400 |
| align | an icon button showing the current alignment, `Align` | a menu of Left, Centre, Right, written as the panel writes them |

- **Swatches.** A colour control opens a kit Popover with a grid of twelve swatches, a Default swatch first, a None swatch for a fill (not on a note), and below them spec 18's custom field (the browser's colour input and a hex field) that writes `#rrggbb` or `#rrggbbaa`. The twelve are one constant in the domain package, `ANNOTATION_SWATCHES`, fixed hex values chosen to read on both the light and dark canvas, and a picked one is written as its hex. Spec 18's rule holds: a set colour is the same in both schemes. Default clears the value (`null` in the patch), so the shape shows tldraw's derived colour in the current scheme again.
- **Clearing.** tldraw merges `meta` on update, so a change that leaves a shape with no stored design value writes `meta.unframed` as an empty object rather than dropping it; otherwise Default on a shape's last value would keep the old value. This also fixes the same case in spec 18's panel.
- **Mixed.** When the selected shapes differ on a value, a swatch shows an empty swatch with a dash in it, the size field shows the placeholder `Mixed`, a menu button shows its icon with no item checked, and Bold reads unpressed. A choice applies to all of them.
- **Keys.** Esc in an open popover or menu closes it and nothing else: the row and the tray mark that Escape as handled before tldraw's container sees it, so the selection stays. A pick made with the pointer gives the focus back to the canvas, so Cmd-Z right after it undoes the pick. Esc in the size field gives the keyboard back to the canvas, as in the panel. A wheel over the row is forwarded to the canvas, as spec 03 already does for the bar.

### The style row in the selection toolbar

- The row is the first group in the bar, then the Design panel toggle, then a 12 px gap, then what spec 03's toolbar states already put there (the hint, Regenerate, Agent, Generate, Recipe). Spec 03's "no dividers" holds: the gap separates the groups.
- It shows in every toolbar state whose selection holds an annotation shape: `generate`, `agent`, `result` (a text result is a prompt) and `recipe`. It does not show in `generating`, in `open` (a single artifact), or once the bar has grown into the composer; it comes back when the composer closes.
- The style controls are the kit's ghost icon Buttons at `sm` size, and the toggle is the kit's Toggle, `outline` at `sm`, as Parameters is. Every control has a kit tooltip with the name in the table above.
- The bar is wider with the row, and spec 03's placement rule takes its new width unchanged: centred above the selection, flipped below, clamped 8 px from the canvas's sides, kept clear of the top-left card and of `data-unframed-design-panel`.
- The bar hides during drags and box selection exactly as spec 03 says, row included.

### The Design panel toggle and the preference

- **Toggle**: the kit Toggle with the SlidersHorizontal icon, label and tooltip `Design panel`. Pressed while the panel is open.
- **Preference**: `design.panel` in spec 01's preferences store, `{ open: boolean }`. A missing or unreadable value reads as `{ open: false }`. It is written when the toggle or the panel's Close button changes it, never otherwise. The domain function `designPanelPreference(value: unknown): { open: boolean }` reads it.
- **While open**: the panel behaves exactly as spec 18 describes today, for selections and for creation tools (`Next {kind}`), with the same place, width, watermark rule and bottom row centring. Its header gains a ghost icon Button X labelled `Close design panel`, tooltip `Close`, which writes `{ open: false }`.
- **While closed**: the panel is never shown, whatever is selected and whatever tool is on.
- The style row keeps showing while the panel is open, so the toggle that closes it stays next to the selection.

### The tool tray

- **When.** While a creation tool is on (Prompt, Draw, Highlight, Line, Arrow, Note or a geo shape) and the Design panel preference is closed, whatever is still selected. It closes when the tool changes to one that is not a creation tool, and moves to the new button when it changes to another creation tool.
- **Where.** A `surface-glass` card with the kit border, `rounded-xl` and the small shadow, as spec 03's bar, centred above the active tool's button in the bottom toolbar with an 8 px gap, clamped 8 px inside the canvas. It never covers the watermark: it sits above the bottom bar, which already keeps clear of it. It carries `data-unframed-tool-tray`.
- **Contents.** The style controls of the tool's kind from the table above (the Prompt tool takes the Text row, a geo tool the Geo row), with the same looks and popovers.
- **What it writes.** The next-shape values spec 18 defines: held for the session, never written to a shape, given to each shape the tool creates. Font, align, dash and fill go to tldraw's next-shape styles, the rest through spec 18's next-shape design.
- **Pointer.** The tray takes its own pointer events and passes none to the canvas; drawing on the canvas does not close it, and the person can change the colour between strokes.

### Modules

| Module | Package | Change |
| --- | --- | --- |
| Style controls | domain | new: `styleControlsFor`, `ANNOTATION_SWATCHES`, `strokeWidthPreset` (the preset a width matches, or none), `designPanelPreference` |
| Style row | web | new: the controls and their popovers, shared by the selection toolbar and the tool tray, writing through the shape design functions spec 18 built |
| Selection toolbar | web | gains the style row and the Design panel toggle |
| Design panel | web | opens only from the preference; gains its Close button |
| Tool tray | web | new, anchored to the bottom toolbar's active tool |

The toolbar state function in the domain (`toolbar.ts`) is unchanged: the style row is decided from the selection's annotation shapes, beside it, not inside it.

### Rules this spec bends

00-index requires a spec that bends a shared rule to say so and why. This one bends the following, and the PR that builds it updates each passage so the earlier specs keep describing the app.

1. **Spec 18, The Design panel on the canvas, Where**: "It is hidden while nothing it edits is selected and no creation tool is on." It is also hidden whenever the `design.panel` preference is closed, which is the default. **When**: unchanged while open. Why: the person wants annotation styling inline by default, as FigJam and Miro do it, with the full panel as an option, as the Parameters panel is.
2. **Spec 18, The next shape**: values set with a tool on come from the tool tray while the panel is closed. What is stored and how it reaches the next shape is unchanged.
3. **Spec 02, Chrome**: "spec 18's Design panel takes its place, shown only while a drawing tool is on or the selection holds prompts or tldraw's drawings". It shows under that rule only while the person has it open; otherwise the style row and the tool tray carry the styling.
4. **Spec 03, Toolbar states**: the bar for a selection holding prompts or marks starts with the style row and the Design panel toggle. The rows of the table and the primary button rule are unchanged.
5. **Spec 18, Tasks 43 to 45**: their tests open the panel with the toggle first. What they assert about the panel is unchanged.

Not bent: spec 18's stored values (`meta.unframed.design`) and their ranges, the hosting contract (spec 01), and contract 7 (the watermark stays visible).

## Testing Decisions

A good test drives the domain seam or the browser seam and asserts on what they expose: return values, what a person sees, and the shapes the room then holds. No test reaches into React state or the controls' internals.

- **Domain seam**, table-driven Vitest cases named by the behaviour: `styleControlsFor` for each kind alone, each pair that matters (text and note, note and line, geo and drawing), an empty list and the canonical order; `strokeWidthPreset` for each preset and an off-preset width; `designPanelPreference` for a missing, unreadable, false and true value; `ANNOTATION_SWATCHES` holds twelve distinct valid hex colours that `designValueRefusal` accepts. Prior art: spec 18's `shapeDesignOf` and `designPatched` tables, and spec 09's canvas Parameters panel preference rules (task 65b).
- **Browser seam**, Playwright against the built client and an engine at the engine seam: the row's controls per selection, each control's write landing in the room and on screen, Mixed, undo, the toggle and its remembered state across a reload, the panel's Close, the tool tray's place, writes and closing. Prior art: spec 18's tasks 43 to 45 for the panel and spec 03's tasks 34 and 35 for the bar.
- No engine-seam test is new: the preferences store is spec 01's and already tested there.

## Tasks

1. `styleControlsFor` returns each kind's controls in the canonical order, the intersection for a mixed selection, and an empty list for none. Seam: domain
2. `strokeWidthPreset` maps 1, 2, 4 and 8 to their presets and any other width to none; `ANNOTATION_SWATCHES` holds twelve distinct hex colours that pass `designValueRefusal`. Seam: domain
3. `designPanelPreference` reads a missing or unreadable value as closed and keeps a saved one. Seam: domain
4. Selecting a sticky note shows the style row before the hint, Agent and Generate, with fill, font, size, bold, align, text colour and the Design panel toggle; the Design panel is not shown. Seam: browser
5. Selecting a prompt, a drawing, an arrow and a rectangle each shows its kind's controls; a note with a line shows only the toggle; a group alone shows no row; a note with a group shows the note's row. Seam: browser
6. A fill swatch on a sticky note writes its hex to `fillColor` in the room and on screen as one undo step; Default clears it; Cmd-Z restores the previous colour. Seam: browser
7. Fill None on a rectangle sets `fill` to none; a fill swatch sets it back to solid; stroke and text colour swatches write `strokeColor` and `textColor`; a typed hex in the custom field is written. Seam: browser
8. Stroke width presets and dash on a drawing write `strokeWidth` and `dash`; a width of 3 set in the panel shows `3` with no preset checked. Seam: browser
9. Font, size, bold and align on a prompt write as the panel writes them; size steps with the arrow keys and Shift; a refused size puts the field back. Seam: browser
10. Two notes with different colours and sizes show Mixed; a choice applies to both. Seam: browser
11. Esc in an open swatch popover closes it and keeps the selection; the row hides during a drag and a box selection and comes back after. Seam: browser
12. The style row is absent for a single artifact and while the composer is open, and back when the composer closes. Seam: browser (the `generating` bar has no row by construction; a held run marker cannot be staged at the browser seam, because the engine clears a marker with no live run)
13. The Design panel toggle opens the docked panel and reads as pressed; the panel shows for the next note selected; after a reload it is still open; its Close button closes it and the toggle reads as released after another reload. Seam: browser
14. With the Draw tool on and the panel closed, the tool tray shows above the Draw button with stroke, stroke width and dash; a colour picked there lands on the next drawing and on no existing shape; the tray stays open across two strokes. Seam: browser
15. The tool tray moves to the Note button when Note is picked, closes on Select, and is hidden while the Design panel is open, where the panel shows `Next drawing` as before. Seam: browser
16. Spec 18's tasks 43 to 45 pass with the panel opened through the toggle first. Seam: browser

## Out of Scope

- New style properties. The row and the tray carry a subset of spec 18's panel and add nothing it lacks: no letter spacing, no corner radius, no opacity, no shadows inline.
- A theme-aware named palette (tldraw's own colour names). Swatches write exact hex, as spec 18 decided for set colours.
- Per-project or per-shape memory of the panel state: the preference is one per person.
- Styling images, videos, audio, artifacts, groups or nodes from the row.
- Changing the Parameters panel, the artifact editor's Design tab, or spec 03's toolbar states for selections without annotation shapes.
- Floating or moving the Design panel. It stays docked as spec 18 places it.

## Further Notes

- The SlidersHorizontal icon now opens two panels: Parameters for an artifact and Design for prompts and marks. They never show in the same bar, because Parameters is offered only for one artifact selected alone and the style row never shows then.
- The swatch hex values are a design choice the person can tune later without a spec change, as long as there are twelve and each reads on both canvas schemes.
- The bar grows wider for annotation selections. If a long row ever crowds the canvas on a narrow window, the place to cut is the hint, not the actions.
