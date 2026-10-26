# 19 · Kits and tokens

Depends on: 01 to 18 (read 00-index first). It builds on spec 09's artifacts, dials, editor and preview origin, spec 06's library, spec 16's flow preset kind (a kit is another preset kind), and spec 18's source edits, edit union, owner rule, Design tab and edit bridge.

## Problem Statement

A person who makes pages and motions for one brand wants them to share one set of colours, sizes, fonts and motion values. Today every artifact holds its own literals. The agent writes `#1a73e8` in one page and `#1b74e9` in the next, a heading is 32 px here and 30 px there, and changing the brand colour means asking the agent to rewrite every file. There is no dark version of a page unless the agent writes one by hand, and nothing on the board says which values belong to the brand and which are accidents.

Design tools solve this with design tokens: named values that every design refers to, grouped in a library that several files share, with modes for light and dark or for sub-brands. Unframed has the pieces to do the same. An artifact is HTML, so a CSS custom property is a token reference the browser already understands. The library (spec 06) already carries saved things between projects. Spec 18's Design tab already writes a person's edits into the source, and its owner rule already asks who owns a value.

## Solution

A **token** is a named design value: a colour, a size, a font family, a font weight, a text style, a shadow, a duration or an easing. Its name is a path such as `color/brand/primary`, and every artifact sees it as the CSS custom property `--color-brand-primary`. A token can refer to another token (an alias).

A **kit** is a named set of tokens with **modes**, for example light and dark, or two sub-brands. Each token holds one value for every mode, or one value per mode.

- **Where kits live.** A project has at most one kit, its **project kit**, stored in the canvas room (so the project database holds it, every tab sees it, the person's edits undo like any canvas edit, and an agent turn's Revert takes the agent's edits back). A kit saved to the library is a **library kit**, a new preset kind beside groups, recipes and flows. Applying a library kit copies it into the project, so the project folder stays self-contained (contract 8). "Update from kit" pulls later library changes with a merge that keeps the project's own edits and shows conflicts before anything changes.
- **How tokens reach artifacts.** The engine writes one helper script into the project folder, `unframed-tokens.js`, beside the dials bridge, and every page and motion the engine writes loads it. It puts the kit on the page as CSS custom properties (the default mode on `:root`, each other mode under `[data-theme="<mode>"]`) and gives scripts `unframed.token("color/brand/primary")` for GSAP durations and eases. Changing a token restyles every artifact in the project, old versions included. This is the one place an artifact version can change after it was written, and this spec says so as a bent rule.
- **Kit mode per artifact.** Each page and motion carries its kit mode on the shape, like its dials. A `Kit mode` picker sits in the editor header and in the artifact's selection toolbar. Frames, snapshots, the live viewer and renders all use it.
- **The Kit dialog.** Opened from a Kit button in the bottom bar beside Library, and from the Design tab. It shows the tokens grouped by path, the modes as columns, how many artifacts use each token, and the import, export and library actions.
- **The Design tab.** Every field of spec 18's inspector offers the tokens that fit it. A value written as `var(--…)` shows as a token chip that can change to another token or detach to a literal. An **Off-token values** section counts literals close to a token, and one click selects the element or puts the token in.
- **Import and export.** Import from DTCG JSON (the W3C design tokens format) and from CSS custom properties. Export to DTCG JSON, CSS custom properties and Tailwind v4 `@theme`.
- **The agent.** `kit_read` and `kit_write` let the agent see and edit the project kit; `kit_write` is a turn change, so Revert works. The artifact tool descriptions tell the agent to use `var(--…)` and `unframed.token()`. `page_write` and `motion_write` still succeed with literals, and their result lists the literal colours and sizes that sit close to a token, so the agent can correct itself. Outside agents get the same tools.

## User Stories

1. As a person, I want to start a kit for my project from nothing, so that my pages share named colours and sizes.
2. As a person, I want to name tokens with paths like `color/brand/primary`, so that a long list stays organised.
3. As a person, I want each token to have a type (colour, size, font family, font weight, text style, shadow, duration, easing), so that the editor offers the right control and the right fields offer it.
4. As a person, I want a token to refer to another token, so that `color/button/background` follows `color/brand/primary`.
5. As a person, I want modes such as light and dark, so that one page can show either.
6. As a person, I want a token to hold one value for every mode or a value per mode, so that I set only what differs.
7. As a person, I want to add, rename and delete tokens and modes in a dialog with modes as columns, so that I see the whole kit at once.
8. As a person, I want a colour editor and number fields with units, so that I never type CSS by hand unless I want to.
9. As a person, I want to see how many artifacts use a token before I change or delete it, so that I know what I am about to restyle.
10. As a person, I want renaming a token to keep the artifacts that use the old name working, so that a rename never breaks a page.
11. As a person, I want a kit edit to be one undo step on the canvas, so that Cmd-Z takes it back like any edit.
12. As a person, I want a kit change made in one tab to show in every other tab and in every live frame at once, so that the board never disagrees with itself.
13. As a person, I want changing a token to restyle every page and motion in the project, the versions I already have included, so that one change updates the brand everywhere.
14. As a person, I want snapshots on the board to follow a token change, so that the still pictures match the live artifacts.
15. As a person, I want to save my project's kit to the library, so that another project can use it.
16. As a person, I want to apply a library kit to a project, so that a new project starts on the brand.
17. As a person, I want an applied kit to be a copy inside the project, so that the project folder works on its own.
18. As a person, I want "Update from kit" to bring in later changes to the library kit, keep the tokens I added in this project, and show me every token both sides changed before anything changes, so that an update never silently undoes my work.
19. As a person, I want to push my project's changes back into the library kit it came from, so that other projects can pick them up.
20. As a person, I want a project to have at most one kit, so that two kits never fight over a name.
21. As a person, I want to choose the mode of each page or motion from the editor header and from its selection toolbar, so that I can show the dark version of one page next to the light version of another.
22. As a person, I want a page's mode to be used by its snapshot, its live viewer tab and its render, so that what I export matches what I chose.
23. As a person, I want every Design tab field to offer the tokens that fit it, so that styling by hand stays on brand.
24. As a person, I want a value that is a token to show as a chip I can change or detach, so that I see which values follow the kit.
25. As a person, I want a text style token to set family, size, weight, line height and letter spacing at once, so that a heading takes the heading style in one click.
26. As a person, I want an Off-token values count in the Design tab, listing literals close to a token, so that I can find the accidents.
27. As a person, I want clicking an off-token value to select its element, and "Use token" to put the token in, so that fixing it is one click.
28. As a person, I want to import tokens from a DTCG JSON file or from CSS custom properties, with a summary before anything changes, so that I can bring a design system from another tool.
29. As a person, I want to export the kit as DTCG JSON, as CSS custom properties and as a Tailwind v4 `@theme` block, so that the same tokens work in my code.
30. As an agent, I want `kit_read` to give me the tokens, their CSS names, their values per mode and the modes, so that I can write pages that use them.
31. As an agent, I want `kit_write` to create the kit and add, change, rename and delete tokens and modes, so that I can build a design system for the person.
32. As a person, I want an agent's kit edits to be part of its turn, so that Revert this turn takes them back and leaves alone a token I changed since.
33. As an agent, I want my page and motion tools to tell me when the project has a kit to use, so that I write `var(--…)` and `unframed.token()`.
34. As an agent, I want my write to succeed and still tell me which literal colours and sizes sit close to a token, so that I can correct myself without being blocked.
35. As an outside agent, I want the same kit tools, so that Claude Code or Codex can work with the kit as the in-app agent does.
36. As a maintainer, I want a project folder with a kit to render with `npx hyperframes render` outside Unframed, so that the folder is still self-contained.

## Implementation Decisions

### Terms this spec adds

- **token** (design token): a named design value with a type. In this spec "token" alone always means a design token. It is not spec 12's app tokens (the UI's own `--card`, `--foreground` and so on), not the `@id` reference token, and not spec 14's connection tokens; where those appear they are named in full.
- **kit**: a named set of tokens with modes. In this spec "kit" alone means this. Spec 12's component library is called "the UI kit" here, never "the kit".
- **project kit**: the one kit of a project, in its canvas room.
- **library kit**: a kit saved as a preset in the library (spec 06).
- **kit mode**: one column of values in a kit (`light`, `dark`, `brand-b`). The first is the **default mode**. Where nothing else is meant, this spec says "mode" for short; it is never spec 18's Edit and Interact modes, and the UI always says `Kit mode`.
- **token path**: a token's name, lower-case words joined by `/` (`color/brand/primary`).
- **CSS name**: the custom property a path makes (`--color-brand-primary`).
- **alias**: a token whose value refers to another token of the same type.
- **off-token value**: a literal value in an artifact's source that equals or sits close to a token's value, by the thresholds below.
- **tokens script**: `unframed-tokens.js`, the engine's helper file that carries the kit into artifacts.
- **style rule reference** (`StyleRuleRef`): the address of one rule in an artifact's `<style>` elements, shared by every edit that targets a rule (The Design tab, below).
- **ease catalogue**: the GSAP named eases the app offers, with their labels and curve samples (Easings, below).

### Modules

| Module | Package | Interface | New or extended |
| --- | --- | --- | --- |
| Kit rules | domain | `kitRefusal(kit)` returns the first refusal sentence or null (paths, CSS name collisions, values per type, aliases, cycles, modes, size); `cssName(path)`; `resolve(kit, path, mode)` returns the value with aliases followed | new |
| Kit edits | domain | `applyKitOps(kit, ops)` returns the new kit or a refusal naming the op; the one function the Kit dialog, import, `kit_write` and the merge all end at | new |
| Kit output | domain | `tokensScript(kit)` builds the tokens script text; `kitCss(kit)` the custom properties; `kitStamp(kit)` an 8-character hash of the output | new; the script, the CSS export and the stamp come from one module so they cannot drift |
| Kit merge | domain | `mergeKit({ project, base, library })` returns the merged kit, the counts and the conflicts; `replaceKit(project, library)` for applying a different kit | new |
| Kit formats | domain | `fromDtcg(files)`, `fromCss(text)` return a kit fragment or a refusal; `toDtcg(kit)`, `toCss(kit)`, `toTailwind(kit)` return text | new |
| Off-token values | domain | `offTokenValues(html, kit)` returns each literal near a token, with its place (an element id, or a `StyleRuleRef`), property, value, the token and whether it is exact | new |
| Ease catalogue | domain | `EASES`: the 31 named eases in order, each with its GSAP name, its label and 24 samples of its curve | new; later specs reuse it |
| Token uses | domain | `tokenUses(html, kit)` returns the paths an artifact file refers to | new |
| Token fields | domain | `tokensForField(field, kit)` returns the tokens a Design tab field offers, in order | new |
| Tag injection | domain | gains the tokens tag (spec 09's rule) | extended |
| Dials bridge | domain | re-applies its last declaration on the `unframed:tokens` window event | extended (spec 09) |
| Kit record | contracts | `Kit`, `Token`, `TokenValue`, the document record's `meta.unframed.kit`, the page and motion `mode` prop with its migration, the kit preset entry | new |
| Kit store | engine | writes the tokens script after each commit that changes the kit and when a room opens; ensures it on every artifact write; re-renders snapshots after a kit or mode change | new |
| Kit tools | engine | `kit_read`, `kit_write`, the kit rows of turn changes, the off-token note in the artifact write result | new; extends spec 07's tool list and turn changes |
| Kit library | engine | `kit.saveToLibrary`, `kit.updateInLibrary`, the kit entries of `presets.json` under spec 06's write rule | extends spec 06's preset store |
| Kit usage and export | engine | `kit.usage`, `kit.exportFile` | new |
| Kit dialog, Kit mode picker, token picker, token chip, Off-token values section | web | the dialog, the pickers in the editor header and the selection toolbar, the Design tab additions | new; extends spec 18's Design tab |
| Ease curve | web | a small curve preview drawn from an ease's samples, used by the easing cell and the ease list | new; later specs reuse it |

### The kit record

The project kit is one value in the canvas room: the tldraw document record's `meta.unframed.kit`, absent when the project has no kit. tldraw sync stores the room in the project database, so the kit lives there as the brief asks, and the room gives it everything else for free: every tab sees an edit at once, the person's edit is a tldraw history step, the canvas change log (spec 02) records who changed it, and an agent's write goes through spec 02's `apply` with its chat origin. The room refuses a document record whose kit fails `kitRefusal`, with that sentence as the rejection reason, as it refuses other bad records (spec 02).

```ts
type Kit = {
  format: 1
  name: string                     // 1 to 80 characters, trimmed
  modes: string[]                  // 1 to 12, the first is the default mode
  tokens: Token[]                  // in the order the dialog shows them
  from?: KitLink                   // set when the kit came from, or was saved to, the library
}

type Token = {
  path: string                     // "color/brand/primary"
  type: "color" | "dimension" | "fontFamily" | "fontWeight"
      | "textStyle" | "shadow" | "duration" | "easing"
  value?: TokenValue               // one value for every mode, or
  values?: Record<string, TokenValue>  // a value per mode; a missing mode uses the default mode's value
  description?: string             // at most 200 characters
  formerNames?: string[]           // CSS names kept working after a rename
}

type TokenValue = string | number | TextStyle   // a string "{color/brand/primary}" is an alias

type TextStyle = {
  fontFamily: string; fontSize: string; fontWeight: number | string
  lineHeight: string | number; letterSpacing: string   // each a literal or an alias
}

type KitLink = {
  presetId: string                 // the library kit
  revision: number                 // the library kit's revision this project last took
  base: { modes: string[]; tokens: Token[] }  // the library kit as it was then, for the merge
}
```

Exactly one of `value` and `values` is set. A per-mode token may leave out modes; a missing mode falls back to the default mode's value, and the default mode itself must have one.

**Limits.** At most 2,000 tokens and 12 modes; the kit's JSON at most 512 KiB.

### Paths, CSS names and values

**Paths.** One to six segments joined by `/`, each matching `^[a-z0-9][a-z0-9-]{0,39}$`, the whole at most 120 characters. Import lowers camel case (`brandPrimary` becomes `brand-primary`) and replaces `.` and spaces with `/` and `-` before checking.

**CSS names.** `--` and the segments joined by `-`: `color/brand/primary` makes `--color-brand-primary`. A text style makes five: `--<name>-font-family`, `--<name>-font-size`, `--<name>-font-weight`, `--<name>-line-height`, `--<name>-letter-spacing`. Two tokens whose CSS names collide (`color/brand-primary` and `color/brand/primary`, or a text style's sub-name and another token) are refused. The CSS name is what artifacts depend on, so it is the token's identity on the page; the path is its identity in the kit.

**Values by type.** Stored as the CSS text a person would write, so the stylesheet needs no conversion:

| Type | Accepted | `unframed.token()` returns |
| --- | --- | --- |
| `color` | hex (`#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`), `rgb()`, `hsl()`, `oklch()`, a CSS named colour | the CSS text |
| `dimension` | a number with `px`, `rem`, `em` or `%`, or `0` | the CSS text (`"16px"`), which GSAP takes |
| `fontFamily` | a non-empty CSS font family list | the CSS text |
| `fontWeight` | 1 to 1000, or `normal`, `bold`, `lighter`, `bolder` | a number, or the keyword |
| `textStyle` | the five fields above, each valid for its kind (`lineHeight` may be a plain number) | an object with the five fields resolved |
| `shadow` | CSS `box-shadow` layers (offsets, blur, spread, colour, `inset`) | the CSS text |
| `duration` | a number with `ms` or `s` | seconds as a number, for GSAP |
| `easing` | a name from the ease catalogue (below), or `cubic-bezier(x1, y1, x2, y2)` | the GSAP name as a string, or for a cubic bezier a function of progress, which GSAP accepts as an ease |

**The ease catalogue.** Exactly 31 GSAP named eases, in this order: `none` (shown as `Linear`), then `sine`, `power1`, `power2`, `power3`, `power4`, `expo`, `circ`, `back`, `elastic` and `bounce`, each as `.in`, `.out` and `.inOut` (shown as `In`, `Out` and `In-out` under the family's name, `Power2 · Out`). Each entry carries 24 samples of its curve from GSAP's own formulas (Back at its default 1.70158 overshoot, Elastic at amplitude 1 and period 0.3). The **ease curve** component draws those samples as a small curve, 24 px high, in `--foreground` on the UI kit's surface. An easing token's value is one of these 31 names or a cubic bezier; any other GSAP name is refused.

**Easings in CSS.** An easing token's custom property holds the CSS form: a cubic bezier as written, and a catalogue name by a table in the kit rules (each `power`, `sine`, `expo`, `circ` and `back` ease as its usual cubic bezier; `elastic` and `bounce` as a CSS `linear()` function sampled at 40 points; `none` as `linear`). The table is pure and tested; the GSAP name stays the source of truth.

**Aliases.** A value of the form `{<path>}` refers to another token of the same type (a text style field may refer to a token of that field's type). In CSS an alias is `var(--<target>)`; `unframed.token()` and `resolve` follow the chain. An unknown target, a type mismatch and a cycle are refused.

**Refusal sentences** (from `kitRefusal` and `applyKitOps`, shown under the field in the dialog and returned to the agent):

- `A token name is words joined by slashes, like color/brand/primary.`
- `There is already a token {path}.`
- `{a} and {b} both make {cssName}. Rename one.`
- `{value} is not a colour. Use a hex value like #1a73e8, or rgb(), hsl() or oklch().`
- `{value} is not a size. Use a number with px, rem, em or %.`
- `A font family cannot be empty.`
- `A font weight is a number from 1 to 1000, or normal, bold, lighter or bolder.`
- `{value} is not a shadow. Use CSS box-shadow, like 0 2px 8px rgba(0, 0, 0, 0.2).`
- `{value} is not a duration. Use ms or s, like 200ms.`
- `{value} is not an easing. Use a GSAP ease like power2.out, or cubic-bezier(x1, y1, x2, y2).`
- `{path} needs its {field}.` (a text style missing a field)
- `{path} refers to {target}, which is not in the kit.`
- `{path} is a {type} and cannot refer to {target}, a {type}.`
- `{a} and {b} refer to each other.` (with longer cycles naming the first two)
- `{path} needs a value for {defaultMode}, the default mode.`
- `A mode name is a short word, like light or dark.` (`^[a-z0-9][a-z0-9-]{0,31}$`)
- `There is already a mode {name}.`
- `A kit keeps at least one mode.`
- `A kit holds at most 2000 tokens.`, `A kit holds at most 12 modes.`, `The kit is too large to save.`

### Kit edits

Every change to a kit is a list of ops through `applyKitOps`, so the dialog, import, merge and `kit_write` share one set of rules:

- `create { name, modes? }` (refused when a kit exists: `This project already has a kit.`); `rename { name }`; `remove` (the person's Delete kit only, below).
- `setToken { path, type, value? | values?, description? }` adds or replaces a token. Changing a used token's type is allowed; its artifacts simply see the new value.
- `renameToken { path, to }`: the token moves, and the old CSS name is added to `formerNames` unless the new one equals it. The tokens script defines every former name as `var(--<new>)`, so an artifact that uses the old name keeps working. The dialog shows `Also answers to {formerName}` under the row; `forgetFormerName { path, cssName }` removes one.
- `deleteToken { path }`.
- `addMode { name, copyFrom? }` (the new mode starts with no values of its own, so every token shows the default mode's value until set, or with a copy of `copyFrom`'s values); `renameMode { name, to }` (shapes whose `mode` names it are updated in the same write); `deleteMode { name }` (refused for the last mode; shapes on it fall back to the default mode); `setDefaultMode { name }` (moves it first).
- `reorder { paths }` for the dialog's drag.

A rename of a mode also rewrites the `mode` prop of every artifact on it in the same room write, so it stays one undo step and one turn change.

### The tokens script

A helper file like `unframed-dials.js`, not an artifact file: the engine rewrites it in place (spec 09's rule for helper files), generated by `tokensScript(kit)` so the tested definition and the shipped file are one. It starts with a comment saying it is generated from the project's kit and rewritten whenever the kit changes, so it must not be edited.

**Why a script and not a stylesheet.** The preview origin's allow-list (spec 09) has no `.css`, and adding a type to it is a change to the one public route that keeps model-written HTML contained. A script is already allowed (`script-src 'self'`), inline styles are allowed (`style-src 'unsafe-inline'`), and the same file has to carry the values `unframed.token()` returns anyway. So one script writes one `<style>` element and defines one function.

**What it does when it loads:**

1. Inserts `<style id="unframed-tokens">` as the first child of `<head>` (or of the document element when there is none). Its text is `kitCss(kit)`: every CSS name with its default-mode value on `:root`, every former name as `var(--<new>)`, then one block per other mode, `[data-theme="<mode>"] { … }`, holding only the tokens whose value in that mode differs from the default. Being first, any rule the artifact writes after it wins, so an author's own CSS is never overridden by the kit.
2. Chooses the mode: `window.__hfVariables.unframedMode` when a render passed one (below), else the default mode, and sets `data-theme` on the document element.
3. Defines `window.unframed.token(path)` beside what the bridge defines, without replacing it (the bridge already merges into an existing `window.unframed`). It returns the current mode's value with aliases followed, in the form the table above gives, or `undefined` with `console.error("[unframed] no token " + path)`. It accepts a CSS name too (`"--color-brand-primary"`), so code written either way works.
4. Listens for messages with the dials bridge's checks (`event.source` is `window.parent`, origin its own or loopback):
   - `unframed:tokens:mode { mode }`: sets `data-theme` to the mode (the default mode when it names none of the kit's), then dispatches the window event `unframed:tokens`.
   - `unframed:tokens:set { kit }`: replaces its kit and its `<style>` text in place, then dispatches `unframed:tokens`. This is how a token change reaches a live frame at once, without a reload and before the engine has rewritten the file.
5. With no kit (the project has none, or it was removed), it defines `unframed.token` (always `undefined`, with the console error) and inserts no style, so a file that loads it never fails.

**Motions and other scripts.** A motion reads tokens when it builds its timeline. The dials bridge, on the `unframed:tokens` event, calls its last declaration's apply again with the current values (spec 09 already teaches the agent to build the timeline in apply and keep the playhead), so a mode or token change shows in a motion without a reload. A page's CSS follows by itself. Scripts that are not dial-driven may listen to `unframed:tokens` themselves; the kit paragraph (assets) says so.

**The tag.** `<script src="unframed-tokens.js"></script>`, skipped when the document already mentions `unframed-tokens.js`. It goes immediately after the opening `<head …>` tag, followed by a newline, so it runs before any script or style the artifact puts in its head. With no `<head>`, spec 09's fallback places it (after the opening `<body …>`, else at the top). It joins spec 09's tag injection, so it goes into every page and motion file write by every writer spec 18 lists: the agent's tools, uploads, drops, pastes, spec 16's node page writer, source edits and `artifact.prepareEdit`. A page that refers to no token looks as it did: the script only adds custom properties the page never reads and a `data-theme` attribute on the root.

**Keeping it current.** The engine writes the tokens script, through a temp file and a rename, when its text differs from what is on disk:

- after every commit that changes the document record's kit (spec 02's after-commit work: a person's edit, an agent's write, an undo, a Revert);
- when a room opens (the engine's own `system` writes run no after-commit work, and a project copied from elsewhere may carry an old one);
- on every artifact write that injects the tag (the "ensure" rule spec 09 uses for the bridge).

The preview origin serves it as any `.js` file. A project with no kit still gets the file the first time an artifact write needs it, so the tag always loads.

### What a token change does

- **Live frames** (the canvas's live artifacts, the editor's frame, the canvas Parameters panel's artifact, a live viewer tab through its pointer, below): the web posts `unframed:tokens:set` with the new kit to each, right after the kit changes in the room, from any tab or from the agent. The motion viewer relays it to its composition (below). No document reloads.
- **Files on disk**: the tokens script is rewritten as above. A page opened on its own, a render and a snapshot all load the current file.
- **Snapshots**: the engine re-renders the snapshot of every artifact shape whose current file loads the tokens script, through spec 09's snapshot queue (debounced 1 s per shape, one at a time). The snapshot record and its name gain the mode and the kit stamp, so a snapshot made with an older kit or another mode is known to be stale; the shape keeps showing it until the new one lands (spec 09's rule for a missing snapshot).
- **Renders already made** do not change. An MP4 is a file.
- **Old versions.** Every version of every artifact in the project loads the same tokens script, so an undo or a Revert to an older file shows that file with today's kit. This is the decided behaviour (Rules this spec bends, 1).

### Modes on artifacts

- **Storage.** Pages and motions gain an optional prop, `mode: string` (the kit mode), with a migration (spec 02's artifact migrations). Absent means the default mode. A `mode` that names no mode of the kit (the mode was deleted, the kit replaced, the shape pasted from another project) is kept as it is and read as the default mode, so restoring the mode restores the look.
- **The picker.** A UI kit Select (spec 12) labelled `Kit mode`, listing the kit's modes by name with the default first, marked `{mode} (default)`. The label is `Kit mode`, not `Mode`, because spec 18's Edit and Interact toggle in the same header is labelled `Mode`. It shows only when the project kit has two or more modes and the artifact has a file:
  - in the editor's centre header, before Preview size (spec 09's header order otherwise unchanged; below 520 px it shows its icon only, SunMoon, with `Kit mode` kept as its accessible name);
  - in the selection toolbar when one filled page or motion is selected, after Parameters (spec 09), as the small outline Button with the SunMoon icon and the mode's name, tooltip and accessible name `Kit mode`, opening the same list.
- **Writing.** Choosing a mode sets `mode` at once (no debounce: it is one choice, not a drag) as one tldraw history step. Choosing the default mode removes the prop.
- **Frames.** Every artifact frame (canvas, editor, panel) posts `unframed:tokens:mode { mode }` after its hello and on each load event, and again whenever `mode` changes. The motion viewer relays `unframed:tokens:mode` and `unframed:tokens:set` from its canvas to the composition, as it relays `unframed:dials:set` (spec 09's "Everything else is ignored" gains these two).
- **The live viewer.** The pointer (spec 09) gains `mode` (or `null`), and the viewer posts `unframed:tokens:mode` to its frame on load and when the mode changes. A kit change rewrites the tokens script, and the viewer's next new frame loads it; the frame on screen gets `unframed:tokens:set` only from the app, so the viewer also remounts its frame (spec 09's swap without a blank moment) when the pointer's new `kit` stamp differs from the last one.
- **Snapshots.** The engine posts `unframed:tokens:mode` with the shape's mode before the wait, and a mode change is a snapshot trigger, like a saved dial change.
- **Renders.** `motion.renderStart` gains `mode?`. The web sends the shape's mode. The producer receives it in the render variables as `unframedMode`, beside `unframedDials`, so the tokens script picks it before the first frame. The render sidecar gains `mode` (when not the default) and `kit: { name, stamp }` (when the project has a kit), so two renders of one file in two modes are traceable.
- **The agent.** `canvas_read` reports `mode` on an artifact that has one. `canvas_write`'s update op accepts `mode` on a page or motion, refused with `there is no mode {mode} in the kit` when the kit has no such mode.

### The Kit dialog

**Opening.** A `Kit` button in the bottom bar, beside Library (spec 06), a ghost icon Button with the Palette icon and the tooltip `Kit`. The Design tab's token picker has `Edit kit` at its foot, and the Design tab's Tokens line (below) opens it too. The dialog is the UI kit's Dialog (spec 12), 960 wide and at most the window's height less 48 px, title `Kit`.

**No kit.** The body reads `This project has no kit yet. A kit holds the colours, sizes, fonts and motion values its pages and motions share.` with three buttons: `New kit` (Button `default`; creates a kit named `Kit` with one mode, `default`, and opens it), `From library` (Button `outline`; opens the Library dialog filtered to Kits), and `Import` (Button `outline`; the import flow below).

**Header**, under the title: the kit's name as an inline field (accessible label `Kit name`); the source line in muted text when the kit is linked: `From “{name}” in your library.`, followed by the ghost Button `Update from kit` when the library kit's revision is newer than `from.revision`, or `The library kit “{name}” is gone. This project keeps its copy.` when its preset is no longer in the library; a search field (`Search tokens…`, hidden label `Search tokens`, matching a path or a CSS name as a substring); and a `More` ghost icon menu with `Save to library`, `Update in library` (only when linked to a user preset), `Import…`, `Export` (a submenu: `DTCG JSON`, `CSS variables`, `Tailwind @theme`) and `Delete kit`.

**Body.** On the left, a list of groups: `All`, then each first path segment with its count (`color 24`). On the right, a table:

- Columns: `Token` (the path, with the CSS name under it in muted monospace text), `Type`, one column per mode headed by its name (the default marked `default`), and `Used by`.
- A header menu on each mode column: `Rename mode`, `Make default`, `Duplicate mode`, `Delete mode`. After the last column, a ghost Button `Add mode`.
- A row whose token has one value for every mode shows one cell across the mode columns. The row menu (`…`) offers `A value per mode` or `One value for all modes` (which keeps the default mode's value), `Rename`, `Description`, `Forget old names` when it has former names, and `Delete`.
- Cells: a colour cell is a swatch and its CSS text; clicking opens a popover with the browser's colour input, a text field for the CSS text, and an opacity number. A dimension cell is a number field and a unit select (`px`, `rem`, `em`, `%`). A duration cell is a number field and `ms` or `s`. A font weight cell is a select of 100 to 900 and the keywords. An easing cell is a select of the ease catalogue, each entry with its ease curve, and a `Cubic bezier` entry with four number fields. A font family, shadow or text style cell is a text field (a text style opens a popover with its five fields). Every cell also takes an alias: a `Use a token` item at the top of its popover lists tokens of the same type; an alias cell shows the target's chip.
- `Used by` shows the number of artifact shapes whose current file refers to the token (by its CSS name, a former name, or `unframed.token` with its path), from `kit.usage`, read when the dialog opens and after each kit change. Zero shows an empty cell. Hovering shows the titles, at most 10, then `and {n} more`.
- A Button `Add token` at the foot of the table adds a row in edit, with a path field (prefilled with the selected group) and a type select. Enter commits.
- Past 200 rows the table renders only the rows in view.

**Committing.** A field commits on Enter or blur; a select, toggle or popover choice commits at once; Esc in a field abandons it. Each commit is one `applyKitOps` call written to the room as one tldraw history step; a refusal shows its sentence under the field in the error text (`role="alert"`) and writes nothing. A drag in the colour input commits when it ends.

**Deleting.** Deleting a token or a mode asks with the UI kit's AlertDialog. A token: title `Delete {path}?`, body `{n} artifacts use it and lose this value.` (or `No artifact uses it.`), action `Delete token`. A mode: `Delete the {mode} mode?`, body `{n} artifacts use this mode and go back to {default}.`, action `Delete mode`. `Delete kit`: `Delete this project's kit?`, body `Pages and motions keep their files, and lose every token value. The library is untouched.`, action `Delete kit`. Each is one undo step.

**Live frames while editing.** The frames follow each commit (above). Nothing in the dialog runs on the canvas's pan path (contract 9): the dialog is a modal over the canvas, and posting a kit to at most a handful of live frames is the only work a commit causes on the app's thread.

### The kit in the library

**The preset entry.** A kit preset is a spec 06 preset entry with `kind: "kit"`, no `content`, no `medium`, and two fields of its own:

```ts
{ format: 2, id, source: "user", savedAt, name, summary,
  kind: "kit",
  kit: { name, modes, tokens },   // a Kit without `from`
  revision: number }              // 1 when saved, plus 1 on every update
```

It lives in `presets.json` under spec 06's whole write rule (re-read before every write, the whole array replaced, temp then rename, unknown entries kept). `library.save` keeps refusing content that is not one group; kits use their own two methods (RPC below). No system kit ships.

**In the Library dialog.** The type toggle gains `Kits`. A kit card shows its name, summary, the line `{n} tokens · {m} modes`, the chip `Kit` (Palette icon, amber; spec 06's chip style) and the source chip, and its button reads `Apply` instead of `Add`. Delete is spec 06's, with the body `This removes “{name}” from your library. Projects that use it keep their copy. This can't be undone.`

**Saving.** `Save to library` in the dialog's menu opens spec 06's "Add to library" dialog with the subtitle `{n} tokens and {m} modes, saved as you have them now.` and the same fields and messages. On success the web sets the project kit's `from` (the new preset, revision 1, and the saved tokens as `base`) in one room write, and the toast is spec 06's.

**Updating the library kit.** `Update in library`, shown when the kit is linked to a user preset, replaces that preset's `kit` with the project's tokens and modes, adds 1 to its revision and sets `savedAt`; the web then sets the project's `from.revision` and `base` to match. If the library kit's revision is newer than the project's `from.revision`, it first says `The library kit changed since this project took it. Update from kit first, so you do not overwrite those changes.` and offers `Update from kit`. Toast: `Updated “{name}” in your library.`

**Applying.** `Apply` on a kit card:

- **The project has no kit**: copies the library kit in, with `from` set to its id, revision and tokens. One undo step. Toast `Applied “{name}” to this project.`
- **The project's kit came from the same preset**: acts as `Update from kit`.
- **The project has another kit**: asks with the AlertDialog `Replace this project's kit?`, body `“{new}” takes the place of “{old}”. Tokens with the same name take the new values. Tokens only this project has stay, so no page loses a value.`, action `Apply kit`. `replaceKit` keeps the project's modes and adds the library kit's, sets every token the library kit has to its values, keeps the others, takes the library kit's name, and links to the new preset. One undo step.

**Update from kit.** `mergeKit({ project, base, library })`, a three-way merge per token path and per mode value, with `base` the library kit as the project last took it:

| Project vs base | Library vs base | Result |
| --- | --- | --- |
| same | changed | take the library's (counted as updated) |
| changed | same | keep the project's |
| changed | changed, to the same value | that value |
| changed | changed, differently | **conflict** |
| absent in base, present in project | absent | project-only: kept |
| absent in project and base | present in library | added |
| present in base, deleted in project | changed in library | conflict |
| present in base, deleted in project | same | stays deleted |
| present | deleted in library | kept as a project token (counted as `no longer in the kit`) |

Modes merge the same way: a library mode the project lacks is added, a project-only mode is kept, a mode deleted in the library is kept. A renamed token in the library reads as one deleted and one added, so the old one stays and keeps its artifacts working. The type, description and former names of a token follow its value's row.

The update opens a dialog, `Update from “{name}”`, listing the counts (`{a} updated, {b} added, {c} kept as you changed them here, {d} no longer in the kit`) and, when there are conflicts, a row per conflict: the path, `Here: {value}` and `Kit: {value}` (swatches for colours), and a ToggleGroup `Keep mine` / `Take the kit's`, set to `Keep mine`. Buttons `Update` and `Cancel`. Update writes the merged kit with `from.revision` and `base` set to the library kit as it is now, as one undo step. With no differences, the button is not offered and the source line says nothing new.

### Import and export

**Import.** `Import…` (and `Import` on the empty dialog) opens a small dialog with a drop zone and file picker (accepting `.json` and `.css`, several files at once) and a `Paste` text area. The format is read from the content: JSON is DTCG, anything else is CSS.

- **DTCG JSON.** Groups and tokens as the format defines them (`$value`, `$type`, `$description`, `$type` inherited from groups, aliases as `{group.token}`), both the string and the object forms of dimension and duration. Types: `color`, `dimension`, `fontFamily`, `fontWeight`, `duration`, `cubicBezier` (an easing), `shadow`, `typography` (a text style); `number` becomes a dimension in `px` only for paths under a `space`, `size` or `radius` group, and any other type or token is skipped and counted. Modes: a file holding `$extensions["org.unframed"].modes` (what this app exports) keeps its modes; otherwise each file is one mode named after the file without its extension and a `.tokens` suffix (`dark.tokens.json` is `dark`), which is how Figma and Tokens Studio export modes. One file with no such name is the default mode. An easing exported by this app keeps its GSAP name from `$extensions["org.unframed"].ease`.
- **CSS custom properties.** Declarations of custom properties in `:root` are the default mode. `[data-theme="x"]`, `.x`, `.theme-x` and `:root.x` blocks are mode `x`; `@media (prefers-color-scheme: dark)` around `:root` is mode `dark`. Each name loses its `--` and splits at every `-` into a path. The type is read from the value: a colour, a length, a time, a `cubic-bezier()`, a weight (a number from 100 to 900 whose name has `weight`), a shadow, a font list (a value with a comma or quotes whose name has `font` or `family`); `var(--x)` is an alias. Any other value, and declarations outside those blocks, are skipped and counted.
- **Applying.** The import becomes ops (`setToken` per token, `addMode` per new mode) merged into the project kit: a token with the same path takes the imported values for the imported modes and keeps its others; new paths and modes are added; nothing is deleted. With no kit, it creates one named after the first file (or `Kit`). Before writing, the dialog shows `Adds {a} tokens, changes {b}, adds the modes {list}. Skips {c} it could not read.` with `Import` and `Cancel`, and any refusal sentence from `applyKitOps` instead of the summary. Import is one undo step.

**Export.** Each item of `Export` writes a file into the project folder through spec 01's exclusive-create naming, `<epochMs>-kit-<slug of the kit name>.tokens.json`, `.css` or `.tailwind.css`, with a sidecar `{ source: "export", kind: "kit", format: "dtcg" | "css" | "tailwind", kit: name, stamp, at }`, and toasts `Saved {file} in the project folder.` with a `Reveal` action (spec 02's reveal). Through RPC `kit.exportFile`.

- **DTCG JSON**: one file with a group per path segment, `$type` and `$value` per token in the default mode, aliases as `{a.b.c}`, dimensions and durations in the object form, easings as `cubicBezier` (a named ease as its table bezier, with the name in `$extensions["org.unframed"].ease`), and the per-mode values in `$extensions["org.unframed"].modes`, so a round trip through this app keeps everything.
- **CSS variables**: `kitCss(kit)` exactly as the tokens script writes it.
- **Tailwind v4 `@theme`**: the default mode's custom properties inside `@theme { … }`, then the other modes as `[data-theme="<mode>"] { … }` blocks. Tokens whose CSS names start with one of Tailwind's namespaces (`--color-`, `--spacing-`, `--radius-`, `--font-`, `--text-`, `--font-weight-`, `--shadow-`, `--ease-`) become Tailwind utilities; the rest are plain variables, and a comment at the top says so.

### The Design tab

Spec 18's Design tab leaves a token slot on each field. This spec fills it.

**Which tokens a field offers** (`tokensForField`):

| Field (spec 18) | Token types offered |
| --- | --- |
| Text: font family | `fontFamily` |
| Text: size, line height, letter spacing | `dimension` |
| Text: weight | `fontWeight` |
| Text: colour; Fill: background colour; Shape: border colour | `color` |
| Shape: border width, corner radius; Spacing: padding, margin, gap | `dimension` |
| Shape: shadow | `shadow` |
| Shape: opacity; Layout; Visibility | none: no slot is shown |

Dimension tokens are ordered by path keyword: for spacing fields, tokens whose path has `space`, `spacing` or `gap` come first; for radius, `radius`, `radii` or `rounded`; for text sizes, `font`, `text` or `size`; the rest follow, each group in kit order. The Text section's header gains a `Text style` picker offering `textStyle` tokens.

**The token button.** A small ghost icon Button (the Diamond icon, label `Use a token`) at the end of each field with a slot. It opens a popover: a search field, the offered tokens with their value in the artifact's current mode (a swatch for colours), `Edit kit` at the foot. With no kit it reads `No kit yet.` and `Edit kit` opens the empty Kit dialog. Hovering a token previews it in the frame through spec 18's preview patch; choosing it adds a `token` edit with the element's id to spec 18's burst.

**The token chip.** When spec 18's `fieldOwner`, run in the web, answers `token` for a field (below), the field shows a chip instead of its input: the token's path (its last two segments, the whole path in the tooltip), a swatch for a colour, and the current mode's value in muted text. Clicking the chip opens the same popover with `Detach` at its top: Detach writes the resolved value as a literal (spec 18's `style` edit), and choosing another token writes a `token` edit. A text style chip appears on the Text section header when all five text fields are owned by the same text style's sub-names.

**The token owner.** Spec 18's owner rule gains `token`, checked before its step 4 (spec 18's step 7 leaves that place for it). A style field's owner is `token` when the element's inline value in the source is exactly `var(--<name>)` or `var(--<name>, <fallback>)`, with `<name>` a CSS name or former name of the project kit, and the live inline value is the same text (so no script replaced it). A `var()` of a name the kit does not have is not a token: the field shows the text as written, `Detach` is not offered, and the rest of spec 18's order decides (a `source` field's input then edits it as text). In script (motions), `unframed.token("<path>")` or `unframed.token("--<name>")` written straight as a value is the same owner, for any later spec that reads scripts.

**`var(--…)` in style values.** Spec 18's `styleValueRefusal` refuses `var(` in every value. This spec opens it for kit names only: `styleValueRefusal(property, value, kitNames)` accepts a value that is exactly `var(--<name>)` or `var(--<name>, <fallback>)` with `<name>` among `kitNames` (the kit's CSS names and former names) and a fallback that itself passes; every other `var(` is still refused. The engine passes the project kit's names; with no kit the list is empty and spec 18's rule is unchanged.

**Style rule references.** One address for a declaration's rule, used by this spec's `token` edit and by every later edit that targets a rule:

```ts
type StyleRuleRef = {
  block: number       // index of the <style> element in document order, counting every <style> element
  selector: string    // the rule's selector text exactly as written
  occurrence: number  // which rule with that exact selector text in that block, 0 first
}
```

A rule inside an at-rule (`@media`) is addressed the same way, its selector as written; the at-rule is not part of the address. In spec 18's burst a `StyleRuleRef` is a target, so the burst keys an edit of a rule by the rule and the property.

**The `token` edit** (joins spec 18's edit union, with spec 18's shape):

```ts
{ type: "token"; elementId?: string; rule?: StyleRuleRef; property: string; token: string /* path */ }
// exactly one of elementId and rule
```

With `elementId` it sets the element's inline style property to `var(--<css name>)`, as spec 18's `style` edit sets a literal, and its burst target is the element; a text style writes all five longhands, each to its sub-name. With `rule` (used here only by Off-token values) it replaces the value of that property's declaration in the rule `rule` names, keeping every other byte, and is refused with `That style changed. Pick the value again.` when the rule or its declaration of that property is gone. Both forms refuse a path the kit does not have: `There is no token {path} in the kit.` `applySourceEdits` applies it like spec 18's edits, and the commit is spec 18's (bursts, the base file, the agent wins). Its summary line is `Token · {label}` (`Token · In styles: .hero h1` for a rule).

**Off-token values.** A section at the foot of the Design tab, closed by default, headed `Off-token values ({n})`, shown only when the project has a kit. It lists `offTokenValues(source, kit)` for the artifact's current source (the source spec 18's editor reads), one row per place: the element's label from the Layers tab (or `In styles: {selector}`), the property, the literal and the token it is near, with `=` for exact. Clicking a row selects its element in the frame (a style row selects the elements its selector matches, through spec 18's pick). Each row has `Use token`, which adds a `token` edit for that place to the burst: with `elementId` for an inline value, with `rule` (the row's `StyleRuleRef`) for a style rule. With none: `Every value here is on the kit.` The count updates after each commit.

**The Tokens line.** When the project has a kit, the top of the Design tab shows `Kit: {name}` and the artifact's mode, and opens the Kit dialog on click.

### Off-token rules

`offTokenValues(html, kit)` is pure, used by the Design tab and the write tools, with these thresholds. A literal is compared with each token's resolved value in every mode, and the nearest token wins (exact before near, then the smaller difference, then kit order).

**Where it looks.** Declarations in `<style>` elements (custom property declarations included, except a kit CSS name, which is the author redefining a token and is left alone), inline `style` attributes, and the SVG attributes `fill`, `stroke` and `stop-color`. Not in script text, not inside a `var()` (its fallback included), not in comments.

| Literal (property) | Compared with | Exact | Near |
| --- | --- | --- | --- |
| colour (any property; hex, `rgb()`, `hsl()`, `oklch()`, named) | `color` tokens | ΔE below 0.05 and the same alpha | ΔE at most 2.0 and alpha within 0.02 |
| length in `padding*`, `margin*`, `gap`, `row-gap`, `column-gap` | `dimension` tokens, spacing paths first | equal in px | within 2 px and within 12.5 % of the token |
| length in `border-radius*` | `dimension` tokens, radius paths first | equal | same as above |
| length in `font-size`, `line-height`, `letter-spacing` | `dimension` tokens and text style fields | equal | same as above |
| `font-weight` | `fontWeight` tokens | equal after `normal` = 400, `bold` = 700 | none |
| `font-family` | `fontFamily` tokens | the first family equal, ignoring case and quotes | none |
| `box-shadow` | `shadow` tokens | equal after whitespace and zero units are normalised | none |
| time in `transition*`, `animation*` | `duration` tokens | equal | within 20 ms or 10 % |
| `cubic-bezier()` in `transition*`, `animation*` | `easing` tokens' CSS forms | each coordinate within 0.01 | none |

ΔE is the distance in OKLab times 100. Lengths convert `rem` and `em` at 16 px; `%` compares only with `%` tokens. Never flagged: fully transparent colours, `0`, lengths of 1 px or less, negative lengths, `auto`, keywords such as `inherit`.

### The agent

**`kit_read {}`** (`{ project? }` on the outside list, spec 14). Answers `{ kit: null }` with no kit, else:

```ts
{ name, modes: string[], defaultMode: string,
  tokens: [{ path, css: string, type, value?, values?, aliasOf?, description?, formerNames? }],
  from?: { library: name, revision, updateAvailable: boolean } }
```

`value` and `values` are as stored; an alias also reports `aliasOf` and its resolved value under `resolved`. The description (asset below) tells the agent to use `var(<css>)` in CSS and `unframed.token("<path>")` in script, to never set `data-theme` itself, never redefine a kit CSS name, and that each artifact's mode is in `canvas_read`.

**`kit_write { ops }`** (`{ project?, ops }` outside). `ops` is a list of the kit ops (Kit edits above, `remove` excluded: deleting the kit is the person's). All ops apply or none: the first refusal answers a tool error `{ "error": "op {n}: {sentence}" }` and writes nothing. On success the kit is written through spec 02's `apply` with origin `chat:<chatId>`, the tokens script follows by the after-commit rule, and it answers `{ ok: true, tokens: n, modes, clock }`. It records a tool activity with the summary `Updated the kit` (or `Created the kit`), which spec 08's work log shows. In plan interaction mode it is refused by spec 07's permission policy, as the other write tools are; otherwise it is allowed in every mode, as `page_write` is.

**Turn changes.** Spec 07's turn changes gain kit rows: one per token path the turn touched, keyed `kit:<path>`, plus `kit:modes` for the mode list and default and `kit:name` for the name, each with `before` and `after` as the token (or list, or name) JSON, null for absent. Several writes collapse as shape rows do. **Revert** treats each kit row as it treats a shape: when the current value equals `after`, it restores `before`; otherwise it skips that row and names it in `skipped` as `the token {path}` (by the person, another chat or a later turn, read from the change log). So a revert takes back the agent's tokens and leaves alone one the person changed since. The kit restores go into the revert's one room write. Spec 08's diffs show no kit rows.

**The change note.** Spec 07's change note counts the person's kit commits since the last turn as `the kit` (for example `You changed 3 shapes and the kit since the last message.`), so the agent knows to `kit_read` again.

**Artifact tool descriptions.** `page_write` and `motion_write` gain the kit paragraph (asset below) after the dials text. The paragraph is static (the tool list is the same for every project, and the stdio shim answers it while Unframed is closed, spec 14), so it says: when `kit_read` returns a kit, use its tokens. **`canvas_read`** gains a top-level `kit: { name, tokens: n, modes } | null`.

**The off-token note.** `page_write` and `motion_write` succeed exactly as before and their result gains `offToken` when the written file has off-token values: `{ count, notes: string[] }`, at most 10 notes, each `{literal} is {css name}` (exact) or `{literal} is near {css name} ({token value})`, deduplicated by literal and token with `(×{n})` when repeated, and a last note `and {n} more` past 10, followed by the fixed sentence from the asset. The scan runs on the file as written (tags injected), against the current kit. It never refuses a write and adds nothing when the project has no kit.

**Outside agents.** `kit_read` and `kit_write` join spec 14's outside list and the in-app list, the stdio shim's copy included, and spec 07's required-tool check counts them.

### RPC methods

All over spec 01's RPC socket, failing with spec 01's `UnframedError`. Person edits to the kit itself go through the room, not RPC.

| Method | Input | Success | Failures |
| --- | --- | --- | --- |
| `kit.usage` | `{ project }` | `{ tokens: Record<path, shapeId[]>, modes: Record<mode, shapeId[]> }` | `not_found` (no such project) |
| `kit.saveToLibrary` | `{ project, name, summary }` | `{ preset }` | `Give it a name.`; `This project has no kit yet.`; spec 06's read failures |
| `kit.updateInLibrary` | `{ project }` | `{ preset }` | `This kit is not linked to your library.`; `That preset is not in your library.`; `conflict` with the newer-revision sentence above |
| `kit.exportFile` | `{ project, format: "dtcg" \| "css" \| "tailwind" }` | `{ file }` | `This project has no kit yet.`; the write error |
| `motion.renderStart` | spec 09's, plus `mode?` | spec 09's | spec 09's |

`library.list` (spec 06) returns kit entries too. Applying, replacing and merging a kit are room writes made by the web from the preset `library.list` returned, so they are the person's undoable edits; after `kit.saveToLibrary` or `kit.updateInLibrary` answers, the web writes the project kit's new `from` into the room the same way, so the engine writes the library and never the room for these two.

### Persisted formats

- The document record's `meta.unframed.kit`: `Kit` above.
- Page and motion props gain `mode?: string`, with a migration.
- A `presets.json` entry with `kind: "kit"` (above). `Preset.kind` gains `"kit"` beside spec 06's kinds and spec 16's flows; a kit entry has `kit` and `revision` and no `content`.
- `unframed-tokens.js` in each project folder that has had an artifact written since this spec (a helper file, regenerable from the room).
- The snapshot record (spec 09) gains `mode` and `kit` (the stamp); the snapshot file name gains them.
- The render sidecar gains `mode?` and `kit?: { name, stamp }`.
- The live pointer gains `mode` and `kit` (the stamp).
- The export sidecar above.
- `turn_changes` holds kit rows keyed `kit:<path>`, `kit:modes` and `kit:name`.

### Rules this spec bends

00-index requires a spec that bends a shared rule to say so and why. This one bends the following, and keeps the rest.

1. **Spec 09, user story 65 and The live viewer**: "A versioned artifact file opened on its own still plays with the values it was written with" and "The versioned file opened on its own is unchanged: no pointer, no panel, the values it was written with." With a kit, a version's dial values are still the ones it was written with, but its token values are the kit's now: every version of every artifact in the project, old ones included, shows today's kit. Spec 09's Solution ("Every edit writes a new file … so no file is ever overwritten and undo … shows the previous version") still holds for the bytes of the file, which never change; what it links changes, as a page that shows a project picture changes when that picture is replaced. Why: the person decided it, and it is the point of a kit: one change restyles the brand everywhere, with no new version of every file and no agent rewrite. Renders are files and do not change. Only tokens bend this; dials, the file and everything else keep spec 09's rule.
2. **Spec 09, Motion, Tag injection**: "A motion gets the runtime tag first, then the bridge tag. A page written by the agent gets only the bridge tag." Every page and motion file write, by every writer spec 18 extended the injection to (uploads, drops and pastes included), also gets the tokens tag, placed right after `<head>`, before the others.
3. **Spec 09, The motion library**: "A page write ensures only the bridge file (same size rule)." A page write also ensures `unframed-tokens.js`, and so does a motion write. The tokens script is a helper file kept current by rewriting, like the bridge; it is not one of the five library files, and its rule is "differs from the kit's output", not "differs in size".
4. **Spec 09, The viewer page**: "Everything else is ignored." The viewer also relays `unframed:tokens:mode` and `unframed:tokens:set` from its canvas to the composition.
5. **Spec 09, Shapes**: "This spec adds no prop." Pages and motions gain `mode` (spec 18 adds its own prop as well).
6. **Spec 09, Keeping artifacts off the canvas thread, 3 (Snapshots)**: the triggers gain a kit change (for artifacts that load the tokens script) and a mode change, and the snapshot's name and record gain the mode and kit stamp.
7. **Spec 09, Rendering and The live viewer**: `motion.renderStart` gains `mode`, the render variables gain `unframedMode`, the render sidecar gains `mode` and `kit`, and the live pointer gains `mode` and `kit`.
8. **Spec 09, Dials, The bridge**: the bridge re-applies its last declaration on the `unframed:tokens` window event.
9. **Spec 06, The library and Out of Scope**: "Versioned presets, 'update all instances', and any link from an inserted preset back to its preset." A kit preset has a revision and can be updated in place, and an applied kit links back to its preset for "Update from kit". Group, recipe and flow presets keep the rule. `kind` gains `kit`, the type toggle gains `Kits`, a kit card's button reads `Apply`, and "A saved preset carries no bytes" holds (a kit is values, not files).
10. **Spec 07, Canvas change log, turn changes and revert**: turn changes record kit rows as well as shapes, and Revert restores or skips them token by token with the shape rule. The tool lists, the required-tool check and the permission policy gain `kit_read` and `kit_write`. `canvas_read` gains `kit` and an artifact's `mode`; `canvas_write`'s update gains `mode`. The change note counts kit changes.
11. **Spec 14, The outside tool list**: `kit_read` and `kit_write` join it, with `project` on outside calls.
12. **Spec 02, Shape kinds and the room**: the room accepts the document record's `meta.unframed.kit` and refuses an invalid one; the bottom bar gains `Kit` beside Library.
13. **Spec 18, The Design tab, the owner rule, the edit union and `styleValueRefusal`**: its token slots are filled as above, its owner rule gains `token` before step 4, its edit union gains `token`, its burst targets gain `StyleRuleRef`, and `styleValueRefusal`'s "`var(` in this spec (spec 19 opens `var(--…)`)" opens for the kit's names only.

The build pull requests for this spec update each passage named above as the behaviour lands, so every spec describes the app as it is.

Not bent: contract 3 (artifacts are still served only by the preview origin, whose route, allow-list and policy do not change), contract 8 (the kit lives in the project's room; the library copy is one of the output folder's two stores), contract 9 (a kit change posts to live frames only and re-renders snapshots in the engine's Chrome), and the hosting contract (spec 01).

## Testing Decisions

A good test drives one of the three seams in 00-index and asserts on what it exposes: return values, RPC answers, the room's records, the files in the project folder and the output folder, the tool results, and what a person sees. No test reaches into the kit store's queue, the snapshot queue or React state.

- **Domain seam** for every rule with many cases, table-driven: `kitRefusal` for each sentence; `cssName` and collisions, text style sub-names included; every value form per type, accepted and refused; aliases (chains, type mismatch, unknown, cycles) and `resolve` per mode with the default fallback; `applyKitOps` for every op, all-or-nothing, a mode rename carrying former names untouched, a token rename adding a former name; the ease catalogue (31 entries, labels, samples against GSAP's `parseEase`) and the easing table; `kitCss` (default on `:root`, only differing values in mode blocks, former names); `mergeKit` for every row of the merge table and the mode rules; `replaceKit`; `fromDtcg` (groups, inherited types, both value forms, modes from file names and from the extension, skipped counts) and `fromCss` (each mode selector, type inference, skipped counts); round trips `toDtcg` then `fromDtcg` and `kitCss` then `fromCss`; `toTailwind`; `offTokenValues` for each threshold row, each never-flagged case, nearest-token choice, every place it looks or does not, and its `StyleRuleRef` places; the `token` edit in both forms and `styleValueRefusal` with kit names; `tokenUses`; `tokensForField` ordering; tag injection with the tokens tag (after `<head>`, fallbacks, skip, idempotent, order with the other two).
- **Domain seam** for the built tokens script, evaluated against a stub window (document with and without a head, `__hfVariables`, parent, `postMessage`), as spec 09 tests the bridge: the style first in the head, the mode from variables, `data-theme`, `unframed.token` per type and for a CSS name, the console error, the message checks, a set and a mode message, the `unframed:tokens` event, and the empty kit. And the bridge re-applying on that event.
- **Engine seam** with the real engine and the scripted agent: the room accepting a kit and refusing an invalid one with its sentence; the tokens script written after a kit commit, at room open, and on every artifact write by every writer spec 18 lists, and not rewritten when unchanged; a mode rename moving the shapes on it in the same write; `kit_read` and `kit_write` (every refusal by op number, all-or-nothing, the activity, plan-mode refusal); turn rows and Revert restoring tokens the person did not touch and skipping one they did; the off-token note on `page_write` and `motion_write` (present, capped, absent with no kit, never a refusal); `kit.usage`; `kit.saveToLibrary` and `kit.updateInLibrary` under spec 06's write rule (re-read, unknown entries kept, revision, the newer-revision refusal); `kit.exportFile` with its sidecar; snapshots re-rendered after a kit change and a mode change with the mode posted (skipped with a note where no Chrome is found, as spec 09's are); a render's `mode` reaching the stub renderer's variables and its sidecar; `canvas_read`'s `kit` and `mode`, and `canvas_write`'s mode update and refusal.
- **Browser seam** for the Kit dialog (empty state, new kit, add, edit each cell type, alias, rename with the former name line, delete with its count, modes as columns, one value for all, search and groups, undo of a commit on the canvas), a token change reaching a live page and the editor's frame without a reload and another tab's frame, the `Kit mode` picker in the editor header and the toolbar driving the frame and the snapshot, the live viewer following a mode, the library flows (save, apply, replace, update with a conflict kept and one taken, update in library), import (DTCG files with modes, pasted CSS) with its summary, export with its toast, and the Design tab (offered tokens per field, choosing one, the chip, Detach, the text style picker, Off-token values selecting an element and Use token).
- Prior art: spec 09's bridge tests (a built script against a stub window), spec 06's preset store tests, spec 07's revert tests, spec 16's flow preset tests, spec 18's source edit tests.

## Tasks

1. Kit record and rules: the `Kit` and `Token` schemas, `cssName`, path rules, every value form per type, and each refusal sentence. Seam: domain.
2. Aliases and `resolve`: chains, type checks, unknown targets, cycles, per-mode values with the default fallback. Seam: domain.
3. `applyKitOps`: every op, all-or-nothing, refusals naming the op, former names on a token rename, mode rename, duplicate and delete, the limits. Seam: domain.
4. The ease catalogue: exactly 31 entries in order, `none` labelled `Linear`, every label, and each entry's 24 samples matching GSAP's own `parseEase` (GSAP runs in Node); an easing token refusing a GSAP name outside the catalogue. Seam: domain.
5. Kit output: `kitCss` (default on `:root`, differing values per mode, text style sub-names, former names), the easing table for all 31 names, `kitStamp`. Seam: domain.
6. The tokens script built from the kit rules, against a stub window: the style first in the head, the mode chosen and set as `data-theme`, `unframed.token` per type and by CSS name, the missing-token error, the empty kit. Seam: domain.
7. The tokens script's messages: the parent and origin checks, `unframed:tokens:mode`, `unframed:tokens:set` replacing the style in place, the `unframed:tokens` event; the dials bridge re-applying its last declaration on that event. Seam: domain.
8. Tag injection gains the tokens tag: after `<head>`, the fallbacks, the skip, idempotence, and its order before the runtime and bridge tags. Seam: domain.
9. Contracts and the room: the document record's kit accepted, an invalid one refused with its sentence; the page and motion `mode` prop and its migration. Seam: engine.
10. The kit store: the tokens script written after a kit commit (person, agent, undo, Revert) and at room open, left alone when unchanged, present with no kit; and the tokens tag and script ensured on every writer spec 18 lists: `page_write`, `motion_write`, `motion.upload`, an uploaded or dropped `.html`, an artifact paste's `files.copy`, the node page writer, a source edit and `artifact.prepareEdit`. Seam: engine.
11. `kit_read` and `kit_write`: answers, every refusal by op number, all-or-nothing, the activity, the plan-mode refusal, the in-app and outside lists and the required-tool check. Seam: engine.
12. Kit turn changes and Revert: rows per token, `kit:modes` and `kit:name`; a revert restoring untouched tokens and skipping one the person changed, named in `skipped`. Seam: engine.
13. A mode rename rewrites the shapes' `mode` in the same write: a `kit_write` `renameMode` leaves every page and motion that was on the old mode on the new one, in the one room write the kit change makes, recorded as one turn change that Revert takes back whole. Seam: engine.
14. The change note counts the person's kit changes; `canvas_read` reports `kit` and an artifact's `mode`; `canvas_write` updates `mode` and refuses an unknown one. Seam: engine.
15. `offTokenValues`: each threshold row, the never-flagged cases, nearest-token choice, the places scanned and not scanned, and each style place given as a `StyleRuleRef` (block counting every `<style>`, occurrence among equal selectors). Seam: domain.
16. The off-token note: `page_write` and `motion_write` results with notes, the cap and `and {n} more`, exact and near wording, absent with no kit, never a refusal. Seam: engine.
17. `tokenUses` and `kit.usage`: CSS names, former names and `unframed.token` paths, per token and per mode, over each artifact's current file. Seam: engine.
18. The Kit dialog's empty state and `New kit`; the Kit button in the bottom bar. Seam: browser.
19. The Kit dialog table: groups, search, modes as columns, one value for all, add token, each cell editor (the easing cell listing the 31 eases with their curves and the cubic bezier entry), an alias, a refusal under its field. Seam: browser.
20. Kit commits are one undo step each on the canvas, and reach another tab. Seam: browser.
21. Rename, delete and modes in the dialog: the former-name line and forgetting it, delete confirmations with their counts, add, rename (the artifacts on it following), duplicate, make default and delete a mode, `Used by` with its hover list. Seam: browser.
22. A token change reaches a live canvas page, the editor's frame and a motion (re-applied) without a reload. Seam: browser.
23. Kit modes on artifacts: the `Kit mode` picker in the editor header and in the selection toolbar, shown only with two or more modes, one undo step, the frame following, the default removing the prop, a deleted mode reading as the default; spec 18's `Mode` toggle unchanged beside it. Seam: browser.
24. The built motion viewer relays `unframed:tokens:mode` and `unframed:tokens:set` from its canvas to the composition and ignores them from anywhere else; the built live viewer posts the pointer's mode to its frame. Seam: domain.
25. The live viewer tab follows a kit mode change and remounts its frame on a new kit stamp without a blank moment. Seam: browser.
26. Snapshots after a kit change and a mode change, with the mode posted and the stamp in the record, shown stale until replaced. Seam: engine.
27. Renders take the mode: `unframedMode` in the stub renderer's variables and `mode` and `kit` in the sidecar. Seam: engine.
28. `mergeKit` for every row of the merge table, modes, renamed tokens; `replaceKit`. Seam: domain.
29. The library store for kits: `kit.saveToLibrary` and `kit.updateInLibrary` under spec 06's write rule, unknown entries kept, revisions, the newer-revision refusal, the link set in the room. Seam: engine.
30. The Library dialog with kits: the `Kits` filter, the kit card and its chip, `Apply` on a project with no kit, the replace confirmation, delete's body. Seam: browser.
31. Update from kit: the source line and button, the dialog's counts, a conflict kept and one taken, one undo step; the gone-preset line. Seam: browser.
32. Save to library and Update in library from the Kit dialog, with the subtitle, toasts and the update-first message. Seam: browser.
33. Import formats: `fromDtcg` and `fromCss` with modes, types, aliases and skipped counts. Seam: domain.
34. Export formats: `toDtcg`, `toCss`, `toTailwind`, and both round trips. Seam: domain.
35. `kit.exportFile` for each format: the file under the exclusive-create name, its export sidecar, and the refusal with no kit. Seam: engine.
36. Import and export in the dialog: drop and paste, the summary, one undo step; each export item's toast with its `Reveal` action. Seam: browser.
37. `tokensForField`: the types each field offers and the path-keyword order. Seam: domain.
38. The `token` edit in `applySourceEdits`: with `elementId` (a text style writes five longhands), with `rule` addressed by `StyleRuleRef` (block, selector and occurrence each telling rules apart), exactly one of the two required, the changed-style and unknown-token refusals; and `styleValueRefusal` accepting `var()` of a kit name and refusing any other `var(`. Seam: domain.
39. The Design tab's token button: the offered tokens with mode values, hover preview, choosing one commits a source edit, `No kit yet.`, `Edit kit`. Seam: browser.
40. The token chip and the token owner: a `var()` value for which `fieldOwner` answers `token` shows a chip, another token and Detach commit source edits, a `var()` the kit lacks stays a literal, the text style chip. Seam: browser.
41. Off-token values in the Design tab: the count, rows, selecting an element or a rule's elements, Use token on an inline value and on a style rule, the empty sentence. Seam: browser.
42. Self-contained folders: a project with a kit, copied to a new place and opened in a plain browser from the preview origin, shows its tokens. Seam: engine.
43. Rendering outside Unframed, the person's step, not a test (it needs a real Chrome and ffmpeg, as spec 09's real render does): render the copied project's motion with `npx hyperframes render` from the folder alone and check by eye that its token colours and its mode show; record the result in the pull request.

## Out of Scope

- More than one kit in a project. Sub-brands are modes.
- System kits shipped with the app.
- Token types beyond the eight listed: gradients, borders as composites, transitions as composites, numbers without units, opacity, z-index, breakpoints.
- Tokens in DialKit parameters: a dial's colour does not offer or follow a token.
- Rewriting artifacts when a token is renamed or deleted. Former names keep renamed tokens working; a deleted one is gone.
- Off-token scanning inside script text, and off-token refusals of any kind.
- Following a mode automatically from the app's light or dark scheme, or from `prefers-color-scheme`.
- Live link between a project kit and its library kit: updates are pulled with "Update from kit" and pushed with "Update in library", never automatic.
- The agent applying, replacing or deleting a kit, or reading the library.
- Importing from Figma's API, Style Dictionary configuration, or Tailwind config files; exporting to formats beyond the three.
- Tokens for components' own properties: spec 20 styles components with these tokens and adds nothing here.

## Open decisions

Settled with the person: renders are left alone (item 2), and the wording cleanup below goes ahead.

1. **The older specs' "kit" wording.** The word `Kit` in the UI is settled. Spec 12 and later specs call t3code's component library "the kit" in their text (the kit's Button, the kit's Dialog). Recommendation: the coordinator renames those to "the UI kit's" in the specs this PR touches and in each later spec as it is next changed, so "kit" alone means a token kit everywhere.
2. **Renders and token changes.** A render uses the kit as it is when it starts; its sidecar records the stamp. Recommendation: nothing more. A "the kit changed since this render" mark would be the first stale mark on a render, which no spec has, so it is left out unless the person asks for it.

## Further Notes

- **How the brief maps to this spec.** Tokens and their types, aliases and paths (Paths, CSS names and values); kits with modes (The kit record); kits as a preset kind copied into the project, updated with a merge (The kit in the library); tokens reaching artifacts through a helper beside the dials bridge, with `:root` and `[data-theme]` blocks and `unframed.token()` (The tokens script); every artifact restyled, old versions included, as a bent rule (Rules this spec bends, 1); the mode per artifact (Modes on artifacts); the Kit dialog; the Design tab's tokens, chips and Off-token values; DTCG, CSS and Tailwind (Import and export); `kit_read`, `kit_write`, the descriptions and the off-token note (The agent).
- **Where this departs from the brief, and why.**
  - The brief asks for a tokens stylesheet. The preview origin's allow-list has no `.css`, so the helper is a script that writes a `<style>` element (The tokens script, why a script). The brief's ":root plus [data-theme] blocks" is exactly what that element holds.
  - The brief asks for the project kit in the project database. It is there, as the document record of the canvas room, which tldraw sync keeps in the project database. A table of its own would have needed its own sync to tabs, its own undo and its own revert; the room has all three, and spec 07's turn changes needed only kit rows beside shape rows.
  - The brief suggests opening the Kit dialog from the canvas main menu. tldraw's main menu is hidden (spec 02), so the dialog opens from a Kit button in the bottom bar beside Library, and from the Design tab.
  - The brief says the bridge sets `data-theme`. The tokens script does, because it is the one file that knows the modes, and a page that loads it works outside Unframed with no other helper.
- **Why at most one kit.** Every token becomes a custom property on `:root`; two kits in one project would share one namespace and collide. Modes already cover sub-brands.
- **Why a rename keeps the old name.** An artifact refers to a token by its CSS name in bytes that never change. Rewriting every file that used it would mean a new version of each, which is an agent's job, not a rename's. A former name costs one line in the stylesheet.
- **Why the default mode is on `:root` and modes override.** An artifact without a mode, a file opened on its own and an artifact written before modes existed all show the default with no attribute, and a mode block holds only what differs.
- **Why off-token values are a note and never a refusal.** The person's rule. A literal can be intended, and the agent cannot always tell; a refusal would block a write over a 1 px difference.
- **Contract 9.** The only new work on the app's thread when a token changes is one `postMessage` per live frame (at most the three selected, three pinned, the panel's and the editor's). Snapshots re-render in the engine's Chrome, one at a time.
- **Licences.** The W3C Design Tokens Community Group format is a specification, not code; nothing is copied. Tailwind's `@theme` syntax is followed, not shipped.

### Assets this spec needs

Written at build time, model-facing, under `assets/prompts/`:

- `kit-tools.md`: the descriptions of `kit_read` and `kit_write` and their arguments, including the op list and the usage rules above (use `var(<css>)` and `unframed.token("<path>")`, keep `data-hf-id` and the tags, never set `data-theme`, never redefine a kit CSS name).
- `kit-contract.md`: the paragraph appended to `page_write` and `motion_write` after the dials text: when `kit_read` returns a kit, style with its tokens; motions read durations and eases with `unframed.token()` inside the dials apply (or on the `unframed:tokens` event) so a mode change rebuilds them.
- `off-token-note.md`: the one sentence after the notes in a write result, telling the agent these literals sit close to kit tokens and to use the token unless the difference is intended.
- `change-note.md`: the wording that names the kit among the person's changes.
- `tool-descriptions.md`: `canvas_read`'s `kit` and `mode`, and `canvas_write`'s `mode`.
- `agent-system.md`: one sentence saying a project may have a kit and `kit_read` shows it.
