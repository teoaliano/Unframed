# A held modifier must stop the canvas from resetting the selection

*2026-08-18*

## Why

Building a group by shift+clicking nodes one at a time now works
(`2026-08-18-canvas-interaction-design.md`), but a group still falls apart while you
build it. Clicking quickly across a grid of nodes, some end up missing even though every
press landed on a node — or looked like it did.

The cause is the presses that *miss*. **Any press that lands on empty canvas resets the
whole selection, and the multi-select key is never consulted.** One stray press in a gap
between nodes throws away everything accumulated so far; the next presses rebuild part of
it, which is why the result reads as "some nodes were lost" rather than "everything was".

This is not a regression. It was always true — it was invisible only because shift+click
on a node was completely broken until now, so nobody got far enough to lose a group.

Observed with `client/src/debug/trace.js`, holding Shift with two nodes already selected:

| Gesture | Verdict |
| --- | --- |
| Shift+click a node | `900 -> 900,903` — adds |
| Shift+click empty canvas, perfectly still | `900,903 -> (none)` |
| Shift+press empty canvas, 3px of movement | `900,903 -> (none)` |

## What is actually happening

Two different paths reach the same reset, and neither reads the modifier. Both are inside
React Flow's `Pane`, and both are reachable only because `selectionOnDrag` is on for the
select tool, which makes `isSelectionEnabled` true.

**A still press.** `onPointerDownCapture` puts a 0×0 `userSelectionRect` in the store for
any press on the pane. `onPointerUp` then does:

```js
if (!userSelectionActive && event.target === container.current && store.getState().userSelectionRect) {
  onClick?.(event);          // → resetSelectedElements()
}
```

So a press that never moves is explicitly routed into the pane's click handler, which
calls `resetSelectedElements()` unconditionally.

**A press that moves.** The box-select commits, and `getSelectionChanges` rebuilds the
selection from the rectangle's contents — an empty rectangle leaves nothing. This is the
same function that makes a normal box-select *replace* rather than add.

Note what this rules out: the pane's `onClick` prop is `undefined` whenever
`isSelectionEnabled` is true, so under the select tool the reset cannot be intercepted by
handling `onPaneClick` — it is called from inside `onPointerUp` and resets regardless of
what the handler does.

## What it should do

One rule, covering both paths: **while a multi-selection key is held, a press on the pane
must not remove anything from the selection.**

- Shift+click empty canvas → nothing happens. You missed; you lose nothing.
- Shift+drag a box → the nodes in the box are **added** to the selection.

The second half is a genuine behaviour change and is the point of writing this down. A
selection box currently replaces the selection whatever is held — accurate today, and
documented as such in `CHANGELOG.md`, but it matches no canvas tool anyone uses. Figma,
Sketch and Illustrator all add on shift+box. Fixing only the still-click half would leave
the tool half-consistent: a missed click is forgiven, a slightly-moved missed click is
not.

"Multi-selection key" means whatever `multiSelectionKeyCode` names — `Meta`, `Control`
and `Shift` — not Shift alone. They are interchangeable everywhere else and must stay so
here, or Cmd+click and Shift+click drift apart.

Out of scope: subtracting from a selection with a modifier (Alt-box in some tools).
Nobody has asked for it, and adding it now would double the states to reason about.

## Approach

React Flow has no prop for this -- `getSelectionChanges` rebuilds from the rectangle by
design -- so it needs a small intervention in `App.jsx`. What shipped, and what the two
open questions below turned out to be:

1. On a `pointerdown` whose target is the pane itself, with a multi-selection key held,
   remember the ids selected at that moment. Latched at the press, so releasing the key
   mid-drag does not turn an additive box back into a replacing one.
2. Any `{ type: 'select', selected: false }` change for one of those ids is turned into
   `selected: true` on its way to `onNodesChange`.
3. Cleared on `pointerup`.

**Both questions answered by reading the library and then by real input.**

- *Does the still press emit changes?* Yes. `resetSelectedElements()` builds
  `createSelectionChange(id, false)` for every selected node and calls
  `triggerNodeChanges` synchronously, so it arrives at `onNodesChange` like any other
  change. One lever covers both paths after all; no second mechanism was needed.
- *Does `mutateItem = true` leave the lookup disagreeing?* Yes, and that is why the
  changes are re-selected rather than filtered out. Dropping them leaves the `nodes` prop
  untouched, so nothing ever contradicts the lookup React Flow just mutated and the node
  renders unselected. Re-selecting produces a new `nodes` array, which syncs the lookup
  back. Verified by DOM class, not by state: `.react-flow__node.selected` is what the
  lookup drives.

One thing the spec did not anticipate. The modifier is read from React Flow's own
`multiSelectionActive`, not from the event's `shiftKey`/`metaKey`/`ctrlKey`. Restating the
key list is exactly the drift the section above warns about -- and it is also the wrong
list: that state is driven by `keydown`, and a pointer event's modifier bits are not
reliably set on a drag, which is how a first attempt passed the click case and failed the
box case.

Whatever the mechanism, it is verified the way everything in the previous spec was: real
pointer input, with `?trace=1`. **Synthetic `MouseEvent`s fire no `pointerdown` and skip
the capture-phase listeners this entire feature lives in** -- that mistake cost two wrong
diagnoses last time. One narrow exception, learned here: driving the browser from
automation, the modifier has to be *held* with a `keydown`, because React Flow reads the
key from a keyboard listener and a mouse event carrying a modifier bit alone leaves
`multiSelectionActive` false. The pointer input stays real; only the key is dispatched.

## Acceptance

With three nodes selected and a multi-selection key held:

- click empty canvas, still → selection unchanged;
- press empty canvas and move a few pixels → selection unchanged;
- drag a box over two further nodes → five selected;
- drag a box over one already-selected node → still five, no toggling;
- click a selected node → removed, as today;
- **without** any modifier: click empty canvas clears, and a box replaces — both unchanged.

Then the same sweep in the packaged app, since that is where this was reported and where
the canvas interaction work has already produced one browser/Electron difference.

## Related

- `2026-08-18-canvas-interaction-design.md` — the work that made this reachable, and the
  tracer built to diagnose it. Its "Left open" item is now closed: native `<select>`
  popups were tested in the packaged app and behave correctly (menu opens on the node, the
  node selects afterwards, a shaky press does not drag it).
- The one thing this work uncovered and did not fix in the same change: React Flow's
  `.react-flow__nodesselection-rect`, the rectangle it lays over a selected group's
  bounding box, swallowed every click inside it -- pre-existing, but an additive box
  grows that box to the union of the selection, so it went from a nuisance to most of
  the canvas being dead. Neutralised in `client/src/styles.css`, where the comment
  explains why it is made transparent rather than hidden.
- `CHANGELOG.md`'s line "A selection box still replaces the selection rather than adding
  to it, whichever key is held" described the old behaviour and was removed when this
  shipped (2026-08-19).
