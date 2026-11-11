# page_write

Used by spec 07's Unframed MCP server and spec 09. The model-facing description of `page_write` and its three arguments.

The full description is the text below, one space, then the text of `dials-contract.md`. No placeholders.

Source: the old app's `ARTIFACTS.page.describeWrite` and the argument descriptions in `artifactTools`, `server/agentTools.js`. Verbatim, with the `nodeId` argument renamed `shapeId` (spec 07).

```text
Create a page asset or write a new version of one. `html` is the complete, self-contained HTML document: inline its style and script; reference the project's images and clips by the exact file names canvas_read reports (they sit beside the page, so a plain relative name works); nothing external loads, except the engine's component pins. Files are never overwritten -- every write is a new version the person can undo. Omit shapeId to create a page beside the current selection; pass it to update that page. The engine stamps every element with a data-hf-id on each write: keep each one on its element when you rewrite it, and never invent, copy or change one. Keep data-uf-name and data-uf-hidden on the element they belong to. Elements the person locked must stay exactly as they are: a write that changes one is refused, so leave them alone and change the rest. Use instances of the project's components instead of copying their markup, as canvas_read lists them: write an instance with its tag, such as <uf-button kind="primary">. Never write the pin yourself; the engine adds one for each tag you use and keeps the pins when you rewrite. An instance's insides cannot be styled or selected from the page.
```

## Arguments

- `html`: The whole HTML document.
- `shapeId`: The page shape to update. Omit to create a new page.
- `title`: A short name for the page, shown on the canvas.
