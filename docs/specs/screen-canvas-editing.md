# Screen canvas editing

## Problem Statement

A person can change a Screen's elements only in the Screen's editor tab, and only through the Design panel. On the canvas, where the person sees and arranges their Screens, there is no way to select an element inside a Screen, drag its padding, resize it, reorder it, retype its text or pick a colour token. The Design panel shows raw pixels where the code uses tokens, has no presets, no scrubbing, no token picker for colours, gaps or shadows, and no per-field discard. Structural edits (reorder, duplicate, delete, wrap, hide) do not exist.

## Solution

**Design mode** on the canvas. With the Select tool, a double-click on a selected Screen enters it: the Screen goes live and interactive for editing, and a click picks an element in the running page. Unframed draws the selection over the page: outline, corner handles, a size badge, padding bars, gap bars, a radius handle, and a live value chip while dragging, with values snapped to the project's tokens. Keyboard shortcuts reorder, duplicate, delete, wrap, hide and restyle text. A double-click on text edits it in place. The Design panel opens on the right of the canvas for the selected element, the same panel the editor tab shows, and it speaks tokens: steps instead of pixels, preset menus, a colour token picker grouped by meaning, label scrubbing, and a dot on each changed field that discards it.

Every change is a draft and previews at once on the live page. A drafts bar under the Screen counts them and offers the list, Show all, Compare, Discard all and Apply. Apply writes what it can mechanically and hands the rest to the Screen's agent, as today.

The behaviour below was recorded control by control in a reference tool and is the target. Screenshots are cited by file name from the catalogue the work was planned from; the implementer gets the folder path.

## User Stories

### Entering and leaving

1. As a person, I want to double-click a selected Screen to edit inside it, so that I can work on the page where I see it.
2. As a person, I want the editor tab to stay one click away on the Screen's toolbar ("Editor"), so that I still have the full-size view.
3. As a person, I want Escape to clear the element selection, and a click on the empty canvas to leave design mode, so that I always know how to get out.
4. As a person, I want the other Screens to stay as they are while I edit one, so that the board stays fast.

### Hover and selection

5. As a person, I want the element under the pointer outlined with a chip "<Name> <W>×<H>" just above its top-left corner, so that I know what a click will pick (`06-hover-sheet.png`).
6. As a person, I want text elements to show their lines underlined on hover, so that I see what text I would pick (`56-text-selected.png`).
7. As a person, I want the selection drawn as a 1px outline with four corner handles and a size badge "264.8 × 140" centred under it, and its parent outlined dashed, so that I see what I am editing and where it sits (`19-deeper-sheet.png`).
8. As a person, I want a double-click to go one level deeper, Cmd-click to pick the deepest element, Shift-click to add or remove, Enter to select the children and Shift+Enter the parent, so that I reach any element fast.
9. As a person, I want a right-click on an element to offer "Select layer" with the ancestor chain, each with its component and file:line, so that I can climb without guessing (`87-select-layer-submenu.png`).
10. As a person, I want several selected elements to share one union box with handles and a badge, so that I can change them together (`41-shift-two-full.png`).

### Handles

11. As a person, I want to drag the left, right, top or bottom edge of a selected element to set its width or height, and a corner to set both, with a live badge showing the value and its token ("256 · w-64"), so that I resize by hand and stay on the scale.
12. As a person, I want green padding bars in each padded side of a selected flex or grid container, which tint the padding and show its value on hover, and which set that side's padding when dragged one pixel per pixel with a chip "20 · pl-5", so that I can adjust spacing directly (`48-pad-sheet.png`).
13. As a person, I want purple gap bars between the children of a selected flex or grid container, which hatch every gap on hover and set the gap when dragged (one pixel of pointer moves the gap two pixels, chip "28 · gap-7"), so that I can adjust the gap directly (`26-gap-sheet.png`).
14. As a person, I want a small circle near a corner of a selected non-text element, shown when the pointer is near that corner, which sets the corner radius when dragged, with a chip "Radius 28", so that I can round corners by hand (`55-radius-sheet.png`).
15. As a person, I want to drag a selected element inside its flex parent to reorder it, with the siblings reflowing live, so that I can change order by hand (`51-reorder-sheet.png`).
16. As a person, I want cursors that tell me what each zone does (ew/ns/nwse resize, default inside), so that the handles are discoverable.
17. As a person, I want to hold Alt to see the distance from the selection to the hovered element as a red line and chip, so that I can check spacing (`82-alt-sheet.png`).

### Keyboard

18. As a person, with an element selected I want: Delete to delete it, Cmd+D to duplicate it right after itself, Cmd+Shift+H to hide it, Cmd+G or Cmd+Alt+G or Shift+A to wrap it in a new flex column, Cmd+] and Cmd+[ and the main-axis arrows in a flex row to move it after or before its sibling, digits 1 to 0 for opacity 10% to 100%, and Cmd+Z / Cmd+Shift+Z to undo and redo each draft step, so that structure is as quick as style.
19. As a person, with text selected I want Cmd+B, Cmd+I, Cmd+U, Cmd+Shift+X, Cmd+Shift+. and Cmd+Shift+, and Cmd+Alt+T (centre), so that common text styling needs no panel.
20. As a person, I want none of these keys to reach the canvas while I am in design mode, so that Delete never deletes the Screen.

### Text

21. As a person, I want to double-click a word in a selected text element to edit the text in place with the word selected, type, and press Escape to commit it as a draft, so that copy changes are direct (`71-text-sheet.png`).

### Inspector

22. As a person, I want the panel header to show the element's name and kind, and for a component "◆ Button · 373 instances" with "Go to main component" and "Code: AgentRail.tsx:219" which opens a code peek of the lines, so that I see it as the code does (`42-button-panel.png`, `84-code-from-button-crop.png`).
23. As a person, I want a value bound to a token to show the token step ("gap 1", "size-7", "2xl", "sm") and a raw value to show pixels, with the aria-label carrying both, so that the panel speaks the project's language.
24. As a person, I want a dot beside every changed field that discards that change when clicked, so that I can undo one field without the list.
25. As a person, I want number fields to step with ArrowUp/Down (Shift for 10), commit on Enter or blur, and scrub when I drag their label or icon, so that tuning is fast (`62-scrub-after.png`).
26. As a person, I want Typography: a text-style chip, a font picker grouped "In this project" and "System" with each row in its font, a weight picker with Styles and Italic groups, a size field with presets from the project's type scale, line height and letter spacing with presets and scrubbing, text align, and a Type settings popover (decoration, case, wrap style, number spacing), so that text is fully editable (`57-typo-menus.png`, `63-type-settings-crop.png`).
27. As a person, I want a colour token picker for text, fill, stroke and selection colours with Tokens and Custom tabs, search by name, hex or class, groups Current (with its alias chain), On this page, Text, Surfaces, Borders, Palettes and More (one group per component prefix with counts), and a custom picker with hue, alpha, eyedropper and a hint naming a token with the same value, so that I pick colours the project already has (`65-colour-tokens-crop.png`, `66-colour-custom-crop.png`).
28. As a person, I want Padding in linked (horizontal, vertical) and individual modes, Border and radius (stroke rows with position, style, weight and sides; radius with token and individual corners), Shadow (token presets grouped Most used / Shadows / Other, Add effect: drop shadow, inner shadow, layer blur, background blur), Size (W/H with Fixed / Hug / Fill / min / max / size tokens, lock aspect ratio, a Resizing group for text), Position (X, Y, rotation, "position: absolute where it is"), Flexbox (Row / Column / Grid, Wrap, a 3×3 alignment grid, gap with presets "Semantic" and "Scale", Clip content, and "Use flexbox" for a block), Appearance (opacity, blend mode, hide), so that every common property has a control (`74-align-grid.png`, `74-gap-presets.png`, `76-width-sizing-menu.png`, `78-shadow-sheet.png`).
29. As a person, I want a component instance's props as controls: dropdowns for variants with every option the `cva` call declares, switches for booleans, read-only code for expressions, so that I change a variant as the code does (`43-dd-size.png`).

### Drafts

30. As a person, I want a drafts bar under the Screen with "✎ N ⌄" (the list, each row "N · Layer · “text” / Gap 4 → 28 gap-7", hover discard, click selects the element), Show all (a numbered pin on each changed element), Compare (a swipe divider: code on one side, my edits on the other), Discard all (Cmd+Z brings them back), and Apply, so that I control what gets written (`28-drafts-menu-crop.png`, `29-show-all.png`, `30-swipe-on.png`).
31. As a person, I want Apply to write and check the drafts as it does in the editor tab today, and the structural changes it cannot write to go to the Screen's agent with exact instructions, so that every change ends the same way.

### Flag

32. As a person on a build without Repositories, I want none of this to show.

## Implementation Decisions

### Where it lives

- Design mode is canvas state per project: `{ screen: shapeId, selection: string[] }`. The Screen in design mode is held live (`hold` tier event) and its pooled frame is interactive for editing (bridge in edit mode), as the editor tab's frame is.
- The canvas reuses the editor's `useEditSession` with `target: "screen"`: one session per design-mode Screen, owned by the canvas, so the overlay, the drafts and the Design panel on the canvas and in the editor tab work the same way. The canvas Design panel for a Screen is `DesignTab` mounted in a right-side panel of the canvas.
- The overlay is drawn by the canvas in screen space over the pooled frame (constant-size chips and handles at any zoom), from element boxes the bridge reports, mapped through the Screen's page transform. Handles take pointer events; everything else falls through to the page, where the bridge reports hover, picks and interior drags.
- The bridge gains: children boxes and computed `display`, `flex-direction`, `gap`, `padding-*`, `border-*-radius` for the selection; text line rects for hover underline; hit at point; pointer gesture reports for interior drags; structural previews (move after/before sibling, duplicate, remove, wrap in a flex column, hide), each reversible.
- Double-click on a selected Screen enters design mode instead of opening the editor tab; the toolbar's Editor button opens the tab. Tests that double-click to open the editor change to the toolbar.

### Tokens

- A **token scale** per project, built by the engine (`screens.tokens`, cached per worktree and branch revision): the Tailwind default scales already in `tailwind.ts`, overridden and extended by the project's `@theme` variables and CSS custom properties (read from the worktree's CSS, and from `.unframed/analysis/design-system.json` when present), grouped as the colour picker and the presets need: colour groups (Text, Surfaces, Borders, Palettes, per-component prefixes with counts), spacing (Scale and Semantic), sizes, radii, font sizes with line heights, font families, weights, shadows with layer and blur counts, and alias chains (`--button-ghost-foreground → --text-default → --color-zinc-800`).
- Pure domain functions on that scale: `snapToken(scale, property, px)` returns the nearest step for a drag ("20 · pl-5"), `tokenOf(scale, property, value)` names the token a computed value is bound to, `tokenLabel` gives the step shown in a field ("1", "size-7", "2xl"), and `changeLine` formats a draft line ("Padding left 8 → 20 pl-5", "Gap 4 → 28 gap-7", "Padding 0 · 8 · 0 · 20 → 4 · 13 · 4 · 13").
- Drags and preset picks record a token; typed values record raw, as the reference does; Apply maps either to a class through the existing `classFor`.

### Gestures (pure, tested in the domain)

- Padding drag: one pixel of pointer is one pixel of padding, clamped at zero. Gap drag: one pixel is two pixels of gap. Edge resize: the dragged edge follows the pointer; corner sets both. Radius: the distance moved inward along the diagonal sets the radius, clamped to half the shorter side. Reorder: the target index is the sibling slot whose midpoint the pointer passed on the parent's main axis. Opacity digits: 1 → 10%, 0 → 100%.
- Zones on a selected element: edge bands and corners resize; padding bars only on flex or grid containers and only on sides with padding of 4px or more; gap bars between children of flex or grid containers; the radius circle within 28px of a corner on a non-text element at least 24px on its shorter side.

### Drafts and Apply

- New draft kinds next to style, class, text and attr: `reorder {from, to}`, `duplicate`, `delete`, `wrap`, `hide`, `props {name: value}`. Each previews through the bridge and undoes in order.
- The writer (`@unframed/domain/jsx`) gains mechanical edits where the JSX allows: reorder of sibling JSX elements in one static children list, duplicate and delete of a JSX element, a prop literal change at a callsite, `hidden` as a class. Anything else (a mapped list, a computed child, an element not self-mapped) goes to the agent with the same message format as today, plus the before and after order for a reorder.

### Visuals and tokens

- Use only existing design tokens. Where the overlay needs a colour, size or radius with no component token yet, keep the nearest existing selection or overlay token and list the need in the PR; new tokens are added in Figma first and exported, never written into `tokens.css` by hand.

## Testing Decisions

- Domain seam (Vitest): token scale parsing (`@theme`, custom properties, aliases, groups), `snapToken`, `tokenOf`, `tokenLabel`, `changeLine`, gesture math, selection rules (deeper, deepest, parent, children), writer cases for reorder, duplicate, delete and props.
- Engine seam: `screens.tokens` on a fake repository with a Tailwind v4 `@theme` and custom properties; Apply of a reorder and of a variant change into the worktree, and their revert.
- Browser seam (Playwright, `repositories` on): enter design mode by double-click; hover chip text; selection badge; Escape and click outside; padding drag writes a draft "Padding left … pl-…" and the live page shows it; gap drag; edge resize; radius; reorder; each keyboard command; inline text edit committed by Escape; Design panel token display, per-field discard dot, scrub, colour token pick; drafts bar list, Show all pins, Compare, Discard all and Cmd+Z; Apply of a padding draft takes; Delete never deletes the Screen; the flag off shows none of it.

## Out of Scope

- Free movement of absolutely positioned elements, layer trees, extract component, explode states, comments on elements, multi-Screen edits.

## Tasks

Three tracks. Track A first defines its exported types and function signatures in one commit so B and C can build against them.

### Track A: core (domain, engine, writer)
1. [x] Token scale types and `screens.tokens` contract; domain parse of `@theme` and custom properties with aliases and groups; engine reads the worktree and caches it.
2. [x] `snapToken`, `tokenOf`, `tokenLabel`, `changeLine`; gesture math; selection rules.
3. [x] New draft kinds and their lines and agent instructions.
4. [x] Writer: reorder, duplicate, delete, prop literal, hidden; engine Apply and revert for them.

### Track B: canvas surface (web, bridge)
1. Design mode state, entry by double-click, exit rules, holding the Screen live; the toolbar Editor button for the tab.
2. Bridge reports for geometry, hit, text lines and gestures; structural previews.
3. Overlay: hover chip and outline, selection outline, corner handles, size badge, parent dashed outline, multi-selection union.
4. Handles: edge and corner resize, padding bars, gap bars, radius circle, reorder, Alt distances, cursors, live chips with tokens.
5. Keyboard map and Delete guard; inline text editing; context menu with Select layer.
6. Drafts bar on the canvas: list, Show all pins, Compare swipe, Discard all with undo, Apply.
7. The canvas Design panel hosting `DesignTab` for the session.

### Track C: inspector (web)
1. Token-first field display, per-field discard dot, label scrubbing, arrow stepping.
2. Typography with presets, font and weight pickers, Type settings popover.
3. Colour token picker (Tokens, Custom) for text, fill, stroke.
4. Padding linked and individual, Border and radius, Shadow and effects, Size menu, Position, Flexbox with 3×3 grid and gap presets, Appearance.
5. Header with component, instances, Go to main component and code peek; instance props with `cva` options.
