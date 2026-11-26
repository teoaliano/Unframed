# Screens load once per open project

## Problem

A Screen's frame reloads, and its app boots again, far more often than the person expects:

- when it goes far off screen, after a zoom or a pan;
- when the person opens the Screen in an editor tab, because the editor replaces the whole canvas and starts its own frame;
- when the person goes back from the editor to the canvas, because the canvas mounts again;
- when the person switches to another project tab and back, because the canvas of a project mounts only while its tab is active.

A browser frame reloads whenever it leaves the page or moves to another place in it, so no rule about when a frame is live fixes this while each view owns its frames. The person's rule: a Screen loads once, when its project opens, and never again while the project stays open.

## Solution

- **One frame per Screen, owned by the project, not by a view.** A pool, rendered by the app frame for every project in the open tabs, holds one iframe per Screen. The pool's layer sits above the canvas and the editor and below the app's chrome. An iframe never moves in the DOM, so it never reloads.
- **Views offer a slot.** The Screen on the canvas, and the preview in the Screen's editor tab, each render an empty slot where the app should show. The pool lays the Screen's iframe over the slot that wants it: the iframe keeps the Screen's size in CSS pixels and is moved and scaled with a transform, clipped to the view it belongs to. A slot in the editor wins over one on the canvas.
- **No slot, still alive.** A Screen whose project is not on screen, or which is outside the view, keeps its frame, hidden. Chromium throttles a hidden cross-site frame, so it costs memory, not frames.
- **Loading.** Every Screen of an open project loads once, in turn through the load queue (one queue per project), nearest to the view first. The pool, not the canvas, tells the engine which Instances are wanted: every Screen of every open project, so no dev server idles out under a Screen that is still open. Under memory pressure the engine's budget can still stop one. The frame loads again only when its route, state or Instance changes, or the person asks with Reload.
- **Pictures stay as the placeholder.** Until its frame has painted, a slot shows the Screen's snapshot or its label. A failure ("Couldn't reach this state") shows in the slot, with the frame hidden.
- **Selection.** The pool draws the selection ring of a selected Screen over its frame, since tldraw's ring sits under the pool.

## Costs

- A shape placed on top of a Screen on the canvas shows under the Screen's frame.
- Every Screen of every open project keeps its app running. Closing a project tab closes its frames.

## Tests

Browser:

- A Screen's page loads once across zoom out, zoom in, a pan far away and back, opening its editor tab, going back to the canvas, and switching project tabs and back (a mark set inside the frame survives).
- The frame lines up with its Screen on the canvas, and the selection toolbar stays above it when the Screen fills the view.
- The existing Screen, state, load and editor specs pass with the frame in the pool.
