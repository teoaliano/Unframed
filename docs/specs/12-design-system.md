# 12 · Design system

Depends on: 00-index, 01 to 11

## Problem Statement

Unframed looks like eleven apps stitched together, because it was built by eleven separate spec runs. Colours are consistent, since they all come from one set of CSS variables. Everything else drifts: nine font sizes (including 11.5, 12.5, 13.5 and 15.5 px), eleven border radii, forty files with hand-styled `<button>` elements, twelve feature stylesheets, and no shared Button, Menu, Dialog, Field or Chip. tldraw's own toolbar, style panel, zoom controls and context menu keep tldraw's default look, which matches nothing else on screen. The font stack names Figtree, which is never loaded, so the system fallback shows by accident.

A person sees buttons of different heights side by side, menus with different row sizes, dialogs with different paddings, and two visual languages on one screen (tldraw's and Unframed's).

## Solution

Unframed adopts t3code's design system whole: its default light and dark tokens, its fonts, its type, radius and spacing scale, and its Base UI component kit, copied from `.reference/t3code/` (MIT). Every Unframed surface is rebuilt on that kit. App code picks a component and a variant and never styles a control itself. tldraw's own UI is themed through tldraw's CSS variables so it reads as part of the same app. The layout stays: where each surface sits, how wide it is, what it contains and how it moves are unchanged unless this spec says otherwise.

After this spec, one button is one component with a handful of variants, one menu looks the same wherever it opens, and a lint rule stops the next spec from hand-styling a control again.

## User Stories

1. As a person, I want every button in the app to share one set of heights, radii and hover and press states, so that the app feels like one product.
2. As a person, I want every menu (project menu, add menu, prop menus, stash menu, plan menu, table actions, rail More menu) to have the same popup, row height, highlight and separator, so that I learn one menu once.
3. As a person, I want every dialog (settings, library, model picker, final prompt, project name, confirm deletes, import report, add to library) to share one frame, header, footer and backdrop, so that dialogs read as one family.
4. As a person, I want every text field, select and combobox to share one frame and one focus ring, so that I can see where I am typing.
5. As a person, I want tooltips to look the same everywhere, including over tldraw's toolbar, so that hover help is predictable.
6. As a person, I want toasts in the same style as the rest of the app, so that a notice looks like it belongs.
7. As a person, I want tldraw's toolbar, style panel, zoom controls, quick actions, shortcuts dialog and link dialog to use the app's colours, font, radii and shadows, so that the canvas tools do not look like a different program.
8. As a person, I want the context menu to look like every other menu, with its section headings and a disabled item that is visibly disabled, so that right-click matches the rest of the app.
9. As a person, I want the tldraw watermark left visible and uncovered, so that the licence terms are met.
10. As a person, I want light and dark to follow my system as before, with every surface switching together, so that nothing stays light in dark mode by mistake.
11. As a person, I want the canvas background, dot grid and selection line in the new palette, so that the board matches the chrome around it.
12. As a person, I want the selection line and grips in the app's highlight colour, so that selection is as visible as before.
13. As a person, I want group frames, their name field and their recipe chip in the new palette and radius scale, so that groups match the kit.
14. As a person, I want shape labels, prompt hints and the media empty state, Remove button and video transport in the new type and colour, so that canvas shapes read with the same voice as the chrome.
15. As a person, I want placeholders and render progress in the new style, so that a running job looks like the rest of the app.
16. As a person, I want empty and filled page and motion cards in the new style, with the filled frame's white page unchanged, so that artifacts look finished.
17. As a person, I want the role badges and the tether line in the new palette, so that input roles stay readable.
18. As a person, I want the selection toolbar's Generate, Agent, Open, Recipe and result buttons built from the kit's button variants, so that the bar's primary action stands out the same way a dialog's does.
19. As a person, I want the composer to look like t3code's composer (its rounded shell, soft shadow and send button), so that typing an instruction feels like typing a chat message.
20. As a person, I want the medium switch to be the kit's segmented toggle, so that image, video and text read as one choice.
21. As a person, I want model, prop and Runs chips built on one chip style, so that the tray reads as one row.
22. As a person, I want the Runs popup, the share-consent line and the status lines in the kit's field, checkbox and alert styles, so that they match settings.
23. As a person, I want the model dialog's table, sort controls and provider tokens in the kit style, with each provider keeping its own hue, so that I can still tell providers apart.
24. As a person, I want the final prompt dialog's sections and warnings in the kit style, so that Free batches are easy to review.
25. As a person, I want the library's search, sort select, view toggles, cards, rows, chips and pagination in the kit style, with each kind keeping its hue, so that the library is scannable.
26. As a person, I want the chat rail to look like t3code's chat panel: its header, tabs, thread search and empty states, so that the agent surface matches the tool it is modelled on.
27. As a person, I want rail tabs styled as t3code's panel tabs, keeping their live dot, rename and More menu, so that the tab strip matches the kit.
28. As a person, I want my messages as t3code's message bubbles and the agent's replies in t3code's markdown typography, so that reading a chat is comfortable.
29. As a person, I want the work log, tool rows, reasoning, "Worked for", retry and limit lines styled as t3code's timeline rows, so that the agent's work reads the same way it does in t3code.
30. As a person, I want queued messages, the "Scroll to end" pill, plan cards and recap cards in the kit style, so that the transcript has one look.
31. As a person, I want the Agent tray's editor, chips, attachment shelf, slash and mention menus, stash menu and pickers in the kit style, so that the agent composer matches the Generate composer.
32. As a person, I want approval and question panels styled as t3code's pending approval and question panels, so that a decision the agent waits on is obvious.
33. As a person, I want the context meter ring, plan toggle and runtime select in the kit style, so that the composer footer is tidy.
34. As a person, I want the diff panel to look like t3code's diff panel, with the same diff colours, so that reviewing changes feels familiar.
35. As a person, I want the artifact editor's columns, header buttons, render row and "Add a parameter" box in the kit style, so that editing an artifact matches the rest of the app.
36. As a person, I want the dials panel's colours to follow the app's scheme in its tokens, so that the editor's right column and the canvas panel read as one card.
37. As a person, I want the settings dialog's key section, model selects, output folder field, Browse button, local agents section and banners in the kit style, so that settings read clearly.
38. As a person, I want the OpenRouter callback page in the browser tab to use the app's dark tokens, so that returning from OpenRouter looks like Unframed.
39. As a person, I want the legacy import screens and the import report dialog in the kit style, so that a first import looks deliberate.
40. As a person, I want confirm dialogs for deleting a chat, editing from here, deleting a project, stopping renders and deleting a preset to share the kit's alert dialog, so that destructive steps always look the same.
41. As a person, I want disabled controls to look disabled the same way everywhere, so that I never click something that cannot work.
42. As a person using the keyboard, I want one visible focus ring on every control, so that I always know where focus is.
43. As a person, I want icons at one size per control size, so that toolbars do not look ragged.
44. As a person, I want the app's text in my system font, as t3code uses, so that type is crisp and nothing depends on a font that never loads.
45. As a person, I want panning, zooming and dragging to stay as smooth as before, so that the new look never costs frames.
46. As a person on the desktop app, I want the shell's hooks to keep working (the two chrome cards, the theme attribute, the secondary text variable, the opaque body background), so that the installed app still places its controls correctly.
47. As a maintainer, I want the kit copied with t3code's own component names, variants and `data-slot` attributes, so that pulling a later t3code change is a small diff.
48. As a maintainer, I want app code to choose variants and never restyle a kit component, enforced by a lint rule next to typecheck, so that the look cannot drift again.
49. As a maintainer, I want no raw colours in app code, enforced by the same lint, so that every colour comes from a token.
50. As a maintainer, I want the twelve feature stylesheets gone, so that a surface's look lives in the kit and its variants, not in a file per feature.
51. As a maintainer, I want test hooks on data attributes and roles instead of styling classes, so that a restyle never breaks a behaviour test.
52. As a maintainer, I want the specs that describe old colours, sizes and shapes updated in the same change, so that the specs stay the description of the app.
53. As a maintainer, I want t3code's copyright and licence carried in the third-party notices for every copied file, so that the copy is legal.
54. As a maintainer, I want the frame budgets from specs 02 and 09 re-measured in the hosted shape after the restyle, so that a glass effect that costs frames is caught before it ships.

## Implementation Decisions

### What changes and what stays

- This spec changes colour, type, font, radius, spacing, borders, shadows, blur, focus rings, icon sizes, and which component renders each control.
- It keeps layout and behaviour: where each surface sits, its width and height where a spec states one (the composer's 420 px, the rail's 380 px, the context menu's 188 px, the model dialog's 680 px, the final prompt dialog's 640 px, the settings dialog's 480 px, the editor's 360 / flexible / 320 grid), what it contains, its keyboard behaviour, and its motion timings. Where this spec names a replacement (the rail tabs), the replacement is the rule.
- Canvas content keeps tldraw's shape fonts. A prompt's text, a note, a geo label are document content: changing their font would reflow every existing board. Only tldraw's UI chrome takes the kit's font.
- The white page of a filled page artifact stays white in both schemes (spec 09).
- DialKit follows the app's scheme (spec 09); its colours come from the tokens.

### Modules

**Theme** (the token stylesheet). A deep module whose interface is the token names and the dark switch. Copied from t3code's global stylesheet, default theme only:

- The semantic tokens with t3code's light and dark values: `--background`, `--foreground`, `--card`, `--popover` and their foregrounds, `--primary`, `--secondary`, `--muted`, `--muted-foreground`, `--accent`, `--border`, `--input`, `--ring`, `--error`/`--destructive`, `--info`, `--success`, `--warning` and their foregrounds and surfaces, the `--contrast-*` twins, and the geometry tokens (`--radius` 0.625rem, `--control-radius` 0.5rem, glass blur, opacity and saturation, scrollbar width).
- The `@theme` and `@theme inline` blocks that turn tokens into Tailwind utilities, including the radius scale (`sm` to `3xl` off `--radius`), the extra text sizes `2xs` to `5xs`, `--ease-drawer`, `--shadow-composer`, and the `skeleton` and `status-*` animations.
- t3code's custom utilities: `surface-glass`, `dropdown-glass`, `dialog-glass`, `dialog-backdrop`, `alert-glass`, the scroll fades, `live-tool-shine`, and the `.chat-markdown` prose rules.
- t3code's base rules: border and outline defaults, popup focus outlines, `pre` and `code` in the mono stack, the thin scrollbar.
- Fonts are t3code's system stacks (`-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif` and the `ui-monospace` stack). Figtree is removed from the font stack.
- Not copied: named themes (`data-theme-id` and the `--app-theme-*` mapping), the contrast and appearance settings, `data-chat-width`, the sidebar-scoped palette, terminal and workspace-topbar tokens, and the body grain image.

Unframed-specific rules on top:

- **Dark switch.** `data-unframed-theme` on `<html>` stays the one source of truth (spec 01 contract). The stylesheet's `dark` custom variant keys on `[data-unframed-theme="dark"]` instead of t3code's `.dark` class, so the copied `dark:` utilities and nested `@variant dark` blocks work unchanged. `theme.ts` keeps writing the attribute as it does today.
- **Canvas background.** The canvas, the dot grid's base and the body background are `--background`. The body stays opaque and equal to the canvas (spec 01), so it does not use t3code's `--app-chrome-background`.
- **Shell variable.** `--unframed-text-secondary` stays, defined as the resolved `--muted-foreground` of the current scheme, readable with `getComputedStyle` (spec 01 contract). Its values change with the palette. The kit's tokens are oklch and `color-mix`, which a native colour call in the shell may not parse, so `theme.ts` writes the variable as hex and the body background as a hex that computes to `rgb()`, the formats the shell has read since spec 01, in the same frame as the theme attribute.
- **Unframed's palette over t3code's.** Two changes to t3code's defaults, at the person's request. `--primary` is neutral: `neutral-900` on light and `neutral-50` on dark, with `white` and `neutral-950` as its foreground, so primary Buttons, the send action, switches and tldraw's active tool are near black or near white, not blue. `--highlight` (with `--highlight-foreground`) is `sky-300` on dark and `sky-600` on light, where `sky-300` would not read: the focus ring (`--ring`), link Buttons and chat links, the canvas selection line, a selected group's frame and the group fill, live and ready dots, progress fills, the context meter, `@` references in menus, selected checks and the video slider. Status colours (info, success, warning, error) keep t3code's values.
- **Unframed-only tokens.** Values t3code has no token for keep a token of their own, defined from t3code tokens or Tailwind palette colours, never from raw hex in app code: the dot grid dot colour (a `color-mix` of `--foreground` and `--background`), the selection line (`--highlight`) and grip fill (`--card`), the group frame fill (a mix of `--primary` into `--background`), and the category hues below.
- **Category hues.** The library's kind chips (recipe purple, group blue, image teal, video orange, text cyan, custom green, system pink), the model dialog's eleven provider hues and the composer's role badges keep their hue-per-category rule. Each renders as the kit's Badge `label` variant, which tints from a `--label` colour; `--label` comes from the matching Tailwind palette colour. The old `--unframed-hue-*` tokens are removed.
- **Removed.** Every other `--unframed-*` token is removed. The old theme values in `assets/theme/` stop being the visual reference, and so do the old-app screenshots in `assets/screenshots/`. Both stay in the repo as history.

**UI kit.** t3code's shared UI components, copied into one module of the web package with their names, variants, sizes and `data-slot` attributes kept. Its interface is each component plus its variant and size props; a caller never passes styling classes to change a kit component's look (it may pass layout classes: margin, width, flex placement). Copied components:

- Button (all variants and sizes; icon buttons are Button with an icon size), InlineButton, Badge, Kbd, Label, Separator, Spinner, Skeleton, Empty, Alert.
- Input, Textarea, InputGroup, NumberField, Checkbox, RadioGroup, Switch, Select, Combobox, Autocomplete, Toggle, ToggleGroup, Group.
- Menu (with checkbox, radio, sub menu and shortcut parts), Popover, Tooltip, PreviewCard, Dialog, AlertDialog, Sheet, Command, ScrollArea, Collapsible, Table, Toast.
- The `cn` helper (tailwind-merge extended with the extra text sizes plus class-variance-authority), exactly as t3code builds it.

Copy rules:

- Copy the files as they are. Change only what an Unframed contract forces, and mark each change with a one-line comment naming the contract, so a later t3code update is a mechanical merge.
- Unframed runs `@base-ui/react` 1.8.0; t3code pins 1.5.0. Where a copied component uses an API that changed between them, adapt it to 1.8.0 and note it in the same one-line way.
- Add `class-variance-authority` and `tailwind-merge` at t3code's versions.
- Components t3code does not have (a slider, tabs) are not invented as kit components. The rail tabs follow t3code's panel tab look (its right panel tabs), built from kit parts in the rail's own module. The artifact editor's dials stay DialKit.
- t3code's feature-level looks (the composer surface, message bubbles, timeline rows, approval and question panels, the diff panel shell) are copied as the class recipes of the matching Unframed surfaces, not as new kit components, because they are feature modules in t3code too.

**tldraw theme adapter.** A stylesheet that maps tldraw's theme variables onto the kit's tokens, for both `.tl-theme__light` and `.tl-theme__dark`:

- `--tl-color-background` to `--background`; `--tl-color-panel` and `--tl-color-panel-contrast` to `--popover`; `--tl-color-text`, `--tl-color-text-0`, `-1`, `-3` and `--tl-color-text-disabled` to `--foreground` and its muted steps; `--tl-color-low` and `--tl-color-low-border` to `--muted` and `--border`; `--tl-color-muted-*` to `--accent` steps; `--tl-color-divider` to `--border`; `--tl-color-primary`, `--tl-color-selected` and `--tl-color-focus` to `--primary`; `--tl-color-selection-stroke` and `--tl-color-selection-fill` to `--highlight` and a `--highlight` mix; `--tl-color-tooltip` to the kit tooltip's colours; `--tl-color-danger`, `-warning`, `-success`, `-info` to the kit's status tokens.
- `--tl-radius-0` to `-4` onto the kit's radius scale; `--tl-shadow-1` to `-4` onto the kit's popup shadows.
- `--tl-font-sans` for tldraw's UI chrome (not for shape content) to the kit's sans stack.
- tldraw's menu rows, toolbar buttons and panel paddings get the kit's row height, radius and highlight through tldraw's own class names, in this one stylesheet only.
- tldraw's UI icons (tools, menus, zoom and quick actions) are Lucide's, the kit's icon set, passed through tldraw's icon asset URLs. The style panel's fill, dash, size, font and arrowhead swatches, which Lucide has no match for, keep tldraw's icons.
- The watermark is never targeted: no rule changes its visibility, opacity, position or size, and no kit surface is placed over it (index contract 7).
- The context menu keeps spec 02's structure and width; its headings and the greyed "Add to library" row use the kit's menu label and disabled styles.

**Third-party adapters.** Each lives in the theme module's stylesheet, beside the tldraw adapter:

- `@pierre/diffs`: t3code's diff colours (`--diff-addition`, `--diff-deletion`) and its injected diff CSS, copied.
- DialKit: its CSS variables set from the kit's tokens, its theme following the scheme.
- Tiptap editors (the instruction box, the agent prompt): t3code's composer editor classes.
- react-markdown: t3code's `.chat-markdown` rules.
- lucide icons: sized by the kit (Button and menu items size their `svg` children), not by a `size` prop in app code.

### Surfaces

Every surface moves onto the kit. The mapping, by surface:

- **Chrome corners, project menu, add menu, library button:** Button (`ghost` and icon sizes), Menu, Tooltip; the two corner cards use `surface-glass` with the kit border and radius; Library and Add sit in the bottom bar as tldraw toolbar buttons (spec 02). The `.unframed-chrome-left` and `.unframed-chrome-right` classes stay (spec 01).
- **Project name dialog and project delete confirms:** Dialog with Input and Label; AlertDialog with `destructive` Button.
- **Toasts:** the kit Toast (Base UI Toast) with t3code's look. Position stays bottom-left as spec 02 has it.
- **Connection notice:** a sticky kit Toast, as today.
- **Canvas shapes and overlays:** shape labels in `text-2xs` with the muted foreground, not uppercase; the prompt hint, empty media, Remove button (Button `icon-micro` on `--popover`), video transport, render placeholder and progress, group frame and name field (Input `unstyled` inside the frame), recipe chip (Badge), artifact cards, role badges (Badge `label`), tether (`--border` stroke), mention menu (the kit menu popup and row look). Canvas shape internals may keep a small canvas stylesheet for rules that target tldraw-rendered DOM (the label-level rules), using tokens only.
- **Selection toolbar and recipe bar:** a `surface-glass` bar; Generate and Agent are Button `default`, the other actions `ghost` or `outline`; the hint uses `text-muted-foreground`.
- **Generate composer:** t3code's composer shell look (rounded shell, `shadow-composer`, glass surface) at the existing 420 px; the medium switch is ToggleGroup `segmented`; the send button uses t3code's message-action button in its labelled pill form, since the Generate send carries its label (the Agent tray uses the round form); status lines are Alert or muted text; the recipe line is InlineButton.
- **Prop tray, Runs chip, share consent:** model and prop chips are one chip recipe built from Button `outline` at `compact` size; value menus are Menu with radio items; the Runs popup is Popover with NumberField and Checkbox; the share consent is Checkbox with Label.
- **Model dialog:** Dialog with the kit Table, Select for sort, Input for search, provider tokens as Badge `label`.
- **Final prompt dialog:** Dialog with Textarea and Alert for warnings.
- **Library and add to library:** Dialog, Input, Select, ToggleGroup, cards and rows on `--card` with the kit border and radius, kind chips as Badge `label`, pagination as Button `ghost`, preset delete as AlertDialog.
- **Chat rail:** the rail on `--background` with a `border-l`, header actions as Button icon sizes, tabs in t3code's panel tab style (the folder-tab shape is dropped), thread search as Input with the kit list rows, the no-provider state as Empty with Alert.
- **Transcript:** user messages as t3code's message bubble, replies in `.chat-markdown`, the work log and tool rows as t3code's timeline rows (icon slot, muted heading, rotating chevron, expanded `bg-muted/40` body), reasoning and retry lines as muted text, the queued bubble as the message bubble with a dashed border and dimmed text, "Scroll to end" as the kit's `glass` Button (t3code's pill there), plan and recap cards on `--card`.
- **Agent tray:** the same composer shell as the Generate composer; chips as Badge; the attachment shelf as t3code's attachment chips; slash, mention and skill menus with the kit menu look; stash and plan menus as Menu; pickers as Popover and Select with t3code's picker rows; the access and plan modes in t3code's compact More menu (kit Menu radio items); the context meter ring in `--highlight`, turning `--error` above 90%.
- **Approval and question panels:** t3code's pending approval panel and question panel looks, with its action Buttons (`default` to accept, `outline` for the rest).
- **Diff panel:** t3code's diff panel shell (header, toolbar icon sizes, file list) around `@pierre/diffs`.
- **Artifact editor:** the three columns on `--card` with the kit border; header actions as Button icon sizes; the render row as the kit's progress look with Spinner; the empty-state Agent button as Button `default`.
- **Settings dialog:** Dialog with Label, Input, Combobox for the model selects, Select, Button variants, Alert banners, and Switch where a setting is on/off. The current project in the project menu is the kit's checked radio item, whose tint marks it.
- **OpenRouter callback page:** the engine's HTML page uses the kit's dark `--background` and `--foreground` values and the system sans stack, inlined, since it is served outside the web build.
- **Legacy import screens and report:** Empty with Spinner for importing, Alert with a Button for the failure, Dialog for the report.
- **Agent confirm dialogs:** AlertDialog with `destructive` Button.

### Lint

- t3code's `@shadcn/lint` rules (`no-restyle`, `no-raw-colors`, `no-unknown-classes`, `require-static-classes`) run on the web package as part of `pnpm typecheck`, so CI fails on a violation.
- The kit module and the theme module are exempt from `no-raw-colors` (they define the tokens). The spec 01 contract classes are allow-listed for `no-unknown-classes`.
- A raw `<button>`, `<input>` or `<select>` outside the kit is a lint error, except inside shapes where tldraw requires a native element (for example the video transport's range input), each with a one-line reason.

### Test hooks

- Test hooks move to roles, accessible names, `data-testid` and `data-*` attributes. A styling class is never a test hook, except the spec 01 contract classes.
- Existing tests that select by an `.unframed-*` styling class switch to a role, name or `data-testid` in the same task that restyles the surface; where no hook exists, the task adds a `data-testid`.
- tldraw's own class names in tests (`.tlui-style-panel`, `.tlui-navigation-panel`, `.tl-watermark_SEE-LICENSE`, `.tl-theme__dark` and the rest) stay; they are tldraw's, not ours.

### Performance

- Glass (backdrop blur) is allowed on surfaces over the canvas only while spec 02's and spec 09's frame budgets hold in the hosted shape. The corner cards already blur at 20 px within budget; the composer, selection toolbar and rail are measured after they move to glass.
- The budgets are measured with `pnpm test:perf` on real hardware, where their frame-gap thresholds are enforced (spec 02's performance budget); a shared CI runner only reports them.
- If a surface pushes a budget over, that surface uses its solid token fill (`--popover` or `--card`) instead of glass. The budget decides, not the look. Measured after the restyle: the selection toolbar and the Generate composer hold the pan budget on glass; the rail on glass reached 2.27 % of frames over 33 ms in one of three runs, so it is on solid `--background`.

### Licensing

- t3code is MIT, "Copyright (c) 2026 T3 Tools Inc." `THIRD_PARTY_NOTICES` carries that line and the MIT notice for the copied kit, theme rules and feature recipes.
- t3code's component registry file lists outside sources (`@coss`, `@spell`) that some kit files may come from. Before copying a kit file, confirm its origin's licence; record each outside source in `THIRD_PARTY_NOTICES`. A file whose licence is not MIT-compatible is not copied; its Unframed equivalent is written from Base UI directly with the same variant names.

### Spec text

Each task updates the spec passages for the surface it restyles, in the same commit, so the specs describe the app as built. The passages that name an old colour, radius, font, size scale or shape look:

- 00 index: the Stack table's UI row names t3code's UI kit and tokens; the Reference material list says `assets/theme/` and `assets/screenshots/` are history, not the visual reference; this spec is added to the build order.
- 02: the chrome cards, prompt label, media Remove button, group frame, context menu headings, dot grid colour, selection line colour, theme section and assets section.
- 03: the selection toolbar buttons, composer bands and send button, model dialog tokens, tether colour.
- 06: the recipe chip and library chips (hues stay, rendering changes).
- 08: the rail surface, tabs (panel tabs replace the folder shape), context meter, queued bubble and markdown.
- 09: artifact card borders, the editor columns, the render row, DialKit colours.
- 10: the callback page colours and the settings dialog look.
- `assets/theme/README.md`: a first line saying spec 12 replaced these values.

## Testing Decisions

- Every task is tested at the browser seam: Playwright driving the built web served by an engine at the engine seam, in both colour schemes. The one exception is the OpenRouter callback page, served by the engine as HTML, which is tested at the engine seam. The domain seam is untouched.
- A good test here asserts on what a person sees and on the design contract, never on how a component is written:
  - each interactive control on the surface renders through the kit (it carries the kit component's `data-slot`, for example `button`, `menu-item`, `dialog-popup`, `input`);
  - anchor tokens hold: a `default` Button's background equals the computed `--primary`, a Menu popup's background equals `--popover`, a Dialog title's font size and weight match the kit, in light and in dark;
  - layout and behaviour the older specs assert still hold (their existing tests stay green).
- No pixel screenshots. System fonts differ between macOS and CI Linux, so screenshot baselines would not be portable.
- Tests that assert old colour values (`theme.spec.ts`, `frame.spec.ts` and the rest the inventory found) are updated to the new tokens in the task that restyles their surface. Tests that assert layout (widths, positions, the watermark hit test) do not change.
- The lint rules are a build check run with `pnpm typecheck`, like the type checker. They are not a test seam and no test re-checks what they enforce.
- The frame budgets from specs 02 and 09 run in the hosted shape at the end of the spec and must pass.
- Prior art: `packages/web/test/theme.spec.ts` and `frame.spec.ts` for computed-style checks against tokens; `canvasHost.spec.ts` for the watermark hit test; `performance.spec.ts`, `largeImages.spec.ts` and `artifactPerformance.spec.ts` for the budgets.

## Tasks

1. Theme foundation: t3code's default tokens, utilities, base rules and system font stacks replace the current theme; the dark variant keys on `data-unframed-theme`; the body and canvas are `--background`; `--unframed-text-secondary` resolves to the muted foreground; the index and `assets/theme/README.md` say spec 12 replaced the old theme. The spec 01 DOM hook tests pass with the new values in light and dark, and every surface still renders. Seam: browser.
2. UI kit and lint: the kit components, `cn`, class-variance-authority and tailwind-merge are copied with their licences recorded; the lint runs in `pnpm typecheck`; the chrome corners (logo card, help button, their tooltips) render through kit Button and Tooltip on `surface-glass`, and the injected-CSS test still moves the left card. Seam: browser.
3. Project menu, project name dialog and the project delete confirms on kit Menu, Dialog, Input and AlertDialog, with the existing project menu tests passing. Seam: browser.
4. Add menu on the kit Menu at 152 px; Library and Add at the end of the one bottom bar (spec 02). Seam: browser.
5. Toasts and the connection notice on the kit Toast, bottom-left, with their existing tests passing. Seam: browser.
6. tldraw theme adapter: the toolbar, style panel, zoom controls, quick actions, shortcuts dialog and link dialog take the kit's colours, font, radii and shadows in both schemes; a toolbar button's background and the style panel's background equal the mapped tokens; the watermark stays uncovered. Seam: browser.
7. Context menu: kit menu look for rows, headings and the disabled "Add to library" row, at 188 px, with every context menu test passing. Seam: browser.
8. Canvas: selection line and grips in `--highlight` and `--card`, dot grid on the new tokens, shape labels, prompt hint, empty media, Remove button, video transport, render placeholder, artifact cards (white page kept), role badges, tether and mention menu on the kit; the selection look, dot grid, media and badge tests pass with updated colours. Seam: browser.
9. Group frame, its name field and recipe chip on the new tokens and kit Input and Badge; the group tests pass. Seam: browser.
10. Selection toolbar and recipe bar on kit Button variants on `surface-glass`, placed as today. Seam: browser.
11. Generate composer: t3code's composer shell at 420 px, segmented medium switch, the instruction editor, t3code's message-action send (its labelled pill), status lines and the recipe line on the kit. Seam: browser.
12. Prop tray, value menus, Runs popup and video share consent on the kit chip recipe, Menu, Popover, NumberField and Checkbox; the Escape and Runs tests pass. Seam: browser.
13. Model dialog and final prompt dialog on kit Dialog, Table, Select, Input, Textarea, Alert and Badge `label` provider tokens, at 680 and 640 px. Seam: browser.
14. Library dialog and Add to library dialog on the kit, with kind chips as Badge `label` in their hues and preset delete as AlertDialog. Seam: browser.
15. Chat rail: the rail shell, header actions, t3code panel tabs (live dot, rename, More menu kept), thread search and the no-provider state on the kit, at 380 px with the same slide. Seam: browser.
16. Transcript: message bubbles, `.chat-markdown`, t3code timeline rows for the work log and tool rows, reasoning, retry and limit lines, the queued bubble, "Scroll to end", plan and recap cards. Seam: browser.
17. Agent tray: the shared composer shell, prompt editor, chips, attachment shelf, slash and mention menus, stash menu, pickers, plan toggle and context meter on the kit. Seam: browser.
18. Approval and question panels in t3code's pending approval and question looks. Seam: browser.
19. Diff panel in t3code's diff panel shell and diff colours. Seam: browser.
20. Artifact editor columns, header actions, render row, the "Add a parameter" box, the empty-state Agent button, and DialKit's colours from the tokens in both schemes. Seam: browser.
21. Settings dialog on the kit: key section, model comboboxes, output folder field and Browse, local agents, banners and the current project mark. Seam: browser.
22. OpenRouter callback page in the kit's dark tokens and system font for every outcome. Seam: engine.
23. Legacy import screens, the import report dialog and the agent confirm dialogs on the kit. Seam: browser.
24. Sweep: the twelve feature stylesheets are gone (only the theme stylesheet, the tldraw and third-party adapters and the canvas label rules remain), no `--unframed-*` token is left except the contract variable, no raw control is left outside the kit, the lint is clean, and a browser test opens every surface in turn and finds no button, menu item, field or dialog without a kit `data-slot`. Seam: browser.
25. Frame budgets: spec 02's drag, pan and large-image zoom budgets and spec 09's artifact pan budget pass in the hosted shape after the restyle, with any glass surface that broke a budget moved to its solid fill. Seam: browser.

## Out of Scope

- t3code's named themes (t3-chat, grove, ocean, ember, iris), custom themes, the contrast layer's user control, and appearance settings (font, font size, chat width). Default light and dark only.
- Replacing tldraw's toolbar, style panel or menus with kit components. They are themed, not rebuilt.
- Changing tldraw's shape content fonts, or any shape's geometry.
- Layout changes: moving, resizing or reordering surfaces, and new motion. Where a surface's size is in a spec, it stays.
- New components t3code does not have (a slider, generic tabs, an avatar, an accordion).
- The film-grain overlay that `assets/theme/README.md` describes, which was never built.
- Pixel screenshot baselines.
- The desktop shell. Its hooks keep working; nothing in the shell repo changes for this spec.

## Further Notes

- The existing inventory behind this spec: 12 feature stylesheets (3,432 lines), 9 font sizes and 11 radii in CSS, 11 arbitrary pixel values in Tailwind classes, raw `<button>` in 40 files, Base UI in 23 files, and no tldraw theming at all. The colour tokens were already consistent; the drift is in everything else.
- `FinalPromptDialog` reads `--unframed-text-warning` and `--unframed-text-danger`, and `panels.css` reads `--unframed-font-mono`; none of the three is defined today. The kit's `--warning-foreground`, `--error-foreground` and `--font-mono` replace them.
- t3code's global stylesheet is about 2,200 lines. Most of it is sidebar, terminal, topbar and named-theme rules this spec does not take; copy the token blocks, utilities and base rules, not the whole file.
- The rail's slide already uses `cubic-bezier(0.32, 0.72, 0, 1)`, which is t3code's `--ease-drawer`; use the token.
