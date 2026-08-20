# Changelog

Unframed ships by `git pull`, so entries are dated rather than versioned — there
is no release artifact to number. Headings are `## YYYY-MM-DD`, groups are
`### Added` / `### Changed` / `### Fixed`, one bullet per user-visible change.
Keep that shape: the website's What's new page parses this file.

## 2026-08-20

### Fixed

- **Unframed now answers only the machine it runs on.** It used to accept
  connections on every network interface, so any other device on your network
  could reach the API and read your output path, your model settings and the last
  four characters of your key — or spend your credit. It also acted on requests
  from websites you happened to have open: they could not read the reply, but the
  action still happened, which for the folder picker meant a site could pop a
  native folder dialog on your desktop. All three doors are shut: the server
  listens on `127.0.0.1` only, and refuses requests whose `Origin` or `Host` is
  not loopback. Nothing about normal use changes; reaching the dev server from a
  phone or another computer no longer works, and is no longer meant to.

### Changed

- **New canvas palette, in both light and dark.** The canvas is a near-black in
  dark mode and a shade off white in light, and nodes sit on their own lifted
  surface with a soft shadow, so a node reads as an object above the canvas rather
  than a bordered patch of it — in dark mode the two used to be the same colour.

- **The floating chrome is translucent.** The toolbar cards, the tools rail and the
  menus are frosted glass over the canvas rather than solid panels: you can see
  what is behind them, blurred. A dialog barely dims the canvas now — it is a pane
  of foggy glass, grain and lit edge included, and what is behind it stays visible
  through it.

- **The canvas dots stay visible at every zoom.** They used to shrink with the view
  and disappear below about 60%; now they hold their size on screen, and the grid
  halves its density on the way out instead of crowding into texture. They are a
  step lighter, too.

## 2026-08-19

### Added

- Video reference and result nodes have their own play/scrub controls, built into
  the node instead of the browser's native ones. A clip now drags by its frame like
  a picture does — scrubbing the new controls moves the playhead, not the node.

- **Image and video reference nodes can be resized.** Drag any edge — including
  the right one, where the dot still takes precedence for wiring. The picture or
  clip keeps its exact proportions whichever edge you pull, and the size is
  saved with the project.

### Changed

- **A selection box adds to the selection when a modifier is held**, the way
  Figma, Sketch and Illustrator do; without one it still replaces, as before.
  Nodes already selected are never toggled off by a box that passes over them.

- **The tinted rectangle over a selected group is gone**, and with it the dead
  zone it created. It covered the whole bounding box and swallowed every click
  inside, so a node in the middle of a group could not be clicked off, dragged on
  its own, or used at all until you cleared the selection. Dragging any selected
  node still moves the whole group, and arrow keys still nudge it.

- Box-select is more forgiving: a rectangle that only touches a node now selects
  it (it used to have to enclose the whole node), and one drawn across a bare
  connection — touching neither of its nodes — now selects that connection too.
- Connection handles are bigger, and a release nearby now connects instead of
  demanding a precise drop on the dot.

- **You can zoom much further in and out** — down to 10% (was 30%) and up to
  400% (was 200%).

- **The right-click menu shows only what it can actually do.** Unavailable
  actions are hidden rather than greyed out, and a heading disappears with its
  last item, so the menu is as short as the situation. "Connect nodes" and
  "Disconnect nodes" are now "Connect all" and "Disconnect all".

- **Reference images and clips fill their node**, edge to edge, instead of
  sitting inside a frame of padding — square corners at the top, rounded to
  match the node at the bottom.

### Fixed

- **Other websites can no longer read or change your local Unframed settings.**
  Any page open in the same browser could previously reach the local server: it
  could read which key was in use, your default models and your output folder
  path, or remove your API key outright. The server now answers only its own
  canvas.

- **Missing a node while building a selection no longer costs you the group.**
  Holding Shift (or Cmd/Ctrl) and clicking a gap between nodes used to throw
  away everything selected so far, so picking quickly across a grid left some
  nodes behind. A press on empty canvas with the key held now does nothing at
  all — whether it lands perfectly still or wobbles a few pixels.
- Hovering a reference picture, a generated result or a reference clip no longer
  raises a tooltip — one that, in the packaged app, could land in the corner of
  the window instead of on the picture.
- A prompt or text field resized by its corner keeps that size after a reload or
  a project switch, instead of snapping back to its default.

- **The canvas navigates over an output node again.** Scroll, pinch and
  Cmd/Ctrl+wheel did nothing at all while the cursor sat on an image, video or
  text output — the node claimed the wheel for its whole area. Only the prompt
  and instruction fields keep it now, where it is what lets long text scroll.

## 2026-08-18

### Added

- **Choosing a model opens a dialog instead of a dropdown.** Room to read the
  list properly: search every model by slug or name, see when each was
  released, and sort by either. The old dropdown showed 43 image, 23 video or
  245 text models through a 200px window; this one also cannot open at the
  corner of the window, like the menus fixed below.

- **Wire several nodes at once.** Select a group, then drag from any one node's
  handle: every selected node that can connect follows along, so three prompts
  reach an output in one drag instead of three. It works in both directions —
  drag from an output's input handle and every selected output gets wired.
- Shift+click adds a node to the selection, alongside the Cmd/Ctrl+click that
  already did.
- **Connect nodes** and **Disconnect nodes** in the right-click menu, under Edit.
  Connect wires every source in the selection to every output in it; Disconnect
  removes the connections *between* selected nodes, leaving the ones that reach
  out to the rest of the graph alone. Each is greyed out when it would do
  nothing.
- Free mode now works from a plain prompt node, not only a text output — wire prose in
  and the text model splits it into one prompt per image.
- A Free section can name which wired images it uses (`images: 2, 5` on its first line),
  so a nine-run batch no longer sends every reference to every run. No line still means
  every image.
- New **View final prompt** checkbox under Free: see the assembled sections, edit them,
  and check which images each run will get before anything is generated.

### Fixed

- **Nodes drag from anywhere except their controls.** The title bar was the only
  handle — 33px on a node up to 284px tall — so most of a node was dead to
  dragging and grabbing one meant aiming. Now a reference node drags by its
  picture, an output node by its generated result, and every node by its header,
  footer and margins. Text fields, menus and buttons are left alone, so a field
  still selects text and a slightly shaky press on Generate still generates
  rather than nudging the node.
- **Shift+clicking a node adds it to the selection.** It did nothing at all:
  Shift was both the "add to selection" key and the key that starts a selection
  box, and the selection box claimed the press before the node ever saw it. The
  giveaway was an input node's header flashing "copied!" on a shift+click that
  left the node unselected — the click was arriving, the selection was being
  cancelled. Building a group one node at a time now works.
- **Clicking a node on its picture selects it again.** Pressing on a reference
  image or a generated result and moving even a pixel started the browser's own
  image drag, which swallowed the click: the node was neither selected nor moved,
  so shift+clicking to add one to a selection appeared to fail at random. A
  perfectly still click had always worked, which is why it looked intermittent.
- Dragging a prompt's or a text node's field by its bottom-right corner makes the
  text area itself bigger again. The bordered box grew but the writing area stayed
  four lines tall, so a long prompt or result scrolled in a strip at the top of a
  mostly-empty box. Broken by the same toolkit upgrade noted under Changed.
- **The Quality, Background, Ratio, Size, Input and Seconds menus on the output
  nodes open on the node again.** They could open at the corner of the window
  instead, far from the control you clicked — always in the installed app, and in
  Safari. They are now the operating system's own menus, so they open where you
  click and scroll properly on a long list; typing a few letters jumps to a value.
  The controls look and behave the same otherwise.
- Pressing Enter in the New project dialog creates the project, and in Rename
  renames it. The button was the only way through; Enter did nothing. An empty or
  already-taken name still stops with its message rather than closing on the
  keystroke.

### Changed

- **Copying a prompt or text node's `@reference` moved to the right-click menu**,
  under Reference. It used to happen when you clicked the node's title bar — which
  is also the strip you drag a node by, so reaching for a drag or a selection
  copied instead. The title bar is now only a title bar, and still shows the id.

- Searching a model list is easier to see: the search box now carries a magnifier
  and, once you have typed, a ✕ that clears it and puts the cursor back. Menus
  also sit a little clear of the control that opened them instead of flush
  against it. Both come from the interface toolkit the app is built on, which
  moved several versions forward in one step; nothing else about the app changed.

## 2026-08-17

### Changed

- Setting up for the first time now asks for the key and nothing else. The default
  models and output folder appear once a key is saved, since the model lists come
  from OpenRouter and cannot be filled in before there is a key to fetch them with.
  Saving the first key confirms with a toast and closes the dialog; reopening it
  shows the full settings.

### Fixed

- Pasting an image or video onto the canvas works in the desktop app. It did
  nothing there — no node, no error — while working normally under `npm run dev`,
  so nothing about the canvas looked wrong until you tried it in the app.
  Drag-and-drop was never affected, and neither was pasting into a selected
  reference node.
- The settings dialog scrolls. It caps at three quarters of the window height, and
  everything past that was cut off rather than reachable — on a small laptop, or a
  resized window, that included the Save button, so there was no way to finish. The
  buttons now stay put at the bottom while the form scrolls behind them.
- The three default-model pickers no longer sit on "Loading models…" forever after
  you add your key. They were shown before a key existed, so their lists were never
  fetched, and saving the key did not go back for them — only closing and reopening
  the dialog did.
- A failed project save, preset save, or project-list load now shows an error
  instead of hanging forever with nothing to see. Under the hood these could take
  the local server down with them, which ended the session rather than the request.
- When the connection drops while reading a generation's answer, the node now
  shows an error — with a note that the run may still have been charged —
  instead of spinning forever.
- A render's status check dying mid-poll no longer leaves its card stuck on
  "Rendering…" forever. Under the hood this could take the local server down
  too, ending the session rather than just that one poll.
- A render finishing while its project is being renamed now lands in the
  renamed project, and its record names the folder the clip is actually in.
- **Reveal in Finder works again.** Since 2026-08-13 it did nothing at all when
  running Unframed from a clone: the menu item was there, the click was
  registered, and no window ever opened.
- A reveal that fails now says why — the folder having been moved or deleted, for
  instance. It used to fail exactly like it succeeded: in silence.
- The top row of a menu highlights under the cursor like every other row. Opening a
  menu with the mouse focuses its first row, and the rule that stops that from
  looking pre-selected was flattening the hover highlight along with it — so
  *Reveal in Finder*, first in the canvas menu, never lit up.

## 2026-08-16

### Added

- Unframed is MIT licensed, and now says so in a `LICENSE` file. There wasn't one
  before, which meant default copyright applied: cloning and running the thing this
  README invites you to clone and run was never actually permitted. Nothing about
  the project changes — the permission it always intended to give is now given.

### Fixed

- A text node's answer can no longer land in the wrong project. Starting a run and
  switching projects before it finished wrote that answer — and its cost — over
  whatever text node happened to share the same id in the project you moved to,
  which downstream prompts then quietly built from.
- Undo no longer strands a video node mid-render. Pressing Cmd+Z after clicking
  Generate left the card spinning forever, with Generate disabled and no "Forget
  this job" button to escape with, until a reload. The clip itself was never at
  risk and still landed on disk.
- A preset saved while a video was rendering no longer carries that render with it.
  Every copy inserted afterwards started disabled, waiting on a job that had long
  since finished.
- A render this app can no longer ask about is given up on after 24 hours and
  reported as failed, saying so, instead of being retried silently forever.
- Changing the output folder in Settings no longer loses track of a render
  already in flight — pending renders move with the folder and land there.
- Undo can no longer freeze an image or text node's Run button. Stepping back
  to a moment when a run was in flight used to leave the button disabled, with
  the node showing "Running…" until a reload.
- Renaming a project no longer loses a render that is still going. The clip now
  lands in the renamed project instead of recreating the old one.
- Deleting a project with a render in progress now asks first, and says how many
  renders it will stop tracking.
- Removing your OpenRouter key now ends every render it was tracking, with a
  reason, instead of leaving its record unresolved forever with nothing left able
  to check on it. A card still watching one of those renders now says the key was
  removed, rather than reading "Rendering…" until you reload.
- Changing the output folder now fails with a message if it cannot take renders in
  progress with it, instead of reporting success and leaving them behind.
- A failed project delete no longer looks like it worked.
- Undo no longer freezes an image or text node that it brings back from a delete.

## 2026-08-15

### Added

- Video nodes choose how wired images are used: as references, as a first frame, or
  as first and last frames. Models that do not accept frames do not offer the choice.
- Inputs a mode has no room for keep their connection, marked red, and their badge
  reads `—`.

### Changed

- Reference badge numbers are now ordered by the consuming output's position on
  the canvas rather than always counting up from 1, so the same wired image can
  read `2 / 1` — the position tells you which output gives which rank.
- Switching a model now returns that node's model-specific settings to that
  model's defaults, whether or not the new model could have honoured the old
  value, the same as a freshly added node on that model.

### Fixed

- An `@word` in a prompt that matches no node id is left as typed. It used to be
  deleted, so "@golden hour" became " hour".
- The `@` reference menu appears again when you type `@` in a prompt. It was being
  drawn just outside the node's card, which clips to its rounded corners, so the
  menu was cut away entirely and no suggestions ever showed.
- That menu now also lists Text nodes, not just other prompts. It had dropped them
  when the output nodes were split on 2026-08-13.
- A video that takes longer than the app was willing to wait is no longer lost —
  the node remembers its job and picks it up when you come back, and the server
  finishes and saves it on its own even if the app is closed the whole time. A
  render that was queued upstream for over an hour prompted this.
- A finished image or video no longer looks lost after you switch projects or
  reload — the node remembers what it made and keeps showing it, and "Add to
  canvas" still works. The file and its sidecar were always on disk; only the
  node's own memory of them was being discarded.
- A video job OpenRouter marks `expired` (or `cancelled`/`canceled`) now ends
  the render with that message shown, instead of spinning forever: the server
  only recognised `completed`/`failed`, so a job stuck upstream past its own
  time limit was polled every 30 seconds for the rest of the process with no
  way out. A render that sat queued for over two hours prompted this.
- An image or text run in flight now keeps its node's Generate/Run button
  disabled across a project switch, so coming back to it can no longer invite a
  second, paid click. A run that finishes after you have switched away no
  longer writes its result into whatever project you have since moved to —
  node ids are shared by every project, so that could otherwise land a
  different project's images, or an @id-resolvable text answer, on a same-id
  node that never asked for them.

## 2026-08-13

### Changed

- Outputs are now three separate nodes — Image, Video and Text — instead of one
  Output node with an Image/Video tab inside it. You pick what you are making when
  you add the node, and its title says so on the canvas.
- Existing projects and saved presets open as before: their output nodes become
  Image or Video automatically, keeping their settings and wiring.

## 2026-08-12

### Added

- Save your own presets: select nodes, right-click, *Add to library*, give it a
  name and a description. Whether it is a flow or a block, and what it makes, are
  read off the selection rather than asked for.
- Your presets are marked *Custom* in the Library, sort ahead of the bundled ones,
  and each has a delete button. They live in `presets.json` in your output folder,
  so they follow you between projects and survive clearing the browser.
- The Library gained a Custom / System filter, sorting (Newest, Oldest, A–Z, Z–A),
  a card-or-list view toggle that remembers your choice, and pages of ten.
- Share a local video clip through a temporary tunnel for the length of one
  generation, so it can be used as a reference. Explicit per-node opt-in, never
  automatic; the link dies when the job ends.
- Paste an `https://` link into a video node for clips already hosted somewhere.

### Changed

- The right-click menu shows all of its items instead of scrolling the last
  section out of reach.
- Copy and Cut now act on the node you right-clicked, even when nothing is
  selected — before, they quietly did nothing.
- The tunnel runs on localtunnel instead of cloudflared — comes up in about a
  second, and needs no binary installed.
- The output node warns when a wired video can't reach the model you picked, and
  explains prompt phrasing for video-to-video instead of guessing at parameters.
- Every generation status carries an icon rather than a bare dot.

## 2026-08-11

### Added

- Settings dialog: key, image/text/video models and output folder, all editable
  without touching `.env` or restarting.
- Video reference nodes — upload, paste or drag a clip, 25MB, numbered like
  images ("video 1").
- Add to canvas for generated videos.
- Video models that declare exact pixel sizes offer those instead of a
  resolution tier and ratio pair.

### Fixed

- Generations land in the project you are actually looking at, not whichever one
  loaded first.

## 2026-08-10

### Added

- Prose to JSON, a Library preset that structures a prompt you already wrote.

### Changed

- Model picker rows are tagged with what each model can actually do — top
  resolution, transparency, quality, seed, durations, audio.

## 2026-08-07

### Added

- The Library: a dialog of ready-made node fragments you drop onto the canvas.
  First presets are Layerize (split an image into its visual parts, one
  generation each) and its image node.
- The output node's Video tab — generate video, priced per second, polled until
  the file is on disk.
- Undo and redo for canvas edits.
- Add nodes by double-click or right-click; the context menu is about whatever
  is under it.
- Reveal every selected image at once.

### Changed

- Size, quality and ratio controls are driven by the selected model's own
  declared capabilities instead of a fixed list.
- Results are handed to the node that asked for them instead of scattered
  across the canvas.

### Fixed

- Autosave no longer drops an edit made right after switching projects.

## 2026-08-06

### Added

- Multi-run generation: N runs per Generate click, or Free — one run per section
  of a text node's list.
- Images are numbered per consumer, so the same picture can be image 1 to a text
  node and image 2 to an output node.
- Every run writes a `.json` sidecar with prompt, params and cost; batch runs
  share a batch id.

### Fixed

- Concurrent results no longer collapse onto one node, and batch filenames no
  longer collide.

## 2026-08-05

### Added

- Text nodes: run a prompt through a text model and reference the answer with
  `@id` anywhere else on the canvas.
- A separate text-model catalogue, filtered to vision-capable models.

### Changed

- Input and output node families are visually distinct; REFERENCE is now IMAGE.

## 2026-08-01

### Changed

- The model list is the image catalogue, sorted, labelled by slug.
- A generated image is placed beside its output node, not underneath it.

## 2026-07-31

### Added

- Unframed's first release: a node canvas wiring prompts and images into an
  output node, generating through OpenRouter and writing the result plus a
  sidecar to a local folder.
- Paste your OpenRouter key into the app; the key dialog opens on first run and
  can remove the key again.
