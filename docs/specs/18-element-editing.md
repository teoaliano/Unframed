# 18 · Element editing

Depends on: 01 to 17 (read 00-index first). It builds on spec 09's artifacts, preview origin, dials and editor, spec 07's MCP server and preamble, and spec 08's rail and composer. Specs 19 to 21 extend what it defines: the edit bridge, source edits and their union, the owner rule, element ids, the editor's tabs and modes, and locks. The passages of earlier specs it changes are listed under "Rules this spec bends"; the build pull requests for this spec update them as the behaviour lands, so each spec describes the app as it is.

## Problem Statement

The agent writes pages and motions, and a person can tune what the agent chose to expose as dials. Everything else needs a sentence to the agent: a heading one size too big, a colour slightly off, a word to fix, a picture to swap. Each of those is a turn, it waits on the agent, and the agent may rewrite more than was asked. Design tools let a person click the thing and change it. Unframed has no way to do that.

Two things make it hard. The file the agent wrote is code, so a value on screen may come from a literal in the HTML, from a dial, or from script arithmetic that no inspector can safely edit. And the agent keeps working on the same file: an edit kept beside the file would drift from it, and an edit the agent overwrites without knowing is lost.

A person also points at things when they talk. "Make this bigger" means nothing to the agent without the element it refers to.

## Solution

The artifact's HTML file stays the truth. A person's edit in the editor becomes a **source edit**: the engine applies it to the current file and writes a new version through spec 09's new-file rule, and the shape's `file` moves to it. Cmd-Z takes it back, as it takes back a replaced page today. The agent reads the new file the next time it reads the artifact, so it sees the person's work without being told.

Every element the agent or a person writes carries a stable **element id** (`data-hf-id`, HyperFrames' own scheme), stamped by the engine on every write and never rewritten, so an edit, a lock or a pointed-at element names the same element across the agent's rewrites.

The editor gains an **Edit** mode, the default, beside **Interact**, which is today's behaviour. In Edit mode, hovering the artifact outlines elements, a click selects one, Shift-click adds, Esc clears, and a double-click on literal text edits it in place. The right column becomes three tabs: **Design** (an inspector for text, fill, shape, spacing, layout, visibility and images), **Layers** (the element tree, with rename, hide and lock) and **Parameters** (today's dials, unchanged).

One **edit bridge**, a script the dials bridge loads into the artifact when the editor asks, reports hover and picks, applies **preview patches** so a change shows at once, and draws nothing: the editor draws the outlines in its own document from the boxes the bridge reports. Edits are collected into a **burst** and written as one version after 1.5 s without a new edit, or as soon as the person switches mode, changes the selection or closes the editor.

The **owner rule** decides what an edit changes. A literal value in the source gets a source edit. A value taken straight from a dial moves the dial, with no new version. Anything the agent's code computes is read-only, with a button that asks the agent to make it editable. A motion's animated properties are read-only too. Edits from the Design and Layers tabs work in both modes; the mode only decides what the pointer and keys do inside the frame.

**Point and tell**: "Tell the agent" puts the selected elements as chips into the composer of the artifact's chat, and the agent receives each one's id, a selector and a short excerpt of its HTML.

The person can **lock** an element in Layers. The agent's write tools then refuse a write that changes or removes it, with a sentence that tells the agent to ask the person to unlock it.

On the canvas only one thing changes: dropping an image shape onto a live page swaps the picture under the drop point.

## User Stories

1. As a person, I want the editor to open in Edit mode, so that I can click the thing I want to change straight away.
2. As a person, I want an Interact mode, switched with I, so that I can still click links, scroll and play the artifact as before.
3. As a person, I want V to bring Edit mode back, so that switching is one key, as in design tools.
4. As a person, I want an outline around the element under my pointer, so that I know what a click will select.
5. As a person, I want a click to select an element and Shift-click to add another, so that I can change several at once.
6. As a person, I want Esc to clear my element selection before it closes the editor, so that I never leave by accident.
7. As a person, I want Shift+Enter to select the parent of the selected element, so that I can reach a container I cannot click.
8. As a person, I want clicks in Edit mode to never follow a link or submit a form, so that selecting never navigates away.
9. As a person, I want a motion to hold still in Edit mode, so that I can select an element that moves.
10. As a person, I want to double-click a piece of text and type over it, so that a typo takes seconds to fix.
11. As a person, I want the Design tab to show the selected element's text, fill, shape, spacing and layout values, so that I can see what it is made of.
12. As a person, I want my change to show in the artifact as I make it, so that I can judge it before it is saved.
13. As a person, I want a series of quick changes saved as one version, so that the folder is not flooded with files.
14. As a person, I want my changes saved when I pause, switch element, switch mode or close the editor, so that I never lose one.
15. As a person, I want Cmd-Z in the editor to take back my last saved change, so that a bad edit is one key away.
16. As a person, I want a value that comes from a parameter to move that parameter, so that the dial and the field never disagree.
17. As a person, I want a value the agent's code computes to be read-only with a plain reason, so that I never make an edit the code would undo.
18. As a person, I want a button that asks the agent to make such a value editable, so that a read-only field is not a dead end.
19. As a person, I want a motion's animated properties shown as read-only, so that I do not fight the animation.
20. As a person, I want to know when a stylesheet rule wins over my change, so that I am not left wondering why nothing moved.
21. As a person, I want to replace a picture from the project's images, newest first, or by uploading one, so that swapping an image is two clicks.
22. As a person, I want to drop an image from the canvas onto a page and have it replace the picture under the drop point, so that I can try a picture in place.
23. As a person, I want a Layers tab listing the page's elements as a tree, so that I can find and select elements that are hard to click.
24. As a person, I want elements the page's script creates shown greyed and read-only in Layers, so that I know they exist and why I cannot edit them.
25. As a person, I want to rename a layer, so that the tree reads in my words and the agent sees the names.
26. As a person, I want to hide and show an element, so that I can try the page without it.
27. As a person, I want to lock an element, so that the agent cannot change what I am happy with.
28. As a person, I want the agent told plainly that an element is locked, so that it asks me instead of working around it.
29. As a person, I want to point at elements and tell the agent about them, so that "make this bigger" means the right thing.
30. As a person, I want several elements pointed at in one message, so that I can ask for one change across them.
31. As a person, I want my unsaved change dropped with a plain sentence when the agent rewrote the artifact meanwhile, so that the agent's work is never silently overwritten.
32. As a person, I want a saved edit to swap in without a blank frame or a lost scroll position, so that editing feels continuous.
33. As a person, I want an artifact made before element editing to become editable when I open it, so that old pages are not second class.
34. As an agent, I want each element to keep its id across my rewrites, so that the person's locks and pointers keep meaning the same element.
35. As an agent, I want the elements the person pointed at in my turn's input, with a selector and an excerpt, so that I edit the right thing.
36. As an agent, I want `canvas_read` to list an artifact's locked elements, so that I can avoid them before I write.
37. As an agent, I want a refused write to name the locked element and what to do, so that I can recover.
38. As an outside agent, I want the same ids, locks and refusals, so that working from a terminal is the same as working in the app.
39. As a person, I want the canvas to pan as smoothly as before while I drag an image over a page, so that editing never makes the board heavy.

## Implementation Decisions

### Terms this spec adds

- **element id**: the `data-hf-id` attribute (`hf-` and four base-36 characters, HyperFrames' scheme) the engine stamps on every element of an artifact's source. Once present it is never changed.
- **source edit**: one typed change to an artifact's HTML, written by the engine as a new version.
- **burst**: the edits the editor collects before it writes them as one version, keyed by target and field. A **target** is an element id here; spec 19 adds a style rule, and a later spec may define another.
- **preview patch**: a change the edit bridge applies to the live document so an edit shows before it is written. Nothing is written by a patch.
- **edit bridge**: the script in an artifact that reports hovers, picks, boxes and styles to the editor and applies preview patches. Its messages are `unframed:edit:*`.
- **owner**: what holds a value on screen, named `source`, `dial`, `script` (the agent's code), `animated` (the motion's animation) or `locked`; spec 19 adds `token`. The **owner rule** says what an edit to that value changes.
- **runtime element**: an element the artifact's script created, which has no element id in the source. Always read-only.
- **lock**: an element id the person locked in Layers, stored on the shape. A locked element cannot be changed by the agent's writes or by the person's edits.
- **element chip**: a pointed-at element in the composer: the artifact, the element id, a selector and an excerpt.
- **Edit mode**, **Interact mode**: the editor's two modes. Interact is spec 09's editor as it is.
- **Design**, **Layers**, **Parameters**: the three tabs of the editor's right column.
- **source tree**: the engine's read of an artifact's source as a tree of elements by id, with their literal values (below).

### Modules

| Module | Package | Interface | New or extended |
| --- | --- | --- | --- |
| Element ids | domain | `stampElementIds(html)` returns the HTML with an id on every element that lacks one, changing nothing else in the text | new, built on `@hyperframes/parsers`' `hf-ids` |
| Source tree | domain | `sourceTreeOf(html)` returns the elements by id with tag, parent, order, name, literal text, inline declarations, hidden flag and image facts | new |
| Source edits | domain | `applySourceEdits(html, edits)` returns `{ ok: true, html, summary }` or `{ ok: false, refusal }`; all or nothing, splicing only the bytes each edit changes | new; specs 19 to 21 add edit types |
| Design fields | domain | `DESIGN_FIELDS` (each field's section, label, CSS properties, value kind, keywords, unit rule); `styleValueRefusal(property, value)` | new |
| Field owner | domain | `fieldOwner({ field, source, live, dials, locked, normalise })` returns the owner | new; spec 19 adds `token` |
| Edit bursts | domain | `addToBurst(burst, edit)` keeps the last edit per target and field, held dial values included; `burstEdits(burst)` lists the source edits in first-edit order and `burstDials(burst)` the held dial values | new |
| Locks | domain | `lockRefusal({ current, next, locked, tree })` returns a refusal sentence or null | new; every later writer of artifact files applies the same check |
| Element chips | domain | `elementChip(element, shape)` builds a chip (selector and excerpt rule); `elementContext(chips, shapes)` builds the preamble part | new |
| Edit bridge | domain | `installEditBridge(win)` and `editBridgeSource()`, built into `unframed-edit.js` as the dials bridge is | new |
| Dials bridge | domain | loads `unframed-edit.js` on the first `unframed:edit:hello` | extended (spec 09) |
| Motion viewer | domain | relays `unframed:edit:*` both ways and maps boxes into its own coordinates | extended (spec 09) |
| Artifact store | engine | every write of a page or motion file injects spec 09's tags and stamps ids; the edit writer and its sidecar; ensures `unframed-edit.js` with the bridge | extended (spec 09) |
| Artifact edit service | engine | `artifact.sourceTree`, `artifact.prepareEdit`, `artifact.edit`, `artifact.images` | new |
| Preview origin | engine | refreshes `unframed-edit.js` on request, as it does the dials bridge | extended (spec 09) |
| Artifact tools, canvas tools | engine | the lock check on `page_write`, `motion_write` and `canvas_write`; `lockedElements` in `canvas_read` | extended (specs 07 and 09) |
| Preamble | engine | the elements part | extended (spec 07) |
| Artifact props | contracts | `lockedElements` with the first artifact migration | extended (spec 02) |
| Edit contracts | contracts | `SourceEdit`, `ElementChip`, the four RPCs, `MessageContext.elements`, the edit sidecar | new |
| Editor modes and tabs, frame overlay, burst controller | web | Edit and Interact, the tab strip, outlines over the frame, the commit and swap | new, inside spec 09's editor |
| Design tab, Layers tab, image picker | web | the inspector, the tree, the picture chooser | new |
| Canvas image drop | web | the drop target on a live page | new |
| Element chips in the composer | web | the chip row of spec 08's Agent tray | extended (spec 08) |

The HTML parsing modules (element ids, source tree, source edits, locks) are called by the engine only. The web receives what it needs over RPC, so no HTML parser ships in the web bundle.

### Element ids

- **The scheme.** HyperFrames' `hf-ids`: an id is `hf-` plus four base-36 characters from a hash of the element's tag, its sorted attributes (minus every `data-hf-*`) and its own text, with a counter for identical twins. It needs no position, so adding a sibling never shifts another element's id. `stampElementIds` uses the package's in-place stamper, which inserts the attribute into each start tag that lacks one and changes no other byte; when the markup does not parse one to one, the package's fallback re-serialises the document, and that is accepted.
- **Which elements.** Every element inside `<body>`, at any depth, including SVG elements and the contents of a composition `<template>`. Not `html`, `head`, `body` or anything in `head`; not `script`, `style`, `template`, `meta`, `link`, `noscript` or `base`; not the contents of a plain `<template>`, whose copies would share ids. So the body itself cannot be selected, and a page's background is edited on its outermost element.
- **Never rewritten.** An element that has an id keeps it. Ids follow elements when the agent moves them, because the agent is told to keep them.
- **Duplicates.** When the same id appears on two elements of one source (the agent copied an element), the first in document order keeps it and each later one gets a fresh id. This is the one case where the engine changes an existing attribute, and only on the copy.
- **When.** On every write of a page or motion file, by any writer: the agent's tools (`page_write`, `motion_write`), `motion.upload`, an `.html` uploaded or dropped through spec 02's upload route, a paste's `files.copy` of an artifact file, spec 16's node page writer, every source edit and `artifact.prepareEdit`. Every one of them gets spec 09's injected tags for its kind (the runtime tag for a motion, the dials bridge tag for both) and then element ids. The stamp runs after tag injection and before the size check, so the 2 MiB limit counts the ids. Injection is idempotent, and a file that already has every tag and every id is written byte for byte as given.
- **Tags on uploads, drops and pastes.** An uploaded, dropped or pasted `.html` now gets the dials bridge tag too (spec 09's injection rule), so it can be tuned and edited like a page the agent wrote. A motion upload already gets both tags.
- **Files written before this spec.** They have no ids, and some have no bridge tag. The editor calls `artifact.prepareEdit` when it opens such a file in Edit mode (The editor, below).
- **Runtime elements.** An element the script creates has no id in the source. One that copies an id from the source (a cloned node) is a runtime element too: a live element whose id an earlier live element already holds is treated as having none.
- **Dependency.** `@hyperframes/parsers` pinned at 0.8.93, the version of the other HyperFrames packages, which already exports `hf-ids`. This spec uses it only through that export. A later upgrade moves it with the others.

### The source tree

`sourceTreeOf(html)` reads the source as the engine wrote it. Per element with an id:

```ts
type SourceTreeElement = {
  id: string; tag: string; parent: string | null; index: number   // order among siblings with ids
  name: string                // data-uf-name, else the derived label below
  named: boolean              // true when data-uf-name is set
  text: string | null         // its text when its children are text only (entities decoded), else null
  style: Record<string, string> // its inline declarations, property lowercased, value as written
  hidden: boolean             // data-uf-hidden is present
  src?: string                // an <img>'s src attribute
  inPicture?: boolean         // an <img> inside a <picture> that has <source> children
}
```

- **Derived label**, the first that applies: the text of a text-only element, cut to 32 characters with `…`; the `alt` of an image; the `id` attribute; the first class; the tag name. Labels are for people; the agent is given ids.
- **Text-only** means every child is a text node (comments are allowed and kept). `<br>` and inline tags make an element not text-only, so its text is edited on the inner elements.

### Source edits

The union, in contracts, shared by the web, the engine and the RPC:

```ts
type SourceEdit =
  | { type: "text"; elementId: string; text: string }
  | { type: "style"; elementId: string; property: string; value: string | null }   // null removes the declaration
  | { type: "attribute"; elementId: string; name: string; value: string | null }   // name from the allow-list
  | { type: "hide"; elementId: string; hidden: boolean }
  | { type: "image"; elementId: string; target: "src" | "background"; file: string }
// specs 19 to 21 add members; the attribute names allowed grow with them
```

`applySourceEdits(html, edits)` applies the list in order to one parse of the source and splices the text: only the bytes an edit changes move, so the agent's formatting, comments and scripts stay as written. It is all or nothing: the first refusal stops it and nothing is written.

- **text**: the element must be text-only. Its content is replaced with the text, with `&`, `<` and `>` escaped. Refusal: `{label} holds more than text, so its text cannot be edited here.`
- **style**: sets or removes one declaration in the element's `style` attribute, creating the attribute when needed. An existing declaration of that property is replaced in place, keeping its `!important` when it had one; a new one is appended after the others, before a hide declaration. The property must be one of `DESIGN_FIELDS`' properties, and the value must pass `styleValueRefusal`: no `;`, `{`, `}`, `<`, `>`, backslash, `!important`, `url(` (except through an image edit), `expression(` or `var(` in this spec (spec 19 opens `var(--…)`), and of the field's value kind. Refusal: `{Field} cannot be "{value}".`
- **attribute**: sets or removes an attribute whose name is in the allow-list, which in this spec is `data-uf-name` only. A later spec that adds a name bends this rule and states the summary line its name writes. A name is trimmed, at most 60 characters, and an empty name removes the attribute. Refusal for another name: `The attribute {name} cannot be edited here.`
- **hide**: hidden adds `data-uf-hidden` and the declaration `display: none !important` as the last in the element's `style`; shown removes both and nothing else. An inline `!important` declaration wins over every stylesheet rule, which is why the hide lives in the style attribute. A script that later sets the element's `display` can still show it; that is the agent's code, as anywhere else.
- **image**: `file` must be a bare project file name with an image extension the preview origin serves (png, jpg, jpeg, webp, gif, svg; the engine also checks it exists). `src` sets the `<img>`'s `src` to the file name and removes `srcset` and `sizes`; it refuses an image inside a `<picture>` with sources: `This picture chooses its file from a list of sources. Ask the agent to change it.` `background` is a style edit of `background-image` to `url("{file}")`. A relative name works everywhere the artifact is shown, because the preview origin and renders serve the project folder beside it.
- **Every type** refuses an id the source does not have: `There is no element {id} in this {kind} any more.`
- **Summary.** Each edit adds one line, `{Field} · {label}` (`Text · Hero title`, `Font size · Hero title`, `Name · Card`, `Hidden · Badge`, `Image · Hero picture`), with repeats dropped, at most 20 lines and `and {n} more` after them. It goes into the sidecar and the work log.

### The edit bridge

- **Where it lives.** A second helper file, `unframed-edit.js`, generated from the domain module like `unframed-dials.js`, written beside it whenever the dials bridge is ensured, and refreshed by the preview origin when a frame asks for it. No new tag goes into any artifact: the dials bridge appends `<script src="unframed-edit.js">` to the document the first time its parent sends `unframed:edit:hello`. Why a second file loaded on demand: every artifact that already carries the dials bridge becomes editable without a rewrite; canvas frames, which never say hello except for an image drop, carry no edit code; and the dials bridge, which every frame runs, stays small. `script-src 'self'` allows the load, so the preview origin's policy does not change.
- **Message rules**, the dials bridge's: the edit bridge accepts a message only when `event.source` is `window.parent` and the origin is its own or loopback, and it posts to the origin that said hello. The editor accepts `unframed:edit:*` only from its own frame's window. A motion's viewer relays every `unframed:edit:*` message both ways between the editor and its composition, as it relays dials.
- **Coordinates.** Boxes are `{ x, y, w, h }` in CSS pixels of the document the editor frames: the page itself, or for a motion the viewer, which maps the composition's boxes through the player's offset and scale before it relays them. The editor maps them once more by its preview size scale and draws the outlines in its own document, in a layer over the frame that takes no pointer events. The bridge draws nothing.
- **What it reports about an element** (`ElementReport`): its element id or null; for a runtime element a live selector (the nearest ancestor with an id, then `> tag:nth-of-type(n)` steps); the tag; the box; its own text when text-only; its live inline value and computed value for every property in `DESIGN_FIELDS`; its live `src` for an image; and for a motion the CSS properties the motion animates on it: every tween in `window.__timelines` that targets the element, its vars minus GSAP's own keys (duration, ease, delay, repeat, yoyo, stagger, callbacks), camel case turned to CSS names, and `x`, `y`, `scale`, `rotation` and their kin reported as `transform`.
- **Edit mode in the frame.** After `unframed:edit:mode { mode: "edit" }` the bridge listens in the capture phase: pointer moves report the hovered element (`unframed:edit:hover`), a click reports a pick (`unframed:edit:pick { element, additive }`, additive with Shift), and the default action of clicks, pointer presses, form submits, drags and key presses is prevented, so nothing navigates or types. A wheel still scrolls. It forwards V, I, Esc, Shift+Enter and the editor's undo keys to the editor as `unframed:edit:key`. While an in-place text edit is active (below), the bridge neither prevents nor forwards key presses, except Esc and Enter, so typing reaches the text. A pick takes the deepest element under the pointer that has an id or is a runtime element, skipping elements inside a locked one. Interact mode removes every listener.
- **Boxes follow.** While anything is hovered or selected the bridge compares those boxes once per animation frame, only while the document is visible, and posts `unframed:edit:boxes` when one moved (scrolling, a resize, a motion seek, a patch). Nothing is measured when nothing is selected.
- **Patches.** `unframed:edit:patch { patches }` applies style, text, hide and image changes to the live elements, recording each original inline value the first time it touches it; `unframed:edit:reset` puts every original back. After each patch it reports the element again, and flags a style patch that left the computed value as it was while the patched value differs (`overridden: true`).
- **Text in place.** On a double-click of a text-only element with an id, the bridge reports `unframed:edit:textStart { id }`; when the editor allows it (the owner rule) it answers `unframed:edit:textEdit { id }`, and the bridge makes the element `contenteditable="plaintext-only"`, selects its text and focuses it. Enter or leaving the element ends it with `unframed:edit:text { id, text }`; Esc ends it with the text put back and no message. Shift+Enter inserts nothing, since a text edit holds one run of text.
- **The tree.** `unframed:edit:tree` answers the live elements under the body as a tree of `{ id | null, selector, tag, children }`, for Layers.
- **Hit test.** `unframed:edit:hitTest { x, y }` answers `unframed:edit:hit { elementId, target, box }` for the image under that point: the deepest element there that is an `<img>` (target `src`) or has a computed `background-image` other than `none` (target `background`), walking up to the first such ancestor; null when there is none, it has no id, or it sits in a locked element.
- **Motions in Edit mode.** The viewer pauses the player when the mode becomes Edit; the player's own controls still seek, and the boxes follow. Interact leaves the player as the person left it.
- **HyperFrames' own picker.** The HyperFrames runtime ships a picker for its Studio. Unframed does not use it: pages are not HyperFrames documents, and one bridge for both kinds keeps pages and motions alike.

Protocol summary (editor is the editor's frame host; a motion's viewer relays every row):

| Message | Direction | Body |
| --- | --- | --- |
| `unframed:edit:hello` | editor to frame | none; the dials bridge loads the edit bridge |
| `unframed:edit:ready` | frame to editor | none |
| `unframed:edit:mode` | editor to frame | `mode: "edit" \| "interact"`, `locked: string[]` |
| `unframed:edit:hover` | both ways | frame to editor: `element \| null`; editor to frame (from Layers): `id \| null` |
| `unframed:edit:pick` | frame to editor | `element, additive` |
| `unframed:edit:select` | editor to frame | `ids` (the bridge then reports each) |
| `unframed:edit:report` | frame to editor | `elements: ElementReport[]` |
| `unframed:edit:boxes` | frame to editor | `boxes: Record<id or selector, Box>` |
| `unframed:edit:patch`, `unframed:edit:reset` | editor to frame | `patches` / none |
| `unframed:edit:textStart`, `unframed:edit:text` | frame to editor | `id` / `id, text` |
| `unframed:edit:textEdit` | editor to frame | `id` |
| `unframed:edit:key` | frame to editor | `key, shift, meta, ctrl` |
| `unframed:edit:tree` | both ways | none / `nodes` |
| `unframed:edit:hitTest`, `unframed:edit:hit` | canvas or editor to frame / back | `x, y` / `elementId, target, box` |

### The owner rule

`fieldOwner` answers, in this order, the first that applies:

1. `locked`: the element or an ancestor is locked.
2. `script`: a runtime element.
3. `animated`: a motion animates one of the field's properties on the element.
4. For a style field, compare the live inline value with the source's inline value (both normalised by the caller's `normalise`, which in the web is the browser's own CSS parsing in a scratch element). Equal, or absent in both: `source`. They differ, so a script set it: when exactly one dial value, at any folder depth, equals the live value, or equals it with a CSS unit appended (`v.size + "px"`), or as a colour after normalising, the owner is `dial` with that dial's path; otherwise `script`. Two dials with the same value are ambiguous and give `script`.
5. Text: the source text equals the live text (whitespace runs collapsed): `source`; a text dial equals it: `dial`; else `script`. An element that is not text-only has no text field.
6. Image `src`: the same comparison with the source attribute.
7. Spec 19 inserts `token` before 4 for a value that is a `var(--…)` reference.

What each owner does in the Design tab:

| Owner | Field | Edit |
| --- | --- | --- |
| `source` | editable | a source edit in the burst |
| `dial` | editable, with a SlidersHorizontal mark whose tooltip is `Parameter {path}` | sets the dial: posted to the frame at once, its write to `dials` held in the burst (Bursts, below). A range dial stops at its min and max. Moving the dial in Parameters moves the field, because the bridge reports the element again after each dial set. A dial drives every element it is applied to, so the edit moves them all |
| `script` | read-only | none. The section shows `Set by the agent's code.` and a ghost button `Ask the agent to make this editable` |
| `animated` | read-only | none. The section shows `Animated by the agent's code.` (a later spec may link it) |
| `locked` | read-only | none. The tab shows `Locked. Unlock it in Layers to edit it.` |

A value set from a stylesheet, inherited or left to the browser's default is `source`: the edit writes an inline declaration, which wins over the stylesheet. When the bridge reports `overridden` (a stylesheet `!important` rule wins), the field shows `A stylesheet rule wins over this value.` and the edit leaves the burst.

With several elements selected a field is editable when every element's owner is `source`, and a value the elements do not share shows `Mixed`. A dial-owned field is editable with one element selected only.

### Bursts, commits and the swap

- **Collecting.** Each edit is posted to the frame as a preview patch and added to the burst. The burst is keyed by **target and field**: a later edit of the same target and field replaces the earlier one, so a scrubbed number is one edit. In this spec a target is an element id; spec 19 adds a style rule, and a later spec may define another kind of target, keyed the same way.
- **Dials inside a burst.** A dial value changed from the Design tab (or from any later editor surface that edits through the owner rule) is posted to the frame at once, like a patch, and its write to the shape's `dials` is held in the burst, keyed by the dial's path. At commit the held dials are written in the same tldraw history step as the burst's new `file`, so one Cmd-Z takes back the whole adjustment. A burst with no source edits writes its held dials alone at commit time, as one step, with no `artifact.edit`. When the burst is dropped (a conflict, a refusal, Cmd-Z), its held dials are dropped with it and the frame gets the shape's saved dials back. A dial moved in the Parameters tab keeps spec 09's behaviour (its own write after 400 ms, its own undo step), and takes that dial out of a pending burst, so the Parameters value wins.
- **Edits work in both modes.** Edits from the Design tab and the Layers tab (and from any later editor surface) work in Edit and Interact alike. The mode only decides what the pointer and keys do inside the frame.
- **Committing.** The burst commits 1.5 s after its last edit, and at once when the person switches mode (either way), changes the editor's selection (any change of the selected set, of elements or of anything a later spec lets the person select in the editor), or closes the editor with Back or Esc. When the editor closes because the artifact was deleted, the burst is dropped. Committing sends `artifact.edit { project, shapeId, baseFile, edits }` with the file the burst began on, when the burst holds source edits.
- **Setting the file.** On success the web sets the shape's `file` to the answered file, with the burst's held dials, as a person edit, one tldraw history step, only if the shape's `file` still equals `baseFile`. Otherwise it shows the race sentence (below). The engine never sets `file` for a source edit, because only a person's change enters their undo history.
- **The swap.** The new version is a new document, as every version is (spec 09, keyed by file). The editor loads it in a second frame behind the one on screen, sends it hello, the saved dials, the mode and the selection, restores the scroll position (and for a motion the playhead time), and shows it in place of the old one at its load event. So a saved edit never blanks the frame, and the patches the old document carried go with it.
- **Undo in the editor.** Cmd-Z and Cmd-Shift-Z (Ctrl on Windows and Linux), with the focus outside a text field, run tldraw's undo and redo, stopping at a mark the editor sets when it opens, so they walk only what was changed in this editor session: committed edits, dial changes and lock changes. With a burst pending, Cmd-Z drops the burst instead: the frame is reset and gets the saved dials back, and nothing is undone.
- **A refusal.** `bad_request` from `artifact.edit` shows its sentence in a toast, resets the patches and drops the burst.
- **The agent wins a race.** When the shape's `file` changes while a burst is pending, or `artifact.edit` answers `conflict`, the burst is dropped with its held dials and the editor shows a warning toast: `The agent rewrote this. Your last change wasn't saved.` when the change came from a chat (`details.reason: "agent"`), else `This {kind} changed somewhere else. Your last change wasn't saved.` The frame shows the new version; the selection is kept for every id it still has. Nothing is replayed.

### RPC methods

All over spec 01's RPC socket, failing with spec 01's `UnframedError`.

| Method | Input | Success | Failures |
| --- | --- | --- | --- |
| `artifact.sourceTree` | `{ project, file }` | `{ ready, elements: SourceTreeElement[] }`; `ready` is true when every element has an id and the file carries the dials bridge tag | `not_found`: `No file {file} in this project.` |
| `artifact.prepareEdit` | `{ project, shapeId }` | `{ file }`: a stamped version with the bridge tag (and a motion's runtime tag), or the current file when it is already ready | `not_found` for a shape that is not a page or motion: `There is no page or motion {shapeId} on this canvas.`, or one with no file: `This {kind} has no file yet.` |
| `artifact.edit` | `{ project, shapeId, baseFile, edits: SourceEdit[] }` | `{ file, summary: string[] }` | `not_found` as above; `conflict` when the shape's file is no longer `baseFile`, with `details.reason` `"agent"` when the change that moved it came from a `chat:` origin, else `"elsewhere"`; `bad_request` with the refusal from `applySourceEdits`, a lock (`{label} is locked. Unlock it in Layers to edit it.`), an empty list (`There is nothing to save.`), or the size limit (`The {kind} would be too large ({n} bytes; the limit is 2097152).`) |
| `artifact.images` | `{ project }` | `{ images: [{ file, fileName, at }] }`: the project folder's images the preview origin serves (png, jpg, jpeg, webp, gif, svg), newest first by file time, `fileName` the sidecar's original name or the file name | `not_found` for an unknown project |

`artifact.edit` reads the base file, applies the edits, injects the tags spec 09 injects for the kind (idempotent), stamps ids, checks the size, and writes the result through spec 09's new-file rule (`<epochMs>-<slug of title>[-<n>].html`, exclusive create) with the edit sidecar. `artifact.prepareEdit` does the same with no edits, its sidecar summary `["Element ids added"]`; the web sets the answered file with the history ignored, so Cmd-Z never brings back a file the editor would prepare again.

### Persisted formats

```ts
// ArtifactShapeProps (spec 02, spec 09) gains:
lockedElements?: string[]       // element ids, absent when none; the first artifact migration adds it

// Sidecar of a source edit or a prepare, beside the new file:
{ source: "edit", kind: "page" | "motion", of: string /* the base file */, shapeId: string,
  edits: string[] /* the summary */, title: string, bytes: number, at: string /* ISO */ }

// MessageContext (spec 07) gains:
elements?: ElementChip[]
type ElementChip = {
  shapeId: string; elementId: string | null   // null for a runtime element
  selector: string                            // [data-hf-id="hf-ab12"], or the live selector of a runtime element
  tag: string; label: string
  excerpt: string                             // at most 240 characters
}
```

In the artifact source: `data-hf-id` (ids), `data-uf-name` (a person's layer name) and `data-uf-hidden` with its `display: none !important` declaration (a hide).

### The editor

Spec 09's editor, with these changes. Contract 9 holds: everything below runs in the editor, which replaces the canvas on screen, or in the artifact's own process.

- **Header.** After the kind word, a UI kit ToggleGroup labelled `Mode` with two items: `Edit` (MousePointer2 icon, tooltip `Edit (V)`) and `Interact` (Hand icon, tooltip `Interact (I)`). It shows only when the artifact has a file. Under spec 09's 520 px header rule the items show their icons only, their words kept as accessible names, and the header still never overflows.
- **Mode.** Edit on every open. V and I switch from anywhere in the editor except a text field or an in-place text edit, and from inside the frame through the bridge. Switching mode commits the burst. Interact hides the outlines; the selection is kept, and the Design and Layers tabs keep editing it, since the mode only decides what the pointer and keys do inside the frame.
- **Opening in Edit mode.** The editor reads the file's source tree. When it is not ready, the editor calls `artifact.prepareEdit` first and the frame swaps to the prepared version; until then the frame shows the artifact and the Design tab reads `Getting this {kind} ready for editing…`. When the prepare fails, the tab shows its sentence and the editor stays usable in Interact.
- **Outlines.** Hover: a 1 px outline in `--ring`. Selected: a 2 px outline in `--primary` with a small label above it (the layer name, and the tag in muted text). Several selected: each outlined. A locked element shows no hover outline. Outlines are drawn from the reported boxes at most once per animation frame.
- **Keys in Edit mode.** Esc ends an in-place text edit; else clears a non-empty selection; else closes the editor as spec 09 says. Shift+Enter selects the parent of the one selected element (the nearest ancestor with an id).
- **Right column.** Its 48 px header becomes a UI kit Tabs list (`Design`, `Layers`, `Parameters`) over the same card. Design is shown on open; the choice is remembered per artifact for the session, like the preview size, and never written. Parameters is spec 09's column, unchanged, with its add-a-parameter box.
- **Selection** is the editor's, held in memory: a list of element ids (or live selectors for runtime elements). It is cleared when the editor closes.

### The Design tab

- **Header row**: the selected element's name and its tag in muted text, or `{n} elements`; then a small outline Button `Tell the agent` (MessageSquarePlus icon). With nothing selected the body reads `Select an element to edit it.` and, in Interact mode, `Switch to Edit (V) to select in the {kind}.`
- **Sections**, each shown when it applies, every field a UI kit control with a trailing token slot that is empty in this spec (spec 19 fills it):

| Section | Field | CSS property | Control and values |
| --- | --- | --- | --- |
| Text | Font | `font-family` | Combobox of the families the document uses (reported by the bridge) plus `system-ui`, `serif` and `monospace`, free text allowed; a family with a space is written quoted |
| Text | Size | `font-size` | number, px |
| Text | Weight | `font-weight` | select 100 to 900 in steps of 100 |
| Text | Line height | `line-height` | number; unitless when the value is unitless, else px |
| Text | Letter spacing | `letter-spacing` | number, px |
| Text | Align | `text-align` | toggle group: left, center, right, justify |
| Text | Colour | `color` | colour |
| Fill | Background | `background-color` | colour |
| Shape | Border | `border-width`, `border-style`, `border-color` | number px, select (none, solid, dashed, dotted), colour; one value for all sides |
| Shape | Corner radius | `border-radius` | number px, one value for all corners |
| Shape | Opacity | `opacity` | number 0 to 100 %, written as 0 to 1 |
| Shape | Shadow | `box-shadow` | x, y, blur, spread (px) and colour for one shadow; a value with several shadows is read-only with `Several shadows. Ask the agent to change them.` |
| Spacing | Padding, Margin | `padding-*`, `margin-*` | four numbers (top, right, bottom, left) with a link toggle that sets all four; px |
| Spacing | Gap | `gap` | number px; shown when the computed `display` is flex, inline-flex, grid or inline-grid |
| Layout | Direction | `flex-direction` | row, column, row-reverse, column-reverse |
| Layout | Align | `align-items` | flex-start, center, flex-end, stretch, baseline |
| Layout | Justify | `justify-content` | flex-start, center, flex-end, space-between, space-around, space-evenly |
| Layout | Wrap | `flex-wrap` | nowrap, wrap |
| Visibility | Visible | (the hide edit) | switch |
| Image | Picture | `src` or `background-image` | a thumbnail and `Replace image`, shown for an `<img>` or an element whose computed background image is a single `url()` |

- **Values.** A field shows the computed value. A number field keeps the unit the inline value already uses when it is px, em, rem or %, and writes px otherwise; arrow keys step by 1, Shift by 10; a typed value applies on Enter or when the field is left. A colour field is a swatch that opens a UI kit Popover with the browser's colour input and a hex field, and writes `#rrggbb`, or `#rrggbbaa` below full opacity.
- **Layout** shows only for an element whose computed `display` is flex or inline-flex. Making an element flex, grid and transforms are the agent's (Out of Scope).
- **Read-only** fields follow the owner table above. A runtime element shows every section read-only with the `Set by the agent's code.` line and its button at the top.

### Images

- **The picker.** `Replace image` opens a UI kit Popover titled `Choose an image`: a filter field, then a grid of the project's images from `artifact.images`, newest first, each a thumbnail from spec 02's 512 preview with its original name as the label and tooltip, and at the foot an outline Button `Upload image` that opens the file chooser and uploads through spec 02's upload route. Choosing (or a finished upload) adds an image edit to the burst and patches the frame. Empty: `No images in this project yet.`
- **On the canvas.** While one image shape with a file is dragged over a live page, the canvas posts `unframed:edit:hitTest` to that page's frame at most once per animation frame (the first one loads the edit bridge into it) and draws the answered box as one 2 px `--primary` outline over the frame. Dropping on a hit puts the image shape back where the drag began and swaps the picture: `artifact.edit` with one image edit, at once, no burst; the file change is the one undo step, and the move is not recorded. A refusal shows its sentence in a toast. Dropping where there is no hit is an ordinary move.
- **Staying live for the drop.** Pressing the image deselects the page, which would stop its frame. So the page that was selected alone when the press began stays live until that drag ends (within spec 09's cap of three). Pinned pages and a page with its Parameters panel open are live anyway and are drop targets too. A motion is never a drop target on the canvas; its pictures are replaced in the editor.

### The Layers tab

- **Tree.** The source's elements from the source tree, in document order, nested by parent, with the live tree's runtime elements under their nearest parent with an id, greyed, read-only and labelled by tag. Each row: an icon by tag (text, image, frame, link, button, media, shape), the name, and on hover or when set, the eye and the lock. Rows indent 12 px per level; a parent toggles open and closed (all open on first show; the state is kept for the session).
- **Selecting** a row selects the element in the editor (Shift-click adds); hovering a row outlines it in the frame. Selecting in the frame selects and reveals its row.
- **Rename**: double-click the name, or Enter on a focused row. A UI kit Input; Enter or leaving applies an attribute edit of `data-uf-name` (into the burst); Esc cancels; an empty name removes it, so the derived label comes back. Runtime rows cannot be renamed.
- **Hide and show**: the eye toggles a hide edit (into the burst). A hidden row is dimmed and its eye stays shown.
- **Lock and unlock**: the lock toggles the element id in the shape's `lockedElements`, a person edit with one undo step and no new version. A locked row keeps its lock shown, and its descendants show a faint lock. Locked elements cannot be picked or hovered in the frame (the bridge gets the list with each mode message), can be selected in Layers, and are read-only in Design. Rename and hide still work on a locked element, so a person can tidy what they protected. Runtime rows cannot be locked.

### Point and tell

- **Tell the agent** (Design header), and `Tell the agent` in a Layers row's context menu, make one element chip per selected element and put them into the composer of the artifact's chat in the editor's rail: the newest idle chat tagged with this artifact (spec 08's continuable-chat rule), else a new chat tagged with it. The rail opens on that chat with the focus in the composer. The artifact joins the message's `context.selection` too.
- **Ask the agent to make this editable** does the same for the element whose value is read-only and, when the draft is empty, fills it with the instruction from `assets/prompts/make-editable-instruction.md`, naming the field. Nothing is sent until the person sends it.
- **The chip** is built by `elementChip`. Selector: `[data-hf-id="{id}"]`, or a runtime element's live selector. Excerpt: the element's start tag as in the source (or as live for a runtime element), its own text cut to 80 characters, `…` for any children, and its end tag, cut to 240 characters. Label: the layer name. In the composer it shows as a UI kit Badge chip with the SquareMousePointer icon, `{tag} · {label}`, and a remove button. Several chips are allowed; adding an element already chipped does nothing. Element chips belong to the chat's draft (spec 08's drafts) and to the stash.
- **What the agent receives.** The preamble gains an elements part after the selection, built by `elementContext`: one line per artifact naming its kind, id and label, then one line per chip with its selector and excerpt, in the wording of `assets/prompts/element-context.md`. A chip whose shape is gone is left out. The stored message keeps the chips in `context.elements`, and the person's message bubble shows them with its `· N selected` note counting them.

### Locks and the agent

- **What a lock covers**: the element and everything inside it, in the source.
- **"Changes"**, decided by `lockRefusal` comparing the current file with the new HTML for each locked id: find the first element with that `data-hf-id` in each; none in the new HTML means it was removed. Otherwise compare a normalised serialisation of both subtrees: tag names lowercased; attributes sorted by name, names lowercased, values exact except `style`, whose declarations are split on `;`, trimmed, empty ones dropped and property names lowercased, kept in order; every whitespace run in text collapsed to one space and whitespace-only text nodes dropped, except inside `pre`, `textarea`, `script` and `style`, which are kept exact; comments dropped. Different strings mean it changed. The element's parent, position and siblings are not compared, so the agent may move a locked element or change what is around it.
- **The refusal**, a tool error, naming the first locked element it hits: `The element data-hf-id="{id}" ("{name}") is locked by the person, and this write {changes|removes} it. Keep that element exactly as it is in the current file (page_read shows it), or ask the person to unlock it in the editor's Layers tab.`, with ` {n} more locked elements are changed too.` when there are more. For a motion it says `motion_read`.
- **Where it applies**: `page_write` and `motion_write` updating a shape (after tag injection and stamping, before the file is written, so a refused write leaves nothing), and `canvas_write` `update` ops that set a page's or motion's `file` (against the named file). Every later writer of artifact files applies the same check. A new shape has no locks.
- **Locks belong to the person.** `canvas_write` refuses `lockedElements` in an `update` with `update: lockedElements is set by the person in the editor's Layers tab`. A turn's Revert never changes locks, since the agent cannot set them. `canvas_read` reports `lockedElements` on a page or motion that has any.
- **The person's own edits** of a locked element are refused by `artifact.edit` (above), except rename and hide.
- **Outside agents** (spec 14) use the same tools, so the same stamping, checks and refusals apply with nothing added.

### What the agent is told

- `page_write` and `motion_write` stamp ids on every write, and their descriptions gain the element paragraph (Assets): keep every `data-hf-id`, `data-uf-name` and `data-uf-hidden` on its element, never invent or change an id, and expect a refusal for a locked element.
- The dials contract gains one sentence: when a parameter sets a style or a text, assign its value straight to it (`el.style.color = v.accent`, `el.style.fontSize = v.size + "px"`), so the person can edit it in the Design tab.
- `page_read` and `motion_read` return the current file, so the person's edits are in what the agent reads. The change note (spec 07) already counts a person's commit as the person's change.

### Rules this spec bends

00-index requires a spec that bends a shared rule to say so and why. This one bends the following, and keeps the rest.

1. **00-index, Vocabulary**: "**Editor**: the full-screen view of one artifact: chat on the left, the artifact in the centre, **dials** (DialKit parameters) on the right." The right column becomes the Design, Layers and Parameters tabs, and the editor has Edit and Interact modes. Why: editing needs an inspector and a tree beside the dials.
2. **Spec 02, Shape kinds** (page and motion `props: { w, h, file, title, fileName, dials? }`) and **spec 09, Shapes**: "This spec adds no prop." Artifacts gain `lockedElements`, with the first artifact migration.
3. **Spec 09, Dropping and pasting**: "A dropped page gets no injected tags." Every page and motion file write, by any writer (uploads, drops and pastes included), gets spec 09's injected tags and element ids, so an uploaded file is no longer byte for byte what was dropped. Why: an upload must be editable like any other page, and ids must exist before anything can be locked or pointed at.
4. **Spec 09, Artifact files**: "Upload and copy sidecars are spec 02's (...). This spec adds none." A source edit and a prepare write the `source: "edit"` sidecar. And "Neither writer changes `page_write`, the dials or the live rules." (writers beyond the agent): spec 16's node page writer now stamps ids and injects the bridge tag.
5. **Spec 09, The editor**: "**Right column, Parameters**: header with the SlidersHorizontal icon and `Parameters`." The header becomes the tab list; Parameters is its third tab, unchanged inside. "**Centre body**: the artifact frame (...), keyed by file." A new version from the person's own commit loads behind the current frame and swaps in at its load event (still one document per file).
6. **Spec 09, The editor**: "**Esc** closes the editor unless the event was already handled or the focus is in an input, textarea or contenteditable." Esc first ends an in-place text edit, then clears an element selection, and only then closes the editor.
7. **Spec 09, The editor**: "Canvas keyboard shortcuts are inactive while the editor is open." They stay inactive, but the editor gains V, I, Shift+Enter and its own undo and redo, limited to the editor session. Why: a person expects Cmd-Z right after a bad edit, not after closing.
8. **Spec 09, Keeping artifacts off the canvas thread, rule 2**: "A frame is live only when it has to be." The page selected alone when an image press began stays live until that drag ends. Why: otherwise no page could ever be the drop target. The cap of three holds.
9. **Spec 09, The motion library, the viewer page**: "Everything else is ignored." The viewer also relays `unframed:edit:*` and maps boxes, and pauses its player in Edit mode. **Spec 09, The bridge**: the dials bridge loads `unframed-edit.js` on an edit hello, and the preview origin refreshes `unframed-edit.js` as it does `unframed-dials.js`. The preview origin gains no route and no header.
10. **Spec 07, What the model is told before each message**: "The preamble has up to three parts, each on its own paragraph:" It has up to four: the elements part comes after the selection.
11. **Spec 07, `canvas_write`**: the `update` row, "a shallow patch onto the shape's props", gains two refusals: `lockedElements`, and a `file` change that breaks a lock. `canvas_read` reports `lockedElements`.
12. **00-index, Stack**: "Motion | HyperFrames (`@hyperframes/core`, `player`, `producer`), GSAP" gains `@hyperframes/parsers`, pinned at 0.8.93 with the others, used for its `hf-ids` export. Why: element ids follow HyperFrames' own scheme, so ids the engine stamps are the ones HyperFrames tools read.
13. **Spec 08, Context chips**: "The chips are the message's `context.selection`; spec 07 builds the "Selected:" preamble line from them." Element chips join the row and are the message's `context.elements`.

Not bent: contract 3 (artifacts are served only by the preview origin; the edit bridge is one more file there), contract 8 (ids, names, hides and versions live in the project folder, locks on the shape), contract 9 (the editor replaces the canvas; on the canvas an image drag only posts a message per frame to a frame in another process), spec 09's "Every edit is a new file", and the hosting contract (spec 01).

## Testing Decisions

A good test drives one of the three seams in 00-index and asserts on what it exposes: return values, RPC answers, the files and sidecars in the project folder, the room's shapes, tool results, the preamble the scripted agent sees, and what a person sees. No test reaches into the burst controller, React state or the bridge's internals.

- **Domain seam** for every rule with many cases, table-driven: `stampElementIds` (minting, keeping, twins, duplicates, the excluded tags, plain and composition templates, idempotence, nothing else in the text changed); `sourceTreeOf` (names, labels, text-only, inline declarations, hidden, images in and out of `<picture>`); `applySourceEdits` for each edit type and refusal, with the untouched bytes compared exactly; `styleValueRefusal` per value kind; `fieldOwner` for each owner and its order, with a stub `normalise`; `addToBurst` (keys by target and field, held dials); `lockRefusal` for each normalisation rule, a removal, a move that passes and a change inside a nested element; `elementChip` and `elementContext`; the built edit bridge, the extended dials bridge and the viewer relay evaluated against a stub window, as spec 09 tests its bridge (message acceptance, loading on hello, patch and reset bookkeeping, box mapping).
- **Engine seam** with the real engine and the scripted agent: tags and stamping on every writer, the four RPCs and their failures, the edit sidecar, the conflict reasons, the lock checks in `page_write`, `motion_write` and `canvas_write`, `canvas_read`'s `lockedElements`, the preamble's elements part, and the preview origin serving `unframed-edit.js`.
- **Browser seam** for the editor's modes, picking, outlines, the Design and Layers tabs, bursts (held dials included) and the swap, undo, the race, images in the picker and from the canvas, point and tell. The DOM side of the bridge (boxes, computed styles, contenteditable, hit tests) is reached here, through what the editor shows.
- **Fixtures.** New scripted-agent scenarios in `assets/fixtures/`: `locked.json` (a `page_write` that changes a locked element, then one that keeps it), `pointed.json` (a turn whose preamble must match an elements part), and a page fixture whose script sets one style from a dial, one by arithmetic on a dial, and creates one element at runtime, for the owner tests.
- Prior art: spec 09's bridge tests against a stub window, spec 09's `page_write` tests through the scripted agent, spec 07's preamble tests (`expectPreamble`), spec 08's chip and draft tests.

## Tasks

1. Element ids: `stampElementIds` mints `hf-` ids on every body element, keeps existing ids, gives twins distinct ids, re-mints only later duplicates, skips the excluded tags and plain template contents, changes no other byte, and is idempotent. Seam: domain
2. Tags and ids on every writer: `page_write`, `motion_write`, `motion.upload`, an `.html` uploaded or dropped through the upload route, an artifact paste's `files.copy` and the node page writer each leave a file with spec 09's tags for its kind and every id; an already tagged and stamped file is written as given; the 2 MiB limit counts the ids. Seam: engine
3. An uploaded, dropped or pasted `.html` gets the dials bridge tag, and a second copy of a tagged file gets no second tag. Seam: engine
4. The source tree: elements by id with parent and order, `data-uf-name` and each derived label rule, text-only text with entities decoded, inline declarations, hidden, an image's `src` and `inPicture`. Seam: domain
5. Text edits: replace a text-only element's text with escaping; refuse an element with children; every other byte unchanged. Seam: domain
6. Style edits: set, replace in place keeping `!important`, append before a hide declaration, remove; create the attribute; `styleValueRefusal` for each value kind and each forbidden token. Seam: domain
7. Attribute, hide and image edits: `data-uf-name` set and removed, another name refused; hide adds and removes exactly its attribute and declaration; image `src` drops `srcset` and `sizes`, refuses inside `<picture>`, background writes `url("…")`; an unknown id refused; a list with one refusal changes nothing. Seam: domain
8. Edit summary lines: one per field and element, repeats dropped, the 20-line cap. Seam: domain
9. Contracts: `lockedElements` with the first artifact migration, accepted by the room; the `SourceEdit` union, `ElementChip`, `MessageContext.elements`, the edit sidecar and the four RPC schemas. Seam: engine
10. The web client opens a canvas saved before this spec, with its pages and motions intact after the migration, and a canvas whose artifacts carry `lockedElements`, with no schema error and the shapes shown. Seam: browser
11. `artifact.sourceTree` answers the elements and `ready`; `artifact.prepareEdit` writes a stamped version with the bridge tag and its sidecar, answers the current file when ready, and refuses a wrong kind and an empty artifact. Seam: engine
12. `artifact.edit` writes a new version with the edits, tags and ids, and its `source: "edit"` sidecar naming `of` and the summary, leaves the base file untouched and does not change the shape. Seam: engine
13. `artifact.edit` failures: `conflict` with reason `agent` after a `page_write`, `elsewhere` after a sync client's change; a refusal; an empty list; the size limit; a locked element refused while rename and hide pass. Seam: engine
14. `artifact.images` lists the served image types newest first with original names and leaves out avif, cache files and non-images. Seam: engine
15. The preview origin serves `unframed-edit.js` with its usual headers, writes it with the bridge, and refreshes it when it differs. Seam: engine
16. The built dials bridge appends the edit bridge script on the first edit hello from its parent and only then; the built edit bridge accepts messages only from its parent with its own or a loopback origin, records originals on patch and restores them on reset. Seam: domain
17. The built motion viewer relays every `unframed:edit:*` message both ways and maps a box through the player's offset and scale. Seam: domain
18. `fieldOwner`: each owner in its order, a dial match with a unit and with a colour, two matching dials giving `script`, text and `src` comparisons, a stub `normalise`. Seam: domain
19. `addToBurst`: the last edit per target and field in first-edit order, a held dial value replaced by a later one for the same path, `burstEdits` and `burstDials` apart. Seam: domain
20. `lockRefusal`: each normalisation rule, a removal, a moved element that passes, a change deep inside, the sentence for one and for several. Seam: domain
21. Locks in the tools: `page_write` and `motion_write` refuse a change to a locked element with the sentence and write nothing, accept a write that keeps it; `canvas_write` refuses `lockedElements` and a `file` change that breaks a lock; `canvas_read` reports `lockedElements` (fixture `locked.json`). Seam: engine
22. The same lock behaviour through an outside connection (spec 14). Seam: engine
23. Element chips and context: selector and excerpt rules for a stamped and a runtime element; the preamble part grouped by artifact; a chip whose shape is gone left out. Seam: domain
24. A turn whose message carries element chips gets the elements part in its preamble after the selection (fixture `pointed.json`), and the stored message keeps `context.elements`. Seam: engine
25. Editor header and tabs: the Mode toggle with Edit on open, V and I from the editor and from inside the frame, the Design, Layers and Parameters tabs with Design first and the choice remembered for the session; the header fits a 1024 px window with the toggle. Seam: browser
26. Edit mode on a page: the hover outline, click selects, Shift-click adds, Shift+Enter selects the parent, Esc clears then closes, a link click does not navigate, a wheel still scrolls; Interact behaves as spec 09's editor. Seam: browser
27. Edit mode on a motion: the player pauses on entering Edit, an element is picked through the viewer, and its outline follows the element when the motion seeks to another time. Seam: browser
28. An artifact written before this spec opens in Edit mode, is prepared, swaps to the stamped version, becomes editable, and Cmd-Z does not bring back the unprepared file. Seam: browser
29. Text section: changing font size, weight and colour patches the frame at once and, 1.5 s after the last change, writes one version; the shape points at it; Cmd-Z in the editor points it back. Seam: browser
30. The burst commits at once on switching mode either way, on selecting another element and on closing the editor; deleting the artifact elsewhere drops it; a Design edit made in Interact mode is collected and committed like one made in Edit mode. Seam: browser
31. Cmd-Z with a burst pending drops the burst: the frame goes back to the saved version's look and dials, no version is written, and the shape's `file` and `dials` are unchanged. Seam: browser
32. Fill, Shape, Spacing, Layout and Visibility fields write the inline declarations they name; Layout shows only for flex; Gap only for flex or grid; several shadows are read-only; two selected elements show `Mixed` and an edit reaches both. Seam: browser
33. Owners in Design: a dial-driven colour edited in Design moves the dial in Parameters at once and writes `dials` when the burst commits, with no new version and one undo step; a dial edit and a style edit in one burst land in one undo step; moving the dial in Parameters moves the field; an arithmetic value is read-only with `Set by the agent's code.` and its button; a motion's animated opacity is read-only with `Animated by the agent's code.`; a stylesheet `!important` shows `A stylesheet rule wins over this value.` and writes nothing. Seam: browser
34. In-place text: double-click literal text, type (letters, V, I and Space reach the text, not the editor), Enter writes it in the burst; Esc puts it back; double-click on text a script sets does nothing and Design shows it read-only. Seam: browser
35. The race: a scripted `page_write` during a pending burst drops it and its held dials with `The agent rewrote this. Your last change wasn't saved.`, shows the agent's version and keeps the selection by id; a commit refused with `conflict` shows the same. Seam: browser
36. The swap: a commit shows the new version without a blank frame, with the scroll position, the saved dials and the selection kept, and for a motion the playhead time. Seam: browser
37. Images in the editor: the picker lists the project's images newest first, filters, swaps an `<img>` and a background image, and an upload from it lands and swaps. Seam: browser
38. Images on the canvas: dragging an image over a selected live page outlines the picture under the pointer; the drop swaps it in one undo step and puts the image shape back; a drop off any picture is an ordinary move; a locked picture is no target; the canvas thread posts at most one hit test per frame. Seam: browser
39. Layers: the tree in document order with runtime elements greyed, selection both ways, hover outlines, rename with `data-uf-name` written and cleared, hide and show. Seam: browser
40. Locks end to end: locking in Layers sets `lockedElements` as one undo step; the locked element cannot be picked in the frame and is read-only in Design; a scripted agent's write that changes it is refused and the turn's work log shows the refusal; unlocking lets the next write through. Seam: browser
41. Tell the agent: chips for two selected elements land in the artifact's continuable chat (or a new chat tagged with it), the rail opens there, a chip can be removed, a sent message carries them and its bubble counts them; Ask the agent to make this editable fills the instruction into an empty draft. Seam: browser

## Out of Scope

- Moving or resizing elements by dragging them. The person rejected free move and resize by hand.
- Transforms, filters, grid layout controls, making an element flex or grid, per-side borders and per-corner radii.
- Adding, deleting, duplicating, reordering or wrapping elements. Hide covers "without it"; the rest is the agent's.
- Editing a page's `<head>`, its stylesheets or its scripts, and the body element itself.
- Editing runtime elements, and instance internals of anything a script builds.
- Loading web fonts. The font field lists what the document already has.
- Dropping an image file from outside the app onto a page to swap a picture (it lands on the canvas as spec 02 says), and swapping pictures of a motion on the canvas.
- Video and audio sources in the Design tab.
- Element editing on the canvas or in the live viewer. All of it lives in the editor, except the image drop.
- Tokens and kits (spec 19), components (spec 20) and the motion timeline (spec 21).

## Open decisions

None open. Settled with the person:

1. **What a lock protects.** The element's content only: its own subtree. The agent may move a locked element or change what surrounds it (Locks and the agent).

## Further Notes

- **Why HyperFrames' model.** HyperFrames Studio writes every inspector edit back into the composition's source, uses a live patch only for instant preview, stamps `data-hf-id` on elements and refuses edits on values its parser cannot trace to a literal. Unframed takes the same shape: the file stays the truth, versions stay immutable, and the agent reads what the person did. An overlay of edits beside the file was rejected because every agent rewrite would have to merge it.
- **Why the owner rule is decided at run time.** Reading the agent's scripts to find out who sets a style would need a JavaScript analysis that resolves selectors and variables, and would still miss most cases. Comparing the live element with its source tells the editor exactly when a script touched a value, and matching the dials' current values tells it when that script only passed a dial through. A later spec may add a static pass for GSAP tweens, where HyperFrames' parser does that work.
- **Brief against code.** (1) The brief has spec 21 add `@hyperframes/parsers`, but this spec needs its `hf-ids` first, so this spec adds the package at 0.8.93, the installed version of the others, which already exports `hf-ids`. (2) HyperFrames' stamper does not give `html`, `head` or `body` an id, so the body is not selectable. (3) `canvas_write`'s `update` can point an artifact at another file (spec 07), a way around locks the brief did not list; this spec closes it. (4) Pressing an image on the canvas deselects the page under it, so "dropping onto a selected page" needs the stay-live rule above.
- **Licences.** `@hyperframes/parsers` (Apache-2.0) and the HTML parser its `hf-ids` uses, linkedom (ISC), plus parse5 (MIT) if the source edit splicer uses it for source offsets: list each in the third-party notices.

### Assets this spec needs

Written at build time, model-facing:

- `assets/prompts/page-write-tool.md` and `assets/prompts/motion-write-tool.md`: a paragraph on element ids and locks: every element carries `data-hf-id`; keep each on its element when rewriting, never invent, copy or change one; keep `data-uf-name` and `data-uf-hidden` with its declaration; elements the person locked must stay exactly as they are, and a write that changes one is refused.
- `assets/prompts/dials-contract.md`: the sentence on assigning a parameter's value straight to a style or a text.
- `assets/prompts/tool-descriptions.md`: `canvas_read` reports `lockedElements` on artifacts; `canvas_write` cannot set them.
- `assets/prompts/element-context.md` (new): the preamble's elements part, with placeholders for the artifact's kind, id and label and, per chip, the selector and the excerpt, and one sentence saying these are the elements the person pointed at.
- `assets/prompts/make-editable-instruction.md` (new): the draft "Ask the agent to make this editable" puts in the composer, with a placeholder for the field, asking the agent to make the value a literal in the source or a parameter assigned straight to it, so the person can edit it by hand.
- `assets/fixtures/locked.json`, `assets/fixtures/pointed.json` and the owner page fixture (Testing Decisions).
