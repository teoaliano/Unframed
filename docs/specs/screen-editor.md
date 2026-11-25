# Screen editor

## Problem Statement

Pages, motions and components open in a full editor tab: the agent rail on the left, a live preview in the centre with Edit and Interact modes, and the Design, Layers and Parameters panels on the right. A Screen, the canvas shape that shows a live app from a Repository, has no editor at all. The person said: "a screen should have an editor view, the exact same we have for pages."

A Screen differs from a page in one way that matters here: its source is the repository's code, not one HTML file, so a change made in the Design panel cannot be written straight to a file.

## Solution

A Screen opens in the same editor tab a page does, from the same places, with the same layout. The centre shows the live Screen through the Instance's proxy, at its current state. In Edit mode the person selects elements inside the running app and changes their styles, text and visibility in the Design and Layers panels. Each change previews at once as an override inside the frame, and the composer draft collects the changed elements as element chips with an instruction that lists the changes. The person sends the draft, and the agent makes the change in the repository on that Screen's branch. Overrides are not saved: undo removes them, and a reload drops them.

## User Stories

1. As a person on a Repository, I want to open a Screen in an editor tab the way I open a page, so that I can work on one Screen with room to see it.
2. As a person, I want the Screen's toolbar to have an Editor button, and double-clicking a Screen to open its editor, so that the entry points match pages.
3. As a person, I want the Screen's editor tab to come back after a restart, follow the Screen's title, route and state, and close when the Screen is deleted, so that it behaves like a page's tab.
4. As a person on an iPad, I want the same "open this on your Mac" notice a page gives, so that I know where the editor lives.
5. As a person, I want the agent rail on the left to chat about this Screen, so that the agent works on its branch.
6. As a person, I want the centre to show the live Screen at its state, with the same starting, stopped and failed overlays as on the canvas, so that I see what the canvas shows.
7. As a person, I want navigating inside the Screen in Interact mode to move the Screen to the new page, as on the canvas, so that the Screen follows me.
8. As a person, I want the header to show the Screen's name, the Edit and Interact toggle (V and I), the preview size, Open in browser, Parameters when the app has them, and the branch chip, so that the chrome matches a page's.
9. As a person, I want the preview size to set the Screen's viewport, so that the editor and the canvas show the same size.
10. As a person, I want to select elements inside the running app in Edit mode, so that I can point at what I want changed.
11. As a person, I want the Design panel to show and change the selected elements' styles, and Layers to show the page's elements, so that I can try a change without writing it.
12. As a person, I want each change to show at once in the frame, so that I see it before anyone writes code.
13. As a person, I want my changes collected in the composer as element chips and an instruction, so that one send asks the agent to make them in the code.
14. As a person, I want undo to remove my last change, so that I can back out of a try.
15. As a person, I want the panel to say in one line that these changes are not saved, so that I do not expect them to survive a reload.
16. As a person on a build without Repositories, I want nothing about Screen editors to show, so that the feature stays hidden until it ships.

## Implementation Decisions

### Opening a Screen's editor

- `aboutShape` answers for a `screen` shape when the `repositories` flag is on, with kind `screen` and the title `<title> · <state or route>` (the Screen label, built from the shape's own title). Everything built on it then works for Screens unchanged: `openArtifactTab`, the `openArtifact` slot that `ArtifactsHost` registers, the device notice, `watchEditorTabs` (title follows, tab closes when the Screen is deleted) and the agent rail's links to a shape.
- The editor-tab kind widens from `ArtifactKind` to `EditorKind` (`page`, `motion`, `component`, `screen`). Saved tabs keep `screen` when restored. The tab strip shows a Screen's tab with the Screen icon and the word "Screen".
- The Screen toolbar gains an Editor button before the branch chip, and `ScreenShapeUtil.onDoubleClick` calls the `openArtifact` slot, as pages do.
- With the flag off, `aboutShape` answers nothing for a Screen: no Editor button, double-click opens nothing, and a saved Screen tab closes when its project opens.

### One editor, generalised

- `ArtifactEditor` stays the one editor component. It reads a Screen's facts as well as an artifact's and branches only where a Screen differs: the centre, the header items, and where edits go. The layout, tokens, keyboard handling, rail, panels and sheets are shared.
- `useEditSession` gains a target: `file` (pages, motions and components, as today) or `screen`. With `screen` it never calls the engine: a change becomes an override, previewed in the frame with the same frame patches a page uses, and the session's source tree is built from the live page (see below). Undo removes the last override and re-applies the rest. A new document in the frame (a reload or a full navigation) starts with no overrides and no selection.
- Header for a Screen: the title (the Screen label), the kind word "screen", the Edit and Interact toggle (when element editing is on, as for pages), the preview size, Open in browser (the canvas toolbar's own action), the branch chip, and Show parameters when the column folds. Render, the kit picker, component updates and Open in a new tab are page-only and do not show.
- The branch chip in the header is the canvas's `BranchChip`, made to work from the canvas document rather than the tldraw editor. In the editor tab its menu shows Changes and Remove branch and worktree only: the other items place a new Screen beside this one on a canvas the person is not looking at.
- Parameters work as on the canvas: the Screen's dials, the app's announcement through the bridge, and the Screen wording for Add parameter and Apply (the instructions `ParametersPanel` already builds for Screens).

### The centre

- The live Screen logic leaves `screen.tsx` for a shared hook in `packages/web/src/repositories/`: the per-load state token and replay, the reload when a state holds, following navigation, the snapshot until first paint, the overlays (starting, stopped, failed, removed, missing), "Couldn't reach this state" with its fix button, and the no-bridge note. The canvas `ScreenCard` and the editor centre both render it. Each passes its own way to follow navigation: the canvas keeps its selected-Screen rule, the editor always follows, both as one undoable change.
- The editor shows the frame at the Screen's viewport, scaled down to fit the column like a page at a fixed preview size.
- The editor demands its Screen's Instance from the engine, as the canvas does for Screens in view, so the dev server starts and stays up while the editor is open. It uses its own demand client so the canvas's demand does not cancel it.

### Edit mode inside a Screen

- The proxy's injected bridge also carries the edit bridge (the one pages use), built in stamp mode. In stamp mode an element without a `data-hf-id` gets one the first time the editor asks about it (hover, pick, tree), and each report and tree node carries `path`, a CSS path built from tags, ids, classes and positions that finds the element without those stamps, and `name`, a short readable name. On the canvas nobody asks, so nothing is stamped. The screen bridge tells the edit bridge which parent to answer, so a new document in the frame says it is ready by itself.
- The session's source tree for a Screen is built from the live tree and the latest reports: every element counts as written exactly as it renders. So every field the Design panel shows is editable, and nothing is "Set by the agent's code".
- Changes a Screen takes: styles, text, and hide or show. Not offered for a Screen: replacing an image (a project file does not load inside the app), Make component, locking and renaming layers, kit tokens and component rules (a Screen has no kit or components).
- Every change updates the composer draft of the Screen's chat: the changed elements as element chips, and the instruction from `assets/prompts/screen-edits.md`, which names the Screen, its branch, its state and its worktree, and lists each element with its selector and the values to set. The instruction replaces the draft's text only while the text is empty or still the instruction the editor last wrote, so a person's own words are never overwritten. Undoing every change takes the instruction and the chips it added back out.
- A Screen's element chip has no element id: its selector is the element's `path`, and its excerpt is built without the stamped id.
- The Design and Layers panels show one line for a Screen: "Changes preview on the running app and are not saved. Send the draft to have the agent make them in the code."

### The agent

- The engine lists a Screen's element chips in the turn's preamble under `Screen "<label>" (shape <id>)`, with a line saying each selector finds the element in the page as it renders, not in a source file. Today the preamble lists chips of pages and motions only. With the `repositories` flag off, Screen chips are left out.
- A chat opened from the Screen editor's rail is filtered to the Screen, as page editor chats are, and the instruction names the worktree, as the other Screen instructions do.

### Tokens

- New parts use existing editor tokens: the not-saved line uses `--artifact-editor-note`, like the editor's other notes. No new token was needed, so there is no Figma follow-up.

### Delivery

- Everything sits behind the `repositories` flag. Lands on `t3/screen-editor`, cut from `feat/repositories`.

### Calls made without the person

The person asked for no questions. These are the calls made while writing this spec:

- Edit mode in a Screen also needs the `element-editing` flag, exactly as pages do; with it off, the Screen editor shows the preview and Parameters only.
- The preview size for a Screen lists the canvas viewports (Desktop, Laptop, Tablet, Phone) and Custom, not Fill: a Screen always has a fixed viewport, and the two places must agree.
- The branch chip in the editor offers Changes and Remove only (see above).
- Undo in the Screen editor removes overrides only. Undoing a navigation stays on the canvas, where it already works.
- Overrides that a stylesheet beats behave as on a page: the panel says a rule wins, and the change is dropped.

## Testing Decisions

- Tests check what a caller sees: what the page shows, the composer draft, the shapes in the room, the preamble the agent receives.
- **Domain seam (Vitest)**: the edit bridge in stamp mode (stamps on demand, reports `path` and `name`, stamps nothing until asked); the Screen editor tab facts (kind, title); building the source tree from the live tree and reports; recording, replacing and undoing overrides; the instruction and the Screen chip; the preview size choices mapped to a Screen's viewport; the element context with a Screen; the prompt assets matching the constants.
- **Engine seam (Vitest, real engine)**: the proxy serves a bridge with the edit bridge in it; a turn with a Screen's element chip has them in its preamble under the Screen header, and with `repositories` off it does not.
- **Browser seam (Playwright)**, new `screenEditor.spec.ts`: open from the toolbar and by double-click, live preview, restore after reload, title following a navigation, tab closing on delete; header items present and page-only ones absent; preview size changing the Screen's viewport; Edit mode selecting an element in the app, the Design panel changing its colour in the frame, the draft holding the chip and instruction, undo removing the override and the instruction; Layers listing the page's elements; the not-saved line. Off state in `featureFlags.spec.ts`: no Editor button and double-click opens nothing.
- Prior art: `screens.spec.ts`, `screenStates.spec.ts`, `artifactEditor.spec.ts`, `artifactTellAgent.spec.ts`, `editBridge.test.ts`, `pointedPreamble.test.ts`.

## Tasks

1. Build the edit bridge in stamp mode and carry it in the screen bridge, with the screen bridge naming the parent. Seam: domain, then engine (the proxy serves it).
2. Add the Screen's pure editor rules: editor-tab facts, the live source tree, overrides, the instruction asset and Screen chips, and the preview size mapping. Seam: domain.
3. List Screen element chips in the preamble, behind the flag. Seam: engine.
4. Widen editor tabs to `EditorKind`, answer `aboutShape` for Screens behind the flag, and add the Editor button and double-click. Seam: browser.
5. Move the live Screen logic into a shared hook used by the canvas card, with no behaviour change. Seam: browser (existing `screens.spec.ts` and `screenStates.spec.ts`).
6. Make `BranchChip`, Open in browser and the frame registry work from the canvas document. Seam: browser (existing specs).
7. Open a Screen in `ArtifactEditor`: the live centre at the Screen's viewport, its header, the editor's Instance demand, Parameters. Seam: browser.
8. Give `useEditSession` the `screen` target: overrides, undo, the live source tree, the composer draft, and the panels' Screen limits and line. Seam: browser.
9. Test the off state. Seam: browser feature-flag tests.

## Out of Scope

- Writing a change into the repository without the agent.
- Keeping overrides across reloads or sessions.
- Replacing images, making components, locking or renaming layers in a Screen.
- Recording steps from the editor.
- Placing new Screens from the editor's branch chip.

## Further Notes

- Builds on `docs/specs/repositories.md` and `docs/specs/screen-states-and-branches.md`.
- Real frameworks stay out of CI: stamping on a React app is checked in the dev app before merging.
