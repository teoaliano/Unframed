# Canvas polish: leftover selection chrome, media tooltips, a node-native player, and lassoing connectors

*2026-08-18*

## Why

Four complaints from using the packaged app, unrelated in cause but all of the same
kind: the canvas shows something it should not, or refuses a gesture the rest of it
accepts.

- A blue rectangle stays on screen after a box-select is released.
- Hovering a picture raises a tooltip nobody asked for — and in the packaged Electron
  app it lands in a corner of the window rather than on the picture.
- An image node can be picked up by its picture. A video node cannot be picked up by
  its clip.
- Selecting several connections means shift+clicking each one, which is a precise
  click on a thin curve.

They are grouped here because they are all the canvas's interaction surface, and the
canvas-interaction spec (`2026-08-18-canvas-interaction-design.md`) is where that
surface was last reasoned about. Read it first; this one assumes its two rules —
**the whole card is the drag surface** and **controls opt out with `nodrag`**.

## 1. The rectangle that stays after release

The leftover box is React Flow's `.react-flow__nodesselection-rect`: the handle it
draws around a multi-node selection so the group can be dragged as one.

**It is a hitbox, not a decoration.** It spans the bounding box of the whole selection
— every gap and every patch of empty canvas between the outermost nodes included — and
it sits above the pane. Styling away its border and background would leave an invisible
rectangle that keeps eating presses on empty canvas, which is precisely the failure the
canvas-interaction spec was written about: a gesture the canvas silently ignores, with
nothing on screen to explain it. So the element goes, not its paint:

```css
.react-flow__nodesselection { display: none; }
```

**Group dragging survives.** React Flow's node drag handler collects every selected
node when the one under the pointer is selected, so dragging any member still moves the
whole group. The rect was the second way to do it, not the only one.

**What is actually lost**, and is accepted rather than rebuilt: arrow-key nudging of a
multi-selection. Its `onKeyDown` lives on that rect and its `tabIndex` is what made the
rect focusable, so both go with it. Nobody has asked for it, and re-implementing it
would mean a keyboard handler on the pane that has to not fire while a text area has
focus — more surface than the feature is worth.

## 2. Tooltips on media

Astryx's `Thumbnail` takes a `label`, and `label` is exactly what wraps it in a
`Tooltip`. Two call sites pass one: the reference picture in `ImageNode` and each
generated result in `ImageOutputNode`'s strip. Dropping the prop removes the tooltip.

**Nothing accessible is lost.** Thumbnail's accessible name falls back to `alt` when
`label` is absent, and both call sites already pass an `alt` — the filename for a
reference, `generated result N` for a result.

The reference clip in `VideoNode` carries the same information as a native
`title="<filename>"` on the `<video>`. It goes too, for consistency: a native tooltip
is drawn by the OS and so is not subject to the mispositioning below, but it is the
same hover noise on the same kind of node.

**Why the mispositioning matters here.** An Astryx tooltip is anchor-positioned, and
where the anchor fails to resolve it renders at a corner of the viewport instead of on
its trigger — the same defect that keeps the output nodes' parameter controls on native
`<select>` elements (see `client/.claude/CLAUDE.md`). Removing these tooltips is wanted
on its own terms; that it also removes an instance of that bug is the reason it is
worth doing now rather than waiting for anchor positioning to become reliable.

## 3. A node-native video player

### The conflict, and why it has only one honest resolution

A `<video controls>` cannot be both a drag surface and a scrub surface. Its controls
live in shadow DOM, so a press on the timeline retargets to the `<video>` element
itself: the event that reaches React Flow is indistinguishable from a press on the
frame. Nothing downstream can tell a scrub from a drag, which is why the clip carries
`nodrag` today and why an image, which has no controls, does not.

The conflict exists only because the controls are *inside* the video element. Moving
them out dissolves it.

### The shape

A new `client/src/nodes/VideoPlayer.jsx`:

- The `<video>` has no `controls` and no `nodrag`. The frame becomes an ordinary drag
  surface, exactly like a picture, which is the whole point of the change.
- A control row underneath carries `nodrag`: play/pause, an Astryx `Slider` for
  position, and a `0:04 / 0:12` readout. That is the same opt-out every other control
  in a node uses, so dragging the scrub thumb moves the playhead and never the node.
- `onLoadedMetadata` sets the duration, `onTimeUpdate` drives the slider, and the
  slider's `onChange` writes `currentTime` back. `timeupdate` fires roughly four times
  a second, which is enough for a scrubber; a `requestAnimationFrame` loop would be
  smoother and is not worth a running frame loop per node on the canvas.
- The Slider is given `valueDisplay="none"`. Its default is a value bubble built on
  `Tooltip`, and section 2 explains why an anchored tooltip inside a node is a thing to
  avoid in this app.

**Both video nodes use it** — the reference clip in `VideoNode` and the result player
in `VideoOutputNode`. One component with two call sites is the right side of the line
that `output/core.js` drew: the alternative is two players that drift, and the drift
would be in exactly the drag behaviour this change exists to fix.

### Two side effects taken deliberately

- **`nowheel` goes with `controls`.** It was there so the player's own controls could be
  worked without the canvas panning underneath. With no native controls, keeping it
  would mean scrolling over a clip does nothing at all, while scrolling anywhere else
  pans. Dropping it makes a clip behave like the rest of the canvas.
- **The dev guard's element list changes.** `client/src/debug/nodragCheck.js` lists
  `video` among the elements that must sit under a `.nodrag`, and after this change
  that is backwards: the video is deliberately outside one, and leaving it listed would
  make the guard warn on every video node forever — which is how a guard stops being
  read. `video` comes off the list. The controls that replace it are a `button` and a
  Slider, and the button is still covered by the list.

### The risk worth naming

A `<video>` with no `controls` shows nothing at all until the browser has decoded a
first frame, so a clip could render as an empty box where it used to render as a
player. Verified in the running app, per `CLAUDE.md`'s rule that node components have
no tests by design. If it does render blank, the fix is a `#t=0.1` media fragment on the
`src` to force a frame, added then and not before.

## 4. Lassoing connectors

### What already happens

React Flow's box-select is not blind to edges: as the rectangle is dragged it selects
every edge connected to a selected node — either endpoint is enough. The gap is
narrower than it looks, and it is this: a rectangle drawn across a connector in empty
canvas, touching neither of its nodes, selects nothing.

Two changes close it, and the first is nearly free.

### `selectionMode="partial"`

By default a node must be **entirely** inside the rectangle to be selected. In partial
mode it need only touch. That alone fixes the common case — a box drawn across a
connector usually clips the corner of the nodes at each end — and it makes box-select
behave the way every other canvas tool does. One prop on `<ReactFlow>`.

### Hit-testing the drawn path

For the rest, a new `client/src/graph/edgeHits.js`, in the same shape as the other
modules in that folder: the pure part is the module and is tested, the DOM part is thin
and lives at the call site.

- `hitEdges(rect, paths)` takes a rectangle in flow coordinates and, per edge, a list
  of sampled points along it. It returns the ids of edges with at least one point
  inside the rectangle. That is all the geometry there is.
- `App.jsx` supplies the two halves. `onSelectionStart` reads the rectangle's origin off
  the React Flow store — `useStoreApi().getState().userSelectionRect`, whose
  `startX`/`startY` are already flow coordinates — rather than off the pointer event:
  the pointer has already travelled past the origin by the time the gesture is
  recognised as a selection. `onSelectionEnd` converts the release point with
  `screenToFlowPosition`. Each edge's drawn `<path>` is then sampled with
  `getTotalLength`/`getPointAtLength`, whose coordinates are already flow coordinates
  because the SVG sits inside the viewport transform.

**Sample the path, not its bounding box.** A bounding box is three lines instead of
five and is wrong in a way that would be blamed on the canvas rather than on the code:
a long diagonal connector has a bounding box covering a large empty region, so a
rectangle drawn nowhere near the curve would select it. Twenty-odd samples per edge
over a few tens of edges is not a cost worth optimising against correctness.

**Marking is additive.** React Flow applies its own selection during the drag, and
`onSelectionEnd` runs after it on pointer-up, so the lassoed connectors join whatever
the box already selected rather than replacing it. Nothing about node selection changes.

`edgeHits.test.js` joins `npm test`: a rectangle crossing a diagonal polyline hits, and
one placed just beside the same polyline — inside its bounding box, off the curve —
misses. That second case is the one that fails if anyone later swaps sampling for a
bounding box.

## Also

`.xnode-video` is defined twice in `styles.css`, at lines 430 and 657. The second is
dead. It goes, since this change is already in that rule.

## Rejected

- **Hiding the group-selection rect with CSS rather than removing it.** Leaves an
  invisible hitbox over the empty canvas inside a selection; see section 1.
- **Gating the video drag on where the press landed.** Toggling `nodrag` on mousedown
  depending on whether the pointer is in the bottom control strip preserves both native
  scrubbing and dragging, and needs a pixel height that has to be scaled by the canvas
  zoom and that changes with the platform's control chrome. It breaks silently and in a
  way that reads as the canvas being flaky. The custom player costs more lines and has
  no magic number.
- **Dropping playback from reference clips entirely** (a muted preview frame, like a
  picture). Whole-surface dragging for free, but you could no longer tell which clip a
  reference holds beyond its first frame.
- **A `requestAnimationFrame` loop for the scrubber position.** Smoother than
  `timeupdate` and not worth a frame loop per video node on a canvas.
- **Rebuilding arrow-key nudging** of a multi-selection after the group rect is
  removed; see section 1.
- **Bounding-box hit-testing for edges.** Over-selects on diagonals; see section 4.
