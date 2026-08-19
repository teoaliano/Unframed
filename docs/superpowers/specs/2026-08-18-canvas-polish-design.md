# Canvas polish: selection chrome, media tooltips, a node-native player, lassoing connectors, connection aim, and remembered field sizes

*2026-08-18*

## Why

Seven complaints from using the packaged app, unrelated in cause but all of the same
kind: the canvas shows something it should not, or refuses a gesture the rest of it
accepts.

- Hovering a picture raises a tooltip nobody asked for — and in the packaged Electron
  app it lands in a corner of the window rather than on the picture.
- An image node can be picked up by its picture. A video node cannot be picked up by
  its clip.
- Selecting several connections means shift+clicking each one, which is a precise
  click on a thin curve.
- Handles are small, and a connection must be dropped almost exactly on one.
- A resized prompt or text field snaps back to its default on every reload and every
  project switch.

They are grouped here because they are all the canvas's interaction surface, and the
canvas-interaction spec (`2026-08-18-canvas-interaction-design.md`) is where that
surface was last reasoned about. Read it first; this one assumes its two rules —
**the whole card is the drag surface** and **controls opt out with `nodrag`**.

## 1. The rectangle that stays after release

This rule is not owned here. `docs/superpowers/specs/2026-08-18-shift-pane-selection-design.md`
owns the group-selection rectangle, and the fix shipped from there. This spec's original
section 1 reasoned its way to a different answer and was wrong; nothing of it is kept.

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

## 5. Bigger handles, and room to miss

### The dot and its target

A handle is a 12px dot with a transparent 24px circle around it, drawn by a
pseudo-element. The 24 was chosen to meet WCAG 2.2 SC 2.5.8 (AA), which asks for
24×24 CSS px and is a **floor**, not a target — so 16px dot, 32px target keeps the
rule satisfied and simply gives more of everything.

Both numbers are stated directly rather than derived from an inset, and the existing
comment explains why: the 2px border plus `box-sizing: border-box` shrink the padding
box, so `inset` would undershoot. That reasoning survives the change unaltered; only
the two numbers move.

### Aim: `connectionRadius`

React Flow already has the mechanism, sitting at its default of **20** flow-pixels:
on release it looks for the nearest compatible handle within that radius and connects
to it. Twenty pixels is roughly the handle itself, which is why a connection feels like
it demands a bull's-eye. Raised to 60–80, a release anywhere in the neighbourhood of
the handle lands.

The cost, and the reason it is a number rather than "as large as possible": the radius
also applies over empty canvas, so a release near a node but not on it now makes an
edge where it used to make nothing. That is visible and undoable, and it is the whole
trade — the number is set where a deliberate miss still reads as a miss.

**Not attempted here: dropping anywhere on the node.** It is possible, and it is
specced under **Deferred** below rather than built, because the radius bump is two
characters and answers most of the same complaint. Whether it is still needed is a
question the radius has to be used before anyone can answer.

## 6. Field sizes that survive a reload

The prompt node's field and both of the text node's fields resize by `resize: both` on
the Astryx text-area wrapper. The browser implements that by writing `width` and
`height` as an **inline style on that element**, and nothing in this app ever reads
them. So the size is real, and it is entirely outside React's knowledge — which is why
it does not survive a reload, a project switch, or anything else that rebuilds the node
from `graph.json`.

**Save on release, restore as a prop.** Read the inline `width`/`height` a CSS resize
wrote onto the wrapper and write them into node data; restore by passing them straight
back as the text area's `style`.

**A CSS resize sets no pointer capture, so `mouseup` cannot be trusted to land on the
wrapper.** The obvious version — a `mouseup` handler on the node body, reading the size
off `e.target.closest('.astryx-textarea')` — works for growing a field, because the
corner tracks the cursor the whole way. It fails for shrinking: once the box hits the
`min-width`/`min-height` floor in `styles.css` it stops while the cursor keeps
travelling, so the release lands on the canvas behind the field and a handler on the
field itself never fires. That silently drops the resize, and only for the direction
that is easy to not notice in a quick check.

The shipped mechanism sidesteps the target instead of trusting it: on `mousedown`,
`onResizeMouseDown` stashes the `.astryx-textarea` wrapper (found from the mousedown's
own event target, which is still reliable) in a ref and arms a one-shot `mouseup`
listener on `window` — a target the gesture cannot miss regardless of where it ends.
That listener reads the size off the STASHED wrapper, not off its own event target, so
where the release lands no longer matters. Two more things keep it correct across the
gestures a text field actually sees:

- A second `mousedown` before the first's `mouseup` — a resize restarted, or a plain
  click that follows one — replaces the pending listener rather than stacking it, so
  nothing accumulates on `window`.
- A `useEffect` cleanup removes it on unmount, since a node can unmount mid-drag (the
  node is deleted, or a project switch remounts every node), and firing later against a
  detached wrapper would write against a stale closure.

Two things from the simpler version still hold:

- Astryx's `TextArea` forwards both `className` and `style` to that same wrapper, so
  restoring needs no DOM access at all.
- Autosave and undo already do the persisting. Both are debounced on `nodes`, and a
  resize writes once per gesture, so it costs one autosave and one undo entry —
  which is correct: undoing a resize should undo the whole drag, not each pixel.

**Where it is stored.** `data.size` for the prompt node and the text node's
instructions field, `data.resultSize` for the text node's result field. Two named keys
rather than a map keyed by field: there are two fields in the whole app, and a map
would need a naming scheme nothing else has to read.

**Node data is the right home, not `node.style`.** React Flow applies `node.style` to
its own wrapper, which would resize the card and leave the field inside it unchanged —
a different feature. What is being remembered is the size of a control.

## Also

`.xnode-video` is defined twice in `styles.css`, at lines 430 and 657. The second is
dead. It goes, since this change is already in that rule.

## Deferred: the whole node as a drop target

The most forgiving version of section 5 is to let a connection be released anywhere on
a receiving node. It works, and the mechanism is worth writing down now so that picking
it up later is a short job rather than a fresh investigation.

**It resolves by hit, not by distance.** React Flow's drop handler calls
`elementFromPoint` and prefers whatever handle sits under the cursor over the nearest
one by distance — explicitly, with a comment saying so. So a target `Handle` sized to
cover the whole card connects on release regardless of `connectionRadius`. Only output
nodes need it; they are the only family with a target handle at all.

Three consequences, each with its answer:

- **The overlay would eat every click on the node's controls.** It takes pointer events
  only while a connection is in flight. `onConnectStart` and `onConnectEnd` are already
  wired in `App.jsx` for the bulk-wire fan-out, so this is a flag and a class, not new
  plumbing.
- **Edges would anchor at the node's centre.** A handle's connection point is the centre
  of its bounds, and the overlay's bounds are the card. `onConnect` belongs to this app,
  so it strips the phantom handle id and the edge renders into the real left-hand
  handle as always.
- **Overlapping nodes.** The topmost card takes the drop, which is what the eye expects
  and needs no code.

Deferred rather than rejected: `connectionRadius` is two characters and addresses the
same complaint, and building both at once would leave no way to tell which one did the
work.

## Rejected

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
- **Bounding-box hit-testing for edges.** Over-selects on diagonals; see section 4.
- **A `ResizeObserver` for the field sizes.** Fires on the initial layout and on every
  font and container change, so it needs a guard to tell a user's drag from a reflow,
  and then writing the size back re-enters it. `mouseup` is the gesture's actual end.
- **`node.style` or React Flow's `NodeResizer` for the field sizes.** Both resize the
  card, which is a different feature from the one that regressed; see section 6.
- **`setPointerCapture` on the field for the resize gesture.** It contends with
  Blink's own handling of the native resizer; see section 6.
