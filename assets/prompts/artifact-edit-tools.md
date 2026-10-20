# page_edit and motion_edit

Used by spec 07's Unframed MCP server and spec 09. The model-facing descriptions of the two edit tools and their arguments. Each description is the text of its section alone: the dials contract and the performance paragraph already reach the model through `page_write` and `motion_write`. No placeholders.

Source: new in Unframed, after the `edit_design` tool of vercel-labs/fx0 (Apache-2.0), which applies exact string replacements to its HTML instead of rewriting the document. Adapted, not verbatim.

## page_edit

```text
Change part of an existing page asset by exact string replacement, without sending the whole document. Use it for localized changes: a piece of copy, a colour, a size, one section, the unframed.dials call. Put every change a request needs in ONE call: `edits` is a list of { old_string, new_string } applied in order, each to the text the edits before it left. Each old_string must match exactly once, so include enough surrounding text to make it unique; if any edit matches zero times or more than once, nothing is written and the error names the edit. Use page_write instead for a new page or a broad rewrite, and page_read first when you do not know the exact current text. The result is held to page_write's rules (self-contained, nothing external loads) and is a new version the person can undo. An edit may change the dials call; the values the person set live on the shape, not in the file, so they still apply to what you write.
```

- `shapeId`: The page shape to edit.
- `edits`: The changes, applied in order: 1 to 20 { old_string, new_string }.
- `old_string`: Text that is in the page now, exactly once, whitespace included.
- `new_string`: The text that replaces it. Empty deletes it.
- `title`: A new short name for the page, shown on the canvas. Omit to keep the current one.

## motion_edit

```text
Change part of an existing motion asset (its HyperFrames composition) by exact string replacement, without sending the whole document. Use it for localized changes: a piece of copy, a colour, a timing, one clip, the unframed.dials call. Put every change a request needs in ONE call: `edits` is a list of { old_string, new_string } applied in order, each to the text the edits before it left. Each old_string must match exactly once, so include enough surrounding text to make it unique; if any edit matches zero times or more than once, nothing is written and the error names the edit. Use motion_write instead for a new motion or a broad rewrite, and motion_read first when you do not know the exact current text. The result must still follow the HyperFrames contract motion_write describes and its rules (load only gsap.js, nothing else external), and is a new version the person can undo. An edit may change the dials call; the values the person set live on the shape, not in the file, so they still apply, and a parameter the timeline is built from stays built into it.
```

- `shapeId`: The motion shape to edit.
- `edits`: The changes, applied in order: 1 to 20 { old_string, new_string }.
- `old_string`: Text that is in the motion now, exactly once, whitespace included.
- `new_string`: The text that replaces it. Empty deletes it.
- `title`: A new short name for the motion, shown on the canvas. Omit to keep the current one.
