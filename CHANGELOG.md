# Changelog

Unframed ships by `git pull`, so entries are dated rather than versioned — there
is no release artifact to number. Headings are `## YYYY-MM-DD`, groups are
`### Added` / `### Changed` / `### Fixed`, one bullet per user-visible change.
Keep that shape: the website's What's new page parses this file.

## 2026-08-17

### Fixed

- A failed project save, preset save, or project-list load now shows an error
  instead of hanging forever with nothing to see. Under the hood these could take
  the local server down with them, which ended the session rather than the request.
- When the connection drops while reading a generation's answer, the node now
  shows an error — with a note that the run may still have been charged —
  instead of spinning forever.
- A render finishing while its project is being renamed now always lands in the
  renamed project, and its record names the folder the clip is actually in.

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
