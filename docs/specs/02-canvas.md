# 02 · Canvas

Depends on: 00-index, 01-engine-foundation

## Problem Statement

Unframed needs a canvas that holds a project's material: text, images, clips, drawings, named groups and the empty pages and motions the agent will later fill. The old canvas was a node graph with wires and output nodes. It had to reinvent every drawing interaction, it had no drawing tools, and it kept a hand-written sync and undo layer between the browser and the engine. People want a whiteboard that behaves like a whiteboard (draw, arrow, note, crop, zoom), where the things Unframed cares about (a prompt with an `@id`, a picture that names a file on disk, a group whose name is its `@id`) sit alongside ordinary marks and follow the same gestures.

The canvas also has to keep every rule the old one earned the hard way: media never lives inside the document, a new `@id` never captures a reference someone already wrote, a failed project list never invents a project, dragging one shape never re-renders the whole board, and a reload, a second tab and the engine all agree on what is on the board.

## Solution

Each project gets one tldraw canvas, kept by the engine in a tldraw sync room that is persisted in the project database (spec 01's `unframed.sqlite`) and served on the app's own origin behind the loopback checks. Every tab of that project is a sync client of the room, so reloads, tabs and engine restarts agree. Undo in a tab walks only that tab's own edits (tldraw's local history). The engine can also change the room directly; those changes reach every tab as remote changes and never enter any tab's undo stack, which is what spec 07 uses to apply and revert agent turns.

tldraw's own tools stay on: select, hand, draw, geo, arrow, line, highlight, note, eraser, laser, frame, text and zoom. Embeds and bookmarks are off. The Unframed shape kinds are built by extending tldraw's own shapes and tools rather than replacing them:

- tldraw's text shape is the **prompt**: it hugs its text, carries an `@id`, offers an `@` mention menu and shows a hint ("Add text…") when empty.
- tldraw's image and video shapes are **image** and **video**: they name a file in the project folder through an asset store adapter over project files. tldraw's image crop stays.
- tldraw's frame is the **group**: dashed, labelled with its name, and its name is its `@id`. `Cmd-G` makes one around the selection. tldraw's own unnamed group is off.
- **page** and **motion** are custom shapes. This spec gives them their empty rendering, file and title; spec 09 fills them.

Around the canvas sit Unframed's chrome (logo, project menu and Settings, the bottom bar with Agent, Library and Add, the add menu), a context menu with Unframed sections, the dot grid, the zoom-dependent labels, toasts, and the project activation rules.

## User Stories

1. As a person, I want each project to open its own canvas, so that material from one project never appears in another.
2. As a person, I want everything I put on the canvas to be saved without pressing anything, so that closing the tab loses nothing.
3. As a person, I want a reload to show exactly the board I left, so that I can trust the canvas.
4. As a person, I want two tabs of the same project to show the same board and each other's edits within a second, so that I can work in two windows.
5. As a person, I want edits I make while the engine is briefly unreachable to be kept and sent when it comes back, so that a restart does not throw away my work.
6. As a person, I want the canvas to reconnect by itself after the engine restarts, so that I do not have to reload.
7. As a person, I want a sticky notice while the connection is lost, so that I know my edits are not reaching the engine yet.
8. As a person, I want `Cmd-Z` to undo only what I did in this tab, so that undo never takes back an agent's work or another tab's edit.
9. As a person, I want `Cmd-Shift-Z` and `Cmd-Y` to redo, so that I can step forward again.
10. As the agent runtime (spec 07), I want to write to the canvas from the engine and have every tab see the change, so that agent turns land on the board.
11. As the agent runtime, I want engine-side changes to stay out of every tab's undo stack and to come with their inverse, so that a turn can be reverted on its own terms.
12. As the agent runtime, I want to know which shapes were edited by a person since a given change, so that a revert can skip them and say so.
13. As a person, I want tldraw's drawing tools (draw, geo, arrow, line, highlight, note, eraser, laser), so that I can sketch on the board.
14. As a person, I want tldraw's hand and zoom tools and its selection behaviours (shift-click, brush select, rotate, align, reorder), so that the canvas moves like the tools I know.
15. As a person, I want the text tool to make a prompt, so that writing text on the board is writing a prompt.
16. As a person, I want double-clicking empty canvas to start a new prompt at that spot, ready to type, so that the most common shape is one gesture away.
17. As a person, I want every prompt to show its `@id` above its top-left corner, so that I know what to type to reference it.
18. As a person, I want a new prompt's `@id` never to be one that some prompt already mentions, so that a new shape never silently becomes the target of an old reference.
19. As a person, I want a prompt to hug its text up to 320 px wide and then grow downwards, so that the box is never bigger than what it says.
20. As a person, I want a prompt I resize by dragging to keep that size, so that my layout holds.
21. As a person, I want double-clicking a prompt's resize edge to make it hug its text again, so that I can undo a manual size.
22. As a person, I want one click on a prompt to select it and a double-click or `Enter` to start editing, so that I can move text without placing a caret.
23. As a person, I want `Escape` to leave editing and keep the prompt selected, so that `Enter` edits it again.
24. As a person, I want typing `@` in a prompt to open a menu of shapes I can reference, with a preview of each, so that I can pick one without remembering ids.
25. As a person, I want to move through that menu with the arrow keys and insert with `Enter` or `Tab`, so that I never leave the keyboard.
26. As a person, I want an empty prompt to say "Add text…", so that I know it is a place to write.
27. As a person, I want to add an empty image and pick, drop or paste a file into it, so that I can place a reference before I have it.
28. As a person, I want an image to show nothing but the picture once it holds one, so that the picture is the element.
29. As a person, I want an image to keep its aspect ratio when I resize it, so that the picture is never stretched or letterboxed.
30. As a person, I want tldraw's image crop, so that I can frame the part of a picture that matters.
31. As a person, I want to add a video by file up to 25 MB, so that I can use a clip as a reference.
32. As a person, I want to be told plainly when a clip is over 25 MB, so that I know why it was refused.
33. As a person, I want to paste an https link to a video instead of a file, so that I can reference a clip I do not have locally.
34. As a person, I want play, pause and a position slider under a clip, outside it, so that scrubbing never drags the shape.
35. As a person, I want a remove control on a selected filled image or video, so that I can empty it without deleting the shape.
36. As a person, I want every uploaded file saved in the project folder with a sidecar, so that the folder is a complete record.
37. As a person, I want the document never to carry picture bytes, so that the canvas stays small and fast.
38. As a person, I want to drop image, video and `.html` files onto the canvas, so that they appear where I dropped them.
39. As a person, I want dropping a file onto an image or video shape to replace its media, so that I can swap a reference in place.
40. As a person, I want to paste a screenshot, so that it becomes an image at the pointer.
41. As a person, I want pasting a picture while images are selected to replace their media, so that "select the empty one, paste" just works.
42. As a person, I want pasting text onto the canvas to make a prompt, so that I can bring in prose from anywhere.
43. As a person, I want to copy, cut and paste shapes, including across projects, so that I can reuse work.
44. As a person, I want pasted prompts that reference each other to keep referencing each other and not the originals, so that a pasted cluster works on its own.
45. As a person, I want a pasted page or motion to get its own copy of its file, so that editing the copy does not change the original.
46. As a person, I want copying exactly one image to also put that picture on the system clipboard, so that I can paste it into another app.
47. As a person, I want `Cmd-G` to wrap the selection in a named group, so that I can keep a set together.
48. As a person, I want the frame tool to draw an empty group, so that I can build one by dropping things in.
49. As a person, I want a group to show its `@id` as its label, so that I know how to reference it.
50. As a person, I want `Cmd-Shift-G` to ungroup and leave the contents exactly where they were, so that ungrouping never moves anything.
51. As a person, I want deleting a group to delete its contents in one undo step, so that nothing is scattered.
52. As a person, I want to drag shapes into and out of a group, so that membership follows what I see.
53. As a person, I want an empty page or motion on the canvas, so that the agent has somewhere to write (spec 09).
54. As a person, I want a right-click menu that offers only what would do something, so that it never shows greyed-out noise.
55. As a person, I want "Reveal in Finder" (or the Windows or Linux equivalent) on files, so that I can find a picture on disk.
56. As a person, I want "Copy as image" on an image, so that I can paste the picture elsewhere.
57. As a person, I want "Copy @id" on a prompt or group, so that I can paste the reference into another prompt.
58. As a person, I want an "Add to library" entry on a selection, so that I can save it (spec 06).
59. As a person, I want the logo and project menu in the top-left corner, so that I can switch or add projects.
60. As a person, I want Settings beside the project menu and Agent in the bottom bar, so that the top-right corner stays clear.
61. As a person, I want tldraw's toolbar at the bottom, so that every tool is one click away.
62. As a person, I want an add menu with Inputs and Artifacts sections, so that I can add any Unframed shape without knowing a shortcut.
63. As a person, I want single-key shortcuts for adding an image, video, page or motion, so that I do not need the menu.
64. As a person, I want labels to hide when the board is zoomed too far out to read them, so that a zoomed-out board is not covered in specks.
65. As a person, I want a dot grid that stays visible and calm at every zoom, so that I can judge distance.
66. As a person, I want a clear selection rectangle with square corner grips, so that I can see what is selected and where to resize.
67. As a person, I want a new project to start with a small example that shows an `@id` reference, so that I learn the idea in the first minute.
68. As a person, I want light and dark themes that follow my system, so that the app matches my desktop.
69. As a person, I want the tldraw watermark left alone, so that the licence terms are met.
70. As a person, I want failures (upload, paste, copy, reveal, opening a project) reported as toasts, so that nothing fails silently.
71. As a person, I want the app to reopen the project I was last in, so that a reload does not drop me somewhere else.
72. As a person, I want a failed project list to show a notice instead of inventing a project, so that nothing is ever written into a folder I did not choose.
73. As a person, I want dragging one shape on a board of hundreds to stay smooth, so that big boards stay usable.
74. As a person, I want to create a project from the project menu with a name, so that I can start fresh.
75. As a developer, I want `?fps=1` to show a per-gesture frame meter, so that I can measure a drag on a real board.
76. As the desktop shell, I want the chrome cards to carry the DOM hooks spec 01 defines, so that the shell can style them.
77. As a person, I want a board of large photos to zoom smoothly, so that high-resolution references never make the canvas heavy.
78. As a person, I want every model request to use my original pixels, so that previews made for the screen never cost me quality in a generation.

## Implementation Decisions

### Modules

Web:

- **Canvas host.** Mounts tldraw for the active project with the Unframed shape utils, tools, UI overrides, component overrides and the asset store. Interface: `open(project)` and `close()`. It owns the sync client, the connection monitor and the camera limits. Deep: callers never see tldraw's configuration.
- **Shape kinds.** One shape util per Unframed kind: prompt (extends tldraw's text), image and video (extend tldraw's image and video), group (extends tldraw's frame), page and motion (custom). Each exposes only what tldraw asks of a shape util. Their prop and meta schemas live in the contracts package so the engine's room validates the same schema.
- **Asset store adapter.** Implements tldraw's asset store (`upload`, `resolve`) over project files. Upload sends bytes to the engine's upload route and returns the file marker. Resolve turns a `project-file:` marker into the file URL of the active project and passes an `https://` clip link through. It is also the validator for asset URLs: it accepts exactly the three schemes of the asset marker table and nothing else, in place of tldraw's default URL check, which would refuse `project-file:` and `preset-file:`.
- **External content handler.** The single place paste and drop are decided: shapes, files, system images and videos, text, links. It replaces tldraw's default external content handlers for files, text and URLs.
- **Context menu.** Builds the Unframed sections from the right-clicked shape and the selection, then appends tldraw's own context menu groups minus the items this spec replaces.
- **Chrome.** The corner cards, the add menu, the library button slot, the zoom-dependent label level, the dot grid, the selection foreground and the toasts. Later specs register content into named slots (agent button, settings button, library button, add-to-library item, artifact empty state). It carries spec 01's DOM hooks by their exact names (see Chrome below).
- **Project activation.** Holds the active project and is the only writer of it. Interface: `activate(name)`, `activeProject()`, `initialLoad()`.
- **Connection monitor.** Watches both engine sockets, the RPC socket (spec 01) and the sync socket, and drives the connection-lost notice. It is the only place that notice is defined.

Engine:

- **Canvas rooms.** One tldraw sync room per project, opened on demand, persisted in the project database, closed after idle. Interface: `connect(project, socket, sessionId)`, `read(project)` returning every record, `apply(project, change, origin)` returning `{ clock, inverse }`, `changedSince(project, recordIds, clock)` returning the ids changed by a client session after that clock, and `close(project)`. A room registers `close` with spec 01's open-project registry when it opens, which is how spec 10's rename, delete and folder change reach it. `apply` is the seam specs 03 to 05 and 09 write run placeholders through and spec 07 builds agent writes and reverts on; spec 11 builds an imported project's first canvas through the room's storage before the room opens.
- **Media store.** Saves uploaded bytes as a project file plus sidecar, copies a file within or across projects, and rewrites any data URL that reaches the room into a file.
- **Starter seeding.** When a project's room is created with no stored canvas, writes the starter content through `apply` with origin `system`.

Domain (pure, no I/O):

- **Refs.** `slug`, `nextRef(records)`, `readRef(shape)`, `rewriteTokensOnPaste(texts, idMap)`, and the token pattern (`@` followed by `[\w-]+`).
- **Mentions.** `mentionQuery(textBeforeCaret)` and `mentionCandidates(shapes, selfRef, query)`.
- **Media naming.** File name and extension rules, sidecar shape, video link detection.
- **Grouping geometry.** `wrapBox(memberBounds)` and the allowed-member rule.
- **Chrome levels.** `labelLevel(zoom)` and `gridGap(zoom)`.
- **Menu rules.** Which context menu sections and items apply to a given right-click target and selection, and the per-OS reveal label.

### Shape schema

Unframed data lives in tldraw's own fields where tldraw has one, and in `meta` otherwise. tldraw's shape id (`shape:…`) is internal and never shown to anyone.

| Kind | tldraw type | Unframed fields |
| --- | --- | --- |
| prompt | `text` | `meta.ref: string`, `meta.sized: boolean` (default false) |
| image | `image` | `meta.ref: string`; `props.assetId` null when empty |
| video | `video` | `meta.ref: string`; `props.assetId` null when empty |
| group | `frame` | `props.name` IS the ref. No `meta.ref`, because a second string would drift from the name |
| page | `page` (custom) | `meta.ref: string`; `props: { w, h, file: string, title: string, fileName: string, dials?: Record<string, unknown> }`. `file` is `''` when empty, `fileName` is the original name of a dropped or uploaded file (`''` otherwise), `dials` is absent until spec 09 stores tuned values |
| motion | `motion` (custom) | same as page |
| mark | any other tldraw shape | none |

Later specs add Unframed fields under `meta.unframed` and nowhere else in `meta`: `result` (spec 03's result meta), `run` and `runError` (spec 03's run marker and run error), `recipe` on a group (spec 06's standing recipe).

Media assets:

```
asset (tldraw image or video asset)
  props.src:  "project-file:<file name>"             a file in this project's folder
              | "https://…"                          a linked clip (video only)
              | "preset-file:<project>/<file name>"  only inside a saved preset (spec 06), never in a room
  props.name: the original file name, shown in labels and alt text
  props.w, props.h: natural size
```

This is the one definition of the asset markers. `preset-file:` is the portable pointer a preset stores: it names the project the file was saved from, because a preset outlives the canvas it came from. An empty `<project>` (`preset-file:/<file name>`) means "a file of that name in whichever project the preset is inserted into", the form spec 11 gives old presets. Spec 06's insert resolves every `preset-file:` pointer to a `project-file:` marker before the shapes reach the room; the room refuses an asset whose `src` uses any other scheme. tldraw's default external asset URL validation would reject both custom schemes, so the asset store adapter (below) is what validates and resolves them, and tldraw is configured to hand every asset URL to it.

No shape and no asset may carry a `data:` URL or a `blob:` URL once it reaches the room. The file name inside a marker is a bare basename; it never contains `/`, `\` or `..`. Because `project-file:` names no project, copying a project folder copies a working canvas.

Custom shape props and every later change to them use tldraw's shape migrations, defined once in the contracts package and used by both the room and the web.

### Refs (`@id`)

- Every prompt, image, video, page and motion has a `meta.ref`; every group has a `props.name`. Refs are unique across the canvas. Only prompts and groups are referenceable by `@` (spec 05 adds text results, which are prompts).
- **A new ref is numeric.** `nextRef` returns the decimal string of one more than the largest number among: every numeric ref on the canvas, every numeric `@` token in any prompt's text, and 99. So the first ref on an empty canvas is `100`. Counting the tokens is what stops a new shape from capturing a reference to a shape that was deleted. A named group (spec 06) is not numeric and does not affect the counter.
- The ref is read from the live store at mint time, which includes every other tab's synced shapes.
- **Collision repair.** Two tabs can mint the same number while one is offline. When a change lands in the room that gives a shape a ref already held by a different shape, the room keeps the shape that held it first and gives the later one `nextRef`, as an `apply` with origin `system`. Prompt texts are not rewritten.
- `slug(s)` is spec 01's slug rule, the one definition (this spec re-exports it from domain). Used for project names, file names, and (spec 06) group names.
- Unknown tokens are left exactly as typed; resolution is spec 03's concern.

### The sync room

- **Endpoint.** A WebSocket at `/sync/<project>?sessionId=<id>` on the app origin. The upgrade applies contract 1 in full: a non-loopback `Host` is refused, a present non-loopback `Origin` is refused, both before tldraw sees the socket. An unknown project closes the socket with reason `unknown project`.
- **One room per project.** Opened on the first connection or the first engine-side call, and kept while any client is connected. It closes 60 seconds after its last client leaves when no engine-side call is in flight. Closing flushes storage.
- **Persistence.** The room uses tldraw's SQLite sync storage over `node:sqlite`, in the project database (spec 01's `unframed.sqlite`, opened only through spec 01's project database module; this spec adds the sync storage tables and `canvas_changes` to it). A change is written to the database before the room acknowledges it to the client that sent it. An engine killed with `SIGKILL` right after an acknowledgement still has that change after restart.
- **Schema.** The room validates records against the same schema the web uses (tldraw defaults minus embed and bookmark, plus the Unframed shapes). A record that fails validation is refused by tldraw's normal mechanism.
- **Change log.** Every change the room commits is also appended, in the same transaction, to the `canvas_changes` table: `{ clock, origin: { kind: "session" | "server" | "system", id }, at, put: string[], removed: string[] }`. This is the one canvas change log; spec 07 reads it and adds none of its own. `session` is a client's sessionId. `server` is an `apply` call's origin id, which says who asked: `run:<runId>` for a run's placeholders and fills (specs 03 to 05 and 09), `chat:<chatId>` for an agent tool call and `revert:<chatId>:<turn>` for a turn's revert (spec 07). `system` is starter seeding, collision repair and media rewriting. `changedSince` reads it. It is never truncated.
- **Engine-side writes.** `apply(project, change, origin)` uses the room's server-side store update, so every connected tab receives the change as a remote change. It returns the room clock after the change and the inverse change (records to put back and records to remove) so a caller can revert it later. Remote changes never enter a tab's tldraw history, so they are never undone by `Cmd-Z`.
- **Data URL rewriting.** When a committed change contains an asset whose `src` is a `data:` URL, or an image or video shape whose `url` prop is one, the engine decodes it, saves it through the media store with source `upload`, and replaces it with a file marker through `apply` with origin `system`. A `blob:` URL is not recoverable; the engine removes that asset's src (the shape shows its empty state). Both happen within 2 seconds of the change.
- **Pages.** tldraw's multi-page support is off. A canvas has exactly one tldraw page, and the page menu is hidden.

### Undo

- Undo and redo use tldraw's local history, so `Cmd-Z` walks only the edits this tab made. Another tab's edits and every engine-side change are remote changes and are not in this tab's history.
- When a local undo touches a shape a remote change has since modified, tldraw's own rule applies (the undo re-applies this tab's earlier values for the fields it changed). This spec adds nothing on top.
- Inside a prompt being edited, `Cmd-Z` is the text editor's own undo.
- History does not survive a reload. Agent turns keep their own revert (spec 07).

### Reconnection

- The sync client reconnects on its own. Attempts follow exponential backoff starting at 1 second, doubling, capped at 10 seconds. After a successful connection the delay resets to 1 second.
- Edits made while disconnected stay on screen and are sent on reconnect.
- **Connection-lost notice.** This is the only notice any spec shows for a lost engine connection. When the RPC socket or the sync socket has been down for 2 seconds, a sticky toast says "Lost the connection to the local server. Reconnecting…". It closes by itself once both sockets are connected again. A drop shorter than 2 seconds shows nothing.

### Project activation

- The active project lives in two places only: React state and the `project.active` preference (spec 01's preferences store; not `localStorage`, which the packaged app loses on every launch). `activate(name)` is the only function that writes either. Every request the web makes names the project explicitly from that state.
- **Initial load.** Wait for the RPC socket (while it is down, the connection-lost notice above is what the person sees; there is no second notice for an unreachable engine). Then read `project.active` and list projects (spec 01). A list that fails with the socket connected is retried once after 1 second; if that fails too, show the sticky toast "Could not list your projects: <message>. Reload to try again." and open nothing. Never fall back to a default project on a failed list.
- On success: if the remembered name is in the list, open it; else open the first project; if the list is empty, create a project named `default` and open it.
- If the person switches project while the initial load is still in flight, the load does not override the switch.
- Switching project waits up to 2 seconds for the current room to acknowledge pending changes, then closes the socket, then activates and connects to the new room.
- A failure to open shows the toast "Could not open “<name>”: <message>".

### Prompt behaviour

- **Look.** Bare text on the canvas: no fill, no border, no shadow. Default style: tldraw's sans font, size `s`, left aligned; tldraw's style panel may change these.
- **Label.** `@<ref>` sits above the top-left corner in a 22 px band: the kit's `text-2xs` (11 px), in the case it is written (kind words in sentence case: Image, Video, Page, Motion), the muted foreground, no dot, never ellipsised. It is part of the shape and scales with the canvas.
- **Hug.** While `meta.sized` is false the prompt is measured from its own text on creation and on every change to the text: it grows sideways until its content is 320 canvas px wide, then wraps and grows downward. An empty prompt is measured from its hint so the hint is fully readable. Measurement is in canvas units, independent of zoom, and widths round up so the last word never wraps into a line the box has no room for. Minimum box 40 × 28.
- **Pin.** The first pointer move of a resize drag (at least 2 px) sets `meta.sized` to true. From then the box keeps whatever size it is dragged to, and text wraps inside it. A press with no movement does not pin.
- **Re-hug.** Double-clicking a prompt's resize edge sets `meta.sized` to false and refits immediately.
- **Editing.** tldraw's two-step editing: one click selects (and a drag moves), double-click or `Enter` starts editing with all text selected, `Escape` leaves editing and keeps the prompt selected. A prompt that is not being edited never takes a caret.
- **Empty hint.** "Add text…", shown whenever the text is empty. Unlike tldraw's plain text, an empty prompt is not deleted when editing ends.
- **Text.** Stored as tldraw rich text. The plain-text rendering (paragraphs joined by `\n`) is the prompt's text for every other purpose: `@` tokens, composition, the agent.
- **Mention menu.** While editing, when the text before the caret ends in `@` followed by zero or more `[\w-]` characters, a menu opens below the prompt listing every referenceable shape other than this prompt whose ref starts with the typed characters, compared case-insensitively. Each row shows `@<ref>` in the accent text colour and a preview: the shape's text with whitespace runs collapsed to one space, first 24 characters, secondary colour, ellipsised (a group has no preview). `↓` and `↑` move the highlight and wrap around; `Enter` or `Tab` inserts; a mouse press on a row inserts; `Escape` closes the menu (a second `Escape` leaves editing). Inserting replaces the typed `@query` with `@<ref> ` (trailing space) and puts the caret after it. The menu is 168 px tall at most and scrolls; rows are 12 px text; the highlighted and hovered row get the hover overlay colour; the surface is the popover colour at 88 % with the chrome blur.
- `Enter` never inserts a newline while the menu is open.

### Media behaviour

- **Empty state.** An image or video with no asset keeps a card frame (spec 12: `--card` fill, the kit border, 10 px radius) with its kind label above it ("IMAGE" or "VIDEO", same type as the prompt label) and asks for a file: a "Choose file" button (the kit's small outline Button) that opens the OS picker (`image/*` or `video/*`). A video's empty state also has a text field (the kit's small Input) with placeholder "or paste an https:// link" and, once the field holds text matching `https://` followed by anything, a "Use link" button. Default empty size: image 240 × 140, video 240 × 180.
- **Bare once filled.** A filled image or video is the picture or clip only: no frame, no fill, no border, square corners.
- **Size on fill.** Width is kept (240 for a new shape) and height follows the asset's aspect ratio. Replacing the media keeps the width and takes the new aspect.
- **Resize.** Aspect-locked from every edge and corner. Width 140 to 900, height at least 100.
- **Crop.** tldraw's image crop is kept unchanged. Video has no crop.
- **Video cap.** A video file over 25 MB (26,214,400 bytes) is refused with "Video is too large. Keep it under 25MB." shown under the empty state, or as an error toast when it arrived by drop or paste.
- **Link.** "Use link" with a value not matching `^https://.+` shows "Paste a full https:// link to a video file.". A valid link creates a video asset with `src` set to the URL and `name` set to the last path segment without its query string, or "linked video" if that is empty.
- **Player.** A filled video shows no native controls and is muted with metadata preloaded. Directly below the clip, outside its bounds, a transport row in the kit's extra-small muted text: a Play or Pause kit ghost icon Button (labels "Play" and "Pause"), a position slider (the native range input in the highlight colour, since the kit has no slider) (label "Position", no value bubble, step 0.01 s) and a readout `m:ss / m:ss` in tabular numerals. The row is a control: a press on it never starts a shape drag or a selection. A press on the clip itself drags the shape like a picture.
- **Remove.** A selected filled image or video shows a 20 × 20 button at its top-right corner, inset 4 px: the kit's outline Button at `icon-micro` size, close icon, label "Remove <file name>". It appears on selection and keyboard focus, not on hover. Clicking it clears the asset (the shape returns to its empty state at the same width); the file stays on disk.
- **No tooltips** on media: hovering a picture or clip shows nothing.
- **Images are stored as uploaded, and shown from previews.** tldraw's image downscaling and re-encoding on import are off, so the project file keeps its original pixels, and every request to a model sends the original. Image uploads are accepted up to 500 MB. Display is a different matter: decoding a 6000-pixel photo to show it 200 pixels wide costs memory and main-thread time on every zoom. So at upload (and on first display of an image that has none) the web makes display previews off the main thread (a worker, `createImageBitmap` plus `OffscreenCanvas`): WebP at longest side 512 and 2048, never larger than the original, written into the project folder's regenerable cache `.cache/previews/` through the upload route. The asset resolver picks the smallest variant that covers the shape's on-screen size times the device pixel ratio (tldraw passes both to it), and the original only above 2048. Previews get no sidecars and are never sent to a model. A missing or broken preview falls back to the original. Previews use the same two routes as their originals with a `preview` query parameter of `512` or `2048`: `POST /api/projects/<project>/files?name=<file>&preview=512` stores the WebP bytes as `.cache/previews/<file>-512.webp` (the file must exist), and `GET /api/file/<project>/<file>?preview=512` serves it, or answers 404 when there is none.
- **Drop onto a shape.** Dropping an image file onto an image shape, or a video file onto a video shape, replaces its media. Any other drop onto a shape is treated as a canvas drop.

### Upload and copy of media files

- **Upload route (HTTP).** `POST /api/projects/<project>/files?name=<original file name>` with the raw bytes as the body and the file's type as `Content-Type`. Body limit 500 MB. Returns `{ file, fileName, bytes, mime }`. Errors: empty body 400 `{ error: "No file bytes in the request body." }`; over the limit 413; a save failure 500 `{ error: "Could not save the file: <message>" }`. This is a file-serving route and stays plain HTTP for the same reason spec 01's file route does: it carries raw bytes. Loopback checks apply. The file is served back by spec 01's project file route.
- **File name.** `<epoch ms>-<slug(original name without extension) or "upload">[-<n>].<ext>`. `n` starts at 1 and increments while the name exists. Extension by type: `image/png` png, `image/jpeg` jpg, `image/webp` webp, `image/gif` gif, `image/avif` avif, `video/mp4` mp4, `video/quicktime` mov, `video/webm` webm, `text/html` html. Otherwise the original name's extension if it is 1 to 5 letters or digits (lowercased), else `bin`.
- **Sidecar.** Same base name with `.json`: `{ "source": "upload" | "copy", "fileName": "<original name>", "mime": "<type>", "bytes": <n>, "at": "<ISO time>", "of": "<source file>" }`, where `of` is present only for a copy. Pretty-printed with two-space indent.
- **Copy (RPC).** `files.copy { project, file, from? }` returns `{ file }`. `file` must be a bare basename in the source project (`from`, default `project`), else "That is not a file in this project.". Missing file: not found, message "Could not copy the file: <message>". The copy's `fileName` is the source name with its leading `<digits>-` removed; its `mime` comes from the source sidecar, else `application/octet-stream`; its sidecar has `source: "copy"` and `of: <source file>`.
- **Reveal.** The context menu's reveal item calls spec 01's `files.reveal { project, fileNames }`, which this spec does not redefine. Its failure message goes to the toast.
- **Path (RPC).** `files.path { project, fileName }` returns `{ path }`, the file's absolute path, built by the engine so it has the platform's separators. The name is reduced to its basename. A project with no folder: not found, "No files for this project yet."; a file not on disk: not found, "No file <fileName> in this project.". The context menu's Copy path item puts the answer on the clipboard as text.

### Clipboard

- **Copy and cut** use tldraw's own clipboard format and behaviour, with the selection (or, from the context menu, the right-clicked shape when nothing is selected). When exactly one filled image is among the copied shapes, the same clipboard item also carries that picture as `image/png` (re-encoded from the file), written inside the user gesture.
- **Paste of shapes.** tldraw's paste, then Unframed's fix-ups before the shapes are committed:
  - every pasted Unframed shape gets a fresh ref from `nextRef`, minted in order;
  - `@` tokens in pasted prompts that name another pasted shape are rewritten to that shape's new ref, whole tokens only (`@100` becomes `@120`, `@1000` is untouched when only `100` was pasted);
  - a pasted page or motion always gets its own copy of its file via `files.copy`;
  - when the shapes came from another project, every file-backed shape and asset is copied into this project via `files.copy` with `from`;
  - a failed copy pastes the shape empty and shows the toast "Could not copy the <kind>'s file: <message>".
  Placement follows tldraw's paste rules.
- **System image or video paste** (no tldraw content on the clipboard): the file is uploaded; a pasted file with no name is named `pasted-<kind>.<ext>` from its type (`jpeg` becomes `jpg`, `png` when unknown). If shapes of the same kind are selected, every one of them gets the new media; otherwise a new shape appears at the pointer. A video over 25 MB shows the cap message as a toast. Upload failure: "Could not paste <name>: <message>".
- **Text paste**: trimmed text that is not empty becomes a new prompt at the pointer, unless it is a video link (below).
- **Link paste**: text that is a single `https://` URL whose path ends in `.mp4`, `.mov`, `.webm` or `.m4v` (case-insensitive, query ignored) becomes a video with that link, or fills the selected videos. Any other URL is text and becomes a prompt. Embeds and bookmarks never appear.
- While a prompt is being edited, paste goes into its text and none of the above runs.

### Drop

- Files dropped onto empty canvas: `image/*` becomes an image; `video/*` up to 25 MB becomes a video; `text/html` or a name ending `.html` or `.htm` becomes a page with `file` set, `fileName` set to the original name and `title` set to the name without the extension (spec 09 adds dropping onto an existing page or motion). Other files are ignored.
- Several files are placed at the drop point, each offset by 24 px right and down from the previous one.
- Bytes are uploaded first; the shape appears when the upload answers, at the point captured at drop time. Failure: "Could not add <name>: <message>".

### Group behaviour (this spec's part)

- **Look.** Dashed border 1.5 px in the kit's `--border`, the kit's 14 px radius, filled with the `--group-fill` token (spec 12: `--highlight` mixed 4 % into `--background`). Label `@<name>` above the top-left, same type as a prompt's label. tldraw's own frame heading is replaced by this label. Selected: the border goes solid `--primary` and the corners square.
- **Members.** A group may hold prompts, images, videos and marks. It may not hold a group, a page or a motion. tldraw's drag-into-frame reparenting applies to allowed shapes only; a disallowed shape dropped over a group stays on the page.
- **`Cmd-G`** wraps the selected shapes that may be members in a new group whose box is their bounding box plus 28 px left, right and bottom and 56 px on top. The name is `nextRef`. Members keep their positions on screen. Shapes already in another group move into the new one. The new group is selected alone. If nothing selected may be a member, nothing happens. tldraw's own group action and shape are not available anywhere.
- **Frame tool (`F`)** draws an empty group named with `nextRef`. Minimum 180 × 96, maximum 4000 × 4000. Default size from the add menu: 420 × 280.
- **`Cmd-Shift-G`** removes the selected group (or the right-clicked one) and leaves its members at the same place on screen, selected.
- **Delete** of a group deletes its members too, as one undo step (tldraw's frame rule).
- Renaming a group is spec 06. In this spec the label cannot be edited.
- This section is the one definition of a group's look, membership, wrap, ungroup and delete. Spec 06 builds on it and does not restate it.

### Empty pages and motions

- Custom shapes with free resize, 180 × 96 to 900 × 900, default 480 × 320. A card frame with the kind icon centred when `file` is empty, and the title as the label above the top-left when set. Spec 09 adds the empty state's Agent button (which opens spec 08's Agent tray), renders the content and opens the editor on double-click.

### Context menu

Sections appear in this order, each only when it has at least one item. An item that would do nothing is left out, never greyed. After the Unframed sections come tldraw's own context menu groups, minus tldraw's group, ungroup, cut, copy and paste items, which Unframed's Edit section replaces.

| Section | Item | Shown when |
| --- | --- | --- |
| Image | "Reveal in Finder" on macOS, "Show in Explorer" on Windows, "Show in file manager" elsewhere, with " (<n>)" appended when more than one file | the right-clicked shape is a filled image or video with a project file; the files are every selected filled image and video, else the right-clicked one |
| Image | "Copy path" | the right-clicked shape is a filled image or video with a project file; copies that file's absolute path |
| Image | "Copy as image" | the right-clicked shape is a filled image |
| Reference | "Copy @<ref>" | the right-clicked shape is a prompt or group |
| Edit | "Cut ⌘X", "Copy ⌘C" | something is selected or right-clicked |
| Edit | "Paste ⌘V" | the clipboard holds tldraw content, a picture, a clip or text |
| Edit | "Group ⌘G" | the selection holds at least one shape that may be a member |
| Edit | "Ungroup ⇧⌘G" | a group is right-clicked or selected |
| Library | "Add to library" | something is selected, and spec 06 has registered the handler |
| Inputs, Artifacts | the add menu's items, placed at the click point | the right-click landed on empty canvas |

On Windows and Linux the shortcut hints read `Ctrl+X`, `Ctrl+C`, `Ctrl+V`, `Ctrl+G`, `Ctrl+⇧G`. Right-clicking an unselected shape selects it alone first; right-clicking inside the selection keeps it. Section headings use the kit's menu label look (spec 12: extra-small medium muted text), rows highlight with the kit's accent, and a disabled row (spec 06's Add to library) has the kit's disabled look, its own text at 64 %. Menu width 188 px.

Failures: "Could not show that file: <message>" or "Could not show those <n> files: <message>"; "Could not copy that path: <message>" or "Could not copy that path to the clipboard."; "Could not copy @<ref> to the clipboard."; "Could not copy that image to the clipboard.".

### Chrome

- **Top-left card**: the logo (28 px, from `assets/brand/`), the project menu, then the Settings slot (spec 10 registers it). While the docked chat rail is open it becomes the rail's top row, without its frame (spec 08). The project menu's trigger shows the active project's name; the menu (spec 12's kit Menu) lists every project as a kit radio item, the active one checked and tinted, switches on click, and ends with "Add project". "Add project" opens the dialog "New project": field "Project name", placeholder "e.g. product-shots", buttons "Cancel" and "Create", `Enter` confirms. The name is slugged; an empty slug shows "Enter a project name."; an existing one shows "A project named “<slug>” already exists.". Creating activates the new project, whose room is seeded with the starter content. Spec 10 adds Rename and Delete to each row.
- **Top-right card**: spec 01's `.unframed-chrome-right` element, kept in the page and empty. There is no Help button.
- **Bottom centre**: one bar, in tldraw's panel look, with no dividers: tldraw's quick actions (Undo, Redo, Delete, Duplicate) and its action menu, then tldraw's tools listed in the Solution (text labelled "Prompt" and frame labelled "Group" in their tooltips), in Unframed's order: Select, Hand, Draw, Eraser, Prompt and Note in the bar, then the arrow and every shape under tldraw's overflow chevron, where the last one picked takes a place in the bar, as tldraw does. There is no Media tool and no Cmd+U: Image and Video from Add, drop and paste bring files in, then the Agent slot (spec 08 registers it), the Library slot and Add. It replaces tldraw's toolbar, which stacks the quick actions in a second small bar above. Library (spec 06 registers it) and Add are tldraw toolbar buttons like the tools, with Lucide icons; Library's tooltip is "Ready-made flows and styles". Add opens the add menu above the bar. A new Unframed tool is a button at the end of this bar.
- **Bottom left**: tldraw's zoom controls (Zoom in, Zoom out, Fit view, zoom menu).
- **Add menu**: the kit Menu with its section labels, 152 px wide, opening above the bottom bar's Add button, with two sections: **Inputs**: Prompt, Image, Video, Group; **Artifacts**: Page, Motion. Icons (lucide): prompt `AlignLeft`, image `Image`, video `SquarePlay`, group `Group`, page `AppWindow`, motion `Clapperboard`. From this button a shape is placed at the centre of the viewport, offset by half its default size; from the context menu, at the click point. A new prompt starts editing.
- Chrome cards use the kit's `surface-glass` (spec 12: `--background` at the glass opacity with the glass blur) with the kit border, a 14 px radius and a soft shadow; their buttons are kit ghost icon Buttons with kit tooltips. They carry spec 01's DOM hooks by these exact names: the top-left card is the one element with class `unframed-chrome-left`, the top-right card the one element with class `unframed-chrome-right`, both positioned with ordinary CSS and no `!important`; `<html>` carries `data-unframed-theme` (`"light"` or `"dark"`) and the custom property `--unframed-text-secondary`, both updated live by the theme (below); `<body>` has the opaque canvas background.
- tldraw's main menu, page menu, help menu, debug menu, share panel and its image and video toolbars are hidden. A selection shows one toolbar, Unframed's (spec 03). Its quick actions and action menu stay, in the bottom bar; its minimap setting and keyboard shortcuts dialog stay. Its style panel shows only while a drawing tool is on or the selection holds shapes with styles (prompts and tldraw's drawings); with nothing selected, or only images, videos, artifacts or groups, it is hidden. The tldraw watermark stays visible and uncovered; no chrome is placed over it.

### Labels by zoom

`labelLevel(zoom)`: below 0.5 `off`; from 0.5 to below 0.75 `hover`; 0.75 and up `on`. At `off` every shape label (prompt `@id`, group label, media kind label, artifact title, and spec 03's role badges) is hidden. At `hover` a label shows only while the pointer is over its shape or the shape is selected. At `on` labels always show. The level is set once on the canvas container as an attribute and applied by CSS, so no shape re-renders on a zoom change.

### Dot grid

A dot grid replaces tldraw's grid background. Base gap 26 canvas px; while the gap is under 16 screen px it doubles (repeatedly). Dots are 1.1 screen px at every zoom. Colour: the `--canvas-dot` token (spec 12), `--foreground` mixed 16 % into `--background` in light and 22 % in dark, over `--background`. Zooming in never changes the gap. The grid component subscribes to the zoom only.

### Camera and navigation

Zoom range 0.1 to 4. Wheel and two-finger scroll pan, `Shift`+wheel pans sideways, pinch and `Cmd`+wheel zoom, `Space`+drag and middle-drag pan. tldraw's other navigation defaults are kept. Opening a project fits the view to its shapes.

### Selection look

From the design artboards (Main, Selected, Group): the selection rectangle is a 1.5 px solid line in `--selection-stroke` (Unframed's `--highlight`) with 4 px radius around the selection bounds, and four square corner grips 7 × 7 with a `--selection-grip` fill (the kit's `--card`) and a 1.5 px border in the selection stroke. The grips are the only resize affordance: resize edges paint nothing, on hover or otherwise. A selected prompt shows the thin selection rectangle tight around its text with no fill. Nothing changes on hover alone. The selection is drawn from tldraw's selection state, never from focus. tldraw's rotate handle is kept.

### Keyboard shortcuts

tldraw's own tool and action shortcuts are unchanged, except those replaced below. On Windows and Linux `Cmd` means `Ctrl`.

| Keys | Action |
| --- | --- |
| `T` | text tool, which makes a prompt (tldraw) |
| `F` | frame tool, which makes a group (tldraw) |
| `I` | add an empty image at the pointer |
| `U` | add an empty video at the pointer |
| `Shift+P` | add an empty page at the pointer |
| `Shift+M` | add an empty motion at the pointer |
| `Cmd+U` | tldraw's insert media: pick files, which become images or videos |
| `Cmd+G` | group the selection (replaces tldraw's group) |
| `Cmd+Shift+G` | ungroup (replaces tldraw's ungroup) |
| `Enter` | edit the selected prompt |
| `Escape` | close the mention menu, else leave editing |
| `Cmd+Z`, `Cmd+Shift+Z`, `Cmd+Y` | undo, redo, redo (this tab only) |
| `Cmd+C`, `Cmd+X`, `Cmd+V` | copy, cut, paste |

None of `I`, `U`, `Shift+P`, `Shift+M` may shadow a tldraw default shortcut in the installed tldraw version. If one does, tldraw keeps it and the Unframed binding moves to `Shift` plus the same letter; the shortcut test fails until the table is updated. Shortcuts never fire while a text field, the prompt editor or a dialog has focus.

### Starter content

A newly created canvas (a new project, or the `default` project on a fresh install) gets two prompts, written by the engine with origin `system` so they are in no tab's undo history: the scene prompt at (40, 60) and the subject prompt at (40, 320). Their texts come from `assets/prompts/starter-canvas.md`. The subject gets the first ref (`100`), the scene the second (`101`), and the scene's text references the subject by that ref.

### Theme

Tailwind with t3code's default light and dark tokens (spec 12), following the OS setting (`prefers-color-scheme`). tldraw's colour scheme follows the same setting, and spec 12's tldraw theme adapter maps tldraw's UI variables (panels, text, selection, radii, shadows, the UI font) onto the kit's tokens. Every theme change sets `data-unframed-theme` on `<html>` and `--unframed-text-secondary` to the resolved muted foreground in the same frame (spec 01's hooks). The canvas background is `--background`, the same as the body. Every colour comes from a token; a variant is a `color-mix` of tokens, never a new hex value in a component. Base UI supplies the dialog, menu, tooltip and toast primitives through spec 12's UI kit.

### Toasts

The kit's toasts (spec 12, Base UI underneath) at the bottom start corner, above tldraw's zoom controls, stacked behind the newest, each with the kit's close button and a type icon. A toast with an id replaces the previous toast with that id instead of stacking. Error toasts auto-hide; the connection-lost notice and the failed-list toast are sticky. Copy strings are the ones listed in this spec.

### Performance budget

- A shape component re-renders only when that shape's own record or a primitive fact about it changes. No shape component reads the whole shape list, the whole selection or the camera during render. Derived facts (a label, a badge) are tldraw computed values keyed to that shape and answer in primitives.
- Budget, measured on the production build at the browser seam on a 300-shape board (100 filled images with real 1024 × 1024 files, 100 prompts, 80 marks, 20 groups): dragging one image for 50 pointer moves renders no other Unframed shape component at all, renders the dragged one at most once per move, keeps the median frame gap at or under 16.7 ms, and has no more than 2 % of frames over 33 ms. Panning 60 steps renders no shape component.
- No shape component holds state that must outlive it, so tldraw's culling of off-screen shapes is allowed.
- Every budget is measured in the hosted shape: the production web served by the engine itself with `UNFRAMED_CLIENT_DIST`, opened at `http://127.0.0.1:<port>`, which is how the desktop shell loads it. The dev setup (Vite on `localhost`) hides a whole class of failure, because `localhost` and `127.0.0.1` are different sites and the browser splits their work across processes where the shipped app does not. Spec 09 adds the artifact budget.
- A second board for images: 40 images whose originals are 6000 by 4000 pixels, fit to view, then zoomed in and out 20 steps: median frame gap at or under 16.7 ms, no more than 2 % over 33 ms, and the page's decoded image memory stays under what 40 previews at 2048 would need plus one original.
- The timing thresholds (median frame gap, share over 33 ms, and spec 09's long tasks) are for real hardware and are enforced by `pnpm test:perf` on one. A shared CI runner cannot hold them, so under `CI` the budget specs still run every gesture and every other assertion (render counts, memory), log the measured frame numbers and skip only those thresholds, with an annotation saying so.
- `?fps=1` loads a frame meter that learns the display's frame time from idle frames and reports per gesture (median frame, frames over one and two display frames); `window.__fps.dump()` returns the settled gestures. It is never loaded without the query parameter.

### Limits

| What | Limit |
| --- | --- |
| prompt hug width | 320 canvas px of content |
| prompt minimum box | 40 × 28 |
| media width | 140 to 900; height at least 100 |
| group size | 180 × 96 to 4000 × 4000 |
| artifact size | 180 × 96 to 900 × 900 |
| video file | 25 MB |
| upload body | 500 MB |
| mention preview | 24 characters |
| mention menu height | 168 px |
| slug | 40 characters |
| room idle close | 60 s |
| reconnect backoff | 1 s doubling to 10 s |
| disconnect toast delay | 2 s |
| data URL rewrite | within 2 s |
| multi-drop offset | 24 px |

## Testing Decisions

A good test drives one of the three seams from 00-index and asserts on what a person sees or what the engine holds. No test reaches into tldraw's store, a component's state or a module's internals.

- **Domain seam** for rules with many cases: `nextRef` (empty canvas gives `100`, dangling `@110` in a prompt pushes the next ref to `111`, named groups ignored); `rewriteTokensOnPaste` (whole tokens only, unknown tokens untouched); `mentionQuery` and `mentionCandidates` (prefix, case, self excluded, preview collapse and cut); media file naming and extension table; sidecar shape; video link detection; `wrapBox` margins and the allowed-member rule; `labelLevel` at 0.49, 0.5, 0.74, 0.75; `gridGap` at 1, 0.5, 0.2, 0.1; context menu rules per target and platform label.
- **Engine seam** for the room and files: sync upgrade refused on bad `Host` or `Origin`; a change from one sync client reaches a second; a change survives `SIGKILL` after acknowledgement; `apply` reaches connected clients, returns an inverse that restores the prior state, and logs origin `server`; `changedSince` reports a session edit after a clock and not a server one; data URL assets are rewritten to files with sidecars; ref collisions are repaired; starter seeding on a new project; room idle close; upload route status codes, file names and sidecars; `files.copy` within and across projects and its errors; an asset with an unknown `src` scheme refused by the room. Tests use a tldraw sync client from the test process to act as a tab.
- **Browser seam** for everything a person does: Playwright on the built web client against an engine at the engine seam. Pointer input is real (Playwright mouse and keyboard), never dispatched synthetic events, because selection and drag live in pointer capture listeners. Assertions read the screen and then the engine (the files on disk, `read(project)` through a test RPC, or a second sync client).

Prior art: the old app's forked-engine tests (temporary data folder, `PORT=0`) and its headless measurement of drag frames against a production build. Node components had no tests in the old app; here every canvas behaviour has a browser-seam test instead.

## Tasks

1. Domain: the token pattern and `nextRef` with the dangling-token rule. Seam: domain
2. Domain: `rewriteTokensOnPaste`. Seam: domain
3. Domain: `mentionQuery` and `mentionCandidates`. Seam: domain
4. Domain: media file naming, extension table, sidecar shape, video link detection. Seam: domain
5. Domain: `wrapBox` and the allowed-member rule. Seam: domain
6. Domain: `labelLevel` and `gridGap`. Seam: domain
7. Domain: context menu rules and per-OS reveal label. Seam: domain
8. Shape schemas for prompt meta, image and video meta, group, page and motion in the contracts package, with migrations, shared by room and web. Seam: engine
9. Sync endpoint with loopback `Host` and `Origin` checks on upgrade, unknown project refused. Seam: engine
10. One room per project persisted in the project database; a client's change reaches a second client. Seam: engine
11. Durability: an acknowledged change survives `SIGKILL`; room closes 60 s after the last client. Seam: engine
12. Change log with origins and `changedSince`. Seam: engine
13. `apply` engine-side writes with returned inverse, broadcast as remote changes. Seam: engine
14. Starter seeding on a new canvas from `assets/prompts/starter-canvas.md`. Seam: engine
15. Ref collision repair. Seam: engine
16. Upload route: saving, naming, sidecar, error codes. Seam: engine
17. `files.copy` within and across projects, and its errors. Seam: engine
18. Data URL and `blob:` rewriting in committed changes. Seam: engine
19. Asset markers: the room accepts `project-file:` and `https://` sources and refuses `preset-file:`, `data:`, `blob:` and any other scheme once rewriting has had its chance. Seam: engine
20. Canvas host mounts tldraw for the active project with embeds, bookmarks and extra pages off, and the watermark visible. Seam: browser
21. Project activation: the remembered project read from the `project.active` preference (and still remembered after an engine restart on a new port), first project fallback, `default` on an empty list, switch during initial load wins. Seam: browser
22. Initial load waits for the RPC socket under the connection-lost notice; a list that fails while connected is retried once, then the sticky failed-list toast, nothing opened. Seam: browser
23. Reload and a second tab show the same board. Seam: browser
24. Reconnect with backoff, offline edits kept and sent; the connection-lost notice appears after 2 s with either socket down, not before, and closes by itself when both are back. Seam: browser
25. Split undo: `Cmd-Z` undoes this tab's edit only; a second tab's edit and an `apply` change stay. Seam: browser
26. Prompt from the text tool and from double-click on empty canvas, with its `@id` label and a fresh ref. Seam: browser
27. Prompt hug to 320 then wrap, measured the same at zoom 0.5 and 2. Seam: browser
28. Prompt pin on resize drag, no pin on a still press, re-hug on edge double-click. Seam: browser
29. Prompt two-step editing and `Escape`, and empty prompt kept with "Add text…". Seam: browser
30. Mention menu: open, filter, preview, arrow keys, `Enter`, `Tab`, mouse insert, `Escape`. Seam: browser
31. Asset store adapter: upload through the engine, resolve markers to file URLs, no downscaling. Seam: browser
32. Empty image: "Choose file", fill, bare once filled, width kept and aspect height. Seam: browser
33. Empty video: file, 25 MB refusal message, link field and "Use link" with its error. Seam: browser
34. Video transport outside the clip; scrubbing never moves the shape, a press on the clip drags it. Seam: browser
35. Aspect-locked media resize within limits; tldraw image crop works. Seam: browser
36. Remove button on selection empties the media and keeps the file. Seam: browser
37. Drop files onto canvas: images, videos, `.html` as page, offset, oversize toast, upload failure toast. Seam: browser
38. Drop onto an image or video shape replaces its media. Seam: browser
39. System paste: image at pointer, image replacing selected images, video, unnamed files named, text as prompt, video link as video, other URL as prompt. Seam: browser
40. Copy and paste shapes with fresh refs and rewritten tokens. Seam: browser
41. Paste across projects copies files; pasted page gets its own file; failed copy toast. Seam: browser
42. Copying one image also puts a PNG on the system clipboard. Seam: browser
43. `Cmd-G` wraps allowed members with the margins and selects the group; tldraw group unavailable. Seam: browser
44. Frame tool draws a named group; allowed and refused members on drag in; no nesting. Seam: browser
45. `Cmd-Shift-G` ungroups in place; deleting a group deletes members in one undo step. Seam: browser
46. Empty pages and motions from the add menu and from `.html` drop. Seam: browser
47. Context menu sections and items per target, dropped rather than greyed, tldraw groups after them. Seam: browser
48. Reveal, Copy as image, Copy @id actions and their failure toasts. Seam: browser
49. Chrome: top-left card and project menu with "New project" dialog and its errors. Seam: browser
50. Chrome: the top-left card with Settings, the empty right hook; the bottom bar and zoom controls; hidden tldraw menus. Seam: browser
51. Add menu with Inputs and Artifacts, placing at centre or click point. Seam: browser
52. Add-shape shortcuts and the no-collision check against tldraw's defaults. Seam: browser
53. Labels by zoom level: hidden, hover, always. Seam: browser
54. Dot grid gap doubling and constant dot size. Seam: browser
55. Selection rectangle and grips look, nothing on hover. Seam: browser
56. Theme tokens in light and dark, following the OS. Seam: browser
57. Performance budget on a 300-shape board in the production build, in the hosted shape. Seam: browser
58. Image previews: an upload writes 512 and 2048 WebP previews into `.cache/previews/` without blocking the main thread; the resolver serves the smallest variant that covers the on-screen size; requests to a model send the original; a missing preview falls back to the original. Seam: browser
59. The large-image budget: 40 images of 6000 by 4000, zoomed 20 steps, in the hosted shape. Seam: browser
60. `?fps=1` frame meter. Seam: browser

## Out of Scope

- **Wires, edges, handles and output nodes no longer exist.** There is no image, video or text output node, no connection, no "Connect all" or "Disconnect all", no ignored-edge styling and no lassoing of connectors. The selection is the input set (spec 03). A group no longer collapses or drops wires on grouping, because there are none.
- Generating anything, the Generate composer, role badges ("image 1") and the selection toolbar: spec 03.
- Video input modes and render jobs: spec 04. Text results as prompts and Free mode: spec 05.
- Renaming a group, recipe groups, the library dialog and presets: spec 06.
- Agent writes and per-turn Revert: spec 07 (this spec delivers `apply`, inverses and `changedSince`). The chat rail, Agent button and composer: spec 08.
- Rendering pages and motions, the preview origin, the editor and dials: spec 09.
- Settings, OAuth, project rename and delete: spec 10. Importing old projects: spec 11.
- Embeds and bookmarks. Pasted URLs never unfurl.
- tldraw's multi-page documents and tldraw's own group shape.
- The old React Flow debug aids (`?trace`, the drag-exclusion checker): they diagnosed React Flow's pointer handling, which no longer exists. `?fps=1` is kept.
- Undo history that survives a reload.

## Further Notes

- The tldraw license key comes from the build-time environment variable (contract 7). A dev build on localhost runs without it; the watermark is never hidden in either case.
- tldraw's asset size limit must be raised to 500 MB for images; the 25 MB video cap is Unframed's own and is checked before upload.
- `apply` is the only way the engine changes a canvas. Spec 07's agent tools, spec 10's lifecycle, spec 11's importer and this spec's seeding, repair and rewriting all go through it, so the change log records every engine-side change with an origin.
- The file marker `project-file:<name>` is the same marker spec 03 inlines at the OpenRouter boundary.
- Old performance findings that shaped the budget: re-rendering every node on every drag frame cost 25 ms per frame on a 120-node board; limiting subscriptions brought it to 8.3 ms. The dev server and React StrictMode inflate frame times on their own, so budget numbers are taken on the production build only.

### Assets this spec needs

- `assets/prompts/starter-canvas.md`: the scene prompt text (with a placeholder for the subject's ref) and the subject prompt text. Source: old repo `client/src/graph/starter.js`, `initialNodes` (scene text and subject text).
- `assets/theme/`: history since spec 12, which replaced these values with t3code's tokens. It held light and dark values for every token this spec named (body, card, surface and popover backgrounds, overlay, overlay hover, border, border emphasized, accent, on accent, text primary, text secondary, text accent, icon primary, radius values, fast duration) plus the chrome values (chrome blur 20 px, scrim filter, grain texture, the corner card, tools bar and floating button styles, mention menu surface). Source: old repo `client/src/theme.js`, the resolved Astryx theme-neutral token values, and the custom properties and `.toolbar-card`, `.tools`, `.fab`, `.fab-library`, `.mention-menu`, `.xnode-media-remove`, `.xnode-group`, `.xnode-line` rules in `client/src/styles.css`.
- `assets/brand/logo.svg` and `assets/brand/favicon.svg`: the Unframed mark (four rounded shapes), drawn in `currentColor` for the logo and in near black or white by scheme for the favicon. `assets/brand/app-icon.png` (1024 × 1024) is the desktop app's icon, for the shell. The mark replaced the old repo's logo on 2026-09-30.
- `assets/design/` Main, Selected and Group artboards (selection look). Source: the design canvas files already collected.
- `assets/screenshots/` canvas views of the old app. History since spec 12, not the visual reference. Source: screenshots of the old app.
