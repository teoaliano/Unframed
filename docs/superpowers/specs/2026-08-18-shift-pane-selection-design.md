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

React Flow has no prop for this — `getSelectionChanges` rebuilds from the rectangle by
design — so it needs a small intervention in `App.jsx`. The shape that looks right:

1. On `onSelectionStart`, if a multi-selection key is held, remember the ids selected at
   that moment.
2. While that is set, filter `{ type: 'select', selected: false }` changes for those ids
   out of what reaches `onNodesChange`, so a box adds rather than replaces.
3. Clear it on `onSelectionEnd`.

**Two things to verify before trusting that, rather than after.** Neither is settled:

- `getSelectionChanges` is called with `mutateItem = true`, so it writes `selected` onto
  React Flow's internal node lookup as well as emitting a change. Filtering the change may
  leave the lookup disagreeing with the `nodes` prop for a frame. Check whether the
  controlled `nodes` prop wins on the next render, or whether the selection flickers.
- The still-press path may not emit `select` changes at all — `resetSelectedElements()` is
  a store action, and it is reached from `onPointerUp`, not from a handler this app owns.
  It may need a different lever from the box path. Find out which before designing around
  it.

Whatever the mechanism, it is verified the way everything in the previous spec was: real
pointer input, with `?trace=1`. **Synthetic `MouseEvent`s fire no `pointerdown` and skip
the capture-phase listeners this entire feature lives in** — that mistake cost two wrong
diagnoses last time.

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
- `CHANGELOG.md`'s line "A selection box still replaces the selection rather than adding
  to it, whichever key is held" describes today's behaviour and must be rewritten when
  this ships.
