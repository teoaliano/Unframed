# 11 · Legacy import

Depends on: 01 to 10 (read 00-index first). Built last.

## Problem Statement

People already have projects and presets made with the old Unframed. The old app stored a project as a node graph with wires (`graph.json` plus an append-only journal `graph.log`) and stored presets as graph fragments in `presets.json`. The new app has no wires and no output nodes: the selection is the input set, and generation settings live on results and on recipe groups. The packaged app keeps the same output folder across the update, so the first time a person opens an old project in the new app, its folder holds files the new canvas cannot read. Without an import the project opens empty, and the person's work looks lost even though every file is still there.

## Solution

A one-time, automatic import, built last.

- **Projects.** The first time the engine opens a project folder that holds an old graph and no project database, it rebuilds the old graph (snapshot plus journal), maps it onto the new shape kinds, and writes the project database (spec 01's `unframed.sqlite`) beside the old files. Prompts stay prompts with the same `@id`. Images and videos become media shapes naming the same files. Groups stay groups with the same members. Each output node becomes a recipe group, around its wired sources when that can be done cleanly and on its own where it stood otherwise, and its results become result shapes carrying recipes rebuilt from their sidecars. Wires disappear. Pages and motions keep their files and dials. The old files are never rewritten or deleted. A report says what changed, what was not kept and which files were missing, shown once and reachable from the project menu afterwards.
- **Presets.** Old presets stay in `presets.json` exactly as they are. The library converts each one to a preset every time it reads the file (an output makes it a recipe group, no output makes it a plain group), shows it with a note of anything not kept, and never writes the converted form back.
- **Chats.** Old chats (`threads/*.json`) are not imported. They stay on disk untouched, and the report says so.

## User Stories

1. As a person upgrading, I want my old project to open with its content on the canvas, so that my work is not lost.
2. As a person, I want the import to happen by itself the first time I open an old project, so that there is no step I can forget.
3. As a person, I want the canvas to show that it is importing while it works, so that a slow first open does not look broken.
4. As a person, I want my prompts to keep their text and their `@id`, so that every reference I wrote still resolves.
5. As a person, I want my images and videos to show the same files, so that nothing is duplicated or re-uploaded.
6. As a person, I want pictures the oldest app kept inside `graph.json` written out as files, so that they appear on the canvas like any other picture.
7. As a person, I want an https video link to stay a linked reference clip, so that it still reaches the video model.
8. As a person, I want my groups to keep their names and members, so that `@character` still means the same thing.
9. As a person, I want an image, video or text output to become a recipe group holding its model and settings, so that I can run it again in one click.
10. As a person, I want that recipe group drawn around the shapes that were wired into the output when that fits cleanly, so that selecting the box is the same as the old wiring.
11. As a person, I want an output whose sources were shared with other outputs to become a recipe group where the output stood, so that its settings survive even when a box cannot be drawn.
12. As a person, I want an output wired from one group to put its settings on that group, so that the group itself becomes the recipe.
13. As a person, I want a text output's answer to become a text result with the text output's `@id`, so that prompts that referenced its answer still get it.
14. As a person, I want a text output's instructions to become a prompt inside its recipe group, so that the instructions still go with every run.
15. As a person, I want every generated image and clip to become a result carrying its recipe, so that Generate and Regenerate work on my old results.
16. As a person, I want results listed on an output but never added to the canvas to arrive as result shapes beside it, so that nothing I paid for is left in a strip I can no longer see.
17. As a person, I want a result I had already added to the canvas to arrive once, not twice, so that the canvas is not cluttered with duplicates.
18. As a person, I want a render that was still in flight to keep being tracked and land when it finishes, so that a paid render is never stranded by the upgrade.
19. As a person, I want my pages and motions to keep their files, titles and dial values, so that they look and behave as before.
20. As a person, I want shapes to keep their positions and sizes, so that my layout is the one I made.
21. As a person, I want the old files left exactly as they were, so that I can go back to the old app or inspect them.
22. As a person, I want the import to happen once and never again, so that later edits are never overwritten by a second import.
23. As a person, I want a crash in the middle of an import to leave the project importable, so that a half-written canvas never blocks a clean retry.
24. As a person, I want a report after the import listing what changed, what was not kept and which files were missing, so that I know exactly where to look.
25. As a person, I want to reopen that report later from the project menu, so that I can check it after dismissing it.
26. As a person, I want a clear message and a Try again button when an import fails, so that I am not left with an empty canvas that hides my work.
27. As a person, I want my old presets to appear in the library, so that what I saved is still there.
28. As a person, I want an old flow with an output to arrive as a recipe group and an old block without one as a plain group, so that presets fit the new canvas.
29. As a person, I want each converted preset to say what could not be kept, so that I am not surprised when I insert it.
30. As a person, I want to delete an old preset like any of mine, so that I can tidy the library.
31. As a person, I want my old presets never rewritten on disk, so that a conversion bug can never damage them.
32. As a person, I want the report to tell me my old chats are still in the folder but not shown, so that I know they were not deleted.
33. As a maintainer, I want the mapping to be a pure function of the old files, so that every rule is testable with plain inputs and outputs.
34. As a maintainer, I want the old formats written down completely in this spec, so that the importer can be built and tested without the old code.

## Implementation Decisions

### Modules

- **Legacy graph reader** (domain, deep). `rebuild(snapshotText | null, journalText | null)` returns `{ graph, stats, notes }`: the old graph as it last stood, following the snapshot-and-journal rules below and the old op vocabulary. Hides: every op's semantics, the legacy-snapshot rule, where replay stops.
- **Legacy normaliser** (domain). `normalise(graph)` returns a graph with legacy types migrated, transient keys dropped, membership repaired, and notes for everything repaired.
- **Legacy mapper** (domain, deep). `mapProject(graph, facts, options)` returns `{ canvas, extractions, report }`. `facts` is everything the engine learned from disk: which files exist, the pixel size of each image file, the parsed sidecar for each file, the text sidecars, the project's records in `jobs.json`, whether `threads/` holds files, the default models. `canvas` is a description of every shape to create (kind, `@id`, bounds, parent, text, file, recipe, result recipe, dials, pending render). `extractions` lists the inline data URLs to write out and the file name each must get. Hides: every mapping rule, placement, the report strings.
- **Legacy preset converter** (domain). `convertPreset(entry, options)` returns a spec 06 preset (in its built form, before a tldraw schema is stamped) plus notes, or nothing when the entry is not an old preset.
- **Project importer** (engine). Runs inside spec 01's project database `open`, as the step spec 01 reserves for it before the file is first created. Gathers `facts`, calls the domain modules, writes extractions, builds the project database in a temporary file (applying spec 01's migration list, then writing the canvas through spec 02's room storage), stores the report in the `legacy_import_report` table this spec adds, and renames the file into place. Hides: the atomic write, the import lock, the loading state.
- **Import report UI** (web). The dialog, the project menu entry, the loading and failure states.

### When the import runs

A project folder **needs an import** when it holds `graph.json` or `graph.log` and no `unframed.sqlite`. Every path in the engine that opens a project's database (the sync room, the chat store, the agent's canvas tools, anything else) goes through spec 01's one opener, and that opener runs the check first. So the import happens on the first open of that project in the new app, whatever caused the open, and before anything else can create the database.

Only one import per project runs at a time; a second open waits for the first and then opens the result. While it runs, the canvas shows "Importing from the old Unframed…" in place of the canvas (spec 12: the kit's Empty with a Spinner, the line in muted text).

The import is not offered as a menu action. A manual step would leave an empty canvas the person could start editing, and a later import would then have to overwrite or merge those edits.

### Never rewrite, never delete

The importer reads `graph.json`, `graph.log`, sidecars, `jobs.json` and media files, and writes only new files: the project database, the media files it extracts from inline data URLs (each with a sidecar), and nothing else. It never renames the old journal (the old app renamed a stale journal; the importer only ignores it). `graph.json`, `graph.log`, `graph.log.stale-*`, `threads/`, every sidecar and every media file stay byte-identical. The report is stored inside the project database, not as a file.

### Once, and crash-safe

- The project database is built in a temporary file in the project folder, `unframed.sqlite.import-<pid>.tmp`, and renamed to `unframed.sqlite` only after every record and the report are written. Leftover temporary files from a crashed import are deleted at the start of the next attempt.
- Extracted media files get deterministic names: `legacy-` + the first 16 hex characters of the SHA-256 of the bytes + `-` + the slug of the old `fileName` without extension (or `upload`) + `.` + the extension from the MIME type. An extraction whose target already exists with the same size is reused, not written again, so a retry never duplicates files. Sidecar: `{ source: "legacy-graph", fileName, mime, bytes, at }`.
- Once the database exists, the project is never imported again, even if `graph.json` changes later.
- The mapping is deterministic: the same old files always produce the same canvas apart from tldraw's own shape ids.

### Failure

If the import fails, no database is written. The project shows: "Could not import this project from the old Unframed: <message>. Its files are unchanged." with a "Try again" button that reruns the import (spec 12: the kit's error Alert, centred in the canvas's place, with a primary Button as its action). The canvas is not created, so the project cannot be edited until the import succeeds.

### The old output folder

```
<output folder>/
  presets.json          old presets (see "presets.json")
  jobs.json             render jobs (see "jobs.json")
  <project>/            one folder per project; the folder name is the project name, slugged
    graph.json          snapshot
    graph.log           journal
    graph.log.stale-<ms>  a journal set aside by the old app; ignored
    threads/<id>.json   chats; not imported
    <media and sidecars>
    hyperframes-viewer.html, unframed-dials.js, hyperframes-player.js,
    hyperframes-runtime.js, gsap.js   generated motion files; ignored, spec 09 regenerates its own
```

A project folder name is the slug of the project name: lowercase, every run of characters outside `a-z0-9` becomes `-`, a leading or trailing `-` removed, cut to 40 characters.

### `graph.json`

Pretty-printed JSON (two-space indent), written temp-then-rename.

```ts
type LegacySnapshot = {
  version?: number;   // integer; absent in files written before the journal existed
  nodes: LegacyNode[];
  edges?: LegacyEdge[]; // may be absent: read as []
};
type LegacyNode = {
  id: string;         // counter numbers ("104"), agent ids ("a-<base36>-<rand>"), or group names ("character")
  type: string;       // see the table below
  position: { x: number; y: number }; // top-left; relative to the parent when parentId is set
  width?: number;
  height?: number;
  parentId?: string;  // the id of a group
  data: Record<string, unknown>;
  // may also carry, and must be ignored: selected, dragging, measured, extent, and any other key
};
type LegacyEdge = {
  id: string;         // usually "e-<source>-<target>"
  source: string;     // node id
  target: string;     // node id; always an output node
  animated?: boolean;
  // may also carry sourceHandle, targetHandle and other keys: ignored
};
```

A file that fails to parse, or whose `nodes` is not an array, is **unreadable**.

### Node types and their data

| `type` | family | `data` keys |
| --- | --- | --- |
| `prompt` | input | `text` (string), `sized?` (true when the person dragged a size; otherwise the box hugged its text), `size?` (an older field size, ignored) |
| `image` | input | `file?` (a file name in the project folder), `fileName` (the original name), `dataUrl?` (an inline `data:` URL in graphs older than the file store, or `""`), `aspect?` (width divided by height) |
| `video` | input | same keys as `image`; `dataUrl` may also hold an `https://` link to a hosted clip |
| `group` | input | `{}`; its `id` is its name. A group saved on one day in September 2026 may carry `name`, which is ignored: the old app labelled and referenced groups by `id` |
| `imageOutput` | output | `model`, `resolution` (e.g. `"1K"`), `quality` (e.g. `"low"`), `aspect_ratio` (e.g. `"1:1"`), `background`, `output_format`, `size` (an exact `"WxH"`, which replaces resolution and ratio), `runs` (1 to 10), `freeRuns` (true = Free), `previewPrompt` (true = show the final prompt before a Free run), `results?` (`[{ url, savedPath, cost, runIndex }]`), `running?` (`{ startedAt, session }`) |
| `videoOutput` | output | `videoModel`, `duration`, `resolution`, `aspect_ratio`, `size`, `generateAudio`, `inputMode` (`"reference"`, `"first_frame"` or `"first_last"`; absent = `"reference"`), `shareLocalVideos` (absent = true), `job?` (`{ id, startedAt, params }`), `result?` (`{ url, cost, savedPath }`) |
| `textOutput` | output | `text` (the instructions, appended after the wired input), `result` (the model's answer, `""` when not run), `cost`, `model`, `running?`, `size?`, `resultSize?` (field sizes, ignored) |
| `page` | artifact | `file`, `title`, `fileName`, `dials?` (the saved dial values object) |
| `motion` | artifact | same as `page` |
| `output` | legacy | an output from before the three-way split: `data.kind` is `"video"` for a video output, anything else (or absent) for an image output; every other key is that output's |
| `text` | legacy | the old name of `textOutput`, same keys |

In a result, `url` is `/api/file/<project>/<file name>` (URL-encoded) and `savedPath` is an absolute path whose basename is the file name. Very old graphs may hold a `data:` URL in `url`.

Wiring rules of the old graph, which the mapper relies on: only output nodes are edge targets; a group has edges and its members do not; members are prompts, images and videos only, and groups never nest.

Default sizes when `width` or `height` is absent: prompt 240 by 160; group 420 by 280; page 480 by 320; motion 480 by 300; image and video 240 wide, height from the aspect ratio; outputs 320 by 200.

### `graph.log`

JSON lines, append-only, one entry per committed change, never truncated.

```ts
type LegacyEntry = {
  version: number;          // 1, 2, 3...; one more than the entry before
  op: LegacyOp;             // the op that was applied, including for undo and redo entries
  inverse: LegacyOp | null; // null = not undoable (system commits)
  origin: { kind: "session" | "thread" | "undo" | "redo" | "system"; id?: string; reason?: string };
  at: number;               // epoch milliseconds
  undoes?: number;          // on an undo entry: the version it undid
  redoes?: number;          // on a redo entry: the undo entry's version it redid
};
```

The op vocabulary, each op applied to `{ nodes, edges }` as the old app did:

- `addNode { node, index? }`: inserts `node` (transient keys dropped) at `index`, or at the end. Rejected when the id exists, or when `node.parentId` names no group, names a node that is not a group, or the node cannot be a member (an output or a group). A member never lands ahead of its group in the array.
- `updateNode { id, patch }`: merges `patch` into `data`; a key whose value is `null` is deleted. Rejected when there is no such node.
- `moveNode { id, position }`: sets `position`.
- `resizeNode { id, width, height }`: sets each, or deletes it when `null` or absent.
- `reparentNode { id, parentId, position, index? }`: moves the node into a group (`parentId`), or out (`null`), with its new `position`; entering a group drops every edge touching the node. Rejected on the same membership rules as `addNode`, on `parentId` equal to `id`, and on a missing position.
- `renameNode { id, to }`: changes the node's id to `to` and rewrites `parentId` of its members and both ends of every edge. Rejected unless `to` matches `^[\w-]+$`, differs from `id`, and is free.
- `removeNode { id }`: removes the node, and when it is a group also every member; removes every edge touching any of them.
- `addEdge { edge, index? }`: inserts the edge. Rejected when the id exists or either end is missing.
- `removeEdge { id }`: removes it.
- `batch { ops }`: applies the ops in order; rejected as a whole if any op is rejected.
- Any other `type` is rejected.

### Rebuilding the old graph

1. Read the snapshot. Missing: start empty at version 0. Unreadable: start empty at version 0 and note it. Present without `version`: it is a **legacy snapshot**.
2. Read the journal line by line, skipping blank lines, and stop at the first line that is not valid JSON (the entries before it count; note the line number).
3. If the snapshot is a legacy snapshot and the journal has entries, the snapshot wins and the journal is ignored entirely.
4. Otherwise apply, in file order, every entry whose `version` is greater than the current version: apply `entry.op`; if the op is rejected, skip the entry and keep going; if it applies, the current version becomes `entry.version`.
5. The graph that results is what the old app would have shown.

### Normalising

- `output` becomes `videoOutput` when `data.kind` is `"video"`, else `imageOutput`, and `kind` is dropped from `data`. `text` becomes `textOutput`.
- Unknown node types are dropped (report).
- A node whose `parentId` names no node, or a node that is not a group, becomes top-level; its relative position is used as an absolute one, which is where the old app drew such an orphan (report).
- A member that cannot be a member (an output, a group, a page, a motion) becomes top-level at its absolute position (report).
- An id that does not match `^[\w-]+$` is replaced by a fresh minted `@id`; no text can reference it, so no text changes.
- Edges whose ends do not both exist are dropped.

### Mapping a project

Positions and sizes keep their numbers: an old top-left position is a new top-left position, and member positions stay relative to their group. Every old id that survives becomes the new shape's `@id` verbatim. No minted `@id` can equal an imported one: spec 02's `nextRef` mints one past the highest numeric ref and numeric `@` token on the canvas, which includes every imported one.

**Inputs**

- `prompt` becomes a prompt shape with the same `@id` and text. With `sized` true, it keeps its width and height as a fixed size; otherwise it hugs its text.
- `image` becomes an image shape naming a file, chosen in this order: `data.file` when that file exists in the folder; else the file extracted from a `data:` URL in `dataUrl`; else an empty image shape. A `data.file` that is missing on disk gives an empty shape (report). Width is the node's width (default 240); height is the width divided by the aspect ratio, taken from `data.aspect`, else the image file's pixel size (read from its PNG, JPEG, WebP or GIF header), else 1.
- `video` becomes a video shape the same way; an `https://` link in `dataUrl` becomes a linked reference clip in spec 04's form; the aspect ratio falls back to 16:9.
- `group` becomes a group with the same `@id`, bounds and members.
- A media shape whose file has a generation sidecar (below) is a result: it gets a result recipe from that sidecar, even when no output lists it.

**Artifacts**

- `page` and `motion` become page and motion shapes with the same `file`, `title`, `fileName` and dial values, and their size. A missing file gives spec 09's empty state (report).

**Outputs**

Outputs are processed top to bottom by position, ties left to right. For each output, its **sources** are the nodes with an edge into it, and the recipe comes from its data:

| old | recipe |
| --- | --- |
| `imageOutput` | `{ medium: "image", model: data.model or the default image model, params: { resolution, quality, aspect_ratio, background, output_format, size } (only keys that are set), runs: "free" when freeRuns, else runs (default 1) }`; `previewPrompt` is dropped: a Free recipe group always stops at spec 05's final prompt dialog (spec 06) |
| `videoOutput` | `{ medium: "video", model: data.videoModel or the default video model, params: { duration, resolution, aspect_ratio, size, generate_audio, inputMode, shareLocalVideos }, runs: 1 }`, with `generate_audio` from the old `generateAudio` (the video tray's name for it), `inputMode` default `"reference"` and `shareLocalVideos` default true |
| `textOutput` | `{ medium: "text", model: data.model or the default text model, params: {}, runs: 1 }` |

Where the recipe goes, first match wins:

1. **One group.** The sources are exactly one group, that group has no recipe yet and is not a source of any other output, and the output is not a text output with instructions. The group gets the recipe. (A text output's instructions are kept out of an existing group because they would change what `@group` means.)
2. **A box around the sources.** Every source is a top-level prompt, image, video or text output (a text output source counts as its text result shape), no source is a source of any other output, and the box the wrap rule of spec 06 would draw around them (grown by the instruction prompt, below, for a text output) overlaps no other top-level shape and no group created earlier in this import. A new recipe group is drawn around the sources.
3. **Where the output stood.** Otherwise, and for an output with no sources, a new recipe group is placed at the output's position with the output's size (default 320 by 200) and no members except the instruction prompt, below.

The new group's `@id` is the output's id for an image or video output (these ids were never referenceable, so nothing points at them), and a fresh minted `@id` for a text output (its id goes to its answer).

A **text output's instructions** (`data.text`, when not empty after trimming) become a prompt shape with a fresh minted `@id`, placed as a member of the output's recipe group, below its lowest member with a gap of 28 (at the box's top-left inside the 56 label margin when the box is empty); the box grows to hold it. The old app appended the instructions after the wired input, and being lowest in the box keeps that order.

**Results**

- An `imageOutput`'s `results` each name a file: the basename of `savedPath` when that file exists, else the file named at the end of a `/api/file/` URL, else the file extracted from a `data:` URL. A result whose file is on the canvas already as an image shape is that shape: it becomes a result in place. Every other result becomes a new image result shape. Missing files are counted and reported.
- A `videoOutput`'s `result` is handled the same way, as a video result shape.
- A `textOutput`'s non-empty `result` becomes a text result shape (spec 05) holding the answer, with the text output's id as its `@id`, so prompts that referenced the answer still resolve to it literally. An empty `result` gives no shape; tokens that referenced it stay as typed (report).
- New result shapes are placed at the output's position, left to right with a gap of 24, in `runIndex` order, 240 wide. When rule 3 put a recipe group at the output's position, the row starts 24 below that group.

**Result recipes.** Each result shape gets a result recipe in spec 03's form: medium, model and parameters from the file's sidecar when there is one, else from the output's data; the sources are the shapes that were wired into the output at import time; the instruction is empty; the selection prompt and references are empty; and it is marked `approximate: true` with `sentPrompt` set to the sidecar's `prompt` (the full text the old app sent), exactly spec 03's recipe schema. The importer never rewrites a sidecar, so the recipe is stored on the shape as spec 03's result meta `recipe` (the one case spec 03 allows), with `sidecar` naming the old sidecar or null. The old app did not record which shapes fed a run, only how many, so spec 03's rule for an approximate recipe applies: Regenerate opens the composer showing "Imported from the old app. It sent:" followed by `sentPrompt`, and sending uses its sources as they are now.

**In-flight runs**

- `running` on an image or text output is dropped: the request died with the old process (report).
- A `videoOutput`'s `job` is looked up by id in `jobs.json` among records for this project. `done` with a `savedPath`: the finished file becomes the video result (unless `data.result` already named it). `pending`: a render placeholder (spec 04) bound to that render job, carrying spec 03's durable run marker with `runId` the job id and `durable.params` from the record, so the sweep's finished file lands in it (report). `failed`: nothing is created (report with the error). Not found: nothing is created (report).
- The importer never writes `jobs.json`. It is the same store spec 04 keeps; pending records keep being swept whether or not a canvas shape points at them.

**Edges.** Every edge disappears. The count goes in the report.

### Generation sidecars (read, never written)

Each sits next to its file with the same base name and `.json`.

- Image generation, file `<ISO time>-<slug of prompt>[-<runIndex>][-<n>].<ext>`: `{ prompt, model, resolution, quality, aspect_ratio, output_format, background, referenceCount, references: { images, videos }, batchId, runIndex, runCount, cost, createdAt, file }`. Recognised by having `prompt` and `model` and no `source` and no `kind`.
- Video generation, file `<ISO time>-<slug>.mp4`: `{ kind: "video", prompt, model, duration, resolution, size, references, usage, cost, createdAt }`.
- Text run, no media file, named `<ISO time>-text-<slug>.json`: `{ kind: "text", prompt, model, result, referenceCount, references, batchId, cost, createdAt }`. A text result's recipe comes from the newest text sidecar whose `result` equals the answer exactly, else from the output's data and `cost`.
- Upload, copy or extraction, file `<epoch ms>-<slug of name>[-<n>].<ext>`: `{ source: "upload" | "copy" | "legacy-graph", fileName, mime, bytes, at, of? }`. Not a result.
- Agent page or motion, file `<epoch ms>-<slug of title>[-<n>].html`: `{ source: "agent", kind: "page" | "motion", threadId, turn, nodeId, title, bytes, at }`. Not a result.
- Motion render, file `<epoch ms>-<slug of title>.mp4`: `{ source: "render", of, title, mime: "video/mp4", fps: 30, quality: "standard", bytes, dials?, at }`. Not a paid result; the video shape naming it stays a plain video.
- Agent turn, `<epoch ms>-agent[-<n>].json`: `{ kind: "agent-turn", threadId, turn, provider, model, billing: "subscription", usage, estimatedUsd?, durationMs?, at }`. Ignored.

### `jobs.json` (read, never written)

At the output folder root, an array:

```ts
type LegacyJob = {
  id: string;               // the upstream video id
  project: string;          // the project folder name
  params: { prompt: string; model: string; duration?: number; resolution?: string; size?: string };
  startedAt: number;        // epoch ms
  status: "pending" | "done" | "failed";
  refs?: { images: number; videos: number; frames: number };
  savedPath?: string;       // done: the absolute path of the collected clip
  cost?: number;
  resolvedAt?: number;      // epoch ms
  error?: string;           // failed: why
  unreachableSince?: number; // epoch ms
};
```

An unreadable `jobs.json` is read as no records for the import (every `job` is reported as not found); the import does not fail over it.

### `threads/<id>.json` (not imported)

One file per chat: `{ id: "t-<base36>-<8 hex>", project, tags: string[], provider: "claude" | "codex", model, effort, mode?, status: "idle" | "running" | "failed", error?, title (60 characters at most), titledBy: "user" | "agent" | null, lastVersion, sdkSessionId?, pending?, grants?, messages: [{ role, text, at, turn, selection?, attachments? }], events: [{ seq, at, turn, type, ... }], seq, turns, createdAt, updatedAt }`, with event types `turn`, `session`, `tool_use`, `tool_result`, `ops_applied`, `api_retry`, `rate_limit`, `result`, `titled`, `error`, `permission_request`, `permission_result`. The new chat store (spec 07) is an event store with a different shape, and the old `sdkSessionId` values name provider sessions that may no longer exist. When `threads/` holds any file, the report says so.

### `presets.json` (old entries, read, never written)

At the output folder root, an array. Old entries have no `format` key:

```ts
type LegacyPreset = {
  id: string;               // "user-<base36 ms>"
  source: "user";
  savedAt?: string;         // absent on the earliest saves
  name: string;
  summary: string;
  type: "flow" | "block";   // several top-level nodes, or one
  kind: "image" | "video" | "text";
  needs?: string;
  fragment: { nodes: LegacyNode[]; edges: LegacyEdge[] }; // same node and edge shapes as graph.json
};
```

A fragment's media nodes name a `file` with no project (the old app looked for it in whatever project the preset was inserted into), or hold a `data:` URL, or an `https://` link. Fragments may hold run markers (`job`, `running`) and produced output (`results`, `result`) captured at save time.

### Converting an old preset

`library.list` (spec 06) returns, after the current-format entries, every old entry converted, marked `legacy: true` with `notes: string[]`. The file is never written in converted form; saves and deletes keep old entries as they are, except that deleting a converted preset removes its old entry by id.

1. Migrate legacy node types as in "Normalising". Drop run markers and produced output (note "Its old results were not kept." when there were any).
2. The **recipe output** is the output that is not a source of another output, the topmost if there are several (ties left to right). It gives the recipe by the table above, and the preset's `kind` is `"recipe"` with the recipe's medium. With no output, `kind` is `"group"`.
3. Other outputs: a text output that feeds another output keeps its instructions as a prompt and its non-empty answer as a text result with its id as `@id`, and loses its model (note "The text step @<id> lost its model. Run it with the composer."). Any other output is dropped (note "@<id>, a second <medium> output, was not kept.").
4. The recipe output, when it is a text output, adds its instructions as a prompt at the bottom of the preset's group, and its non-empty answer as a text result.
5. **The group.** When the fragment's only top-level input is one group, that group is the preset's group and keeps its `@id`; kept prompts from steps 3 and 4 go inside it below its lowest member. Otherwise a new group with `@id` the slug of the preset name (a minted one when empty) is wrapped around every kept top-level input by spec 06's wrap rule; members of other groups join it at their absolute positions (note "Group @<id> was flattened into the preset's group.").
6. Pages and motions are dropped (note "Pages and motions are not kept in a preset.").
7. Edges are dropped.
8. Media: a `file` becomes spec 02's portable pointer with an empty project, `preset-file:/<file>`, meaning that file name in whichever project the preset is inserted into; a `data:` URL is kept inline in the converted content (it never reaches the room: the insert extracts it through `library.copyFiles` first); an `https://` link becomes a linked reference clip.
9. `id`, `name`, `summary`, `needs` and `savedAt` are kept; `source` is `"user"`.

So an old flow with an output becomes a recipe group and an old block without one becomes a plain group. A block that is a single output (a lone text output, for example) has an output, so it becomes a recipe group.

`library.copyFiles` (spec 06) resolves `preset-file:/<file>` as `{ project: "", file }`, an empty project meaning the target project, copied like any other; and it gains one entry form for converted presets, `{ dataUrl }`, whose bytes are written into the target project with a sidecar `{ source: "legacy-preset", fileName: "", mime, bytes, at }`. A `data:` URL that does not parse as base64 answers `{ missing: true }`.

In the Library dialog a converted preset shows a line under its summary, in the supporting ink: "From the old app." followed, when there are notes, by " Not kept: " and the notes joined by a space.

### The report

Stored in the project database's `legacy_import_report` table with the import:

```ts
type ImportReport = {
  importedAt: string;
  source: { snapshotVersion: number | null; journalEntriesApplied: number; journalStoppedAtLine?: number };
  counts: { prompts: number; images: number; videos: number; groups: number; recipeGroups: number;
            results: number; pages: number; motions: number; wiresRemoved: number; filesExtracted: number };
  items: { section: "changed" | "notKept" | "missing"; text: string }[];
  seen: boolean;
};
```

RPC methods: `legacyImport.status({ project })` answers `none`, `pending` (an import is needed or running) or `failed` with the failure message, without starting an import, so the web can show the loading or failure state before it opens the canvas; `legacyImport.report({ project })` returns the report or `null` for a project that was never imported, running a pending import first; `legacyImport.markSeen({ project })`; `legacyImport.retry({ project })` reruns a failed import. A failed import is remembered until `retry`: every opener answers its message, with `details.reason` `legacy_import`.

The item texts, exactly (`<n>`, `<id>` and so on are filled in; `<medium>` is image, video or text):

- changed: "Wires are gone: the selection is the input now. <n> wires were removed." (only when n > 0)
- changed: "@<id> was an image output. It is now a recipe group around its <n> sources." (video and text alike, with their medium)
- changed: "@<id> was a <medium> output wired from @<group>. @<group> now holds its settings."
- changed: "@<id> was a <medium> output whose sources also fed other outputs, or could not be boxed cleanly. It is now a recipe group where it stood. Select it with its sources to run it."
- changed: "@<id> was a <medium> output with no sources. It is now a recipe group where it stood."
- changed: "@<id> was a text output. Its answer is now a text result with the same @id."
- changed: "Its instructions are now the prompt @<new id>." (follows the item above)
- changed: "@<id> had a render in flight. It is still tracked and lands here when it finishes."
- changed: "@<id> belonged to a group that no longer exists. It is now on the canvas at its old offset."
- changed: "@<id> was inside a group but cannot be a member here. It is now beside it."
- notKept: "@<id> was a text output with no answer yet. Prompts that mention @<id> now show the token as typed."
- notKept: "@<id> had a run in flight when the old app last saved. It was not resumed. Any image it finished is in the project folder."
- notKept: "@<id>'s render failed: <error>"
- notKept: "@<id> was waiting for a render the job store no longer knows about. Nothing was resumed."
- notKept: "A node of unknown type <type> (id <id>) was not imported."
- notKept: "graph.log has an unreadable line <n>. Changes after it were not imported."
- notKept: "graph.json could not be read, so the canvas was rebuilt from graph.log."
- notKept: "Old chats in threads/ are not shown in this version. Their files are still in the project folder."
- missing: "<Image|Video|Page|Motion> @<id> named <file>, which is not in the project folder. It is empty now."
- missing: "<n> results of @<id> are no longer in the project folder."

**Dialog.** The kit Dialog (spec 12), 520 px wide, with its title, description, panel and footer and no corner close. Shown when a project opens with a report whose `seen` is false; closing it calls `markSeen`, so it shows once across tabs. Title "Imported from the old Unframed". Body: "This project was made with an older version. Its canvas was rebuilt for this one. graph.json and graph.log are still in the project folder, unchanged. Undo history from the old app does not carry over." Then up to three sections, each shown only when it has items: "Changed", "Not kept", "Missing files". A primary button "Got it" in the footer. The project menu of an imported project has "Import report", which opens the same dialog.

After an import the canvas opens zoomed to fit its content.

## Testing Decisions

A good test gives old files in and asserts on what comes out: the rebuilt graph, the mapped canvas description, the report text, the records the engine then serves, and the bytes of the old files afterwards. No test reads the importer's intermediate state.

- **Domain seam** carries almost every rule, because the reader, normaliser, mapper and converter are pure: each op's semantics and rejections, replay order and skipping, the legacy-snapshot rule, the unreadable-line stop, type migration, orphan and bad-member repair, every input mapping (file, data URL, link, missing), aspect fallbacks, each output rule (one group, box, where it stood, no sources) including overlap refusals and shared sources, instruction placement, result dedupe and placement, text result `@id`, result recipes from each sidecar kind, in-flight handling for each job status, the report strings, determinism (map twice, compare), and every preset conversion step.
- **Engine seam** carries the file behaviour: copy the samples into a temp output folder, open a project over RPC or the sync socket, and assert the canvas records, the report, that every old file is byte-identical afterwards, that extracted files and their sidecars exist with deterministic names, that a second open does not import again, that a leftover temporary file from a simulated crash is cleaned and the import completes, that a failed import writes no database and `retry` succeeds once the cause is fixed, that `library.list` returns converted old presets without changing `presets.json`, and that `library.copyFiles` handles both legacy forms.
- **Browser seam** carries what the person sees: the loading line, the report dialog once and its sections, "Import report" in the project menu, the failure message and Try again, converted presets in the Library with their note, inserting one, deleting one, a recipe group from an old output running from the toolbar with the stub receiving the old model and parameters.

Prior art: the old app tested its graph ops by round-tripping each op through its inverse, and its document store by forking the real server on a temp folder. The samples in `assets/legacy-samples/` are the fixtures for all three seams; tests copy them, never edit them in place.

## Tasks

1. Legacy op vocabulary: `addNode`, `updateNode`, `moveNode`, `resizeNode` apply and reject as specified. Seam: domain.
2. `reparentNode`, `renameNode`, `removeNode` (group cascade), `addEdge`, `removeEdge`, `batch` (all or nothing), unknown op rejected. Seam: domain.
3. `rebuild`: snapshot then journal entries above its version, rejected entries skipped, stop at the first unparsable line with its number. Seam: domain.
4. `rebuild`: legacy snapshot with a journal ignores the journal; unreadable snapshot rebuilds from the journal; missing both is empty. Seam: domain.
5. `normalise`: `output` and `text` types migrated, unknown types dropped, transient keys ignored, dangling edges dropped. Seam: domain.
6. `normalise`: orphan members and non-groupable members repaired with their report items; bad ids re-minted. Seam: domain.
7. Import trigger: a folder with `graph.json` and no `unframed.sqlite` is imported on first open through the one opener, whatever opened it. Seam: engine.
8. Loading state "Importing from the old Unframed…" while the import runs; a second open waits for the first. Seam: browser.
9. Atomic write: the database appears only complete; a leftover temporary file is removed and the import reruns. Seam: engine.
10. Never rewrite: every old file is byte-identical after import. Seam: engine.
11. Once: a second open, and an open after `graph.json` changes, do not import. Seam: engine.
12. Failure: no database, the failure message with "Try again", and `legacyImport.retry` succeeds after the cause is removed. Seam: browser.
13. Prompts map with the same `@id`, text, and fixed or hugging size; the minter never reissues an imported `@id`. Seam: domain.
14. Images map by file, by extracted data URL, or empty; missing files reported; aspect from data, header, or 1. Seam: domain.
15. Data URL extraction writes deterministic `legacy-<hash>-<slug>` files with sidecars and reuses them on retry. Seam: engine.
16. Videos map by file, link clip, extracted data URL or empty, aspect falling back to 16:9. Seam: domain.
17. Groups map with `@id`, bounds and members; `data.name` ignored. Seam: domain.
18. Pages and motions keep file, title, fileName and dial values; a missing file shows spec 09's empty state. Seam: domain.
19. Output recipe mapping for image, video and text outputs, including defaults and the Free and final-prompt settings. Seam: domain.
20. Rule 1: an output wired from one unclaimed group puts its recipe on that group; a text output with instructions does not. Seam: domain.
21. Rule 2: a recipe group is drawn around unshared, cleanly boxable sources with the output's id as `@id`. Seam: domain.
22. Rule 2 refusals: shared sources, overlap with another shape, overlap with an earlier import group. Seam: domain.
23. Rule 3: a recipe group where the output stood, for refused and unwired outputs. Seam: domain.
24. Text output instructions become a minted prompt at the bottom of its recipe group, growing the box. Seam: domain.
25. Text output answer becomes a text result with the output's id; an empty answer leaves tokens as typed and is reported. Seam: domain.
26. Image results: file resolution order, dedupe against image shapes on the canvas, row placement in `runIndex` order, missing counted. Seam: domain.
27. Video result from `data.result`, deduped the same way. Seam: domain.
28. Result recipes from image, video and text sidecars, marked legacy with `sentPrompt`, sources as wired at import. Seam: domain.
29. A media shape whose file has a generation sidecar becomes a result even when no output lists it; upload, render and agent sidecars do not. Seam: domain.
30. Regenerate on an imported result shows "Imported from the old app. It sent:" with the sent prompt, and sending runs from current sources. Seam: browser.
31. In-flight: `running` dropped and reported; `job` done, pending, failed and not found each handled as specified. Seam: domain.
32. A pending imported render lands in its result shape when the stubbed sweep finishes it. Seam: engine.
33. An unreadable `jobs.json` does not fail the import. Seam: engine.
34. Edges disappear and their count is reported. Seam: domain.
35. Mapping is deterministic: the samples map to the same description twice. Seam: domain.
36. Report: every item string, counts, sections; stored with the import; `legacyImport.report` and `markSeen`. Seam: engine.
37. Report dialog shows once across reloads and tabs, with its sections, and "Import report" in the project menu reopens it. Seam: browser.
38. The chats line appears when `threads/` holds files; the files stay untouched. Seam: engine.
39. The canvas opens zoomed to fit after an import. Seam: browser.
40. `convertPreset`: recipe output choice, recipe mapping, kind and medium. Seam: domain.
41. `convertPreset`: feeding text steps, extra outputs, pages and motions, results and run markers, each with its note. Seam: domain.
42. `convertPreset`: one group kept as the preset group; otherwise a new group named from the preset, with other groups flattened. Seam: domain.
43. `library.list` appends converted old presets marked legacy with notes and leaves `presets.json` byte-identical. Seam: engine.
44. `library.copyFiles` resolves `preset-file:/<file>` in the target project and accepts `{ dataUrl }`, with the `legacy-preset` sidecar and `missing` for bad data. Seam: engine.
45. Library shows a converted preset with "From the old app." and its notes; Add inserts it; delete removes its old entry only. Seam: browser.
46. End to end: the sample project's recipe group from an old image output runs from the toolbar, and the stub receives the old model and parameters. Seam: browser.

## Out of Scope

- **Old chats.** `threads/*.json` are not imported into the new chat store. They stay on disk and the report says so.
- Old undo history. The journal is replayed to rebuild the graph and is not turned into undo steps.
- Writing anything back to the old files, and any path back from the new canvas to `graph.json`.
- An import menu action, a re-import, or merging an old graph into an already-imported canvas.
- Resuming an image or text request that was in flight in the old app.
- Importing `.env` (spec 01 and spec 10 read the same file) and `jobs.json` (spec 04 reads the same store).
- Old generated motion support files (`hyperframes-viewer.html` and the rest); spec 09 writes its own.
- The old viewport; the canvas opens zoomed to fit.

## Further Notes

- Why automatic on first open: the project list already shows old folders (a project is a folder), so opening one must show its content. Anything else leaves an empty canvas that invites edits a later import would collide with.
- Why presets convert on read and are never written: the old app kept `presets.json` deliberately unmigrated for the same reason spec 06 gives for its write rule. Converting on read is idempotent by construction, a conversion bug is fixed by shipping a fix rather than by repairing files, and the old app can still read the file.
- Why an image or video output's id becomes its recipe group's `@id`: those ids were never referenceable, so reusing them breaks nothing, and the report can name the same thing the person saw.
- Why a text output's instructions stay out of an existing group: a group's prompt members are what `@group` means, and adding one would change the text every prompt that mentions the group resolves to.
- Imported result recipes are approximate by necessity: the old app recorded how many references a run sent, never which ones.

### Assets this spec needs

`assets/legacy-samples/` holds old-format files, used as fixtures by all three seams. The coordinator writes them by hand in the formats above; nothing comes from old source. They must contain:

- `graph.json` for one project (`everything/`), with `version` set, covering: a prompt that hugs and a prompt with `sized: true`; prompts that reference another prompt, a text output, a group, and an unknown token; an image with `file`; an image with a small inline PNG `data:` URL; an empty image; an image whose `file` is missing on disk; a video with `file` and one with an `https://` link; a group with a prompt and an image member (and a stray `data.name`); a legacy `output` with `kind: "image"` and one with `kind: "video"`; a legacy `text`; an `imageOutput` with `results` (one of them also on the canvas as an image node, one whose file is missing) wired from loose unshared sources; a Free `imageOutput` wired from a text output and an image that also feeds that text output (the Layerize shape); a `videoOutput` with a `result`, and one with a `job` that `jobs.json` lists as pending; a `textOutput` with instructions and an answer; a `textOutput` with an empty answer that a prompt references; an output wired from exactly one group; an unwired output; an `imageOutput` with a `running` marker; a page with `dials`; a motion; a member whose group is missing; a node of an unknown type; edges with and without `animated`, one with `sourceHandle`; stale `selected`, `dragging`, `measured` and `extent` keys.
- `graph.log` for that project with entries above the snapshot's version: an `addNode`, a `batch`, a `renameNode` of a group, an undo entry (`undoes`), one entry whose op is rejected, and a last line that is not valid JSON.
- The media files that graph names (tiny PNGs, a tiny MP4, a page `.html`, a motion `.html`) with their sidecars: an image generation sidecar for each result, a video generation sidecar, a text run sidecar matching the answer, upload sidecars for the inputs.
- `jobs.json` at the samples root with a pending record for the `videoOutput`'s job and a failed record.
- `threads/` in that project with one old thread file.
- A second project (`legacy-snapshot/`) whose `graph.json` has no `version`, beside a non-empty `graph.log`.
- A third project (`broken-snapshot/`) whose `graph.json` is not valid JSON, beside a `graph.log` that rebuilds it.
- `presets.json` at the samples root with: one flow with an output (planner prompt, text output, Free image output, empty image: the old Layerize shape), one block without an output (a group `character` with a prompt and an image member), one block that is a lone text output with instructions, one entry whose image holds a `data:` URL, and one entry in spec 06's current format to prove mixed files work.
