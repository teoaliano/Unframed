# Canvas tool descriptions

Used by spec 07's Unframed MCP server. These are the model-facing descriptions of the canvas tools. This file holds `canvas_read` and `canvas_write`. The four artifact tools each have one home in spec 09's files, listed at the end; spec 07 uses those same files. Spec 09's preview tools are in `preview-tool-descriptions.md`.

Source: the old app's `canvasTools` in `server/agentTools.js`. `canvas_read` and `canvas_write` are rewritten for tldraw shapes and spec 07's op vocabulary: no nodes, no edges, no output nodes. Each op names itself in a `type` field, as the old ops did. The `ops` argument description is verbatim.

## canvas_read

No arguments.

```text
Read the whole canvas: every shape with its id, kind, position, size, text or file, and which shape ids the person had selected when they sent the latest message. A shape with parent sits inside that group, positioned relative to it. A result carries the recipe that made it. Call this before answering anything about what is on the canvas, and before any change.
```

## canvas_write

```text
Change the canvas with one batch of operations, applied all or nothing, as one step of this turn that the person can revert. Ops: {type:"create", id, kind, x, y, w?, h?, parent?, props} -- use an id like "new:hero" and the result tells you the real id; {type:"update", id, props} -- a shallow patch onto the shape's props, null deletes a key; {type:"move", id, x, y} ; {type:"resize", id, w, h} ; {type:"delete", id} -- deleting a group deletes its members ; {type:"reparent", id, parent} -- into a group, or null to take it out ; {type:"rename", id, name} -- renames a group and rewrites every @ reference to it. Kinds: prompt (props.text), image and video (props.file names an existing project file, or props.url for a clip link), group (props.name), mark (props.type is geo, note, arrow or line, plus that tldraw type's own props). Make pages and motions with page_write and motion_write, not here. Never put bytes or data: URLs in shape props. At most 200 ops per call.
```

Arguments:

- `ops`: The operations, in order.

## The artifact tools

Each description lives in one file. Build the full text as each file says.

- `page_write`: `page-write-tool.md`, followed by `dials-contract.md`.
- `motion_write`: `motion-write-tool.md`, followed by `dials-contract.md`, then `dials-timeline.md`.
- `page_read` and `motion_read`: `artifact-read-tools.md`.
