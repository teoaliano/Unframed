# 20 · Components and variants

Depends on: 01 to 19 (read 00-index first). It builds on spec 09's artifacts, preview origin, rendering and editor, spec 18's source edits, edit bridge, owner rule, Design and Layers tabs, locks and point and tell, and spec 19's tokens and kits.

## Problem Statement

A person who builds several pages and motions with the agent ends up with the same button, card or title block written out again in every file. Each copy drifts. Changing the brand button means asking the agent to find and rewrite it everywhere, and nothing shows which pages still carry the old one.

Design tools solved this with components: one main definition, used as instances, with variants for its kinds and sizes and a few properties an instance may set. Changing the main component offers the change to every file that uses it, and nothing changes in a file until its owner accepts. Unframed has no such thing. Its artifacts are single HTML files, and the preview origin's policy (`connect-src 'none'`) means an artifact cannot fetch another HTML file at run time, so the obvious "include this file" does not work.

## Solution

A **component** is a custom element (`<uf-button kind="primary">`) shared across the project. The agent writes it as a **component sheet**: one HTML file holding a declaration (its tag, its variants, its properties and its slots), its styles, written with the kit's tokens, and its markup. A sheet is versioned exactly like an artifact: every change is a new file, written with exclusive create, never overwritten.

Every time a sheet is written, the engine also compiles it into a **compiled component**: a self-contained script file beside it that defines the custom element. A page or motion uses a component by holding instances of its tag and one `<script src>` tag naming the compiled file of the version it uses. That tag is the artifact's **pin**. A script loaded by `<script src>` from the preview origin is allowed by its policy (`script-src 'self'`), the preview origin already serves `.js`, and HyperFrames' producer serves the project folder to a render. So the same pinned file works in the canvas frame, the editor, snapshots, the live viewer, renders, and `npx hyperframes render` outside Unframed.

A component appears on the board as a **component shape**, a third artifact kind beside page and motion. It shows the sheet's **variant board**: one instance of every variant, labelled. Its `file` is the component's current version, so undo, Revert and the version rule are spec 09's. Double-clicking it opens the editor, where spec 18's Design and Layers tabs edit the sheet with the owner rule: an edit to an element in one variant's cell changes whatever owns the value, which may be the markup itself (every variant) or the style rule of that variant.

When a component gets a new version, every page and motion that pins an older one shows **Component updates available**, in the editor header and as a badge on its canvas shape. Accepting writes the artifact a new version whose pin names the newer file. Nothing changes in an artifact until accepted. This is Figma's publish and accept model.

In the Design tab, a selected instance shows its component's name, a select per variant and a field per property. Changing them is a source edit on the instance's attributes. "Go to main component" opens the component. An instance's internals are edited only on its component.

The agent makes and changes components with `component_write` and reads them with `component_read`, and `canvas_read` lists them. A person turns an element into a component with **Make component** in the editor, which sends the element to the agent with a fixed instruction, because extracting a component means writing code.

## User Stories

1. As a person, I want to ask the agent for a button component with kinds and sizes, so that every page uses one definition.
2. As a person, I want a component to appear on the board, showing every variant side by side with its name, so that I can see the whole set at a glance.
3. As a person, I want to double-click a component to open it in the editor, so that I can tune it like a page.
4. As a person, I want an edit to an element in one variant's cell to change that variant when the variant's style sets the value, and every variant when the markup sets it, so that an edit never breaks the variants.
5. As a person, I want a component's colours and sizes to come from my kit's tokens, so that changing a token restyles every instance.
6. As a person, I want to see a component's variants, properties and slots in the Design tab, so that I know what an instance can set.
7. As a person, I want to pick an instance in a page and change its variant from a select, so that I can switch a button to secondary without the agent.
8. As a person, I want to change an instance's text and image properties in the Design tab, so that each button says its own label.
9. As a person, I want "Go to main component" on an instance, so that I can jump to the definition.
10. As a person, I want an instance's insides to stay out of reach in a page, so that a page never forks its own private copy of the button.
11. As a person, I want a page to keep the component version it was made with when the component changes, so that nothing changes underneath a page I am happy with.
12. As a person, I want "Component updates available" in the editor header and a badge on the canvas shape of every artifact that uses an older version, so that I see what is behind.
13. As a person, I want to accept an update for one component or for all of them, as one undoable version of the artifact, so that updating is safe.
14. As a person, I want a warning before I accept an update that drops a variant or a property my instances use, so that I know which instances will change.
15. As a person, I want "Make component" on a selected element, so that the agent turns a repeated block into a component and uses it in place of the element.
16. As a person, I want a pasted component to become a new component with its own tag, so that a duplicate never fights the original.
17. As a person, I want a page pasted into another project to bring the component files it uses, so that it still renders there.
18. As a person, I want a rendered motion to show its component instances exactly as the preview does, so that the MP4 matches.
19. As a person, I want a deleted component to leave its instances working, so that a delete never breaks pages.
20. As a person, I want locked elements of a component to be safe from the agent, as on a page, so that a lock means the same everywhere.
21. As a person, I want to see how many artifacts use a component, so that I know the reach of a change.
22. As an agent, I want a tool that writes a component sheet, refuses a malformed one with a clear sentence, and tells me which artifacts use older versions, so that I can build and evolve components.
23. As an agent, I want `canvas_read` to list each component's tag, variants, properties and slots, so that I can use instances without reading every sheet.
24. As an agent, I want the engine to add the pin for a component I use in a page or motion, so that I never write file names by hand.
25. As an agent, I want a note in my write result when I use a tag that is not a component of this project, so that a typo does not pass silently.
26. As an outside agent, I want the same component tools, so that Claude Code can build components too.
27. As a maintainer, I want a project folder with components to render with `npx hyperframes render` outside Unframed, so that the folder stays self-contained.

## Implementation Decisions

### Terms this spec adds

- **component**: a custom element shared across a project, defined by a component sheet. Its tag starts with `uf-`.
- **component shape**: the canvas shape of a component, a third artifact kind beside page and motion. Its `file` is the component's **current version**.
- **component sheet**: the HTML file the agent writes for one version of a component: declaration, style, template and, optionally, example slot content.
- **compiled component**: the script file the engine writes beside each sheet, which defines the custom element. Derived from its sheet, never edited.
- **instance**: an element in a page or motion whose tag is a component's tag.
- **variant**: a named attribute with a fixed list of values (`kind`: `primary`, `secondary`), the first being the default. A component's variants together make its **variant combinations**.
- **property** (of a component): an attribute an instance may set to its own value, of type text, boolean or image.
- **slot**: a place in the template where an instance's own child elements show.
- **pin**: the `<script src>` tag in an artifact that names the compiled component it uses for one tag. One per tag per document.
- **variant board**: what a sheet shows when opened on its own: one instance per variant combination, labelled.
- **component update**: an artifact's pin naming an older sheet than the component's current version.

The index's **Artifact** becomes "a page, a motion or a component" (Rules this spec bends, 1).

### Modules

| Module | Package | Interface | New or extended |
| --- | --- | --- | --- |
| Component sheet | domain | `readComponentSheet(html)` returns `{ declaration, style, template, examples }` or a refusal sentence; `sheetRefusal(sheet, canvas, shapeId?)` adds the canvas rules (tag taken, tag changed, nested component) | new |
| Component compiler | domain | `compileComponent(sheetHtml, sheetFile)` returns the compiled script's text; `compiledFileName(sheetFile)` | new |
| Component runtime | domain | the definer the compiled file and the sheet helper both carry: builds the custom element from a declaration, a style and a template | new, built into both files from one module so they cannot drift |
| Pins | domain | `readPins(html)` returns `[{ tag, sheet }]`; `injectPins(html, components)` adds a pin for every used tag that has none and repairs invalid ones, and reports the used tags that are not components; `setPin(html, tag, sheet)` | new; joins spec 09's tag injection order |
| Variant board | domain | `boardCells(declaration)` returns the combinations the board shows and their labels, with the cap | new |
| Update impact | domain | `updateImpact(fromDeclaration, toDeclaration, instances)` returns the warning sentences | new |
| Style owner | domain | `styleOwner(rules, inline, property, matches)` returns which declaration sets a property on a picked element of a sheet: the inline style, one rule, or none | new; spec 18's owner rule for sheets |
| Component tag copy | domain | `copiedTag(tag, taken)` returns `<tag>-copy`, `<tag>-copy-2` and so on | new |
| Source edits | domain | `applySourceEdits` gains the `componentUpdate` and `componentRule` edit types, and an instance's declared attributes in the attribute allow-list | extended (spec 18) |
| Artifact store | engine | writes a sheet and its compiled file together, ensures the sheet helper, ensures compiled files that are missing | extended (spec 09) |
| Component tools | engine | `component_write`, `component_read`; `canvas_read` lists components; page and motion writes inject pins | new, and extended (specs 07, 09) |
| Component service | engine | `component.pins`, `component.updates`, `component.copy`; `artifact.edit` on component shapes and with the new edit types; `files.copy` brings pins along across projects | new, and extended (specs 02, 18) |
| Component shape | contracts | the `component` shape props with their first migration | new |
| Edit bridge | domain | in a sheet, picks inside board instances and reports the variant context and the style owners; in a page or motion, reports an instance as one element with its declaration | extended (spec 18) |
| Component shape util, Instance section, Component section, updates popover, canvas badge, Make component | web | as below | new |

### The component sheet

A sheet is a whole HTML document with four marked parts:

- **The declaration**: the one `<script type="application/json" data-uf-component>`, holding a `ComponentDeclaration` (below) as JSON.
- **The style**: the one `<style type="text/x-uf-component" data-uf-component-style>`, the component's CSS, which the runtime puts into each instance's shadow root.
- **The template**: the one `<div data-uf-template hidden>`, whose children are the markup each instance clones.
- **The examples**, optional: the one `<div data-uf-example hidden>`, whose children fill the board's instances.

```ts
type ComponentDeclaration = {
  tag: string                                   // ^uf-[a-z][a-z0-9]*(-[a-z0-9]+)*$, at most 50 characters
  variants: Record<string, string[]>            // at most 4; each 1 to 12 distinct values, the first is the default
  props: Record<string, "text" | "boolean" | "image">   // at most 16
  slots: string[]                               // "" is the default slot; at most 8
}
```

- Variant and property names share one list and are lowercase letters, digits and hyphens, 1 to 31 characters, starting with a letter. `id`, `class`, `style`, `slot`, `part`, `hidden`, `is`, `tabindex` and any `data-` or `aria-` name are refused, because the page and spec 18 own those attributes.
- Variant values are 1 to 40 characters of `[A-Za-z0-9_-]`.
- **The style**'s unknown `type` keeps the browser from applying it to the sheet's own document. It counts as a `<style>` element for spec 19's `StyleRuleRef`. It uses `:host`, `:host([variant="value"])` and ordinary selectors. Colours, sizes, fonts, radii and shadows should be `var(--…)` tokens (spec 19), which reach inside the shadow root because custom properties inherit, so a token change and a mode change (spec 19's `data-theme` on the root) restyle every instance.
- **The template** is an ordinary element on purpose, not a `<template>`: HyperFrames' id scheme, which spec 18's stamper follows, skips `<template>` and its content, so ids, Layers, locks and `applySourceEdits` would not reach the markup. The `hidden` attribute keeps it off screen in the sheet.
- A text property binds to an element with `data-uf-prop="<name>"`: an instance's attribute replaces that element's text, and the template's own text is the default. An image property binds an `<img data-uf-prop="<name>">`: the attribute replaces its `src`, and the template's `src` is the default. A boolean property binds nothing: it is an attribute for the style to match (`:host([disabled])`), off by default.
- A named slot is `<slot name="<name>">` in the template, the default slot `<slot>`. Every declared slot must appear in the template.
- **The examples** (with `slot` attributes for named slots) go into every board instance, so a component made only of slots does not look empty on the board. They are never part of the component.
- The template holds no `<script>` and no instance of another component (Out of Scope: nested components). Behaviour belongs to the page that uses the component.
- The engine injects spec 19's tokens tag and spec 09's dials bridge tag, as it does for a page, then the sheet helper tag (below). The dials bridge loads spec 18's edit bridge on hello, as on a page. The engine stamps `data-hf-id` on every element of the template and the examples by spec 18's rule.

**Refusals** of `readComponentSheet` and `sheetRefusal`, the first one found, in this order:
- no declaration, or more than one: `a component sheet needs one <script type="application/json" data-uf-component> declaration`
- not JSON: `the component declaration is not valid JSON: {message}`
- a bad tag: `the tag {tag} is not a component tag; use uf- and lowercase words joined by hyphens, like uf-price-card`
- a bad name: `{name}: a variant or property name is lowercase letters, digits and hyphens, and is not id, class, style, slot, part, hidden, is, tabindex, or a data- or aria- name`
- a name in both lists: `{name} is both a variant and a property`
- a bad variant list: `variants.{name}: a variant is a list of 1 to 12 distinct values made of letters, digits, hyphens and underscores`
- a bad property type: `props.{name}: a property is "text", "boolean" or "image"`
- too many: `a component has at most 4 variants, 16 properties and 8 slots`
- no style, or more than one: `a component sheet needs one <style type="text/x-uf-component" data-uf-component-style>`
- no template, or more than one: `a component sheet needs one <div data-uf-template hidden> holding its markup`
- an unbound property: `props.{name}: no element in the template has data-uf-prop="{name}"` (text and image only)
- a missing slot: `slots: the template has no <slot name="{name}">` (or `no <slot>` for the default)
- a script in the template: `a component's template cannot hold a script; put behaviour in the page that uses it`
- an instance of another component in the template: `a component cannot hold another component yet; give it a slot and put {tag} in that slot in the page instead`
- the tag held by another component shape on this canvas: `{tag} is already the component {shapeId}; write to that shape, or choose another tag`
- a write to a component shape with a different tag: `component {shapeId} is {tag}; a component keeps its tag`
- over the size limit after injection: `the component is too large ({n} bytes; the limit is 2097152)`

### Files and versions

- **Sheet**: named by spec 09's rule, `<epochMs>-<slug>[-<n>].html`, the slug from the title, or `component` when the title is empty. Exclusive create, never overwritten, never deleted.
- **Compiled component**: `<sheet base>.component.js` beside it (for `1761400000000-button.html`, `1761400000000-button.component.js`), written with exclusive create right after the sheet, in the same write. The name fits the preview origin's file rule, and `.js` is on its allow-list, so no route or header changes. The new-file rule treats a name as taken when its compiled name exists too. Spec 09's 2 MiB limit applies to each file.
- **Why a second file**: an artifact cannot read the sheet. `connect-src 'none'` forbids fetch, so there is no HTML include. HyperFrames' own sub-compositions (`data-composition-src`) are fetched by its runtime in the preview, so they fail under the same policy, and they exist only for motions. A classic script from the preview origin is the one way in that the policy allows, the same way spec 09's live viewer reads its pointer. It also works in renders, because the producer serves the project folder to its browser.
- **Self-contained**: the compiled file carries the component runtime, the declaration, the style text and the template markup as string literals, and calls the runtime once. It loads nothing else. It is frozen with its version: a later engine with a changed runtime leaves it as it is, so a version never changes underneath an artifact (spec 09). A shared runtime helper would have been smaller, but refreshing it, as the bridge is refreshed, would change every old version at once.
- **No sidecar for the compiled file**: it is a build of its sheet. The sheet's sidecar names it in `compiled`. It does not go in the cache folder, because the cache is not servable and renders need it beside the artifacts.
- **Missing compiled file**: when a frame asks the preview origin for a `.component.js` that is missing and its sheet exists, the origin compiles it first, as it refreshes the bridge (only in a project folder that exists). A write, a snapshot and a render start each ensure the compiled files of every pin in the file they handle. This is the one case where Unframed writes a compiled file after its sheet, and it writes the same bytes the current compiler makes.
- **Sidecars of a sheet**: agent `{ source: "agent", kind: "component", tag, compiled, chatId, turn, shapeId, title, bytes, at }`; edit (spec 18's edit sidecar) with `kind: "component"`, `tag` and `compiled` added; copy (spec 02's copy sidecar) with `tag` and `compiled` added.

### The component runtime

One domain module, built into every compiled file and into the sheet helper. Its rules:

- It defines the tag only when the tag is not yet defined, so a second pin for the same tag, or the sheet helper and a compiled file in one document, never throw.
- The element attaches an open shadow root in its constructor, puts the style text in a `<style>` element there (allowed by the policy's `style-src 'unsafe-inline'`), and clones the template into it. Everything happens synchronously, with no timer, no random value and no network, so a snapshot, a seek and a render frame all see the finished instance.
- Its class carries the declaration and its sheet's file name as static fields, which the edit bridge reads.
- It observes every variant and property attribute. A text or image property sets its bound element's text or `src`; an absent attribute restores the template's value. A variant attribute that is absent, or holds a value the declaration does not list, is set on the live element to the variant's default, so `:host([kind="primary"])` matches. That changes the live DOM only, never the source.
- The pin sits right after spec 19's tokens tag at the start of the head, so the element is defined before any of the artifact's own scripts run, and every instance upgrades as it is parsed. A motion's timeline therefore finds instances complete when it is built.
- **In motions**: GSAP animates an instance as one element (its position, size, opacity, transform), or a custom property on it (`--uf-progress`) that the component's style uses. It cannot reach into the shadow root by selector. The motion tool description says so.

### The sheet helper and the variant board

- **The helper** is `unframed-components.js`, one per project folder, generated from the domain modules and refreshed by spec 09's size rule and on request, like the bridge. Its tag goes in a sheet's head after the bridge tag. Pages and motions never get it.
- In a sheet, it reads the declaration, style and template from its own document (no fetch is needed: they are in the DOM), defines the element with the runtime, and builds the variant board into the body.
- **The board**: one cell per variant combination, in declaration order, the first axis slowest. Each cell is an instance with that combination's attributes, the examples as its children, and a label under it in a small muted sans font: the values joined with ` · ` (`primary · md`), or `Default` for a component with no variants. Cells sit in a wrapping grid, 24 px apart, on the page's white. With more than 48 combinations, the board shows one row per variant instead, each varying that variant with the others at their defaults, and a last line `{n} combinations; showing each variant on its own.` `boardCells` is the rule.
- The board and its labels are made at run time, so they have no `data-hf-id` and are read-only in Layers (spec 18's rule for runtime elements).
- The helper watches the template and the style. When spec 18's preview patch changes them, every board instance is rebuilt from them, so a live edit shows in every cell at once.
- Opened on its own (a versioned sheet in a browser tab), a sheet still shows its board: the helper needs nothing else.

### The component shape

- **Why a shape**: the person wants components visible on the board, next to the pages that use them, as Figma keeps main components on the canvas. A shape whose `file` is the current version reuses spec 09 whole: the frame, the live and snapshot rules, the editor, the label and naming, the new-file rule, undo and Revert. A component registry in the project database was the alternative. It would be a second truth for "the current version" beside the canvas, and neither tldraw undo nor a turn's Revert would reach it.
- **Props**: `{ w, h, file, title, fileName, tag }`, plus whatever spec 18 and spec 19 add to artifact shapes (locks, mode). `tag` is set when the shape is created and never changes. It has no `dials` (a component declares no parameters). Defined in contracts with its first migration.
- **One shape per tag**: no two component shapes on a canvas share a tag. The agent's write refuses it (above). A paste gives the copy a new tag (Pasting).
- **On the canvas**: spec 09's filled artifact. The frame shows the sheet, so the board, from the preview origin. The live rules, snapshots, Keep playing and the 480 by 320 default size apply. The kind icon is Lucide's Component, the kind word `Component`. The selection toolbar shows Editor and Agent for one selected component. It shows neither Render nor Parameters.
- **Title**: spec 09's title rule. A new component's title is the `title` given, else the tag without `uf-` with its hyphens as spaces and the first letter capitalised (`uf-price-card` is `Price card`). A person's name wins over the agent's titles, as for artifacts. The title is the component's name everywhere: the Design tab, the updates popover, `canvas_read`.
- **Deleting** the shape needs no confirmation and keeps every file. Instances keep working, because they load their pinned files. No update is offered for its tag, and "Go to main component" is disabled with the tooltip `The main component was deleted.` Undo brings it back.
- **Not an input**: a component takes no part in a selection run (as a page does not) and is never a wire source (spec 16), refused with `A component is never an input yet, so this wire is refused.`
- **No empty component**: the add menu has no component item. Components are made by the agent (`component_write` or Make component). An empty component shape cannot exist.

### Using components in pages and motions

- **The pin** is `<script src="<sheet base>.component.js" data-uf-component="<tag>"></script>`.
- **Injection** (`injectPins`, pure): on every page and motion file write, by every writer spec 18 lists (the agent's tools, uploads, drops, pastes, spec 16's node page writer, source edits and `artifact.prepareEdit`), for each tag used in the document that is the tag of a component shape on the canvas:
  - no pin for it: add one naming the current version's compiled file;
  - a pin naming a file that is not a compiled component of a sheet in the project declaring that tag: replace it with the current version's;
  - a valid pin: keep it, whatever version it names. A rewrite by the agent never moves a pin on its own. The agent moves one only by writing the pin itself, and a person only by accepting an update.
- Pins go right after spec 19's tokens tag at the start of `<head>`, in tag order, before the runtime and bridge tags and before any of the artifact's own scripts (with no `<head>`, right after the tokens tag wherever spec 09's fallback put it). Idempotent.
- A pin whose tag is no longer used stays. It costs one small script.
- A tag of the form `uf-…` that no component shape has is left as it is (the browser shows its content as plain inline content) and reported in the write result.
- **Instances**: `<uf-button kind="secondary" label="Buy now">`. Its overrides are its own attributes and its own child elements, which show in the slots. They are ordinary elements of the artifact's source, with ids, so spec 18 edits them as it edits any element.
- **Components inside components, through slots**: a slotted child may itself be an instance of another component (`<uf-card><uf-button slot="action">`). Both are elements of the page, so the page pins both tags, and each instance is picked and edited as itself. This is how the agent builds a card with a button in it. What a component cannot do is hold another component in its own template (Out of Scope).
- **Renders**: the render start ensures the library and every pin's compiled file. HyperFrames' producer loads the composition from the project folder through its own file server, so the pins load as they do in the preview. Spec 09's motion contract gains: pins are the one kind of external script besides GSAP and the runtime.
- **Snapshots and the live viewer** load the pins from the preview origin like any sibling file. Nothing in them changes.

### The Design tab on instances

When the selected element (spec 18) is an instance, the edit bridge reports it as one element: hovering or clicking inside it picks the instance, never an element of its shadow root. A child element in one of its slots is the instance's own and is picked as itself. The report adds `component: { tag, sheet, declaration }`, read from the defined element's static fields, so the fields follow the version the artifact pins, not the newest one.

The Design tab then shows an **Instance** section first:

- Header: the Component icon, the component's title (the tag when its shape is gone), and a ghost button `Go to main component`, which opens the editor on the component shape (spec 09's editor switch: the pending burst is committed first).
- One UI kit Select per variant, labelled with the variant's name, listing its values; the current one is the instance's attribute, or the default.
- One field per property: text, a UI kit Input; boolean, a UI kit Switch; image, spec 18's image field with its picker.
- When the pin is older than the current version: muted text `This instance uses an older version of {title}.` and a small outline button `Update`, which accepts that one component's update for the whole artifact (below).
- Changes are spec 18's attribute edits on the instance: the live preview patch sets the attribute (the instance restyles at once), and the burst commits them as one source edit. Choosing the default value of a variant removes the attribute.
- **The allow-list.** Spec 18's attribute allow-list (`data-uf-name`) gains, on an instance only, the names its pinned component declares as variants and properties. `applySourceEdits` is given each instance's pinned declaration (the engine reads it from the pinned sheet) and refuses any other name with spec 18's sentence. A variant's value must be one of its values (`{value} is not a {variant} of {title}.`), a boolean property's value is `""` or null, a text property's value is at most 500 characters, and an image property's value passes spec 18's image file rule. Summary lines, in spec 18's form: a variant writes `{Variant} · {label}` (`Kind · Buy button`), a property `{Property} · {label}` (`Label · Buy button`), the name with its first letter capitalised.
- **Owner rule**: a variant or property whose attribute is literal in the source is a source edit. One whose live value differs from the source (a script sets it) is read-only with spec 18's sentence `Set by the agent's code.` and its ask-the-agent action. An attribute the runtime filled with a variant's default counts as literal (its source value is "absent").
- After the Instance section, only spec 18's margin, opacity and Visibility fields show for an instance. The other sections are hidden: their values would cascade into the component's insides, which an instance does not edit.
- Layers (spec 18) shows an instance as one row with the Component icon and no children of its shadow root; its slotted children are its rows' children.
- Double-clicking an instance does nothing more than select it.

### The editor on a component

The editor (spec 09, with spec 18's layout) opens a component shape like a page, with these differences:

- **Header**: the Component icon, the title, the kind word `component`, then muted text `Used in {n} artifacts` (`Used in 1 artifact`; hidden at none), counting the page and motion shapes on this canvas that pin any version of the tag. Then spec 18's `Mode` toggle (Edit and Interact), spec 19's `Kit mode` picker and spec 09's Open in a new tab. No Render, no preview-size change beyond spec 09's.
- **Tabs**: Design and Layers. A component has no Parameters tab.
- **Component section**, at the top of the Design tab when nothing is selected: the tag in monospace, each variant with its values as small badges (the default first, marked `default`), each property with its type, the slots (the default slot as `default`). Read-only. Below them a small outline button `Ask the agent to change this`, which puts the component's chip into the rail's composer (spec 18's point and tell). Changing the declaration means changing code, so it goes through the agent.
- **Picking in the board**: the edit bridge follows the pointer into a board instance's shadow root and picks the element there. It reports the template element's `data-hf-id` (the clone carries the template's id, and is edited as the template element: Rules this spec bends, 13), the picked copy's box, and the **variant context**: the cell's attribute values. The editor outlines the picked copy, and draws a fainter outline on the same element in every other cell. Selecting a row in Layers outlines every copy.
- **The variant line**: with an element picked, the Design tab's first line reads `Editing {title} · {values}` (`Editing Button · secondary · md`).
- **Owner rule in a sheet**: for each Design field, the bridge collects the declarations that can set the property on the picked copy: the template element's inline style, and each rule of the component style whose selector matches the copy in its cell. `styleOwner` picks the winner by the cascade (inline first, then specificity, then order; `!important` respected), and names a rule by spec 19's `StyleRuleRef` (its `block` is the component style's index among the sheet's `<style>` elements). Inside a sheet, spec 18's owner order becomes: `locked` (the template element or an ancestor is locked), then `script` (a runtime element, such as a board label), then `token` (the winning declaration's value is a `var()` of a kit name, spec 19), then `styleOwner` in place of spec 18's step 4:
  - the winner is the inline style, or nothing sets it: owner `source`, and the edit is spec 18's style edit on the template element, so it applies to **every variant**. The field shows a small muted chip `All variants`;
  - the winner is a rule whose selector has no variant condition (`button { … }`): owner `source`, and the edit is a `componentRule` on that rule, also every variant, chip `All variants`;
  - the winner is a rule with a variant condition (`:host([kind="secondary"]) button`): owner `source`, and the edit is a `componentRule` on that rule, chip `{variant}: {value}` (`kind: secondary`), so the edit changes only the variants that rule covers;
  - a `token` owner shows spec 19's token chip: another token is a `token` edit with `rule` (or with `elementId` when the winner is the inline style), and Detach writes the resolved value into the same declaration (a `componentRule`, or spec 18's style edit);
  - the winning declaration is anything else (a `calc()`, several values the field cannot show, a selector the bridge cannot test, such as one using `:has()`): owner `script`, read-only with `Set by the component's style.` and spec 18's ask-the-agent action.
- A property that only one variant sets differently is never made variant-specific by hand. A field edit whose owner covers every variant says so with its chip, and making a value differ per variant is a request to the agent (Out of Scope).
- **Text**: double-clicking template text in a cell edits it in place (spec 18), which changes the template: the default text, in every cell. Text bound to a text property edits the property's default in the same way.
- Spec 18's image swap on a template `<img>` changes the template's `src`, the image property's default when it is bound.
- Every edit is a source edit on the sheet with spec 18's burst rule, and the new version gets its compiled file in the same write. The component shape points at the new sheet; every artifact pinning the older one now shows an update.

### Component updates

- **What counts**: an artifact (page or motion shape) has an update for a tag when it pins a sheet of that tag and a component shape with that tag exists whose `file` is a different sheet. "Different", not "newer": after an undo on the component, accepting moves the artifact to the board's version again, older or not.
- **Pins stream**: RPC `component.pins { project }` is a stream, like spec 09's `artifact.snapshots`. It answers `{ file, pins: [{ tag, sheet }] }` for every page and motion file the canvas names, then one item for each newly named file after a commit. Files never change, so a file's pins are read once and kept by name. The web compares pins with the component shapes in its store. That is a lookup on store changes, with no frame, so the canvas thread stays clear (contract 9).
- **Canvas badge**: on a filled page or motion with at least one update, a small badge (spec 12's badge style) with the Component icon and `Updates`, above the shape's top-right corner, on the label's line, following spec 02's labels-by-zoom rule. Tooltip `Component updates available`. A click opens the editor on that artifact with the updates popover open.
- **Editor header**: on an artifact with updates, a small outline button with the Component icon, `Component updates available`, before the preview size. Below 520 px of header it shows its icon only, its words kept as its accessible name (spec 09's header rule).
- **The updates popover** (a UI kit Popover labelled `Component updates`): the engine answers `component.updates { project, shapeId }` with `[{ tag, title, from, to, warnings }]`. One row per component: its title, a muted `{n} instances`, the warnings below it in the warning text colour, and a small outline `Update` button. Under a border, `Update all` (shown with two rows or more). With no updates left the popover closes.
- **Warnings** (`updateImpact`, from the instances in the artifact's source):
  - `{title} no longer has {variant} "{value}". {n} instances will show "{default}".`
  - `{title} no longer has the property {property}. {n} instances lose their {property}.`
  - `{title} no longer has the slot {slot}. Content in it will not show on {n} instances.` (the default slot reads `the default slot`)
- **Accepting**: `Update` and `Update all` commit at once (after flushing a pending burst, which is its own version) through spec 18's `artifact.edit` with one `componentUpdate { tag, to }` edit per component. `to` is the sheet the web saw as current. The new artifact version's sidecar `edits` summary reads `Updated {title}` (or `Updated {n} components`). It is one undo step. The agent-wins rule holds: a changed `file` refuses the commit with spec 18's sentence. A `to` that is not a sheet of that tag in the project is refused with `That component version is not in this project.`
- The engine ensures the compiled file of `to` before it writes.

### Make component

- In the editor, in either mode, with exactly one element selected that has an id, is not an instance, is not inside a component sheet and is not runtime-made: a small outline button `Make component` with the Component icon, beside spec 18's `Tell the agent`.
- On a locked element it is disabled, tooltip `Unlock it first. The agent replaces it with the component.`
- It sends a message to the artifact's own chat (spec 09's add-a-parameter chat rule: the newest idle chat tagged with this artifact, else a new chat tagged with it), opening the rail on that chat: the element's chip (spec 18) and the fixed instruction from `assets/prompts/make-component-instruction.md`, filled with the artifact's kind and title. The instruction asks the agent to write a component from the element with `component_write` (its markup, its styles in tokens, a variant for each visible difference among similar elements in the artifact, a text property for each text), then to replace the element and its look-alikes in the artifact with instances, keeping the element's `data-hf-id` on the instance that replaces it.
- With no ready provider: the toast `Connect Claude or Codex first.`

### Pasting

- **A component shape** pasted (within or across projects) gets its copy through RPC `component.copy { project, file, from? }`, which writes a copy of the sheet with a fresh tag, `copiedTag(tag, taken)` against the destination canvas (`uf-button-copy`, then `uf-button-copy-2`), compiles it, and answers `{ file, tag }`. The pasted shape takes both. A cross-project paste whose tag is free in the destination keeps the tag. Duplicating a main component makes a new component, as in Figma. A failed copy pastes nothing for that shape and shows spec 02's toast `Could not copy the component's file: {message}` (an empty component cannot exist).
- **A page or motion** pasted across projects: `files.copy` with `from`, for an `.html` file, also copies every sheet and compiled file the file pins, under the same names, when the destination lacks them. Those names hold a millisecond stamp, so a name already present in the destination is the same file. The pasted artifact pins its own versions. When the destination has a component shape with that tag, the artifact shows an update, which is the right reading of "same tag, same component".

### Persisted formats

```ts
type ComponentShapeProps = {
  w: number; h: number
  file: string            // the current sheet, never "" once created
  title: string
  fileName: string
  tag: string             // set at creation, never changed
  // plus the props spec 18 and spec 19 add to artifact shapes
}

type Pin = { tag: string; sheet: string }   // read from the artifact's source, never stored on a shape

type SourceEdit =                           // spec 18's union, extended
  | /* spec 18's and spec 19's types */
  | { type: "componentUpdate"; tag: string; to: string }          // to: a sheet file
  | { type: "componentRule"; rule: StyleRuleRef; property: string; value: string }   // StyleRuleRef: spec 19
```

`componentRule` names the rule by spec 19's `StyleRuleRef`, so two identical selectors stay apart, and its burst target is that rule. It replaces the property's value in that rule, or adds the declaration when the rule lacks it, keeping the rest of the style byte for byte. The value passes spec 18's `styleValueRefusal` as spec 19 extends it. It refuses with `That style rule is no longer in this component.` when the rule is gone, and with spec 18's lock sentence (`{label} is locked. Unlock it in Layers to edit it.`) when the rule's selector, with its `:host(…)` conditions set aside, matches a locked template element or an element inside one. Its summary line is `{Field} · {selector}` (`Background · :host([kind="secondary"]) button`). A token chosen for a rule is spec 19's `token` edit with `rule`, not a `componentRule`.

Pins are read from files and never stored on shapes, so undo, Revert, uploads and every other writer keep them right without extra work.

### RPC methods

All over spec 01's RPC socket, failing with spec 01's `UnframedError`.

| Method | Input | Success | Failures |
| --- | --- | --- | --- |
| `component.pins` (stream) | `{ project }` | `{ file, pins: [{ tag, sheet }] }` per artifact file, then one per newly named file | `not_found` (no project) |
| `component.updates` | `{ project, shapeId }` | `[{ tag, title, from, to, warnings: string[] }]` | `not_found`: `There is no page or motion {shapeId} on this canvas.` |
| `component.copy` | `{ project, file, from? }` | `{ file, tag }` | spec 02's `files.copy` failures |
| `artifact.edit` (spec 18) | accepts a component shape, and the two new edit types | spec 18's answer | spec 18's, plus the sentences above |
| `files.copy` (spec 02) | unchanged | unchanged | unchanged; copies pins along across projects |

### The agent

- **`component_write { html, shapeId?, title? }`** (title at most 120), built from spec 09's write definition so the new-file rule, result and event cannot drift:
  1. `html` not a non-empty string: `html must be a non-empty string`.
  2. `shapeId` given: unknown shape `no shape {shapeId}`, another kind `shape {shapeId} is a {kind}, not a component`.
  3. Inject the tokens, bridge and helper tags; stamp ids; read and check the sheet (the refusals above); run spec 18's `lockRefusal` against the shape's current file; spec 19's off-token check adds its warnings.
  4. Title by spec 09's rule 4, the new-component default above when none is given.
  5. Ensure the helper, write the sheet and its compiled file and the agent sidecar.
  6. Update: set `file` (and `title` when given and different). Create: a component shape at 480 by 320 beside the selection (spec 09's placement), with `{ file, title, fileName: "", tag }`. Through spec 02's `apply` with origin `chat:<chatId>`, recorded in the turn's changes, so Revert undoes it.
  7. Tags the chat with the component and records a tool activity `Created component` or `Updated component`, then ` · {title}`.
  8. Returns `{ ok: true, shapeId, file, tag, title, previewUrl, clock, usedBy: [{ shapeId, title, current: boolean }] }`, `usedBy` listing the artifacts that pin any version of the tag, `current` false where an update now waits. The description tells the agent that a person accepts updates, so it should say which artifacts wait, not rewrite them, unless asked.
- **`component_read { shapeId }`** returns the current sheet's HTML. Refusals: `no shape {shapeId}`, `shape {shapeId} is a {kind}, not a component`, `the file {file} could not be read`.
- **`canvas_read`** reports a component shape as `{ id, kind: "component", x, y, w, h, parent?, ref?, title, tag, file, compiled, variants, props, slots }` (variants as `{ name: [values] }`, the first the default), and a page or motion gains `components: [{ tag, sheet, current: boolean }]` when it pins any.
- **`canvas_write`**: `create` with `kind: "component"` is refused with `create: make components with component_write`. `update` of `tag` or `file` on a component is refused with `update: <field> is written by component_write`. `move`, `resize`, `rename` and `delete` work as for any artifact.
- **`page_write` and `motion_write`** inject pins (above). Their result gains, only when non-empty, `components: { pinned: [tag], olderVersions: [tag], unknownTags: [tag] }`, where `olderVersions` lists the tags whose pin is not the current version.
- **Permissions**: `component_write` is a write: allowed in every runtime mode, refused in plan mode with `assets/prompts/plan-no-writes.md` (spec 07). `component_read` is allowed everywhere. Both join the server's required-tool check.
- **Outside agents** (spec 14): both tools join the outside list, with `project` on outside calls, and behave the same.
- **Turn diffs** (spec 08): a component sheet a turn wrote is a file in `getTurnDiff` like a page.
- **Locks** (spec 18): `component_write` runs spec 18's `lockRefusal` against the shape's current sheet before anything is written, with spec 18's sentence and its definition of "changes" (the element's own subtree).

### Rules this spec bends

00-index requires a spec that bends a shared rule to say so and why. This one bends the following and keeps the rest. The build pull requests for this spec update each passage as the behaviour lands.

1. **Index, Vocabulary**: "**Artifact**: a page or a motion." becomes "a page, a motion or a component (spec 20)". The Shape list gains "**component**: a shared custom element's main definition, shown as its variant board (spec 20)." Why: a component is framed, versioned, edited and snapshotted exactly as an artifact is.
2. **Spec 09, Shapes**: "Two custom tldraw shapes, `page` and `motion`, both artifacts." gains the `component` shape with the props above. Its frame, live, snapshot, editor, label, delete and new-file rules apply to it. Its tools, Render and Parameters do not.
3. **Spec 09, Motion contract**: "GSAP loads with `<script src="gsap.js"></script>` and nothing else external loads;" gains "except the engine's component pins". The same line in `assets/prompts/motion-write-tool.md` changes with it.
4. **Spec 09, Tag injection**: "A motion gets the runtime tag first, then the bridge tag. A page written by the agent gets only the bridge tag." gains: the pins go right after spec 19's tokens tag, before the runtime and bridge tags, on every writer spec 18 extended the injection to. A sheet gets the tokens tag, the bridge tag and then the sheet helper tag.
5. **Spec 09, The motion library**: "A page write ensures only the bridge file (same size rule)." A component write ensures the bridge and the sheet helper. The preview origin's on-request refresh gains the sheet helper and missing compiled files. No route, header or allow-list entry changes.
6. **Spec 09, The live viewer**: the pointer's `kind` may be `component`, which frames the sheet directly as a page does.
7. **Spec 02, Paste**: "a pasted page or motion always gets its own copy of its file via `files.copy`;" gains: a pasted component gets a fresh tag through `component.copy`. "`files.copy { project, file, from? }`" gains: across projects, an `.html` file brings its pinned component files.
8. **Spec 07, canvas tools**: `create` gains the refusal for `component`; `canvas_read` gains the component entry and an artifact's `components`; the server gains `component_write` and `component_read`, and the plan-mode rule names `component_write`.
9. **Spec 14**: both tools join the outside list.
10. **Spec 16, Wires**: "Shapes are **wired** into a node: a prompt, an image, a video, a page, a motion, a group, a mark, or another node's current result." A component is not a source, with its refusal sentence in `wireRefusal`.
11. **Spec 08, Diffs**: "one entry per page or motion written" gains component sheets, and the empty state "No page or motion changed in this selection." reads "No page, motion or component changed in this selection."
12. **Spec 18**: the edit bridge gains instance reporting and sheet picking; the Design tab gains the Instance and Component sections; `applySourceEdits` gains two edit types; "Make component" joins the selection actions; the Parameters tab is absent for a component; inside a sheet the owner order is the one under The editor on a component, with `styleOwner` in place of step 4.
13. **Spec 18, Element ids, Runtime elements**: "a live element whose id an earlier live element already holds is treated as having none." Inside a component sheet's variant board, the copies of the template in each cell carry the template element's id, and each is picked and edited as that template element, not as a runtime element. Why: the board shows one template many times, and an edit to any copy is an edit to the template.
14. **Spec 18, Source edits, attribute**: "the allow-list, which in this spec is `data-uf-name` only." On an instance it also holds the variant and property names its pinned component declares, with the summary lines `{Variant} · {label}` and `{Property} · {label}`. Why: an instance's variants and properties are its attributes.
15. **CLAUDE.md, Commands**: "`pnpm test:perf` runs the frame-budget specs (specs 02, 09, 12 and 17)" gains spec 20, for its canvas budget task.

Not bent: contract 3 (a sheet is served only by the preview origin), contract 8 (every component file is in the project folder, and a pasted artifact brings its pins), contract 9 (the badge and the pins comparison run no artifact code on the canvas thread; component shapes follow spec 09's live rules), and spec 09's "every edit is a new file".

## Testing Decisions

A good test drives one of the three seams in 00-index and asserts on what it exposes: return values, RPC answers and streams, the room's shapes, the files and sidecars in the project folder, and what a person sees. No test reaches into the pins cache or React state.

- **Domain seam**, table-driven, for every rule with cases: `readComponentSheet` and `sheetRefusal` for each refusal in order; `compileComponent` (the declaration, style and template round-trip into the script text, `</script>` in content escaped, the header naming the sheet, the same bytes for the same sheet); `compiledFileName`; `injectPins` (missing, invalid and kept pins, placement right after the tokens tag, idempotence, unknown tags reported); `readPins`; `setPin`; `boardCells` (order, labels, `Default`, the cap and its line); `updateImpact` for each sentence and count; `styleOwner` (inline, specificity, order, `!important`, a variant rule, no owner, an untestable selector) and the sheet owner order; `applySourceEdits` for `componentUpdate`, `componentRule` (byte-for-byte elsewhere, `StyleRuleRef`, refusal) and an instance's declared attributes; `copiedTag`; `wireRefusal`.
- **Engine seam**, with the scripted agent: `component_write` and `component_read` (create, update, every refusal through the real tool, the files and sidecars, the turn's Revert, locks), pins injected by every writer and the `components` field of `page_write` and `motion_write`, the lock refusal of a `componentRule`, compiled files ensured at snapshot time, `canvas_read` and `canvas_write` for components, `component.pins`, `component.updates`, `component.copy`, `artifact.edit` with the new edit types and the race, `files.copy` bringing pins, the preview origin compiling a missing compiled file, render start ensuring pins (with `UNFRAMED_TEST_RENDERER`). New scripted-agent fixtures: a button component with two variants used by a page and a motion; a rewrite of that component.
- **Browser seam**: the component runtime in real Chrome (a fixture page pinning a fixture compiled file): upgrade at parse, defaults, properties, slots, a second pin harmless; the component shape, its board and snapshot; the editor's Component section, board picking, variant chips, edits that reach one variant or all; the Instance section; the badge and the updates popover; Make component; paste.
- **Real render probe**: an engine-seam test that renders, with the real producer, a fixture motion whose only content is an instance filling the frame in a token colour, then checks the MP4 and its sidecar exist and reads the frame at 1 s with ffmpeg to check the centre pixel. It needs Chrome and ffmpeg on the machine and is skipped, saying so, where either is missing, as spec 09's preview tool tests are. It prints HyperFrames' lint output for custom elements to the log.
- **Frame budget**: the canvas budget task is a `pnpm test:perf` spec, with spec 09's thresholds enforced on real hardware and asserted without them under `CI`.
- Prior art: spec 09's bridge tests (a generated script tested through its real source), its tag injection tests, its artifact tool tests through the scripted agent; spec 18's source edit and owner rule tests.

## Tasks

1. Contracts: the `component` shape and its first migration; the room accepts a component shape and refuses one whose `tag` breaks the tag rule. Seam: engine.
2. Component sheet reading: the declaration, style, template and examples found by their markers; each refusal sentence, in order. Seam: domain.
3. Canvas rules for sheets: tag taken by another shape, tag changed on a shape, an instance of another component in the template. Seam: domain.
4. Component compiler: the compiled text holds the runtime, declaration, style and template, escapes `</script>`, names its sheet, and is the same for the same sheet; `compiledFileName`. Seam: domain.
5. Variant board rule: combination order, labels, `Default`, the 48 cap with one row per variant and its line. Seam: domain.
6. The component runtime in Chrome: a fixture page with a pin in its head has every instance upgraded before its own inline script runs; variant defaults set on the live element; text and image properties set and restored; slots show children; a second pin for the same tag does not throw. Seam: browser.
7. Artifact store: a component write puts the sheet, its `.component.js` and the sheet sidecar (with `tag` and `compiled`) in the folder with exclusive create; a name is taken when its compiled name exists; the sheet helper is ensured by the size rule. Seam: engine.
8. Preview origin: serves a compiled component as `text/javascript` with the usual headers; compiles a missing one from its sheet on request; never creates a folder. Seam: engine.
9. Snapshots ensure compiled files: a snapshot of a page whose pinned compiled file was deleted recreates it, with the bytes the compiler makes, before the capture (skipped with a note where no Chrome is found, as spec 09's snapshot tests are). Seam: engine.
10. `component_write` creates a component shape beside the selection with the default title from the tag, tags the chat, records the activity and returns the answer with `usedBy`; Revert removes the shape and keeps the files. Seam: engine.
11. `component_write` with `shapeId` writes a new version and points the shape at it; every refusal through the real tool; plan mode refuses it; a person's name wins over the title. Seam: engine.
12. Locks: `component_write` runs `lockRefusal`, refusing a change to a locked template element with spec 18's sentence and writing nothing, and accepts a change elsewhere. Seam: engine.
13. `component_read` returns the current sheet and refuses unknown shape, wrong kind, unreadable file. Seam: engine.
14. Pins: `injectPins` adds missing pins right after the tokens tag and before the runtime and bridge tags, replaces invalid ones, keeps valid older ones, reports unknown tags, and is idempotent; `readPins`; `setPin`. Seam: domain.
15. `page_write` and `motion_write` inject pins for the canvas's components and return the `components` field; an older pin survives a rewrite. Seam: engine.
16. Pins on every other writer: `motion.upload`, an uploaded or dropped `.html`, an artifact paste's `files.copy`, the node page writer, a source edit and `artifact.prepareEdit` each add a pin for every project component tag the file uses that has none, and keep valid pins. Seam: engine.
17. `canvas_read` lists components with tag, variants, properties, slots and compiled file, and an artifact's `components`; `canvas_write` refuses creating a component and updating its `tag` or `file`. Seam: engine.
18. Outside agents: both tools on the outside list with `project`, same answers. Seam: engine.
19. The component shape on the canvas: the board shows in the live frame, a snapshot when not live, the Component icon and kind word, Editor and Agent in the toolbar without Render or Parameters. Seam: browser.
20. Sheet helper: a sheet opened on its own shows its board with labels and examples; a change to the template or style through the bridge's preview patch rebuilds every cell. Seam: browser.
21. Editor on a component: header with `Used in {n} artifacts`, the `Mode` toggle and `Kit mode` picker, Design and Layers tabs only, the read-only Component section and its ask-the-agent action. Seam: browser.
22. Style owner: the winner among inline style and matching rules by cascade, `!important`, variant rules, no owner, an untestable selector, each rule named by its `StyleRuleRef`; the sheet owner order (locked, script, token, then the style owner). Seam: domain.
23. `componentRule` edit: changes or adds one declaration in the rule its `StyleRuleRef` names, the rest byte for byte, occurrence counted, the value checked, the summary line, refusal when the rule is gone. Seam: domain.
24. `artifact.edit` on a component refuses a `componentRule` whose selector matches a locked template element, or an element inside one, with spec 18's lock sentence and writes nothing, and accepts one that matches only unlocked elements. Seam: engine.
25. Board picking: a click in a cell picks the element inside the instance, reports its template id and the variant context; outlines on every copy; the variant line in Design. Seam: browser.
26. Sheet edits by owner: a background set by a variant rule changes only that variant's cells after the burst, chip `kind: secondary`; a padding set inline changes every cell, chip `All variants`; a token declaration shows the token chip, another token writes into the rule and Detach writes the literal there; a `calc()` is read-only with `Set by the component's style.` The new sheet has a compiled file. Seam: browser.
27. The instance allow-list: `applySourceEdits` sets and removes an instance's declared variant and property attributes, refuses an undeclared name with spec 18's sentence, a value outside a variant's list, and these names on an element that is not an instance; each writes its summary line. Seam: domain.
28. Instances in a page: hover and click pick the instance, never its insides; a slotted child is picked as itself, including a slotted instance of another component (a button in a card's slot), which shows its own Instance section; Layers shows one row per instance. Seam: browser.
29. Instance section: variant selects and property fields from the pinned version's declaration; a change restyles the instance live and commits one source edit after the burst; the default value removes the attribute; an attribute a script sets is read-only. Seam: browser.
30. Go to main component opens the component's editor after committing a pending burst; disabled with its tooltip when the shape is deleted. Seam: browser.
31. `component.pins` streams every artifact file's pins and then new files' pins. Seam: engine.
32. Update impact sentences for a dropped variant value, property and slot, with instance counts. Seam: domain.
33. `component.updates` lists one row per component with its warnings; `artifact.edit` with `componentUpdate` writes a new artifact version with the new pin and the `Updated {title}` summary, refuses a stale base with spec 18's sentence and an unknown `to` with its sentence. Seam: engine.
34. Updates on screen: after a component edit, a page using it shows the `Updates` badge and the header button; the badge opens the editor with the popover; Update moves the pin and the badge goes; Cmd-Z brings the old pin and the badge back. Seam: browser.
35. A deleted component shape: instances still render, no update is offered, Go to main component is disabled; undo restores everything. Seam: browser.
36. Make component: shown for one plain element, disabled on a locked one, hidden for instances and in sheets; sends the chip and the filled instruction to the artifact's chat and opens the rail; the no-provider toast. Seam: browser.
37. `copiedTag` naming. Seam: domain.
38. `component.copy` writes a sheet with a fresh tag and its compiled file; within a project the tag changes, across projects a free tag stays. Seam: engine.
39. `files.copy` across projects brings a page's pinned sheets and compiled files when missing and leaves existing ones. Seam: engine.
40. Pasting a component shape makes a new component with its own tag; pasting a page into another project renders its instances there. Seam: browser.
41. Render start ensures the compiled files of the motion's pins (a missing one is recompiled), with `UNFRAMED_TEST_RENDERER=ok`. Seam: engine.
42. Real render probe, with the real producer (skipped with a note naming what is missing where Chrome or ffmpeg is not found): a fixture motion whose only content is an instance filling the frame in a token colour renders; the render answers success, its MP4 exists in the project folder with its sidecar, and the frame at 1 s, read with ffmpeg, has the token colour at its centre within a tolerance of 8 per channel. HyperFrames' lint output for the fixture is printed in the test log, not asserted. Seam: engine.
43. Tokens and modes: changing a token restyles a component's board and a page's instances; spec 19's `Kit mode` picker on a page switches its instances' look. Seam: browser.
44. `wireRefusal` refuses a component as a wire source with its sentence. Seam: domain.
45. A selection that holds a component shape and a prompt runs with the prompt only, and the component never joins the request. Seam: browser.
46. Turn diffs include a component sheet the turn wrote. Seam: engine.
47. Canvas budget: a board with ten pages each pinning one of five component shapes, badges showing on five of the pages, pans for 4 s in the hosted shape with the median frame gap at or under 16.7 ms and no more than 2 % of frames over 33 ms, as spec 09's artifact budget. The thresholds are enforced by `pnpm test:perf` on real hardware; under `CI` the same test runs and asserts everything except them. Seam: browser.

## Out of Scope

- **Nested components**: a component's template cannot hold another component. An instance placed in another instance's slot, in the page, is in scope (Using components in pages and motions). Two pins of one tag at two versions in one document would have to be reconciled, and a classic script cannot load another script in order. A later spec.
- **Detaching an instance** into plain markup by hand. A person asks the agent (point and tell on the instance).
- **Editing the declaration by hand** (adding a variant, a property or a slot), and making a value differ per variant by hand. Both are code changes, made by the agent.
- **Per-instance edits of a component's insides**, and double-click editing of an instance's text.
- **Updating every artifact at once** from the component's side. Updates are accepted per artifact.
- Scripts and behaviour inside components, component events, and form participation.
- Components in a kit or the library (spec 19's kits carry tokens only), and sharing components between projects except by paste.
- An empty component shape from the add menu.
- Components as node inputs or outputs (spec 16).
- Deleting superseded sheets or compiled files.

## Open decisions

None open. Settled with the person:

1. **Updating every artifact at once.** Updates are accepted per artifact in the first build. `Update everywhere` (one engine operation that writes each artifact a version) is a later change, once the person has used per-artifact updates.
2. **Nested components.** A component's template holds no other component in the first build; components compose through slots in the page. Templates that hold components are a follow-up spec once the first build shows how often the agent wants them.

## Further Notes

- **Why the sheet is HTML and not script.** A sheet is what the agent reads and writes, what the editor opens and what spec 18's Design, Layers, ids, locks and source edits work on. All of those work on HTML. The compiled script is a build the engine owns, so the agent never writes JavaScript to define an element, and the person's edits never touch a script.
- **Why shadow DOM.** It keeps a page's own CSS from restyling a button's insides and the button's CSS from leaking into the page, which is what "an instance does not fork" means. Tokens still reach in because custom properties inherit. Fonts are loaded by the page (`@font-face` does not work inside a shadow root), which the component tool description says.
- **HyperFrames and custom elements.** The runtime treats an instance as any element: it can be a clip with `class="clip"`, `data-start` and `data-duration`. HyperFrames' producer collects and reorders scripts when it inlines sub-compositions but keeps a local `<script src>` in its authored place, and serves relative files from the project folder; the render probe (task 42) checks this on the installed version, and runs again after any HyperFrames upgrade.
- **A known limit of locks in sheets.** A lock covers the locked element's own subtree (spec 18). So an agent's `component_write` that changes a style rule which restyles a locked template element is not refused: `lockRefusal` compares the element's markup, not the CSS that reaches it. Only the person's `componentRule` edits check selectors against locks. A stricter check would have to run the cascade on every agent write.
- **Undo on a component and "updates".** Undoing a component edit points its shape at the older sheet. Artifacts that had accepted the newer one then show an update that moves them back. This is consistent (the board is the truth), and the warnings still describe what changes.
- **Licences**: nothing new. The runtime is Unframed's own code.

### Assets this spec needs

Written at build time under `assets/prompts/`:

- `component-write-tool.md` (new): the `component_write` description: what a component is for, the sheet format with the four markers and the declaration's limits, tokens for every colour and size when the project has a kit, no scripts and no nested components, fonts loaded by the page, that the engine compiles the sheet and adds pins, that a person accepts updates, and the three argument descriptions (`html`, `shapeId`, `title`).
- `component-read-tool.md` (new), or a section in `artifact-read-tools.md`: the `component_read` description and its `shapeId` argument.
- `make-component-instruction.md` (new): the Make component instruction, with placeholders for kind and title.
- `page-write-tool.md` and `motion-write-tool.md` (changed): one paragraph each: use instances of the project's components (listed by `canvas_read`) instead of copying their markup; the engine adds the pins; keep pins when rewriting; an instance's insides cannot be styled or selected from the page. The motion paragraph adds: animate an instance as one element or through a custom property it exposes. The motion contract's "nothing else external loads" line names pins.
- `tool-descriptions.md` (changed): `canvas_read`'s component entry and an artifact's `components` field; `canvas_write`'s refusal for creating components.
- `agent-system.md` (changed): one sentence: when the project has components, reuse them, and when the person asks for something repeated, propose a component.
