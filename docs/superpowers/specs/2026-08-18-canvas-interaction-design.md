# Canvas interaction: selection, dragging, and what a node's chrome is for

*2026-08-18*

## Why

Heavy use of the packaged app produced three complaints that all felt like one thing —
"the canvas randomly ignores me":

- a node is dragged and does not move;
- a node is clicked and is not selected;
- shift+click, used to build a group one node at a time, does nothing at all.

They read as one flaky bug. They were three independent causes, plus a fourth
interaction that made all of them more likely to be hit. None of them were
intermittent — each is deterministic once you know which pixel the press landed on.

The expensive lesson is in **Verification** below: the first two diagnoses of the
shift+click failure were wrong, and both were wrong because they were reasoned from the
library's source and tested with synthetic events. A real `pointerdown` behaves
differently from a dispatched `MouseEvent`, and the difference was the entire bug.

## What was actually wrong

### 1. A picture is a native drag surface

`Thumbnail` renders a bare `<img>`, and an `<img>` is draggable by default. Pressing a
reference image or a generated result and moving one pixel starts the browser's own
image drag. That drag consumes the mouseup, so no `click` is dispatched: the node is
neither moved (the handle was the header) nor selected. A perfectly still click worked,
which is exactly why it looked random — a hand always moves a pixel or two.

Fixed with `-webkit-user-drag: none` on every `img` inside a node.

### 2. Shift meant two different things

`multiSelectionKeyCode` includes `Shift`. React Flow's `selectionKeyCode` — the key that
starts a **selection box** — also defaults to `'Shift'`, and was never overridden. Both
features claimed the same key, and box-select wins, because it listens in the capture
phase on the pane, an ancestor of every node:

```js
const isSelectionActive = (selectionOnDrag && eventTargetIsContainer) || selectionKeyPressed;
if (…) return;
if (!eventTargetIsContainer) { event.stopPropagation(); event.preventDefault(); }
```

So a shift+press on a node was cancelled before the node saw it. No `mousedown` was
produced at all, so the drag-start handler that owns node selection never ran.

The visible tell, and the thing that finally identified it: the `click` still fired, so
an input node's header would flash **"copied!"** on a shift+click that left the node
unselected. The event was arriving and the selection was being *cancelled*, not missed.

Fixed with `selectionKeyCode={null}`. Box-select already comes from `selectionOnDrag`,
so nothing is lost.

### 3. The drag handle was 12% of a node

`dragHandle: '.xnode-head'` meant a node could only be moved by its 33px title bar. On a
300×284 image output that is 12% of the node, and far less once results are attached.
Everything else was dead for dragging, and the body is nearly all controls.

Fixed by making the whole node draggable — see **Whole-node dragging**.

### 4. The drag handle was also a button

Clicking a prompt or text node's header copied `@<id>` to the clipboard. That put a
button on the one strip of a node that has to stay grabbable, so reaching for a drag or
a selection copied instead. Causes 1 and 3 left the header as the only reliable place to
grab a node, and the header was the one place that did something else.

The reference moved to the right-click menu, under **Reference**. The header now carries
no interaction at all and still shows the id as plain text.

## Whole-node dragging

The node's own card becomes the drag surface, with controls excluded by React Flow's
`noDragClassName` (`nodrag`).

**Exclusion, not an allowlist.** An allowlist of draggable regions cannot express "the
padding of a container that also holds a button", because React Flow's `hasSelector`
walks *up* from the event target: a class on the container makes every child draggable
too. The draggable area is "everything except the controls", and that is only sayable as
an exclusion.

That choice has a cost, and it is the reason for the guard below: the exclusion fails
*dangerously*. Forget `nodrag` on a control added later and it silently becomes a drag
surface that eats clicks — invisible in review and invisible in the UI. An allowlist
would have failed benignly (an area that just does not drag).

**What gets `nodrag`.** Most of it lands in one shared file: `output/controls.jsx`
covers `ModelPicker`, `NativeSelect` and `CostFoot`'s buttons for all three output nodes
at once. Then `RunsControl`'s wrapper, the text areas, `FileInput` and the remove
buttons, `<video controls>`, the paste-a-link row, and the primary buttons (Generate,
Run, Clear, Add to canvas).

**What becomes draggable.** Header, footer, labels, padding, the gaps — and the
thumbnails and result strips. That last one is the real gain, because a reference node
is mostly picture.

**Clearing the old handle.** `withDrag` sets `dragHandle: undefined` rather than dropping
the key. Every node saved to `graph.json` carries `dragHandle: '.xnode-head'`, and
`withDrag` spreads the saved node before applying its derived keys — the same reason its
`className` is set after the spread. Dropping the key would leave every existing project
on header-only dragging while new nodes dragged fully, and `presets.json` is deliberately
never rewritten (`docs/library.md`), so for presets that split would be permanent. Same
line count, no migration code. The three `addToCanvas` call sites that hand-set the
handle lose it too, or nodes added from a result would differ from every other node.

**The guard.** A check gated on `import.meta.env.DEV` scans each node once on mount for
`button`/`input`/`select`/`textarea`/`video` with no `.nodrag` ancestor and warns. It
runs in every dev session rather than only when someone remembers the tracer, and costs
nothing in production. This is the counterweight to choosing an exclusion list.

## Verification

`client/src/debug/trace.js`, loaded only by `?trace=1` via a dynamic import, records per
gesture: every pointer/mouse/click event at **both** capture and bubble, who called
`stopPropagation`/`preventDefault` and from where, and the selected node ids before and
after. An event killed on the way down shows as a capture row with no matching bubble
row — that gap is the diagnosis, and nothing else surfaces it, because a cancelled event
and a handler that never ran are indistinguishable from the outside.

It earned its place by identifying cause 2 after two wrong answers, and it is the thing
that catches the exclusion list's dangerous failure mode.

**Synthetic events are not a substitute.** A dispatched `MouseEvent` fires no
`pointerdown`, so it bypasses capture-phase pointer listeners entirely — which is how
cause 2 was missed twice. Anything touching selection or dragging is verified with real
input.

## Rejected

- **`nodeDragThreshold={0}`.** Shipped briefly on the theory that React Flow selects a
  node twice per gesture (drag-start plus click), which toggles on and back off under a
  multi-select key. The double call is real in source but never happens with real input:
  d3-drag calls `preventDefault` and `stopImmediatePropagation` on the click after any
  movement, so exactly one selection call survives. The evidence for it came from
  synthetic events. Reverted — and while it was in, it removed the one path that still
  worked, making shift+click worse.
- **An allowlist of draggable regions.** Cannot express padding inside a container that
  also holds controls; see above.
- **Shift+box-select adding to a selection.** `CHANGELOG` and a code comment claimed it
  did. It never has: `getSelectionChanges` rebuilds the selection from the rectangle's
  contents, whatever key is held. A/B tested against the old config — identical. The
  claims were corrected rather than the behaviour implemented; nobody had asked for it.
- **Per-result copy buttons** on the result thumbnails. `Copy image N of M` in the
  right-click menu already covers it.

## Left open

Whether a native `<select>` popup swallows the click in the packaged Electron app, so
the node under it is never selected. Not reproducible headless — it needs the packaged
app. Deferred to its own change; the tracer is how to answer it.
