# Screen direct edit

## Problem Statement

The Screen editor lets a person select elements inside the running app and change their styles, text and visibility, but every change is an override on the live page. Nothing reaches the code until the person sends a draft and the agent finds the right file, reads it, and writes the change. For a padding of 14 pixels that should be 8, that is a full agent turn, minutes instead of seconds, and the agent starts from a CSS path that names nothing in the source.

The editor knows nothing about the code behind an element: not the file, not the line, not the component, not whether the same JSX renders four times on the page, not the Tailwind classes the project already uses. So it shows pixels where the code has `pl-3.5`, and it cannot write a change itself.

## Solution

Each element in a live Screen maps to the JSX that rendered it: the file, the line and column, the component that owns it, the props at its callsite, and how many elements on the page come from the same JSX. The mapping needs no change to the person's build. The bridge Unframed already injects into the page registers a React developer-tools hook before React loads and reads React's own development data from each element.

Hand edits become **drafts**. Each one previews at once on the live page, as today, and joins a pending list in the editor: how many changes, each one's before and after, compare, discard one, discard all. **Apply** writes the drafts into the Screen's worktree. The engine edits the source by span with a JSX parser: it swaps a Tailwind class inside a literal `className`, replaces static text, replaces a literal attribute, or adds a class. When the dev server's hot reload lands in the Screen, the editor reads the element back and marks each change as took or did not take.

A change the engine cannot write mechanically, or one that did not take, goes to the Screen's agent thread as one message: the file, the line and column span, the component, the before and after values and the token for each change. When the agent finishes, the same check runs.

The Design panel speaks the project's Tailwind: values read as the element's classes, typed pixels snap to the scale, and a component instance shows its component, how many instances the page has, its props, and the variants its `cva` call declares. A Code section shows the file, the line range and the JSX.

## User Stories

### Mapping

1. As a person on a Repository, I want each element I select in a Screen to name the file, line and component that render it, so that I know where a change will land.
2. As a person, I want this to work on my app as it is, with no plugin or build change, so that I can use it on any React app I already run.
3. As a person, I want to see how many elements on the page come from the same JSX and which one I picked, so that I know whether a change touches one card or all of them.
4. As a person, I want an element the mapping cannot reach (one drawn by a library outside React) to name the nearest element it can, so that I still know roughly where it lives.

### Selecting

5. As a person, I want a click in Edit mode to select the outermost component instance under the pointer, so that I pick whole parts of the page first.
6. As a person, I want a double-click to go one level deeper, Cmd-click to pick the deepest element, and Shift-click to add to the selection, so that I reach any element in a few clicks.
7. As a person, I want the outline and a label such as "Header · in AgentRail 359×48" drawn by Unframed over the frame, so that selection never changes the app itself.
8. As a person, I want Delete and Backspace with an element selected never to delete the Screen, so that I cannot lose the Screen by accident.

### Inspecting

9. As a person, I want spacing, size, type and radius values to read as the element's Tailwind classes, so that the panel speaks the project's language.
10. As a person, I want a value I type in pixels to snap to the project's scale, so that my change stays on the scale.
11. As a person, I want a component instance to show its component, its instance count, its props at the callsite, and its variants when it uses `cva`, so that I see it as the code sees it.
12. As a person, I want a Code section with the file, the line range and the JSX, so that I can check what will change.

### Drafts and Apply

13. As a person, I want each change to show on the live Screen at once, so that I see it before any code changes.
14. As a person, I want a pending list with the count, each change's before and after, compare, discard one and discard all, so that I can tidy my drafts before writing them.
15. As a person, I want Apply to write every draft into the Screen's worktree and tell me, per change, whether it took on the reloaded page, so that I trust the result.
16. As a person, I want a change Unframed cannot write by itself to go to the Screen's agent with exact instructions, and to be checked the same way when the agent finishes, so that every change ends the same way.
17. As a person, I want undo after Apply to put back exactly the lines Apply changed, so that I can back out of a write.
18. As a person, I want to choose whether a change in a reused component applies to every instance or only this one, so that I do not restyle every card by accident.

### Agent

19. As a person, I want the agent to see each element's file, line and component, so that its own edits land in the right place.
20. As an agent, I want a tool that resolves a Screen's element to its file, line, component and instance count, so that I can edit precisely.

### Flag

21. As a person on a build without Repositories, I want none of this to show, so that the feature stays hidden until it ships.

## Implementation Decisions

### Mapping without a build change

- The injected bridge (`screenBridgeSource`) gains a source module that runs first, before any app script. It installs `__REACT_DEVTOOLS_GLOBAL_HOOK__` when none exists, or wraps the existing one, keeping every method it already has and calling through. React finds the hook when it loads, registers its renderer, and reports each commit.
- For a DOM element, the module reads React's fiber from the element's `__reactFiber$` key. It resolves:
  - **Source.** React 18 and earlier keep `_debugSource` (`fileName`, `lineNumber`, `columnNumber`). React 19 keeps `_debugStack`, an error captured where the JSX ran; the module takes the first frame outside React and the bundler's dependency folders, then maps it through the dev server's source map (inline or fetched from the same origin through the proxy). The mapping code is pure and tested in the domain.
  - **Component.** The owner's display name (`_debugOwner`), seen through `memo` and `forwardRef`.
  - **Instance key, count and index.** The unmapped source position (file, or bundled URL, plus line and column) is the key. The module counts the elements on the page with the same key, in document order, and reports which one this is.
  - **Levels.** Walking up the fiber tree, each component boundary contributes the first DOM element it renders. These levels, outermost first, drive selection. Levels that cover nine tenths of the viewport or more (the app's shell) are skipped.
  - **Props.** The props of the outermost component rooted at the element, with primitives kept and everything else summarised (`ƒ`, `{…}`, `[…]`), `children` left out.
- An element with no fiber of its own is **not self-mapped**: it reports the nearest mapped ancestor's source plus its CSS path.
- The engine turns a reported file into a worktree path: absolute paths inside the worktree, URL paths from the dev server's root, and `webpack://` prefixes all resolve; anything outside the worktree is refused.
- Next.js: in development the App Router renders through React 19 in the browser for client components, so the same path applies. Server components have no fiber in the browser; their elements fall back to the nearest client component or the CSS path. Webpack's `webpack-internal:///(app-pages-browser)/./src/…` and `webpack://app/./src/…` names resolve to worktree paths. When a reported line does not land on JSX (an eval source map that shifts lines), the writer looks for the one element in the file with the same tag and the class being changed, and otherwise refuses, so the change goes to the agent with the file and the component.

### Selecting

- The edit bridge, in stamp mode, sends each pick with its levels (stamped ids and component names) and the gesture: click count, Cmd and Shift.
- A pure rule chooses the selection: a click takes the outermost level, or keeps the current selection when the pointer is inside it; a double-click goes one level deeper than the current selection; Cmd-click takes the deepest element; Shift adds. A page with no React reports one level, the element itself, which is today's behaviour.
- The overlay draws the selection label as `<name> · in <component> <w>×<h>`.
- In the Screen editor, Delete and Backspace with an element selected are swallowed, so tldraw never sees them; the Screen shape stays.

### Inspector

- A Source section heads the Design panel for a Screen: the component and its instance count (`Header · 4 instances`), the instance's props, the `cva` variants with their options and the current choice when the engine finds them, and Code: the file, `line–endLine`, and the JSX span. The engine reads all of it from the file (`screens.inspect`).
- Tailwind mapping is pure domain logic (`tailwind.ts`): which class sets a property (`pl-*`, `px-*`, `p-*` for padding-left; `text-sm` for font-size and line-height), what a class is worth in pixels on the default scale (spacing at 4 px a step, the type scale, radii, weights), and the class for a typed value (8 px on padding-left is `pl-2`; a value off the scale becomes an arbitrary class, `pl-[13px]`). Variant-prefixed classes (`hover:`, `md:`) are read but never written.
- Fields that map to a class show it beside the value (`pl-3.5`).

### Drafts

- A draft change is `{ id, kind: style | class | text | attr, property, before, after, token?, element }`, where `element` is `{ source { file, line, col, endLine?, endCol? }, component, instanceIndex, instanceCount, selector, name, selfMapped }`.
- A style change on an element whose classes are Tailwind becomes a class change: `before` is the class that sets the property today (or none), `after` the class for the new value, `token` its name and value. Otherwise it stays a style change.
- The live preview keeps today's overrides. Text overrides write to the element's own text node so React's later updates still land.
- The pending list sits in the editor header: a count button opens it, each row names the element by its kind and component and reads like "Padding left 14 → 8 · pl-2", with discard, and All N or Only this one when the JSX has more than one instance. Compare shows the page without the drafts while it is on; Discard all and Apply close the list.
- A reload of the Screen drops the drafts with the overrides, as before.

### Writing

- The writer is pure domain code (`@unframed/domain/jsx`) on Babel's parser, editing by span so formatting is kept. For each change it finds the JSX element whose opening tag starts at the reported line and column, then:
  - **class**: swaps the class inside a string-literal `className`, a template literal with no expressions, or the literal arguments of `cn`, `clsx`, `cx`, `classNames` or `twMerge`; adds the class to the first literal when there is no class for the property; adds `className="…"` to a host element that has none.
  - **text**: replaces a single static text child, keeping the whitespace around it.
  - **attr**: replaces a literal attribute value, or adds the attribute.
  - **style**: replaces or adds a literal key in a `style={{ … }}` object literal.
  - It refuses, with a reason, when the value is computed (an expression), the class comes from a prop or a variant (it is in no literal), the element is not self-mapped, or no JSX starts at the position.
- **Scope.** When the element's JSX has more than one instance on the page, the change writes at the JSX site, which changes every instance; the pending row says "all N". Choosing "only this one" sends the change to the agent, since it needs a prop or a wrapper at the callsite.
- The engine (`screens.apply`) resolves the Screen's worktree, applies each file's changes in order, writes the files, and keeps what it changed (file, offset, before and after text) under an apply id. `screens.revert` puts back each span still as Apply left it and reports any it cannot.

### Apply and check

- Apply sends every draft to `screens.apply`. The editor resets the overrides, waits for the Screen to report a React commit or a new document (hot reload or full reload), up to 10 seconds, then asks the bridge to measure each target, found by instance key and index, or by CSS path. A pure check compares what was asked with what the page shows (pixels against rem, colours in any notation, text trimmed) and marks each change **took** or **did not take**.
- Changes refused by the writer, changes the person scoped to one instance, and changes that did not take go to the Screen's agent thread (the chat that continues this Screen, or a new one) as one message: one line per change with the file, the line and column span, the component, the property, before and after, and the token, and element chips that carry the source. The file in each line and chip is the one `screens.inspect` found in the worktree, or the CSS path when it found none. The canvas keeps a resolved element from the page only when its fields have the shapes React's data gives (a one-line file, integer positions, component names that are identifiers), and every string the page reported is quoted on one line in the message. When that turn ends, the same check runs on those changes.
- Each pending row shows its state: writing, checking, took, did not take, with the agent, refused (with the reason).
- Undo (Cmd-Z) right after Apply calls `screens.revert` for that apply.

### Agent

- Element chips gain an optional source (`file:line`, component). The preamble lists it after the selector.
- A new repository tool, `screen_element`, takes a Screen and a CSS selector, loads the Screen's route in the headless browser through the proxy, and answers the element's file, line, column, component and instance count from the same bridge code.

### Flag and tokens

- Everything sits behind `repositories` (and `element-editing`, like the Screen editor's Edit mode). The engine refuses `screens.inspect`, `screens.apply` and `screens.revert` with the flag off.
- New parts reuse existing editor tokens: rows and buttons use the Design panel's, the pending count uses the badge's, notes use `--artifact-editor-note`. Tokens to add in Figma later, under a `screen-drafts` group: `screen-drafts/row/surface-hover`, `screen-drafts/status/took`, `screen-drafts/status/failed`.

## Testing Decisions

- Tests check what a caller sees: the file on disk after Apply, the page after a hot reload, the pending list, the message the agent receives.
- **Domain seam**: source-map lookup and stack parsing; the source module on fake React 18 and 19 fibers (source, component, levels, instance count, props, hook chaining); the pick rule; Tailwind mapping and snapping; draft changes from an edit; the JSX writer on fixture sources (each kind, `cn` arguments, formatting kept, every refusal); worktree path normalising; the check; the agent instruction.
- **Engine seam**: `screens.inspect`, `screens.apply` and `screens.revert` against a real repository's worktree (`screenDirectEdits.test.ts`), and refusal with the flag off; the bridge served with the source module first; `screen_element` in headless Chrome against the fixture app (`screenElement.test.ts`).
- **Browser seam**: a fixture app (`packages/engine/test/reactFixture.ts`) built with real React 19 and esbuild's JSX dev transform with inline source maps, served by the fake dev server with a small Tailwind-like stylesheet, and reloading the page when a source file changes. `screenReactSource.spec.ts` checks the mapping itself. `screenDirectEdit.spec.ts` checks levels by click, double-click and Cmd-click, the label, the Source section, a padding change that shows its class, joins the pending list, is written by Apply and reads took, undo putting the file back, a change kept to one instance going to the agent, and Delete with an element selected keeping the Screen. `screenEditor.spec.ts` keeps the page without React on CSS paths.

## Tasks

1. Pure mapping code: stack frames, source maps, the source module with the hook, levels, props. Seam: domain.
2. Carry the source module in the bridge and the levels and source on reports and picks. Seam: domain, engine (bridge served).
3. Tailwind mapping, draft changes, the pick rule, the check, the instruction. Seam: domain.
4. The JSX writer. Seam: domain.
5. `screens.inspect`, `screens.apply`, `screens.revert` behind the flag. Seam: engine.
6. The fixture React app in the fake dev server. Seam: browser.
7. The edit session's drafts, the pick rule, the label and Delete safety. Seam: browser.
8. The Source section and class hints in the Design panel. Seam: browser.
9. The pending list, Apply, the check and the agent hand-off. Seam: browser.
10. Source on element chips and the `screen_element` tool. Seam: engine.
11. The off state. Seam: engine and browser feature-flag tests.

## Out of Scope

- Edit mode on the canvas itself: selecting elements in a Screen without opening its editor. The editor carries it first; the canvas follows once the editor's model has settled.
- Background planning of a change before Apply.
- Moving, reordering, wrapping or deleting elements.
- Frameworks other than React. A page with no React keeps today's CSS-path behaviour.
- Writing CSS files, CSS modules or design-token files. Those changes go to the agent.
- Colour tokens from the project's theme: a colour change writes an arbitrary value class (`text-[#c0392b]`) in place of the colour class.

## Further Notes

- Builds on `screen-editor.md`, which made Screen edits overrides only, and on the proxy and bridge in `repositories.md`.
- Real Vite and Next apps stay out of CI; the fixture app covers React 19 with source maps, and the domain tests cover React 18's `_debugSource`. Check a Vite app and a Next app in the dev app before merging.
