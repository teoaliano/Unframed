# motion_write

Used by spec 07's Unframed MCP server and spec 09. The model-facing description of `motion_write`, its HyperFrames composition contract included, and its three arguments.

The full description is the text below, one space, the text of `dials-contract.md`, one space, then the text of `dials-timeline.md`. No placeholders.

Source: the old app's `ARTIFACTS.motion.describeWrite` and the argument descriptions in `artifactTools`, `server/agentTools.js`. Verbatim, with the `nodeId` argument renamed `shapeId` (spec 07).

```text
Create a motion asset -- a HyperFrames composition, an HTML video -- or write a new version of one. `html` is a complete HTML document that follows the HyperFrames contract: the root is <div id="root" data-composition-id="main" data-start="0" data-duration="SECONDS" data-width="PX" data-height="PX"> (data-duration is the render length; size #root to those pixels with overflow hidden); every timed element inside it has an id, class="clip", data-start and data-duration in seconds (.clip is position:absolute; inset:0 -- a full-frame box you lay out inside); <video>, <audio> and <img> clips reference the project's files by the exact names canvas_read reports (they sit beside the composition); a <video> gets muted playsinline, and data-has-audio="true" when its sound should be heard; animation is ONE paused GSAP timeline, registered synchronously: window.__timelines = window.__timelines || {}; window.__timelines.main = gsap.timeline({ paused: true }); give tweens explicit positions and prefer fromTo(); load GSAP with <script src="gsap.js"></script> -- it sits beside the composition -- and nothing else external except the engine's component pins: no CDNs, fonts or remote images. Never call play(), pause() or set currentTime on media; no wall-clock time, no unseeded randomness, no infinite repeats. The HyperFrames runtime is added to the file for you. Files are never overwritten -- every write is a new version the person can undo. Omit shapeId to create a motion beside the current selection; pass it to update that motion. The person renders it to an MP4 from the node. The engine stamps every element with a data-hf-id on each write: keep each one on its element when you rewrite it, and never invent, copy or change one. Keep data-uf-name and data-uf-hidden on the element they belong to. Elements the person locked must stay exactly as they are: a write that changes one is refused, so leave them alone and change the rest. Use instances of the project's components instead of copying their markup, as canvas_read lists them: write an instance with its tag, such as <uf-button kind="primary">. Never write the pin yourself; the engine adds one for each tag you use and keeps the pins when you rewrite. An instance's insides cannot be styled or selected from the page, but you can animate an instance as one element or through a custom property it exposes. Write each tween as its own call on `window.__timelines.main`, never chained onto `gsap.timeline()`: the editor's timeline reads only tweens called on a named timeline, so a chained tween shows no row and plays as written.
```

## Arguments

- `html`: The whole HTML document.
- `shapeId`: The motion shape to update. Omit to create a new motion.
- `title`: A short name for the motion, shown on the canvas.
