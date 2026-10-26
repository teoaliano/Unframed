# page_read and motion_read

Held in `packages/domain/src/artifacts/prompts.ts`. The model-facing descriptions of the two read tools and their one argument. No placeholders.

Source: the old app's `ARTIFACTS.page.describeRead`, `ARTIFACTS.motion.describeRead` and the argument description in `artifactTools`, `server/agentTools.js`. Verbatim, with the `nodeId` argument renamed `shapeId`.

## page_read

```text
Read the current HTML of a page asset, so an edit starts from what is there.
```

- `shapeId`: The page shape.

## motion_read

```text
Read the current HTML of a motion asset (its HyperFrames composition), so an edit starts from what is there.
```

- `shapeId`: The motion shape.
