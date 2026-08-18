# Canvas Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Seven canvas interaction fixes — remove the leftover group-selection rectangle and the media tooltips, make a video clip draggable by replacing its native controls with node-native ones, let a box-select lasso connectors, enlarge the handles and their connection aim, and remember resized text fields across reloads.

**Architecture:** Six of the seven are edits to existing files: CSS numbers, props on `<ReactFlow>`, and props removed from Astryx components. Two introduce new files, each following a pattern the repo already has — `client/src/nodes/VideoPlayer.jsx` is a shared node component used by the two nodes that show a clip, and `client/src/graph/edgeHits.js` is a pure module with an assert-based self-check, exactly like its neighbours `resolve.js` and `bulkWire.js`.

**Tech Stack:** React 18, `@xyflow/react` v12 (React Flow), Astryx design system (`@astryxdesign/core`), Vite. Tests are plain `node` with `node:assert/strict` — no framework, no fixtures, no runner.

**The spec this implements:** `docs/superpowers/specs/2026-08-18-canvas-polish-design.md`. Read it before starting. It carries the reasoning; this plan carries the steps.

## Global Constraints

- **Read `CLAUDE.md` and `client/.claude/CLAUDE.md` before the first edit.** They are short and they override defaults.
- **Astryx components do the layout — no raw `<div>` for layout.** The existing `<div className="xnode-body">` elements are pre-existing and stay; do not add new ones. New layout uses `HStack`/`VStack` from `@astryxdesign/core/Stack`.
- **No raw hex or px values in CSS.** Use tokens: `var(--color-*)`, `var(--spacing-*)`, `var(--radius-*)`. The handle sizes in Task 5 are the exception the existing file already makes, and the existing comment explains why.
- **The whole node card is the drag surface; controls opt out with `className="nodrag"`.** This is load-bearing and is why Task 3 exists at all. See `docs/superpowers/specs/2026-08-18-canvas-interaction-design.md`.
- **A comment earns its length only if deleting it would let someone make a wrong change.** Do not annotate what the code already says.
- **Node components have no tests by design.** Verify them in the running app (`npm run dev`, then the canvas at http://localhost:5173) and say so in the commit or the summary. Only pure logic gets a test.
- **`npm test` must pass before every commit** that touches anything under `client/src/graph/` or `server/`.
- **Commit per task.** Never push to `main`; this work lands by PR.

## File Structure

**Created:**
- `client/src/graph/edgeHits.js` — pure geometry: does a rectangle cross a sampled path? Plus the DOM sampling helper, which is thin and untested by design.
- `client/src/graph/edgeHits.test.js` — assert-based self-check, added to the `test` script in `package.json`.
- `client/src/nodes/VideoPlayer.jsx` — a `<video>` with no native controls plus a `nodrag` control row (play/pause, position slider, time readout). Used by `VideoNode` and `VideoOutputNode`.

**Modified:**
- `client/src/styles.css` — hide the group-selection rect, handle sizes, the video player's control row, delete a duplicate rule.
- `client/src/App.jsx` — `selectionMode`, `connectionRadius`, `onSelectionStart`/`onSelectionEnd`.
- `client/src/nodes/ImageNode.jsx`, `client/src/nodes/ImageOutputNode.jsx` — drop `label` from `Thumbnail`.
- `client/src/nodes/VideoNode.jsx`, `client/src/nodes/VideoOutputNode.jsx` — use `VideoPlayer`.
- `client/src/nodes/PromptNode.jsx`, `client/src/nodes/TextOutputNode.jsx` — save and restore field sizes.
- `client/src/debug/nodragCheck.js` — `video` comes off the interactive-element list.
- `package.json` — the new test joins the `test` script.
- `CHANGELOG.md` — one dated entry at the end.

**Task order matters in one place only:** Task 3 (the video player) must land before Task 7 touches `nodragCheck.js`'s sibling concerns — but they are independent files, so any order works if you keep each task's commit self-contained. Tasks 1, 2, 4, 5, 6 are independent of everything.

---

### Task 1: Remove the leftover group-selection rectangle

**Files:**
- Modify: `client/src/styles.css` (append near the other React Flow overrides, after the `.react-flow__handle` block that ends around line 204)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing other tasks read.

**Background:** After a box-select of two or more nodes, React Flow renders `.react-flow__nodesselection-rect` — a bordered box spanning the selection's bounding box, which exists so the group can be dragged as one. It is also a **hitbox** covering all the empty canvas inside that bounding box. Hiding only its paint would leave an invisible rectangle that keeps swallowing presses. The element has to go.

- [ ] **Step 1: Add the rule**

Add to `client/src/styles.css`, immediately after the `.react-flow__handle::before` block:

```css
/* React Flow draws a bordered box around a multi-node selection so the group can be
   dragged as one. It outstays the gesture, and it is a HITBOX as much as a border:
   it spans the selection's bounding box, so every patch of empty canvas between the
   outermost nodes stops responding. Hiding only its paint would leave that intact and
   invisible, which is worse. Dragging any selected node still moves the whole group --
   React Flow collects the selection in its own drag handler, so nothing is lost but
   arrow-key nudging, which lived on this element's own onKeyDown. */
.react-flow__nodesselection {
  display: none;
}
```

- [ ] **Step 2: Verify in the running app**

```bash
npm run dev
```

Open http://localhost:5173. With the select tool active (the default), drag a box across two or more nodes and release. Confirm: no rectangle remains; the nodes show as selected; dragging any one of them moves all of them together; clicking empty canvas between them starts a fresh selection box rather than dragging the group.

- [ ] **Step 3: Commit**

```bash
git add client/src/styles.css
git commit -m "Remove the group-selection rectangle left behind by box-select"
```

---

### Task 2: Remove the tooltips on pictures and clips

**Files:**
- Modify: `client/src/nodes/ImageNode.jsx:72-78`
- Modify: `client/src/nodes/ImageOutputNode.jsx:627-635`
- Modify: `client/src/nodes/VideoNode.jsx:88-95`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing other tasks read.

**Background:** Astryx's `Thumbnail` wraps itself in a `Tooltip` **when and only when** a `label` prop is passed. Dropping the prop removes the tooltip. Nothing accessible is lost: `Thumbnail` derives its accessible name from `label ?? alt`, and both call sites already pass an `alt`.

- [ ] **Step 1: Drop `label` from the reference thumbnail**

In `client/src/nodes/ImageNode.jsx`, the `<Thumbnail>` currently reads:

```jsx
            <Thumbnail
              className="xnode-thumb"
              style={{ aspectRatio: data.aspect || 1 }}
              src={data.dataUrl}
              alt={data.fileName || 'image'}
              label={data.fileName || 'image'}
            />
```

Delete the `label` line so it reads:

```jsx
            <Thumbnail
              className="xnode-thumb"
              style={{ aspectRatio: data.aspect || 1 }}
              src={data.dataUrl}
              alt={data.fileName || 'image'}
            />
```

- [ ] **Step 2: Drop `label` from the result strip**

In `client/src/nodes/ImageOutputNode.jsx`, delete the `label={`result ${r.runIndex + 1}`}` line from the `<Thumbnail>` inside the result strip. The `alt` and the `src` (with its comment) stay exactly as they are. It becomes:

```jsx
                  <Thumbnail
                    className="xnode-thumb"
                    // A just-finished run still has the bytes it fetched; a
                    // reopened node (after a project switch or reload) only has
                    // the pointer that survived — see `shown` above.
                    src={r.image ?? r.url}
                    alt={`generated result ${r.runIndex + 1}`}
                  />
```

- [ ] **Step 3: Drop the native tooltip from the reference clip**

In `client/src/nodes/VideoNode.jsx`, delete the `title={data.fileName || 'video'}` line from the `<video>` element. Leave everything else on that element alone — Task 3 replaces it wholesale, and doing it here as well would make Task 3's diff harder to read.

- [ ] **Step 4: Verify in the running app**

With `npm run dev` running, hover a reference image, a generated result in an image output's strip, and a reference clip. Confirm no tooltip appears in any of the three, and that the pictures still render.

- [ ] **Step 5: Commit**

```bash
git add client/src/nodes/ImageNode.jsx client/src/nodes/ImageOutputNode.jsx client/src/nodes/VideoNode.jsx
git commit -m "Drop the hover tooltips on reference and result media"
```

---

### Task 3: A node-native video player, so a clip drags like a picture

**Files:**
- Create: `client/src/nodes/VideoPlayer.jsx`
- Modify: `client/src/styles.css` (the `.xnode-video` rule around line 430; delete the duplicate around line 657; add the control row's rule)
- Modify: `client/src/nodes/VideoNode.jsx:85-96`
- Modify: `client/src/nodes/VideoOutputNode.jsx:542`
- Modify: `client/src/debug/nodragCheck.js:12`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `VideoPlayer`, a default export taking exactly one prop — `src: string`. Renders the clip and its controls. No other task depends on it.

**Background:** A `<video controls>` cannot be both a drag surface and a scrub surface. Its controls live in shadow DOM, so a press on the timeline retargets to the `<video>` element and nothing downstream can tell a scrub from a drag. That is why the clip carries `nodrag` today, and why an image — which has no controls — does not. Moving the controls out of the element dissolves the conflict: the frame becomes an ordinary drag surface, and the controls carry `nodrag` like every other control in a node.

- [ ] **Step 1: Write the component**

Create `client/src/nodes/VideoPlayer.jsx`:

```jsx
import { useRef, useState } from 'react';
import { HStack } from '@astryxdesign/core/Stack';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Icon } from '@astryxdesign/core/Icon';
import { Slider } from '@astryxdesign/core/Slider';
import { Text } from '@astryxdesign/core/Text';
import { Play, Pause } from 'lucide-react';

// A clip with its controls OUTSIDE the video element, which is the only way a node
// can have both a scrubber and a drag surface. Native controls live in shadow DOM, so
// a press on the timeline retargets to the <video> itself: nothing downstream can tell
// a scrub from a drag, and the clip had to carry `nodrag` to stay usable. Out here the
// frame is an ordinary drag surface like a picture, and the control row opts out the
// same way every other control in a node does.
//
// Deliberately NOT `nowheel`: with no native controls there is nothing on the clip for
// a wheel to work, so keeping it would mean scrolling over a clip did nothing while
// scrolling anywhere else panned the canvas.

function clock(seconds) {
  if (!Number.isFinite(seconds)) return '0:00';
  const s = Math.floor(seconds % 60);
  return `${Math.floor(seconds / 60)}:${String(s).padStart(2, '0')}`;
}

export default function VideoPlayer({ src }) {
  const ref = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [at, setAt] = useState(0);
  const [length, setLength] = useState(0);

  function toggle() {
    const el = ref.current;
    if (!el) return;
    if (el.paused) el.play();
    else el.pause();
  }

  function seek(v) {
    setAt(v);
    if (ref.current) ref.current.currentTime = v;
  }

  return (
    <>
      <video
        className="xnode-video"
        ref={ref}
        src={src}
        muted
        preload="metadata"
        onLoadedMetadata={(e) => setLength(e.currentTarget.duration || 0)}
        // `timeupdate` fires roughly four times a second, which is enough for a
        // scrubber. A requestAnimationFrame loop would be smoother and would mean a
        // running frame loop per video node on the canvas.
        onTimeUpdate={(e) => setAt(e.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
      />
      <HStack className="xnode-player nodrag" gap={2} vAlign="center">
        <IconButton
          variant="ghost"
          size="sm"
          label={playing ? 'Pause' : 'Play'}
          icon={<Icon icon={playing ? Pause : Play} />}
          onClick={toggle}
        />
        <Slider
          className="xnode-player-track"
          label="Position"
          isLabelHidden
          // Astryx's default is a value bubble built on Tooltip, and an anchored
          // tooltip inside a node can render at a corner of the window in the packaged
          // app — the same defect that keeps the model parameters on native selects.
          valueDisplay="none"
          min={0}
          max={length || 1}
          step={0.01}
          value={Math.min(at, length || 1)}
          onChange={seek}
        />
        {/* Tabular numbers so the row does not twitch as the seconds tick over. */}
        <Text type="supporting" color="secondary" hasTabularNumbers>
          {`${clock(at)} / ${clock(length)}`}
        </Text>
      </HStack>
    </>
  );
}
```

- [ ] **Step 2: Style the control row and fix the duplicated video rule**

In `client/src/styles.css`, find the `.xnode-video` rule near line 430 and leave it as it is. Then find the **second, dead** `.xnode-video` rule near line 657 (just above the `/* ---- Library dialog ---- */` banner) and delete it entirely:

```css
.xnode-video {
  width: 100%;
  border-radius: var(--radius-element);
  display: block;
}
```

Add the control row's rule immediately after the surviving `.xnode-video` block:

```css
/* The clip's controls, moved out of the <video> so the frame itself can be dragged
   (see nodes/VideoPlayer.jsx). The row carries `nodrag`; the slider needs to take the
   leftover width so the time readout keeps its own. */
.xnode-player {
  width: 100%;
  padding-block-start: var(--spacing-1);
}
.xnode-player-track {
  flex: 1;
  min-width: 0;
}
```

- [ ] **Step 3: Use it in the reference node**

In `client/src/nodes/VideoNode.jsx`, add the import beside the other local imports:

```jsx
import VideoPlayer from './VideoPlayer.jsx';
```

Then replace the `<video>` element and the comment above it. It currently reads:

```jsx
            {/* nodrag/nowheel so the player's controls scrub instead of panning
                the canvas. */}
            <video
              className="xnode-video nodrag nowheel"
              src={data.dataUrl}
              controls
              muted
            />
```

Replace all of that with:

```jsx
            <VideoPlayer src={data.dataUrl} />
```

- [ ] **Step 4: Use it in the output node**

In `client/src/nodes/VideoOutputNode.jsx`, add the import beside the other local imports:

```jsx
import VideoPlayer from './VideoPlayer.jsx';
```

Then replace this line:

```jsx
            <video className="xnode-video nodrag nowheel" src={shown.url} controls preload="metadata" />
```

with:

```jsx
            <VideoPlayer src={shown.url} />
```

- [ ] **Step 5: Take `video` off the dev guard's list**

In `client/src/debug/nodragCheck.js`, line 12 currently reads:

```js
const INTERACTIVE = 'button, input, select, textarea, video, [contenteditable="true"]';
```

Change it to:

```js
// `video` is deliberately absent: a clip is a drag surface like a picture, and its
// controls live outside it in a `nodrag` row (nodes/VideoPlayer.jsx). Listing it would
// warn on every video node forever, which is how a guard stops being read.
const INTERACTIVE = 'button, input, select, textarea, [contenteditable="true"]';
```

- [ ] **Step 6: Verify in the running app**

With `npm run dev` running:

1. Add a video input node and give it a clip (drop a file on the node).
2. **Drag the node by the middle of the clip.** The node must move. This is the whole point of the task.
3. Press play. The clip plays and the button becomes Pause.
4. **Drag the slider thumb.** The playhead must move and the node must NOT.
5. Check the browser console for the `[nodrag]` warning table. It must not list the video node.
6. Run a video generation (or open a project that has a finished one) and repeat 2–4 on the output node's result player.

**The known risk, and what to do about it:** a `<video>` with no `controls` shows nothing until the browser has decoded a first frame, so the clip may render as an empty box. If it does, append a media fragment to the source in `VideoPlayer.jsx` — `src={`${src}#t=0.1`}` — which forces a frame, and add a one-line comment saying why. Do this **only if** it actually renders blank.

- [ ] **Step 7: Commit**

```bash
git add client/src/nodes/VideoPlayer.jsx client/src/nodes/VideoNode.jsx client/src/nodes/VideoOutputNode.jsx client/src/styles.css client/src/debug/nodragCheck.js
git commit -m "Move the video controls out of the clip so a video node drags like an image"
```

---

### Task 4: Lasso connectors with a selection box

**Files:**
- Create: `client/src/graph/edgeHits.js`
- Create: `client/src/graph/edgeHits.test.js`
- Modify: `package.json:13` (the `test` script)
- Modify: `client/src/App.jsx` (imports; a new callback pair; three props on `<ReactFlow>` around lines 1247–1249)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `hitEdges(rect, paths) → Set<string>` where `rect` is `{x, y, width, height}` in flow coordinates and `paths` is `Array<{id: string, points: Array<{x: number, y: number}>}>`. Returns the ids whose points include at least one inside the rectangle.
  - `samplePaths(count?) → Array<{id, points}>` — reads the drawn edge paths out of the DOM. Not pure, not tested.

**Background:** React Flow's box-select is not blind to edges — as the rectangle is dragged it selects every edge connected to a selected node, either endpoint being enough. The gap is exactly this: a rectangle drawn across a connector in empty canvas, touching neither of its nodes, selects nothing. Two changes close it. `selectionMode="partial"` means a node need only touch the box rather than sit entirely inside it, which handles the common case for free. Hit-testing the drawn path handles the rest.

- [ ] **Step 1: Write the failing test**

Create `client/src/graph/edgeHits.test.js`:

```js
// Assert-based self-check. Run with: node client/src/graph/edgeHits.test.js
import assert from 'node:assert/strict';
import { hitEdges } from './edgeHits.js';

// A path running diagonally from (0,0) to (100,100), sampled every 10 units.
const diagonal = {
  id: 'e1',
  points: Array.from({ length: 11 }, (_, i) => ({ x: i * 10, y: i * 10 })),
};

// A rectangle the path passes through.
{
  const rect = { x: 40, y: 40, width: 20, height: 20 };
  assert.deepEqual([...hitEdges(rect, [diagonal])], ['e1']);
}

// The case that fails if anyone swaps sampling for a bounding box: this rectangle sits
// well inside the path's bounding box and nowhere near the path itself.
{
  const rect = { x: 5, y: 80, width: 20, height: 15 };
  assert.equal(hitEdges(rect, [diagonal]).size, 0);
}

// A rectangle nowhere near it at all.
{
  const rect = { x: 500, y: 500, width: 10, height: 10 };
  assert.equal(hitEdges(rect, [diagonal]).size, 0);
}

// The rectangle's own edges count as inside, so a box that just grazes the path hits.
{
  const rect = { x: 50, y: 50, width: 10, height: 10 };
  assert.deepEqual([...hitEdges(rect, [diagonal])], ['e1']);
}

// Several paths, only the crossed one comes back.
{
  const far = { id: 'e2', points: [{ x: 900, y: 900 }, { x: 950, y: 950 }] };
  const rect = { x: 40, y: 40, width: 20, height: 20 };
  assert.deepEqual([...hitEdges(rect, [diagonal, far])], ['e1']);
}

// A path with no samples cannot be hit, and must not throw.
{
  const rect = { x: 0, y: 0, width: 1000, height: 1000 };
  assert.equal(hitEdges(rect, [{ id: 'e3', points: [] }]).size, 0);
}

console.log('edgeHits.test.js ok');
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
node client/src/graph/edgeHits.test.js
```

Expected: fails with `ERR_MODULE_NOT_FOUND` — `edgeHits.js` does not exist yet.

- [ ] **Step 3: Write the module**

Create `client/src/graph/edgeHits.js`:

```js
// Which connectors a selection rectangle crosses.
//
// React Flow already selects any edge with an endpoint on a selected node, so this
// covers exactly one gap: a box drawn across a connector in empty canvas, touching
// neither of its nodes. Both halves live here, but only the geometry is pure and
// tested -- reading the drawn paths needs the DOM.

// Enough to catch a rectangle drawn across any bend a bezier between two nodes can
// make, and cheap: a canvas has tens of edges, not thousands.
const SAMPLES = 24;

/**
 * @param {{x: number, y: number, width: number, height: number}} rect - flow coordinates
 * @param {Array<{id: string, points: Array<{x: number, y: number}>}>} paths
 * @returns {Set<string>} ids of the paths with at least one point inside the rectangle
 */
export function hitEdges(rect, paths) {
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  const hits = new Set();
  for (const { id, points } of paths) {
    for (const p of points) {
      if (p.x >= rect.x && p.x <= right && p.y >= rect.y && p.y <= bottom) {
        hits.add(id);
        break;
      }
    }
  }
  return hits;
}

/**
 * Samples every edge currently drawn on the canvas.
 *
 * The points come back in FLOW coordinates with no conversion, because the SVG the
 * paths live in sits inside React Flow's viewport transform -- its user space IS flow
 * space. Sampling the path rather than taking its bounding box is the whole point: a
 * long diagonal connector's bounding box covers a large empty region, so a box drawn
 * nowhere near the curve would select it.
 *
 * @param {number} [count] - points per path
 * @returns {Array<{id: string, points: Array<{x: number, y: number}>}>}
 */
export function samplePaths(count = SAMPLES) {
  const out = [];
  for (const g of document.querySelectorAll('.react-flow__edge[data-id]')) {
    const path = g.querySelector('path.react-flow__edge-path');
    if (!path) continue;
    const total = path.getTotalLength();
    const points = [];
    for (let i = 0; i <= count; i++) {
      const { x, y } = path.getPointAtLength((total * i) / count);
      points.push({ x, y });
    }
    out.push({ id: g.dataset.id, points });
  }
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
node client/src/graph/edgeHits.test.js
```

Expected: `edgeHits.test.js ok`

- [ ] **Step 5: Add it to `npm test`**

In `package.json`, the `test` script currently starts:

```
"test": "node client/src/graph/resolve.test.js && node client/src/graph/bulkWire.test.js && node server/env.test.js && ...
```

Insert the new file after `bulkWire.test.js`, so it reads:

```
"test": "node client/src/graph/resolve.test.js && node client/src/graph/bulkWire.test.js && node client/src/graph/edgeHits.test.js && node server/env.test.js && node server/share.test.js && node server/presets.test.js && node server/jobs.test.js && node server/host.test.js"
```

Then run the whole suite:

```bash
npm test
```

Expected: every line prints `ok`, including `edgeHits.test.js ok`.

- [ ] **Step 6: Wire it into the canvas**

In `client/src/App.jsx`:

First, add `useStoreApi` to the `@xyflow/react` import list (it already imports `ReactFlow`, `ReactFlowProvider`, `Background`, `addEdge`, `useNodesState`, `useEdgesState`, `useReactFlow`):

```jsx
  useStoreApi,
```

Add the module import beside the other `graph/` imports:

```jsx
import { hitEdges, samplePaths } from './graph/edgeHits.js';
```

Then, next to the existing `onConnectStart`/`onConnectEnd` callbacks (search for `const connectFrom = useRef(null);` — put this block just after `onConnectEnd`), add:

```jsx
  // Where the selection rectangle started, in flow coordinates. Read off React Flow's
  // own store rather than the pointer event: by the time a drag is recognised as a
  // selection the pointer has already travelled past the origin, and the store holds
  // the exact starting point.
  const store = useStoreApi();
  const lassoFrom = useRef(null);
  const onSelectionStart = useCallback(() => {
    const rect = store.getState().userSelectionRect;
    lassoFrom.current = rect ? { x: rect.startX, y: rect.startY } : null;
  }, [store]);

  // React Flow selects an edge whenever one of its nodes lands in the box, and it has
  // already done so by the time this runs -- so marking hits here ADDS the connectors
  // the box crossed in empty canvas, rather than replacing anything.
  const onSelectionEnd = useCallback(
    (e) => {
      const from = lassoFrom.current;
      lassoFrom.current = null;
      if (!from) return;
      const to = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const rect = {
        x: Math.min(from.x, to.x),
        y: Math.min(from.y, to.y),
        width: Math.abs(to.x - from.x),
        height: Math.abs(to.y - from.y),
      };
      const hits = hitEdges(rect, samplePaths());
      if (!hits.size) return;
      setEdges((es) => es.map((edge) => (hits.has(edge.id) ? { ...edge, selected: true } : edge)));
    },
    [screenToFlowPosition, setEdges],
  );
```

Finally, on the `<ReactFlow>` element, beside the existing `panOnDrag` and `selectionOnDrag` props, add:

```jsx
          // A node need only TOUCH the selection box, not sit entirely inside it.
          selectionMode="partial"
          onSelectionStart={onSelectionStart}
          onSelectionEnd={onSelectionEnd}
```

- [ ] **Step 7: Verify in the running app**

With `npm run dev` running, on a graph with at least one connection:

1. Drag a selection box across the **middle of a connector only**, touching neither node. The connector must highlight as selected.
2. Press Backspace. The connection must be deleted (undo with Cmd+Z afterwards).
3. Drag a box that clips the corner of a node without enclosing it. The node must now be selected — that is `selectionMode="partial"` working.
4. Drag a box over empty canvas near a connector but not across it. Nothing must be selected. If this one over-selects, the sampling is wrong, not the rectangle.

- [ ] **Step 8: Commit**

```bash
git add client/src/graph/edgeHits.js client/src/graph/edgeHits.test.js package.json client/src/App.jsx
git commit -m "Select connectors a box-select crosses, and let a box select nodes it touches"
```

---

### Task 5: Bigger handles and a wider connection aim

**Files:**
- Modify: `client/src/styles.css:184-204` (the `.react-flow__handle` block and its comment)
- Modify: `client/src/App.jsx` (one prop on `<ReactFlow>`)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing other tasks read.

**Background:** The dot is 12px with a transparent 24px circle around it drawn by a pseudo-element. The 24 comes from WCAG 2.2 SC 2.5.8 (AA), which asks for 24×24 CSS px — a **floor**, not a target, so raising it keeps the rule satisfied. Separately, React Flow's `connectionRadius` (default 20 flow-pixels) is how far from a handle a release still connects; 20 is roughly the handle itself, which is why connecting feels like it demands a bull's-eye.

- [ ] **Step 1: Enlarge the dot and its target**

In `client/src/styles.css`, the block currently reads:

```css
/* 12px dot with a transparent 24px target around it. WCAG 2.2 SC 2.5.8 (AA) asks
   for 24x24 CSS px; the visible dot stays small because a big one crowds the node
   edge, and the pseudo-element does the catching. Size is stated directly (not
   derived from inset) because the 2px border and box-sizing: border-box shrink the
   padding box to 8px, so inset would yield only 20px. */
.react-flow__handle {
  width: 12px;
  height: 12px;
```

and further down:

```css
  width: 24px;
  height: 24px;
```

Change the four numbers and the comment's first sentence, so the block reads:

```css
/* 16px dot with a transparent 32px target around it. WCAG 2.2 SC 2.5.8 (AA) asks
   for 24x24 CSS px and that is a floor, not a target; the visible dot stays smaller
   than its target because a big one crowds the node edge, and the pseudo-element does
   the catching. Size is stated directly (not derived from inset) because the 2px
   border and box-sizing: border-box shrink the padding box, so inset would undershoot. */
.react-flow__handle {
  width: 16px;
  height: 16px;
```

and the pseudo-element's:

```css
  width: 32px;
  height: 32px;
```

- [ ] **Step 2: Widen the connection radius**

In `client/src/App.jsx`, on the `<ReactFlow>` element beside the props Task 4 added, add:

```jsx
          // How far from a handle a release still connects, in flow pixels. React
          // Flow's default of 20 is about the size of the handle itself, which is why
          // connecting felt like it wanted a bull's-eye. The radius also applies over
          // empty canvas, so this is set where a deliberate miss still reads as a miss
          // rather than as large as it could be.
          connectionRadius={70}
```

- [ ] **Step 3: Verify in the running app**

With `npm run dev` running:

1. The handles are visibly larger, and no node's border looks crowded by one.
2. Drag from an input node's right-hand handle and release roughly half a handle-width away from an output node's handle — it must connect.
3. Release well out in empty canvas, a clear distance from any node. No edge must appear. If stray edges are easy to make by accident, lower `connectionRadius` to 50 and re-check; note the change in the commit message.

- [ ] **Step 4: Commit**

```bash
git add client/src/styles.css client/src/App.jsx
git commit -m "Enlarge the connection handles and widen the radius a release connects within"
```

---

### Task 6: Remember resized prompt and text fields

**Files:**
- Modify: `client/src/nodes/PromptNode.jsx` (the body `<div>` and the `<TextArea>`)
- Modify: `client/src/nodes/TextOutputNode.jsx` (both `<TextArea>` elements, wrapped by a new handler)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: two node-data keys read by nothing else — `data.size` and `data.resultSize`, each `{width: string, height: string}` or absent.

**Background:** These fields resize by `resize: both` on the Astryx text-area wrapper (`styles.css:487` and `:502`). The browser implements that by writing `width` and `height` as an **inline style on that wrapper**, and nothing in this app reads them — which is why the size dies on any reload that rebuilds the node from `graph.json`. Three facts make the fix small: a CSS resize has no event of its own but `mouseup` from the gripper targets the wrapper, so `e.target.closest('.astryx-textarea')` finds it; Astryx's `TextArea` forwards `style` to that same wrapper, so restoring needs no ref; and autosave and undo are already debounced on `nodes`, so a resize costs one save and one undo entry.

- [ ] **Step 1: Save and restore in the prompt node**

In `client/src/nodes/PromptNode.jsx`, add this function inside the component, just above the `return`:

```jsx
  // A CSS resize has no event of its own, so the gesture's end is the mouseup -- which
  // targets the wrapper the browser wrote the size onto. Without this the size is real
  // but invisible to React, and dies with the next reload or project switch.
  function saveSize(e) {
    const box = e.target.closest?.('.astryx-textarea');
    if (!box?.style.width && !box?.style.height) return;
    updateNodeData(id, { size: { width: box.style.width, height: box.style.height } });
  }
```

Then add `onMouseUp={saveSize}` to the body `<div>`, which currently reads:

```jsx
        <div className="xnode-body" onKeyDown={onKeyDown} onClick={() => syncMenu(ref.current)}>
```

so that it becomes:

```jsx
        <div className="xnode-body" onKeyDown={onKeyDown} onClick={() => syncMenu(ref.current)} onMouseUp={saveSize}>
```

And add `style={data.size}` to the `<TextArea>` in that node, beside its `className`:

```jsx
          <TextArea
            className="nodrag"
            style={data.size}
            ref={ref}
```

- [ ] **Step 2: Save and restore in the text output node**

In `client/src/nodes/TextOutputNode.jsx`, add this function inside the component, just above the `return`:

```jsx
  // See PromptNode's copy of this: a CSS resize writes an inline style the browser
  // owns and React never sees. Two fields here, so which one resized decides the key.
  function saveSize(e) {
    const box = e.target.closest?.('.astryx-textarea');
    if (!box?.style.width && !box?.style.height) return;
    const key = box.classList.contains('xnode-text-result') ? 'resultSize' : 'size';
    updateNodeData(id, { [key]: { width: box.style.width, height: box.style.height } });
  }
```

Add `onMouseUp={saveSize}` to the `<VStack gap={3} padding={3}>` that wraps the node's body — it holds both fields, and it is a container that already exists rather than a new one.

Add `style={data.size}` to the instructions field:

```jsx
        <TextArea
          className="xnode-text-field nodrag"
          style={data.size}
          label="Instructions"
```

And `style={data.resultSize}` to the result field:

```jsx
            <TextArea
              className="xnode-text-field xnode-text-result nodrag"
              style={data.resultSize}
              label="Result"
```

- [ ] **Step 3: Verify in the running app**

With `npm run dev` running:

1. Resize the prompt node's field by its bottom-right corner. Reload the page. The size must survive.
2. Do the same on the text node's instructions field, run the node so a result appears, resize the result field too, and reload. Both must survive independently — resizing one must not move the other.
3. Switch to another project and back. Both must still hold.
4. Resize, then press Cmd+Z. The resize must undo in one step, not pixel by pixel.
5. Type in a field after a resize. The size must not jump back.

- [ ] **Step 4: Commit**

```bash
git add client/src/nodes/PromptNode.jsx client/src/nodes/TextOutputNode.jsx
git commit -m "Remember prompt and text field sizes across reloads and project switches"
```

---

### Task 7: Changelog, and the whole batch verified together

**Files:**
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: every task above.
- Produces: nothing.

**Background:** `CHANGELOG.md` takes an entry when a user would notice — which is every task here, since the whole batch is user-visible. Its own header states its format; follow it rather than this plan's guess. `status.md` is gitignored: if it holds a todo any of this closed, delete it, and if anything was decided against along the way, record it there under "Decided not to build". The deferred whole-node drop target is already written up in the spec, so it does **not** need a todo — a checkbox reads as intent.

- [ ] **Step 1: Run the full test suite**

```bash
npm test
```

Expected: every line prints `ok`.

- [ ] **Step 2: Verify the batch together in one session**

With `npm run dev` running, on a project that has a prompt node, an image reference, a video reference, an image output with results, and a text output with a result:

1. Box-select several nodes and release — no rectangle remains, and the empty canvas between them still responds.
2. Hover a picture and a result — no tooltips.
3. Drag a video node by its clip — it moves. Scrub it — the node does not move.
4. Box-select across a bare connector — it selects.
5. Connect two nodes releasing near, not on, the target handle — it connects.
6. Resize a field, reload, and find it unchanged.
7. Check the console for `[nodrag]` warnings — there must be none.

- [ ] **Step 3: Write the changelog entry**

Read `CHANGELOG.md`'s header first and match its format exactly. Add one dated entry for 2026-08-19 covering, in user-facing language: the selection box no longer lingering after a box-select; no more hover tooltips on pictures and clips; video nodes now draggable by the clip, with their own play and scrub controls; box-select now catching connections it crosses and nodes it touches; larger connection handles that connect without a precise drop; and prompt and text field sizes surviving reloads and project switches.

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md
git commit -m "Changelog for the canvas polish batch"
```

- [ ] **Step 5: Open the PR**

Confirm the right account is active first — a wrong one fails only on writes, which is exactly what this step is:

```bash
gh auth status
```

If it is not `teoaliano`:

```bash
gh auth switch --user teoaliano
```

Then push the branch and open the PR against `main`. Never push to `main` directly.

```bash
git push -u origin claude/app-visual-improvements-3efb53
```

---

## Notes for the implementer

**What is deliberately not here.** The spec's **Deferred** section describes letting a connection be released anywhere on a receiving node. It is designed and it is not in this plan — `connectionRadius` in Task 5 answers most of the same complaint for two characters, and building both at once would leave no way to tell which one did the work. Do not build it.

**If a verification step fails, stop and say so.** Every task in this plan ends with a check in the running app because node components have no tests by design — that check is the only evidence these changes work. Reporting a task done on the strength of the code reading correctly is the one failure mode this plan cannot absorb.
