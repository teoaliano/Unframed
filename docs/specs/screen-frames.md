# Screen frames live in the project's pool

## Problem

A Screen's frame reloads, and its app boots again, far more often than the person expects:

- when the person opens the Screen in an editor tab, because the editor replaces the whole canvas and starts its own frame;
- when the person goes back from the editor to the canvas, because the canvas mounts again;
- when the person switches to another project tab and back, because the canvas of a project mounts only while its tab is active.

A browser frame reloads whenever it leaves the page or moves to another place in it, so no rule about when a frame is live fixes this while each view owns its frames. `screen-tiers.md` decides which few Screens hold a frame. This spec keeps those frames alive while their project stays open.

## Solution

- **The tiers pick, the pool holds.** A pool, rendered by the app frame for every project in the open tabs, holds one iframe for each live, warming or parked Screen of that project (`screen-tiers.md`: at most one live, one warming and three parked). A Screen that shows a picture or a page copy has no frame in the pool. The pool's layer sits above the canvas and the editor and below the app's chrome. An iframe never moves in the DOM, so it never reloads while its Screen keeps its tier.
- **The tier state belongs to the project.** It outlives the canvas: opening the editor tab or switching project tabs unmounts the canvas, but the live and parked Screens keep their frames.
- **Views offer a slot.** The Screen on the canvas, and the preview in the Screen's editor tab, each render a slot: the Screen's picture, where the app should show. The pool lays the Screen's iframe over the slot that wants it: the iframe keeps the Screen's size in CSS pixels and is moved and scaled with a transform, clipped to the view it belongs to. A slot in the editor wins over one on the canvas.
- **Hidden when parked or unseen.** A parked Screen's frame is hidden, and so is a live one whose project is not on screen or that sits outside the view. Chromium throttles a hidden cross-site frame, so it costs memory, not frames.
- **The editor tab holds its Screen.** Opening a Screen's editor tab makes it live, from its parked frame at once or from its picture, and keeps it live until the tab closes, whatever the selection does. While the tab is open, the pool's layer rises above the editor (z-index 701), and the editor's element outlines render inside the pooled frame's host. Leaving the editor puts the app back in interact mode and drops unsaved previews. Back on the canvas, the Screen stays live while it is selected and parks when it is not.
- **Demand.** The pool tells the engine which Instances its frames need, so no dev server idles out under a live or parked Screen of a project that is not on screen. The canvas adds the Instances of near Screens with no picture yet.
- **Pictures stay as the placeholder.** Until its frame has painted, a slot shows the Screen's picture or its label. A failure ("Couldn't reach this state") shows in the pooled host, with the frame hidden.
- **Selection and input.** The pool draws the selection ring of a selected Screen over its frame, since tldraw's ring sits under the pool. A Screen takes pointer input only when it is live, selected, settled and the camera is still; otherwise its frame is `inert`, so a hidden or idle app cannot take keyboard focus, and a frame that stops taking input gives focus back.
- **Keeping the pool honest.** A Screen deleted while its canvas is shown leaves the pool and its tier at once. One deleted while its project's canvas is not shown leaves when the canvas next mounts. Closing a project tab empties its pool and its tiers. Hiding the window drops every parked frame (`screen-tiers.md`).

## Costs

- A shape placed on top of a live Screen on the canvas shows under the Screen's frame.
- Each open project keeps up to five frames alive: one live, one warming and three parked. Closing a project tab closes them.
- A parked Screen whose frame the tiers drop (a fourth one parked, or the window hidden) loads again when it is next selected.
- Screens stay upright: the canvas undoes any rotation of a Screen, and a Screen inside a rotated group shows its picture instead of its frame, since the frame is laid over the slot's upright box. A Screen in a group that clips its children is clipped to the canvas only.
- tldraw's own overlays inside the canvas (resize handles, the brush, snap lines) paint under a live Screen's frame.
- After the editor closes, the keyboard focus is on the page, not the canvas, so the next Escape does not deselect the Screen; a click on the canvas does.

## Tests

Browser:

- A live Screen's page loads once across a narrower canvas, zoom out and in, a pan far away and back, parking and selecting it again, opening its editor tab, going back to the canvas, and switching project tabs and back (a mark set inside the frame survives).
- An editor tab makes its Screen live from a picture and holds it; two parked frames survive the editor and a project tab switch with their marks.
- The frame lines up with its Screen on the canvas, and the selection toolbar stays above it when the Screen fills the view.
- A Screen stays upright.
- The existing Screen, state, load and editor specs pass with the frame in the pool.
