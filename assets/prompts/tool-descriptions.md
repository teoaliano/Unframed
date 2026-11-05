# Canvas tool descriptions

Used by spec 07's Unframed MCP server. These are the model-facing descriptions of the canvas tools. This file holds `canvas_read`, `canvas_write` and spec 16's `node_run`. The four artifact tools each have one home in spec 09's files, listed at the end; spec 07 uses those same files. Spec 09's preview tools are in `preview-tool-descriptions.md`.

Source: the old app's `canvasTools` in `server/agentTools.js`. `canvas_read` and `canvas_write` are rewritten for tldraw shapes and spec 07's op vocabulary, with spec 16's nodes and wires in place of the old output nodes and edges. Each op names itself in a `type` field, as the old ops did. The `ops` argument description is verbatim.

## canvas_read

No arguments.

```text
Read the whole canvas: every shape with its id, kind, ref (its @id), position, size, text or file, and which shape ids the person had selected when they sent the latest message. A shape with parent sits inside that group, positioned relative to it. A result carries the recipe that made it. A component shape reports its tag, variants, properties and slots, and a page or motion that uses one lists it as `components`, with `current` false where an update waits. A page or motion with locked elements reports them as `lockedElements`. A page or motion drawn smaller or larger on the canvas reports its `scale`: it lays out at its size divided by that scale. A node reports its medium, model, provider (only when it is vercel), params, runs, instruction, status (not_run, running, failed, waiting, out_of_date or ready, with statusLine saying why), how many versions it holds and its current result; a wire reports from, to and its role. Call this before answering anything about what is on the canvas, and before any change.
```

## canvas_write

```text
Change the canvas with one batch of operations, applied all or nothing, as one step of this turn that the person can revert. Ops: {type:"create", id, kind, x, y, w?, h?, parent?, props} -- use an id like "new:hero" and the result tells you the real id; {type:"update", id, props} -- a shallow patch onto the shape's props, null deletes a key; {type:"move", id, x, y} ; {type:"resize", id, w, h} ; {type:"delete", id} -- deleting a group deletes its members ; {type:"reparent", id, parent} -- into a group, or null to take it out ; {type:"rename", id, name} -- renames a prompt, image, video, audio, page, motion, node or group and rewrites every @ reference to it. Kinds: prompt (props.text), image and video (props.file names an existing project file, or props.url for a clip link), audio (props.file names an existing project file), group (props.name), mark (props.type is geo, note, arrow or line, plus that tldraw type's own props). node (props.medium is image, video, text, audio or page; model, params, runs and instruction are optional, and an image or text node also takes props.provider, openrouter or vercel) and wire (props.from is the shape that feeds it, props.to is a node, props.role is prompt, reference, first, last, or for a page both; a page wire also takes props.files, entry or linked). A node's versions, current version, run and error are written by its runs, never here; run a node with node_run. Deleting a shape deletes its wires. Make pages and motions with page_write and motion_write, and components with component_write, not here. To draw a page or motion smaller or larger on the canvas without changing its layout, update its scale (0.1 to 4, null for 100%) without w or h; its size on the canvas follows. A scale below 1 never lays a page out wider or taller than 4096 px, so a smaller one is raised to keep it so. lockedElements belongs to the person (the editor's Layers tab), so never set it. Never put bytes or data: URLs in shape props. At most 200 ops per call.
```

Arguments:

- `ops`: The operations, in order.

## node_run

```text
Run one node, or several as a chain in dependency order, each step a paid generation the person pays OpenRouter or the Vercel AI Gateway for, as the node's provider says. A node's inputs are the shapes wired into it, and its result lands inside it as a new version; nodes after it take that result through their wires. Call it with dryRun true first to see each step's prompt, references and estimate, then again to run. downstream with one id also runs the nodes after it that failed, are waiting, are out of date or never ran. A chain stops at the first step that fails, and the steps after it do not run. A node that needs a sketch or a marked picture cannot be run from here: the answer says so, and the person runs it from its card. The answer comes once the steps are queued; follow it with canvas_read.
```

Arguments:

- `ids`: The node ids to run, as canvas_read names them.
- `downstream`: Also run the nodes after it that failed, are waiting, are out of date or never ran.
- `dryRun`: Only show each step's prompt, references and estimate.

## The artifact tools

Each description lives in one file. Build the full text as each file says.

- `page_write`: `page-write-tool.md`, followed by `dials-contract.md`.
- `motion_write`: `motion-write-tool.md`, followed by `dials-contract.md`, then `dials-timeline.md`.
- `page_edit` and `motion_edit`: their sections of `artifact-edit-tools.md`, each alone.
- `page_read` and `motion_read`: `artifact-read-tools.md`.
