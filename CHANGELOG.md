# Changelog

Unframed ships by `git pull`, so entries are dated rather than versioned — there
is no release artifact to number. Headings are `## YYYY-MM-DD`, groups are
`### Added` / `### Changed` / `### Fixed`, one bullet per user-visible change.
Keep that shape: the website's What's new page parses this file.

## 2026-08-15

### Fixed

- The `@` reference menu appears again when you type `@` in a prompt. It was being
  drawn just outside the node's card, which clips to its rounded corners, so the
  menu was cut away entirely and no suggestions ever showed.
- That menu now also lists Text nodes, not just other prompts. It had dropped them
  when the output nodes were split on 2026-08-13.

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
