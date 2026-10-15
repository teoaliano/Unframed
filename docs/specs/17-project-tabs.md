# 17 · Project tabs

Depends on: 01 to 16 (read 00-index first). It replaces the project picker that spec 02 and spec 10 describe, and it changes the parts of spec 01, 02, 08, 10 and 14 named under "Specs this amends". Those passages are edited in the build PRs, not here, so the spec describes the app as it is until the build lands.

## Problem Statement

One project is open at a time. To reach another one, a person opens the project picker, and the canvas is torn down and built again for the new project. People who work across several projects want what browsers give them: several open at once, one click away, in a row across the top.

The app is fast because it keeps one live canvas. A naive version of tabs keeps one tldraw editor, one sync socket, one set of artifact frames and one agent rail for every open project, so ten tabs cost ten times the memory and the work of one, and the app slows for everyone. Tabs have to be close to free while they sit in the background, and the cost of switching can be a little higher, because switching already rebuilds the canvas today.

## Solution

The project picker leaves the top-left card, and Settings moves to the end of the top bar that is opposite the window controls: the top-right on macOS, where the traffic lights are on the left, and the far left on Windows, where the caption buttons are on the right. In the middle sits a **tab strip**: an opaque grey strip holding one rounded **project tab** per open project, in the order they were opened, and inset in it the same rounded shape as the Settings button. Clicking a tab switches to that project. An **All projects** button at the end of the strip holds what the picker held: the list of every project, Rename and Delete per row, and Add project.

Only the **active tab** has a live canvas. It is the same canvas, rail and sockets the app has today. A **background tab** holds a small descriptor: its project name, the camera it was last at, and the chat drafts typed in it. It holds no editor, no socket, no artifact frame, no timer and no listener. Switching tears the active canvas down and builds the new one, as the picker does today. Nothing else is kept warm.

Work does not wait for a tab. An agent turn, a paid generation, a video render or a motion render started in a background project keeps running in the engine and lands in that project's folder and canvas room, as it does today when no tab is open on it. A background tab shows that work and whether anything waits on the person, with the same live dot the chat tabs use, and a check when a project finished while it was in the background and nobody has looked.

The open tabs, their order and the active one are remembered in the preferences store, so they come back after a restart. Only the active tab loads; the others wait until they are opened.

## User Stories

1. As a person, I want to open a second project in a new tab, so that I can keep two projects in reach without closing one.
2. As a person, I want the tabs in the top bar where the project picker was, so that switching project is one click and I know where to look.
3. As a person, I want to open a project that is already open and land on its tab, so that I never get two tabs on one project.
4. As a person, I want to close a tab, so that I can tidy up without deleting anything.
5. As a person, I want to reopen the tab I closed by mistake, so that closing is safe.
6. As a person, I want to drag tabs into the order I work in, so that my usual projects sit first.
7. As a person, I want the tabs back after I restart the app, in the same order and with the same one active, so that I do not rebuild my set each morning.
8. As a person, I want the tabs that do not fit to stay reachable, by scrolling the strip or from the All projects list, so that ten tabs do not push the logo or Settings off the window.
9. As a person, I want a background project's agent turn and paid generation to finish while I work in another project, so that I never have to wait on one project to use another.
10. As a person, I want a background tab to show that its project is running, needs my answer, or has finished without my looking, so that I know where to go next.
11. As a person, I want switching tabs to keep the view where I left it, so that I can come back to a place on a board without finding it again.
12. As a person, I want ten open tabs to feel like one, in speed and in memory, so that opening many projects costs me nothing I can notice.
13. As a person using an outside agent, I want its canvas reads and writes to keep working for a project that sits in a background tab, so that a terminal agent never stops because I looked at another project.
14. As a person, I want Cmd+T, Cmd+W, Cmd+Shift+T and Cmd+1 to Cmd+9 to work from the keyboard, so that tabs feel like a browser.
15. As a person, I want renaming or deleting a project to keep its tab right, so that the strip never shows a project that is gone.
16. As a person, I want changing the output folder to close every tab first and then bring the tabs back for the folder's projects that exist, so that no tab shows a project from the old folder.

## Implementation Decisions

### Terms this spec adds

- **Project tab**: one open project's place in the tab strip. One tab per project. It has the project's name, its position and its status dot.
- **Active tab**: the project tab whose canvas is mounted. There is at most one, and none when no tab is open.
- **Background tab**: every other project tab. It holds a descriptor and nothing live.
- **Tab store**: the in-memory record of the tabs: their order, the active one, each tab's camera and chat drafts, and the closed-tab stack. It lives in the web client and is lost on reload. The saved part (order and active) lives in the preferences store.
- **Closed-tab stack**: the last ten projects closed from the strip, most recent first. In memory only.
- **Activity**: the engine's per-project status (live work and waiting requests), read by the strip. Defined under "The activity stream" below.

Spec 08's chat tabs keep their name. Where this spec says "project tab", it means the top-bar tab, never a chat.

### Modules

- **Domain** (pure, `domain/tabs.ts`): the tab rules with no I/O. `openTab(order, name)` appends a name not yet in the order and returns the existing position otherwise. `closeTab(order, active, name)` returns the new order and the new active name: the tab to the right of the closed one, else the tab to its left, else none. `moveTab(order, name, to)`. `restoreTabs(saved, projects)` keeps the saved order, drops every name no longer in the project list, and falls back as spec 02 does when nothing is left. `tabWidth(available, count)` returns the width each tab gets, clamped between 120 and 200 px. `statusOf(activity)` returns one of `needs-you`, `running` or none, with `needs-you` winning. `closedStack.push` and `closedStack.pop` keep the last ten entries.
- **Engine**: `projects/activity.ts` (new). It derives each project's activity from three sources that already exist: the chat store (turns running, including outside turns, and pending approvals, questions and plans, spec 07), the run registry (live runs, spec 03) and the render jobs (pending durable renders, spec 04, and in-flight motion renders, spec 09). Nothing is stored; it is computed when read. It registers no closer, holds no timer of its own beyond the debounce below, and adds no state to the project database.
- **Web**: `project/activation.ts` keeps its one writer. `activate(name)` stays the only function that changes the active tab, and it now also writes the tab store and the `project.tabs` preference. The tab store is a sibling of the activation object, not a second source of the active project. `chrome/TabStrip.tsx` (new) renders the strip. `chrome/ProjectMenu.tsx` keeps its list, its Rename and Delete rows and its "Add project" entry, and moves from the top-left card to the strip's All projects button.

### The top bar

- **Top-left card** (`.unframed-chrome-left`, spec 02): the logo. On macOS the logo alone sits after the traffic lights, which keep the 92 px inset (the shell's repair, spec 01). On Windows the card holds Settings first, then the logo, because Settings is at the far left there. The project menu leaves the card on both platforms. While the rail is docked the card still becomes the rail's top row (spec 08).
- **Settings**: a 44 px grey holder with one Settings button in the reference shape below. Its place follows the window controls. On macOS it is the top-right card (`.unframed-chrome-right`, spec 01), at the far right, 8 px from the window's edge. On Windows it is the first item in the top-left card, at the far left, before the logo. The web chooses the side with the platform helper (`canvas/platform.ts`), so no shell CSS moves Settings; the shell's repair of `.unframed-chrome-right` (below the caption buttons on Windows) stays and leaves that card empty there. Settings keeps its dialog, its tooltip and its label "Settings". Its icon is the kit's settings (gear) icon, not the reference's chevron, because the reference is a shape, not a meaning. On macOS it stays reachable while the rail is docked, because the rail's top row does not cover the right edge.
- **Tab strip** (`.unframed-tabs`, new): one opaque strip in the same row as the top bar's cards, 44 px tall, centred on the same line. Its left edge is 8 px right of the left card. While the rail is docked, its left edge is 8 px right of the rail instead, because the rail covers the space under the card. Its right edge is 8 px left of the top-right card on macOS. On Windows the shell moves the caption buttons into the top-right corner, so the strip's right edge there is set by the shell's caption inset (see "The hosting contract with the desktop shell").
- **Look (interpreting the user's reference).** The user's words: the Settings button "could appear somewhat like this reference button next to a tab", with the reference showing a grey strip, a white squircle-like button holding a chevron, and a white rounded tab beside it, all inset in the strip. This spec reads "they" as covering the tabs as well as the button, so the tabs match the reference too. The reading is recorded here so the user can correct it. Concretely: the strip is a solid `--color-muted` surface with the kit's large corner radius (`--radius-3xl`) and 4 px padding, and no glass. Every tab and the Settings button is a 36 px tall rounded square (`--radius-xl`, about 40% of its height, which is the reference's squircle proportion) with 4 px gaps between them. The active tab is raised to `--color-card` with the kit border and foreground text, and inactive tabs are transparent with a `--color-accent` tint on hover. Dark mode follows the same tokens, which the theme flips with `data-unframed-theme`, so the pairing (muted strip, card tab) holds in both schemes. Text on a card tab must meet WCAG AA contrast (4.5:1) in both schemes, checked in the browser test. The strip drops glass for two reasons: the reference is opaque, and glass over the canvas is what spec 08 measured as crossing the pan budget.
- **Tabs**: each is a 36 px rounded tab with a status slot, the project name cut with an ellipsis, and a close button. The name's full text is the tooltip, which also says the status in words. The active tab has the raised look, not colour alone. The strip is a tab list (`role="tablist"`, each tab `role="tab"` with `aria-selected`), and the close button has the label "Close <project>".
- **Width.** Each tab is `tabWidth(available, count)` wide, from 120 px to 200 px. Below 120 px the strip scrolls.
- **Overflow.** The strip scrolls sideways with a trackpad or with Shift and the wheel. Edge fades show when there is more to each side. Opening or switching to a tab scrolls it into view. No chevron buttons. There is no cap on open tabs.
- **All projects.** A ghost icon button at the end of the strip, tooltip "All projects", opens the kit Menu of spec 10's project menu: one row per project, a status dot on the open ones, the active one checked, Rename and Delete on each row as spec 10 says, then "Add project" (spec 02's dialog). Choosing a row that is not open opens it in a new tab at the end and activates it. Choosing an open row activates its tab.
- **Empty strip.** With no tab open the strip shows only the All projects button and the canvas area shows the start state, an empty card, "No project is open.", with a button "Open project" that opens All projects. The window stays open. The app does not create a default project for this case; spec 02's create-on-empty-list rule still applies at boot.
- **Drag region.** The strip's empty area and its card are a window drag region, and each tab, its close button, the All projects button and the Settings button are not (`-webkit-app-region` in the page's CSS, harmless in a browser).

### Opening, closing, reordering and reopening

- **Open.** From All projects, from "Add project" (which creates the project, then opens its tab) or from Cmd+T. An already open project activates its tab. A new tab goes at the end. Opening a project fits its view to its shapes, as spec 02 says, unless the tab store has a camera for it (below).
- **Close.** The tab's close button, Cmd+W, or a middle click on the tab. Closing asks nothing: no confirmation, even with a paid run or a running turn in that project. Closing the active tab first settles its canvas (spec 02's two-second settle), then activates the neighbour from `closeTab`. Closing a background tab touches no canvas. The project and everything in it stay; closing deletes nothing and stops no work. The closed project goes onto the closed-tab stack.
- **Reorder.** Drag a tab sideways past a 4 px threshold; the others move to make room. Alt+ArrowLeft and Alt+ArrowRight move the focused tab one place. The new order is saved when the drop or key press lands.
- **Reopen.** Cmd+Shift+T pops the closed-tab stack and opens that project in a new tab, at its old place when that place still exists, and activates it. A project that no longer exists is skipped silently. The stack is in memory and empties on reload.
- **Rename.** An open project keeps its tab. Spec 10's rename closes the old name's canvas and activates the new name, so the tab takes the new name at the same place.
- **Delete.** Spec 10's delete removes the tab. If it was active, the neighbour rule of `closeTab` applies. A delete that is refused (spec 10's live-run conflict) changes nothing, tabs included.
- **Output folder change.** Spec 10 closes every open project first. Then the tab store is cleared, including the closed-tab stack, and the boot rules below run against the new folder.

### Restart and the saved tabs

- **Saved form.** The preference `project.tabs` (spec 01's preferences store) holds `{ order: string[], active: string | null }`. It is written through `preferences.set` each time the order or the active tab changes, and not on every pan or edit. It replaces `project.active`.
- **Migration.** When `project.tabs` is absent, the boot reads `project.active` and opens that one project as the only tab. The old key is then left in place and ignored.
- **Boot.** Read `project.tabs`. `restoreTabs` filters the saved order against `projects.list`. Every surviving project becomes a tab in that order. The active tab is the saved one when it survived, else the first tab. If no saved project survives, boot falls back exactly as spec 02 does: the first project, else a new `default`. A failed list still opens nothing and shows spec 02's sticky toast.
- **What boots live.** Only the active tab mounts its canvas. The other tabs start as descriptors. No room is opened for them, no chat is subscribed to, and no artifact is loaded until the person opens the tab.
- **What is not restored.** Camera, drafts, the closed-tab stack and the selection do not survive a reload. A tab's first open after a restart fits its view, as spec 02 says.

### Switching

A switch is `activate(name)`. In order:

1. The active canvas settles its pending edits to the room (spec 02's two-second settle).
2. The active canvas records its camera and its chat drafts in the tab store.
3. The active canvas is torn down: its sync socket closes with code 1000, its tldraw editor is disposed (store, history, selection, instance state), its artifact frames unmount, and its chat rail unmounts, which ends its subscriptions and moves its drafts to the tab store. Per-project client modules release what they hold for the project: run watchers, render polls, the library and the generate composer's state for that project. Shared modules that are keyed by project stay keyed, and nothing else survives.
4. The new project's canvas mounts through spec 02's existing path. The room is read, the view is restored to the tab's remembered camera when there is one, or fitted when there is not, and the rail opens on that project's chats.
5. The `project.tabs` preference is written. The write is not awaited by the switch.

Steps 3 and 4 are the same work the picker does today, so a switch costs what a picker switch costs. The rail's open state, width and the Settings dialog are global and are not torn down.

An artifact editor open on the active tab closes on a switch, because the editor belongs to the project it opened in. The strip stays visible above the editor, so switching from the editor is one click.

### What a background tab holds

- **On the client:** a descriptor per tab in the tab store, with the project name, the camera (three numbers) and the chat drafts (text and context-chip references, as spec 08 keeps them today, held in memory). Nothing else. A background tab adds no DOM node, no socket, no subscription, no timer, no listener and no animation frame.
- **Engine side:** nothing is told that a tab is in the background. The engine sees a socket close, and the rules below do the rest.
- **Strip state:** the strip reads the tab store and the activity stream. It re-renders when a tab opens, closes, moves or changes status, and not on canvas activity.

### The activity stream

- `projects.activity` (stream, spec 01's RPC group): emits the current activity of every project that has any live work or waiting request, then one message per change. A message is `{ project, running: number, needsYou: number }`, where `running` counts live runs, running chat turns (outside turns included), pending render jobs and in-flight motion renders, and `needsYou` counts pending approvals, pending questions and proposed plans waiting on the person. A project whose counts both fall to zero is sent once with zeros, so the strip can clear its dot.
- Changes are debounced 100 ms per project. The stream is one subscription per socket, shared by every tab.
- The web tracks, in memory, the last `running` it saw for each background project. When it falls from above zero to zero, the strip marks that tab finished, with a check. Activating the tab clears the mark. A reload clears all marks.

### Status on a tab

In this order of precedence:

1. **Needs you**: a dot with a ring, tooltip "Waiting for you in a chat", when `needsYou` is above zero. A chat's approval or question is the thing the agent is waiting for, so this shows on background tabs too.
2. **Running**: the live dot the chat tabs use (spec 08), tooltip "Working", when `running` is above zero.
3. **Finished, unseen**: a check, tooltip "Finished while you were away", on a background tab that finished and has not been opened since.
4. **Nothing**: no mark.

The active tab shows the same marks. Its check never appears, because the person is looking at it.

### Work in a background tab

Nothing stops because its tab is in the background, or because its tab was closed. Each piece of work keeps the rules it has today:

- **Agent turns** (spec 07) keep running in the engine. The provider session stays until the 10-minute idle close, and a turn or a waiting request holds it open. The chat's events are in the project database, and the rail reads the projection when the tab returns. Outside turns (spec 14) keep their open-turn rules.
- **Image, text and audio runs** (specs 03, 05 and 15) are in the run registry. Each lands through `apply` with origin `run:<id>`. `apply` opens the room for that one call (spec 02's "first engine-side call"), writes, and the room closes 60 seconds after its last client leaves when no engine call is in flight. The placeholder shows the run's state when its tab returns, because the run marker is in the room.
- **Video renders** (spec 04) are durable jobs; the sweep keeps running, and the file lands in the folder it started in.
- **Motion renders** (spec 09) keep running and write into the folder they started in. The in-memory render record is read again on return.
- **Preview browser tabs** (spec 09) belong to their chats and close when the chat's session closes. Nothing new closes them.
- **Canvas edits** a person makes are sent before the switch settles, as today. Nothing is pending after a switch.

### The engine's resources per project

The engine gets no new timers and no new per-project resource. This table is what each project costs in the engine while its tab is in the background, and what releases it.

| Resource (owner) | While the tab is in the background | Released |
| --- | --- | --- |
| Sync room (spec 02) | none, unless an engine call is in flight | 60 s after its last client leaves, flushed |
| Project database handle (spec 01) | stays open, one per project touched in this run | at shutdown, or `close(project)` (unchanged) |
| Chat store subscriptions (spec 07) | end with the socket that held them | when the socket closes |
| Provider session and MCP token (spec 07) | kept while a turn or a request is live | 10 minutes after the last turn and request end |
| Run registry entries (spec 03) | kept until each run lands or fails | as spec 03 says, bounded to the last 200 runs |
| Render jobs (spec 04) and motion renders (spec 09) | continue | on landing, or as spec 04 and spec 09 say |
| Preview browser tabs (spec 09) | per chat, unchanged | when the chat's session closes |
| Live selection report (spec 14) | dropped when the tab's socket closes | with the socket |

A project touched once and then left in the background keeps one database handle and nothing else. Its cost is the handle and its page cache, which the budget test measures.

### Keyboard

On Windows and Linux, `Cmd` means `Ctrl`. The set follows Figma's desktop app. The user left this choice to the author.

| Shortcut | Action |
| --- | --- |
| `Cmd+T` | new tab: opens the project list (All projects) |
| `Cmd+W` | close the active tab. The shell leaves `Cmd+W` to the page. Closing the last tab shows the start state, never closes the window |
| `Ctrl+Tab`, `Ctrl+Shift+Tab` | next and previous tab, on every platform |
| `Cmd+1` to `Cmd+8` | activate that tab |
| `Cmd+9` | activate the last tab |
| `Cmd+Shift+T` | reopen the last closed tab |
| `Alt+ArrowLeft`, `Alt+ArrowRight` | move the focused tab |

These do not fire while a text field, the prompt editor or a dialog has focus, the same rule as spec 02's shortcuts. The keyboard tests check that none of them shadows a tldraw default or a shortcut from spec 02, spec 08 or spec 09.

### Interactions

- **Agent chats.** Each project keeps its own chats. The rail shows the active project's chats and nothing from another project. Its open state and width are global. Its drafts are per chat and held in the tab store, so a switch keeps them, as they are kept today while the rail stays open. The Agent tray's draft is held per tab the same way.
- **Chat search, filter and stash** (spec 08) are per project and work on the active tab only.
- **Outside agents** (spec 14). A window is one web client's socket with an active canvas, so a background tab is not a window. Only the active tab counts. The rules of spec 14 otherwise hold: the window that changed its selection most recently counts, and a window's report is dropped when its socket closes, which is what a tab switch does. See the open decision on which tab counts.
- **Writes from outside agents and from runs** to a background project go through the room as any engine-side write does. Nothing switches the view.
- **Spec 10 settings and OpenRouter** are global and unaffected. The output folder change closes every tab, as above.
- **Toasts** (spec 02) stay global. A toast about a background project names the project in its message.

### The performance model

The budgets are measured in the hosted shape (spec 02's rule): the production build served by the engine at `127.0.0.1`, in headless Chrome on the same Mac used for spec 02's budgets. The test board for each project is 100 shapes: 30 images at 1024 px from a shared fixture file, 30 prompts, 20 marks, 5 groups, and one page and one motion. Every budget is a ratio against main measured the same way: the first build PR runs the same test on main with the picker and records the numbers in its body.

| Measure | Budget |
| --- | --- |
| Switch to another project, click to the first frame with every shape drawn | median at most 1.5 times the picker's switch on main; the first build PR records both |
| Heap after two forced garbage collections, ten tabs open against one tab open | at most 1.10 times, on real hardware (1.25 times under `CI`) |
| DOM nodes, ten tabs against one | at most 1.05 times |
| JS event listeners, ten tabs against one | at most 1.05 times |
| Page WebSockets, ten tabs | exactly 2: the RPC socket and one sync socket |
| Mounted tldraw editors, ten tabs | exactly 1 |
| Artifact iframes in the document, ten tabs | no more than the active project has |
| Heap a background tab adds | at most 4 KB each, so at most 36 KB for nine |
| Main-thread CPU over 10 s idle, nine background tabs against one tab | at most 1.05 times, plus 20 ms |
| Pan and zoom in the active tab, nine background tabs open | spec 02's pan budget (median frame gap at most 16.7 ms, at most 2 % over 33 ms) |
| Engine resident memory, ten projects opened in turn and then idle for 65 s, against one | at most 15 MB more |
| A paid run in tab A finished while tab B is active | lands in A's folder and room; A shows the result within 1 s of its tab opening |

Timing thresholds (switch time, frame gaps, CPU) run on real hardware in `pnpm test:perf` and are skipped under `CI` with an annotation, as spec 02 says. Counts and ratios that do not depend on timing run everywhere. Heap is measured with CDP `HeapProfiler.collectGarbage` before each reading.

Under no circumstances does a background tab keep a canvas, a socket or a timer alive "to make switching faster". A faster switch is a later decision that must change this table first.

### Specs this amends

Each is edited in the PR that builds the change, so the spec of the built app stays true.

- **Spec 01**: the DOM hook table gains `.unframed-tabs`, and its `.unframed-chrome-right` row changes from "holds nothing" to "holds the Settings button on macOS, and stays empty on Windows" (the name and the shell's repair are unchanged); the preference `project.active` is replaced by `project.tabs` (with its migration); the method group gains `projects.activity`; the test-only variable table gains `UNFRAMED_TEST_ROOM_IDLE_MS` (see Testing Decisions).
- **Spec 02**: "Chrome" (the top-left card holds the logo, plus Settings first on Windows; Settings moves to the top-right card on macOS; the strip is opaque), "Project activation" and "Keyboard shortcuts" change as described here; "Opening a project fits the view" gains the camera exception.
- **Spec 08**: the rail's drafts are held by the tab store; the rail's top row keeps its rule, holds the logo alone, and gains the docked strip offset.
- **Spec 10**: "The project menu" moves from the top-left card to All projects; Rename and Delete keep their rules. The Settings button moves from the top-left card to the end of the bar opposite the window controls (top-right on macOS, far left on Windows), and its dialog is unchanged.
- **Spec 14**: "Windows" and "No window" name the active canvas, and the note reads "Unframed has no canvas showing this project, so there is no selection to read.".

### The hosting contract with the desktop shell

- The new hook `.unframed-tabs` is additive. Nothing the shell already uses changes name or meaning. The top-left card keeps `.unframed-chrome-left` and its inset, and it no longer contains the project menu.
- Settings placement is the web's: the platform helper picks the side, so the shell needs no change for it. On Windows the shell's existing repair still moves `.unframed-chrome-right` below the caption buttons, and that card is empty there.
- Windows: the shell's caption buttons sit in the top-right corner over the strip's right end. The shell's injected CSS needs a right inset on `.unframed-tabs` equal to the caption buttons' width. This is a change in the private shell repo, released together with the engine.
- Windows drag: the strip's empty area is set as a drag region in the page's CSS, so the window can be moved from it without the shell's help.
- macOS: the 92 px inset on the top-left card is unchanged, and the strip starts after it.
- The keyboard set uses `Cmd+W` for closing a tab. The shell's menu must leave `Cmd+W` to the page, so a desktop menu item that closes the window does not take the shortcut first. This is a shell change, released with the engine, and is checked in the shell repo before the PR that adds the shortcut merges.
- Shipping: the engine and the shell are released together. Nothing in the build ships on an engine alone.

### Rules this spec bends

1. **Spec 02, Project activation**: the active project remains the only project with a canvas, and `activate` remains its only writer. A switch now also writes `project.tabs`.
2. **Spec 02, Opening a project fits the view**: a tab with a remembered camera restores it instead of fitting. A tab's first open after a reload still fits.
3. **Spec 14, the live selection**: a background tab is not a window. This narrows "window" to the active canvas, which is what a socket with an open canvas already was.

## Testing Decisions

A good test drives one of the three seams in 00-index and asserts what it exposes: rules, RPC answers and events, the room's shapes and files, what a person sees, and the counts the budget table names. No test reaches into the tab store's memory, the editor's internals or React state.

- **Domain seam** for the tab rules: open (including the already-open case), close with each neighbour case, move, restore against a list with gaps and an empty result, width at each count and width, status precedence, and the closed-stack limit of ten.
- **Engine seam**: `project.tabs` round-trips through the preference store and survives a restart on a new port; a store with only `project.active` migrates to one tab; `projects.activity` answers the current state first, then one message per change, debounced; a run started in project A with no client connected lands in A's folder and room; the room opened for that call closes 60 seconds later (with `UNFRAMED_TEST_ROOM_IDLE_MS` set short); `canvas_read` for a project with no active canvas answers `[]` with the note.
- **Browser seam** for the look and Settings: Settings sits at the end opposite the window controls, top-right in the macOS shape and far left in the Windows shape (the test sets the platform helper to each value), and opens the Settings dialog from there, with the rail open and closed; the strip is opaque in both schemes, its tabs and Settings are rounded and 36 px tall, and the card tab's text meets 4.5:1 contrast in light and dark, measured against the rendered colours.
- **Browser seam** for the strip and the flows: Ctrl+Tab and Ctrl+Shift+Tab cycle; Cmd+W on the last tab shows the start state and closes nothing; open from All projects, Add project and Cmd+T; open an already open project and land on its tab; close the active tab and land on the neighbour; close the last tab and see the empty card; reopen with Cmd+Shift+T; reorder by drag and by Alt+arrow; overflow scrolls and the active tab scrolls into view; each status mark appears and clears; rename and delete keep the tab right; output folder change closes all tabs and restores the ones that exist; restart restores order and active; a run started in one tab lands while another tab is active; the strip's tabs, close buttons and All projects are keyboard reachable with their names.
- **Browser seam, the budget suite** in `pnpm test:perf` (PR 4 adds spec 17 to the spec list in `CLAUDE.md`): ten projects, one tab each, opened in turn; each budget row above asserted, with the single-tab numbers taken from the same test run with one tab. The suite runs on real hardware with the timing rows enforced, and under `CI` with them skipped.

## Tasks

The build is one `/implement` run per PR, in this order. Each PR updates the specs it changes and the index. Each names its seam per task.

**PR 1: rules, preference and activity (no visible change)**

1. The domain tab rules (`domain/tabs.ts`) with their cases. Seam: domain.
2. `project.tabs` in the preference store, the migration from `project.active`, and the boot read of `restoreTabs`. Seam: engine.
3. `projects.activity` stream: current state first, one message per change, 100 ms debounce, zeros sent once. Seam: engine.
4. A run started with no client lands in its project and opens and closes its room as stated. Seam: engine.
5. Spec 01's DOM hook table and test-only variable table, `UNFRAMED_TEST_ROOM_IDLE_MS`. Seam: engine (the variable is read by the room).

**PR 2: the strip and All projects (the picker is replaced, switching still rebuilds)**

6. The tab strip: tabs from the tab store, the width rule, the status slot from the activity stream, overflow scrolling and edge fades. Seam: browser.
7. The top-left card loses the project menu; All projects holds the list, Rename, Delete and Add project, and opens projects into tabs. Settings moves to the end opposite the window controls, top-right on macOS and far left on Windows. Seam: browser.
7a. The look: the opaque strip, the rounded tabs and the Settings button in the muted and card tokens for both schemes, with the contrast check. Seam: browser.
8. Open, close, activate and the neighbour rule, the close button and the middle click, the empty strip and the empty card. Seam: browser.
9. The keyboard set and its shadowing check. Seam: browser.
10. The strip's drag region and its controls' reachability. Seam: browser.

**PR 3: the lifecycle (switching tears down, background tabs live on descriptors)**

11. Switch teardown and mount per "Switching": the socket, the editor, frames, the rail and per-project client modules, with the camera and drafts kept in the tab store. Seam: browser.
12. Background status: needs you, running, finished-unseen and their precedence on tabs, and the check clearing on activation. Seam: browser.
13. Background work lands and shows on return: an agent turn, a paid image run and a motion render started in one tab. Seam: browser, with the scripted agent and the stub upstream.
14. Restart restores the order and the active tab; only the active tab loads at boot. Seam: browser.
15. Reorder by drag and Alt+arrow, saved to `project.tabs`. Seam: browser.
16. Reopen with Cmd+Shift+T from the closed-tab stack. Seam: browser.
17. Rename, delete and the output folder change keep the strip right. Seam: browser.
18. Outside agents: `canvas_read` and `canvas_select` for a background project answer as spec 14 now says, and writes still apply. Seam: engine, and browser for the strip's outside-turn dot.

**PR 4: the budgets and the screenshots**

19. The budget suite in `pnpm test:perf`: the single-tab baseline on main, then ten tabs, every row of the budget table. Seam: browser (hosted shape).
20. The switch timing and the idle CPU check, enforced on real hardware and skipped under `CI` with an annotation. Seam: browser.
21. The spec amendments listed under "Specs this amends", the index row and the vocabulary, and the screenshots in the PR bodies, one set per platform: the strip with ten tabs, the overflow, the All projects menu, a background tab with each status, and the Settings placement on macOS and Windows.

## Out of Scope

- Tear-off tabs and tabs in a second window. One window, as today.
- Thumbnails of background tabs. A thumbnail costs a capture on every switch away and a kept image per tab. The tab shows its name and its status.
- Warm canvases: keeping the last-used editor mounted, or any cache of editors. The budget table forbids it.
- Tab groups, pinned tabs, and tab search. All projects is the search.
- Undo that spans tabs. Each tab's undo stays this tab's, as spec 02 says.
- Moving shapes or groups between projects by dragging between tabs.
- Closing database handles for idle projects. The engine keeps them, and the budget measures them. A later spec may change this if the measure says so.
- Any change to the engine's room idle time beyond the test variable.
- Remote, LAN or tunnel access, which spec 01 leaves unbuilt.

## Decisions

There are no open decisions. The user answered the seven questions raised by this spec; each answer is applied in the sections above.

1. **One tab per project.** Opening an already-open project jumps to its tab. (Applied under "Opening, closing, reordering and reopening" and "The top bar".)
2. **No cap on open tabs.** The strip scrolls. (Applied under "Overflow".)
3. **A background tab keeps its camera position and its unsent chat drafts.** (Applied under "What a background tab holds".)
4. **Closing a tab asks nothing,** even with a paid run or a running turn. (Applied under "Close".)
5. **Only the active tab counts for outside agents.** (Applied under "Interactions" and spec 14's amendment.)
6. **Keyboard set, taken from Figma's desktop app** (the user left this to the author): `Cmd+T` opens the project list, `Cmd+W` closes the tab and leaves `Cmd+W` to the page, closing the last tab shows the start state and never closes the window, `Ctrl+Tab` and `Ctrl+Shift+Tab` cycle, `Cmd+1` to `Cmd+8` jump to that tab, `Cmd+9` to the last, and `Cmd+Shift+T` reopens the last closed tab. (Applied under "Keyboard".)
7. **Engine and shell are released together.** Settings sits at the end of the bar opposite the window controls: far right on macOS, where the traffic lights are on the left, and far left on Windows, where the caption buttons are on the right. (Applied under "The top bar" and "The hosting contract with the desktop shell".)

## Further Notes

- **Build after the open PRs.** Spec 14's open PRs and the chat-tab overflow fix both touch the rail. PR 2 onward builds on main after they merge.
- **Measure before changing.** PR 4's baseline runs on main. The switch budget and the memory ratios are relative to it, so the numbers come from this Mac and this build, not from this spec.
- **Vocabulary.** The index gains "Project tab", "Active tab" and "Background tab", defined above, and the vocabulary's "Chat" entry keeps its own tabs.
- **Why the chat tabs' live dot.** Spec 08 gives chat tabs a live dot for a running or waiting chat. Project tabs use that same dot, so the two read as one system, and add one mark, the check, for work that finished unseen.
- **The user's reference.** The reading of "they" in "Look" is the spec's own. If the user meant only the Settings button, the tabs keep the glass strip of the earlier draft and the strip's look is the one change to revert.
- **The rail offset.** While the rail is docked, the strip starts after it. The space above the rail's top row, between the top-left card and the rail's right edge, stays empty. This is the cost of not overlapping the rail's header.
