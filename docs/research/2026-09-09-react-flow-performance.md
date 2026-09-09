# React Flow canvas performance — research notes

Researched 2026-09-09 against `@xyflow/react` **12.11.2** as installed, plus the
xyflow docs, the xyflow issue tracker, React 19's own reference and Chrome/MDN
rendering docs. Where a claim is checkable in the shipped bundle it is checked
there and the file and line are given, because the docs are thinner than the code
on most of these questions. Blog posts were not used. What the sources do not
answer is in [Unknown / not documented](#unknown--not-documented).

Primary sources used:

- React Flow performance guide — <https://reactflow.dev/learn/advanced-use/performance>
- `useNodes` / `useEdges` — <https://reactflow.dev/api-reference/hooks/use-nodes>, <https://reactflow.dev/api-reference/hooks/use-edges>
- `useNodesData` — <https://reactflow.dev/api-reference/hooks/use-nodes-data>
- `useNodeConnections` — <https://reactflow.dev/api-reference/hooks/use-node-connections>
- `useHandleConnections` — <https://reactflow.dev/api-reference/hooks/use-handle-connections>
- `useStore` / `useStoreApi` — <https://reactflow.dev/api-reference/hooks/use-store>, <https://reactflow.dev/api-reference/hooks/use-store-api>
- `useNodesState` — <https://reactflow.dev/api-reference/hooks/use-nodes-state>
- Computing flows guide — <https://reactflow.dev/learn/advanced-use/computing-flows>
- Zustand guide — <https://reactflow.dev/learn/advanced-use/state-management>
- `<ReactFlow />` props — <https://reactflow.dev/api-reference/react-flow>
- `Node` type — <https://reactflow.dev/api-reference/types/node>
- v12 migration guide — <https://reactflow.dev/learn/troubleshooting/migrate-to-v12>
- Stress-test example — <https://reactflow.dev/examples/nodes/stress>
- Installed source — `client/node_modules/@xyflow/react/dist/esm/index.js`, `client/node_modules/@xyflow/react/dist/base.css`, `client/node_modules/@xyflow/system/dist/esm/index.js`

## 1. `useNodes()` / `useEdges()` in a node component are the documented mistake

The API reference is explicit and unusually blunt for these two hooks. On
`useNodes`: "Relying on `useNodes` unnecessarily can be a common cause of
performance issues. Whenever any node changes, this hook will cause the component
to re-render" (<https://reactflow.dev/api-reference/hooks/use-nodes>). On
`useEdges`: the same sentence, plus "Often we actually care about something more
specific, like when the _number_ of edges changes: where possible try to use
`useStore` instead" (<https://reactflow.dev/api-reference/hooks/use-edges>).

"Any node changes" includes selection and **every frame of a drag**, since a drag
pushes position changes through `onNodesChange` → `setNodes`. The performance
guide states the general form of the rule: do not access "the `nodes` or `edges`
arrays in viewport components", because "these objects change frequently during
interactions like dragging or panning", and it gives the exact anti-pattern —
`useStore((state) => state.nodes)` followed by a `filter`/`map` — against the
narrow alternative of selecting one derived field
(<https://reactflow.dev/learn/advanced-use/performance>).

The cost is multiplicative, not additive: `useNodes()` inside a custom node means
*every* node of that type re-renders on every drag frame of *any* node. With N
such nodes on canvas a single drag is N component renders per frame plus N
executions of whatever the node derives from the array.

**Cost ranking of the narrower alternatives**, read off the bundle:

- `useNodesData(ids)` builds a `{id, type, data}` triple per requested id from
  `nodeLookup` and compares with `shallowNodeData`, which compares the `data`
  references only (`index.js:4302`). Position changes therefore do **not** wake
  the subscriber. This is the cheapest way to read another node's `data`.
- `useNodeConnections({handleType, handleId})` reads the connection lookup and is
  diffed with `areConnectionMapsEqual`; it returns a memoised array
  (`index.js:4281`–`4299`). It wakes only when the set of connections changes.
  `useHandleConnections` is deprecated in its favour — "useHandleConnections is
  deprecated in favor of the more capable useNodeConnections"
  (<https://reactflow.dev/api-reference/hooks/use-handle-connections>).
- `useStore(selector, equalityFn)` is Zustand's hook re-exported; the docs say to
  use it only "when dedicated alternatives like `useReactFlow()` or
  `useViewport()` aren't available", and that "Selector functions should extract
  only necessary state" (<https://reactflow.dev/api-reference/hooks/use-store>).
  The selector runs on every store update no matter what; the equality function is
  what stops the *render*. So a selector that walks all nodes is still O(n) per
  drag frame — it just does not re-render.
- `useStoreApi().getState()` subscribes to nothing at all; the docs recommend it
  to "compute values 'on-demand' within event handlers rather than triggering
  component re-renders" (<https://reactflow.dev/api-reference/hooks/use-store-api>).

### The recommended pattern for "I am image 2 of 3"

The official answer to "a node needs to know about other nodes" is the computing
flows guide, and it is `useNodeConnections` + `useNodesData` — discover the wired
neighbours by handle, then read their `data` — not a scan of the whole graph
(<https://reactflow.dev/learn/advanced-use/computing-flows>).

That pattern does not cover an **ordinal computed over the whole graph**, which is
what this repo's `sourceRoles(nodes, edges, id)` does (ordering by Y position
across every source wired into a consumer). No xyflow doc addresses a
whole-graph-derived per-node value. The only documented construction that fits is
the performance guide's own advice, applied one level up: compute the derived
field **once, outside the nodes**, and let each node select just its own scalar.
Two shapes are available and both are consistent with the docs:

1. Compute the roles map in the app (where the arrays already live) and pass each
   node its own string through `node.data`; the node then re-renders only when its
   own `data` reference changes, which is what `useNodesData`'s `shallowNodeData`
   comparison already exploits (`index.js:4318`).
2. Keep it in the node but subscribe narrowly:
   `useStore(s => sourceRoles(s.nodes, s.edges, id).join('|'))` — a string, so the
   default `Object.is` comparison suffices and no equality function is needed. The
   selector still runs per frame, so this is only a re-render fix, not a compute
   fix. The guide's phrasing — select "the specific data you need" rather than the
   array — is what licenses it (<https://reactflow.dev/learn/advanced-use/performance>).

Note that ordering by Y position means the value genuinely *can* change during a
drag, so it cannot be made drag-independent; it can only be made cheap. Position
is not in `data`, so `useNodesData` alone cannot express it.

**In this repo today** (verified by grep on 2026-09-09):
`client/src/nodes/ImageNode.jsx:29` and `client/src/nodes/VideoNode.jsx:36` both
call `sourceRoles(useNodes(), useEdges(), id)`; `ImageOutputNode.jsx:78-79` and
`VideoOutputNode.jsx:50-51` call `useNodes()`/`useEdges()` for the over-cap hint.
Four node types, each instance subscribed to the whole graph.

## 2. `animated: true` edges: CSS keyframes on `stroke-dashoffset`, and yes, it is a known problem

The mechanism is exactly a CSS animation on an SVG stroke property. From the
shipped stylesheet (`@xyflow/react/dist/base.css:125` and `:285`):

```css
.react-flow__edge.animated path {
  stroke-dasharray: 5;
  animation: dashdraw 0.5s linear infinite;
}
@keyframes dashdraw {
  from { stroke-dashoffset: 10; }
}
```

`stroke-dashoffset` is not a compositor-only property. web.dev's rendering
guidance states that only **two** properties can be animated without triggering
layout or paint — "Stick to transform and opacity changes for your animations"
(<https://web.dev/articles/stick-to-compositor-only-properties-and-manage-layer-count>).
So every animated edge repaints its SVG path continuously, at 0.5s per cycle,
forever, whether or not anything else on the canvas is moving.

The issue tracker has this directly: xyflow issue #4149, "90% GPU utilization for
animated edges" — the reporter measured ~95% GPU while animated edges were in
view against ~24% idle with none visible, and reported that
`onlyRenderVisibleElements={true}` did not help. It is closed, labelled
`topic:culling`, with no maintainer fix or recommendation recorded
(<https://github.com/xyflow/xyflow/issues/4149>).

Adjacent maintainer comment, on the zoom-performance discussion: "complex paths
that overlap are always slow down a flow a lot", and the team's stated direction
is "a canvas-based renderer for edges" rather than a CSS fix
(<https://github.com/xyflow/xyflow/discussions/4617>).

**Recommended alternative if motion is wanted.** No official doc prescribes one.
What the sources support:

- Turn it off by default and animate only edges that mean something right now
  (an edge feeding a running generation), so the count of continuously-repainting
  paths is 0 in the resting state. `defaultEdgeOptions` applies to all new edges
  (<https://reactflow.dev/api-reference/react-flow>), which is the opposite of
  selective.
- If motion must be global, the cheapest form under the web.dev rule is a
  `transform`-animated element rather than a stroke-animated path — e.g. a small
  marker translated along the path — since `transform` is compositor-only
  (<https://web.dev/articles/stick-to-compositor-only-properties-and-manage-layer-count>).
  This is not a documented xyflow pattern; it is the general rule applied.

**In this repo today:** `client/src/App.jsx:1852` sets
`defaultEdgeOptions={{ animated: true }}` — so every edge on the canvas is a
permanently repainting dashed path.

## 3. `onlyRenderVisibleElements`: off by default, and the tradeoffs are in the source, not the docs

The prop reference says only: "You can enable this optimisation to instruct React
Flow to only render nodes and edges that would be visible in the viewport",
default `false` (<https://reactflow.dev/api-reference/react-flow>). No node-count
threshold is given anywhere in the docs. The performance guide does not mention
the prop at all (<https://reactflow.dev/learn/advanced-use/performance>).

What the bundle shows:

- The node cull is a store selector over `s.transform`:
  `getNodesInside(s.nodeLookup, {0,0,width,height}, s.transform, true)`, diffed
  `shallow` (`index.js:2114`, `useVisibleNodeIds` at `:2124`). `s.transform`
  changes every pan and zoom frame, so **enabling the prop converts panning into
  an O(nodes) loop per frame** — `getNodesInside` iterates every entry of
  `nodeLookup` computing an overlap area (`@xyflow/system` `index.js:354`–`381`).
  With the prop off, the same selector is `Array.from(s.nodeLookup.keys())`.
- The edge cull is a second O(edges) loop per frame, and it is coarse: `isEdgeVisible`
  tests the **bounding box of source and target together**
  (`@xyflow/system` `index.js:1020`), so a long edge whose endpoints straddle
  the viewport stays mounted even when no part of it is on screen.
- Nodes are exempted from culling while `node.dragging`, and while
  `!node.internals.handleBounds` — `forceInitialRender`
  (`@xyflow/system` `index.js:374`–`376`). Which is why the maintainers' own open
  task says the optimisation does not do what it says on first paint: issue
  #3883, "check `onlyRenderVisibleElements` optimizations", opened by moklick,
  still open, labelled `topic:culling` — "even when developers enable
  `onlyRenderVisibleElements`, all nodes are still rendered initially"
  (<https://github.com/xyflow/xyflow/issues/3883>).

Known issues, all in the tracker:

- Edges missing when a node has `width`/`height` set as node props (rather than in
  `style`) and one endpoint starts offscreen — issue #4516, assigned to a
  maintainer; documented workaround is to move the dimensions into `style`
  (<https://github.com/xyflow/xyflow/issues/4516>). Also issue #4329
  (<https://github.com/xyflow/xyflow/issues/4329>).
- `useNodesInitialized` returns `false` while nodes are offscreen, so there is no
  reliable moment to call `setCenter` — issue #3573
  (<https://github.com/xyflow/xyflow/issues/3573>).
- Node-local React state is lost when a node is culled and comes back, because the
  component unmounts (issue #3573 thread; same behaviour follows directly from
  `useVisibleNodeIds` gating the `NodeWrapper` list, `index.js:2361`).
- It did not help the animated-edge GPU load at all (#4149, above).

**Reading:** this prop trades a constant per-frame O(n) scan and node unmount/remount
for fewer mounted DOM nodes. It pays off only when the mounted-DOM cost dominates,
i.e. hundreds of heavy nodes with most offscreen. For a canvas of tens of nodes it
is a straight loss, and it will drop node-local state. The official stress-test
example — 450 nodes (15×30) — deliberately does **not** set it
(<https://reactflow.dev/examples/nodes/stress>).

## 4. Where `nodes`/`edges` should live

The docs are consistent and mild: `useNodesState` exists "to make prototyping
easier and our documentation examples clearer", and for sophisticated
applications the recommendation is a dedicated state manager such as Zustand
(<https://reactflow.dev/api-reference/hooks/use-nodes-state>). The Zustand guide's
stated reason is *architectural*, not performance — "as your application grows and
you need to update the state from within individual nodes, managing this state can
become more complex" — and Zustand is picked because "React Flow already uses it
internally" (<https://reactflow.dev/learn/advanced-use/state-management>).

**No official doc claims that moving the arrays out of the app component removes
the per-drag-frame re-render, and there is no documented pattern for avoiding an
app-level re-render on every drag frame.** What is true, from the bundle:

- In the controlled setup the `nodes` prop flows through `StoreUpdater`
  (`index.js:271`, `:293`) into the store's `setNodes`, whose comment says it "is
  called exclusively in response to user actions" (`index.js:3389`). It calls
  `adoptUserNodes` with `checkEquality: true` (`:3403`), and `adoptUserNodes`
  reuses the existing internal node whenever `userNode === internalNode.internals.userNode`
  (`@xyflow/system` `index.js:1627`). So a drag frame rebuilds one node's
  internals, not all of them — but it still clears and refills `nodeLookup` and
  `parentLookup` and iterates every node (`:1623`–`:1625`). O(n) map churn per
  frame is unavoidable in either setup.
- The app component's own re-render per frame is a consequence of holding the
  array in React state and is not something xyflow can avoid for you. Moving it
  to an external store moves the subscription: with Zustand, the component that
  re-renders is whichever one selects `nodes`, and `<ReactFlow nodes={...}>` still
  has to be one of them. The re-render moves, it does not vanish.
- v12.11 already keeps the **viewport transform** out of React entirely. `Viewport`
  seeds the transform from `store.getState()` without subscribing and then writes
  it to the DOM from a store subscription, with source comments saying exactly
  that: "transform changes every pan/zoom frame, so write it to the DOM directly
  to keep React out of the hot path" (`index.js:3048`–`3070`). So **panning and
  zooming cost no React render at all in 12.11.2** unless something else
  subscribes to `s.transform` — which `onlyRenderVisibleElements` (§3) and any
  `useStore(s => s.transform[2])` zoom reader (this repo, `App.jsx:163`) do.

The maintainers' own performance advice in a large-graph thread is the same shape:
stop pushing per-interaction changes through app state at all — use xyflow's
built-in `selected` handling and CSS (`.react-flow__node.selected`) instead of
mapping over nodes to set a flag, and read neighbour state inside a custom edge
via `useReactFlow()` rather than re-storing it
(<https://github.com/xyflow/xyflow/discussions/4975>).

## 5. Measurement, extents, elevation, z-index

- **Specifying `width`/`height` up front does not avoid measurement work.** Every
  non-hidden node is registered with a shared `ResizeObserver`
  (`index.js:2130`–`2158`, `useNodeObserver` at `:2163`), and the observer's
  callback runs `updateNodeInternals`, which unconditionally calls
  `getDimensions(update.nodeElement)` and then `getBoundingClientRect()` on any
  node needing an update (`@xyflow/system` `index.js:1838`, `:1844`). A node is
  always considered needing one on first pass, because `!node.internals.handleBounds`
  is part of the condition (`:1842`) and handle bounds can only come from the DOM.
  `updateNodeInternals` also reads `window.getComputedStyle(viewportNode)` and
  constructs a `DOMMatrixReadOnly` **once per batch** (`:1818`–`:1819`) — a forced
  layout read, batched across the observer entries rather than per node.
- What `width`/`height` (and `initialWidth`/`initialHeight`) *do* buy is a
  dimension before measurement: `getNodeDimensions` falls back
  `measured → width → initialWidth → 0` (`@xyflow/system` `index.js:785`). That is
  what makes SSR and first-paint culling correct, and it is how the v12 migration
  guide presents them — "This enables server-side rendering capabilities, where
  dimensions can be predefined before client hydration"
  (<https://reactflow.dev/learn/troubleshooting/migrate-to-v12>).
- **The docs contradict themselves here.** The `Node` type reference says width and
  height are "Read-only properties calculated internally by React Flow… You
  shouldn't try to set the `width` or `height` of a node directly" and to use
  `style`/`className` instead (<https://reactflow.dev/api-reference/types/node>),
  while the migration guide shows setting them on a node literal as the v12
  approach (<https://reactflow.dev/learn/troubleshooting/migrate-to-v12>). Issue
  #4516's workaround — move them into `style` — sides with the type reference
  (<https://github.com/xyflow/xyflow/issues/4516>).
- **`nodeExtent`** costs a `clampPosition` per node per `setNodes`, which is four
  `clamp` calls (`@xyflow/system` `index.js:550`). `adoptUserNodes` calls it
  whether or not an extent is configured, defaulting to `infiniteExtent`
  (`index.js:1632`–`1633`). Negligible; it does not add a pass.
- **`elevateNodesOnSelect`** (default `true`,
  <https://reactflow.dev/api-reference/react-flow>) is a single constant in the
  z-computation: `selectedNodeZ = elevateNodesOnSelect && !isManualZIndexMode(zIndexMode) ? SELECTED_NODE_Z : 0`,
  with `SELECTED_NODE_Z = 1000` (`@xyflow/system` `index.js:1547`, `:1620`,
  `:1700`). No extra traversal. Its cost is compositing, not JS: a selected node
  gets a different `z-index`, which can change stacking and layerisation.
- **`zIndexMode`** (`'auto' | 'basic' | 'manual'`, default `'basic'`) — "'auto' is
  for selections and sub flows, 'basic' for selections only, and 'manual' for no
  auto z-indexing" (<https://reactflow.dev/api-reference/react-flow>). `'auto'` is
  the expensive one: it maintains a `rootParentIndex` per root parent and offsets
  child z by `ROOT_PARENT_Z_INCREMENT` during `updateChildNode`
  (`@xyflow/system` `index.js:1678`–`1690`). `'manual'` short-circuits the whole
  computation (`:1718`). With group nodes on canvas, `'basic'` (the default) is
  already doing less than `'auto'` would; nothing here is a per-frame cost.

## 6. CSS on and over a transformed canvas

**(a) `backdrop-filter: blur()` on fixed chrome over a panning canvas.** No xyflow
doc or issue addresses this. Chrome's own material says `backdrop-filter` "may harm
performance and should be tested before deploying"
(<https://web.dev/articles/backdrop-filter>), and the rendering-performance page
gives the tools to check: Paint flashing, which "flashes the screen green whenever
repainting happens", and Layer borders
(<https://developer.chrome.com/docs/devtools/rendering/performance>). Mechanically
the blur samples what is behind the element, so a change behind it dirties it; the
canvas transform changing every frame is such a change. **No primary source states
that the blur is recomputed every frame** — that is the expected behaviour from the
definition, and the honest way to settle it here is Paint flashing plus the
Performance panel on this app, not a citation. Filters are not in the
compositor-only pair (`transform`, `opacity`), which is the one hard rule
(<https://web.dev/articles/stick-to-compositor-only-properties-and-manage-layer-count>).

**(b) Heavy/stacked `box-shadow` during zoom.** The performance guide's own list
names it: "Simplify complex CSS styles, particularly animations, shadows, and
gradients" (<https://reactflow.dev/learn/advanced-use/performance>). A shadow is
paint work, and zooming rescales the layer, so the shadow is re-rasterised at the
new scale. Maintainer observation in the same area: "opacity have a huge impact
when used for edges" and overlapping complex paths "always slow down a flow a lot"
(<https://github.com/xyflow/xyflow/discussions/4617>).

**(c) `will-change` / `contain` / `content-visibility`.**

- `will-change: transform` on the flow container is the most-repeated community
  workaround in the tracker — reported as "a significant performance boost in both
  Chrome and Safari" (<https://github.com/xyflow/xyflow/discussions/5446>) and as
  giving "smooth performance without pixelation artifacts" when applied
  dynamically during interaction (<https://github.com/xyflow/xyflow/discussions/4617>).
  It is **not** in any xyflow doc and MDN is pointed about it: "Use the
  `will-change` property as a last resort to try to deal with existing performance
  problems. Don't use it to anticipate performance problems", and "Don't apply
  `will-change` to too many elements… Overusing the property can cause the page to
  slow down instead of improving its performance"
  (<https://developer.mozilla.org/en-US/docs/Web/CSS/will-change>). MDN's own
  recommended shape is to set it on pointer-down and clear it on animation end.
  Putting it on the container is one element, which is within the rule; putting it
  on every node card is exactly what the rule forbids, and web.dev agrees —
  "Every layer you create requires memory and management, and that's not free" and
  "Do not promote elements unnecessarily"
  (<https://web.dev/articles/stick-to-compositor-only-properties-and-manage-layer-count>).
- `content-visibility: auto` "gains `layout`, `style` and `paint` containment" and
  skips rendering work for offscreen content, needing `contain-intrinsic-size` to
  avoid collapsing to zero height, and the article is explicit that
  "performance only applies offscreen… The optimization doesn't help visible
  content" (<https://web.dev/articles/content-visibility>). On node cards this is
  a browser-level version of §3's culling, with the same loss of layout for
  offscreen content and without the unmount. Untested here; no xyflow source
  mentions it.

**(d) Many `<img>`/`<video>` inside nodes on a transformed layer.** Nothing
official from xyflow. The nearest primary statement is the maintainer-acknowledged
report that at 100+ nodes "browsers still have to consider the layout of all the
transformed layers" even when few are visible, that complex node designs compound
it, and that hiding nodes with CSS and stripping markup helped little
(<https://github.com/xyflow/xyflow/discussions/5446>). moklick's reply there:
"We did some experiments with a canvas renderer for edges but not for nodes yet.
We will probably come back to this topic at some point but it's currently not very
high prioritized." A `<video>` element is its own compositing consideration and
web.dev's layer-count warning applies (see (c)); no source quantifies it.

## 7. React 19

- **Batching is not the lever.** Automatic batching of all updates landed in React
  18, not 19, so nothing about it changed under this app.
- **`useSyncExternalStore` is what xyflow's `useStore` sits on** (via Zustand). Its
  documented contract matters for any custom selector: "While the store has not
  changed, repeated calls to `getSnapshot` must return the same value… If the store
  changes and the returned value is different (as compared by `Object.is`), React
  re-renders", and "The store snapshot returned by `getSnapshot` must be
  immutable. If the underlying store has mutable data, return a new immutable
  snapshot if the data has changed. Otherwise, return a cached last snapshot"
  (<https://react.dev/reference/react/useSyncExternalStore>). **A `useStore`
  selector that allocates — `.filter()`, `.map()`, an object literal — returns a
  fresh reference every call and therefore re-renders on every store update unless
  an `equalityFn` is supplied.** Selecting a scalar or a string sidesteps the
  problem entirely. There is also a transition caveat worth knowing: "for every
  Transition update, React will call `getSnapshot` a second time just before
  applying changes to the DOM", restarting as a blocking update if it differs.
- **React Compiler 1.0 is stable** (released 2025-10-07), "compatible with React 17
  and up", and it automatically memoizes "often as precisely or more precisely
  than manual memoization", with `useMemo`/`useCallback`/`memo` remaining "escape
  hatches" (<https://react.dev/blog/2025/10/07/react-compiler-1>). It is a build
  step you opt into per app; it would apply to this repo's own components.
  **xyflow itself is not compiled with it** — issue #5058, "Compile
  `@xyflow/react` source code with React-Compiler", is open and unassigned
  (<https://github.com/xyflow/xyflow/issues/5058>). So the compiler cannot fix a
  `useNodes()` subscription inside a node: the re-render is caused by a store
  subscription firing, not by an unmemoised prop, and no amount of
  auto-memoization removes a subscription.
- **StrictMode inflates dev numbers.** It "calls component function twice to find
  impure rendering bugs" and re-runs effects setup→cleanup→setup, and these
  "checks only run in development and have no impact on production builds"
  (<https://react.dev/reference/react/StrictMode>). Any per-frame render count
  measured in `npm run dev` is roughly doubled versus the built client. Measure a
  `vite build` before concluding.
- React 19 peer support was a real gap and is closed: issue #5229 ("React 19 not
  supported") was about `zustand@^4` lacking React 19 compatibility and is closed
  (<https://github.com/xyflow/xyflow/issues/5229>); 12.11.2 is what is installed
  against `react@19.2.7`.

## 8. Other officially documented things that bear on this

- **The performance guide's memoisation rule is a hard one:** components passed as
  props to `<ReactFlow>`, "including custom node and edge components, should
  either be memoized using `React.memo` or declared outside the parent component";
  functions passed as props should be `useCallback`'d and objects like
  `defaultEdgeOptions` should be `useMemo`'d
  (<https://reactflow.dev/learn/advanced-use/performance>). This repo declares
  `nodeTypes` at module scope (`App.jsx:108`) — correct — but passes
  `defaultEdgeOptions={{ animated: true }}` as an inline literal
  (`App.jsx:1852`), a fresh object every app render, which is the exact case the
  guide names.
- **The guide's other two suggestions**, neither of which is a prop: "Collapse
  large node trees by toggling the `hidden` property dynamically" and "Show
  limited nodes initially and allow expansion on demand"
  (<https://reactflow.dev/learn/advanced-use/performance>). `hidden` is a documented
  `Node` field (<https://reactflow.dev/api-reference/types/node>), and a hidden node
  is skipped by `getNodesInside` and has its `handleBounds` cleared
  (`@xyflow/system` `index.js:365`, `:1827`).
- **`nodeDragThreshold`** — default `1`; "With a threshold greater than zero you
  can delay node drag events" (<https://reactflow.dev/api-reference/react-flow>).
  It has a second, undocumented effect in the bundle: a non-zero threshold
  suppresses select-on-mousedown (`index.js:2266`–`2267`), so raising it also
  changes selection timing, not just drag start.
- **`panOnScroll`** — default `false`; "Controls if the viewport should pan by
  scrolling inside the container" (<https://reactflow.dev/api-reference/react-flow>).
  No documented cost, and none in the bundle beyond what any pan does — and since
  §4 establishes that the transform no longer goes through React in 12.11, a pan
  is DOM writes, not renders. This repo enables it (`App.jsx:1859`).
- **`edgesReconnectable`** — default `true`
  (<https://reactflow.dev/api-reference/react-flow>). Reconnect handling lives in
  the edge wrapper; nothing documents a cost. If reconnection is not a feature the
  app offers, turning it off removes an interaction surface, not a measurable
  render cost.
- **`<EdgeLabelRenderer />`** exists because "Edges are SVG-based. If you want to
  render more complex labels you can use the `<EdgeLabelRenderer />` component to
  access a div based renderer", and has "no pointer events by default"
  (<https://reactflow.dev/api-reference/components/edge-label-renderer>). It is a
  portal into a single container div (visible in the bundle as
  `<div className="react-flow__edgelabel-renderer" />`, `index.js:3256`); its cost
  is whatever HTML you put in it, per labelled edge, inside the transformed layer.
- **`defaultViewport` vs `fitView`** — `defaultViewport` defaults to
  `{x: 0, y: 0, zoom: 1}` and is "ignored if `fitView` is enabled"
  (<https://reactflow.dev/api-reference/react-flow>). `fitView` waits on node
  measurement (`resolveFitView` is gated on `nodesInitialized`, `index.js:3407`),
  so it costs a measurement round-trip on load that `defaultViewport` does not.
- **`minZoom`/`maxZoom`** default `0.5`/`2`
  (<https://reactflow.dev/api-reference/react-flow>). The stress-test example sets
  `minZoom={0}` to let you zoom all the way out
  (<https://reactflow.dev/examples/nodes/stress>) — worth knowing that a permissive
  `minZoom` is what puts every node on screen at once, which is the worst case for
  §6(d).
- **`useStoreApi()` for read-without-subscribe** — see §1; this repo already uses
  it (`App.jsx:231`).
- **`<ReactFlowProvider>` placement**: any hook must be called "within a component
  rendered inside `<ReactFlow>`" or under a provider
  (<https://reactflow.dev/api-reference/hooks/use-node-connections>). No doc
  attaches a performance consequence to where the provider sits; the store is
  Zustand, so subscribers re-render independently of provider depth.

## The official performance example, and what it does differently

There is no benchmark suite. The one performance-shaped example is **Stress Test**
(`/examples/nodes/stress`), 450 nodes (15 rows × 30 columns) plus edges, with a
button that randomises every node's position at once
(<https://reactflow.dev/examples/nodes/stress>).

What it does differently from a real app is *less*, and that is the finding:

- It sets only `fitView`, `minZoom={0}` and `colorMode="system"`. **It does not set
  `onlyRenderVisibleElements`**, and it does not set `defaultEdgeOptions`.
- Its edges are not animated.
- Its nodes are the built-in default node — a bordered box with a label — with no
  images, no video, no shadows, no blur.
- It holds state with `useNodesState`/`useEdgesState`, i.e. the "prototyping" hooks
  the docs steer production apps away from
  (<https://reactflow.dev/api-reference/hooks/use-nodes-state>).

So the library's own demonstration of 450 nodes at acceptable frame rates is a
demonstration of 450 *cheap* nodes with no per-node subscriptions and no
continuous CSS animation. It is not evidence that a node count is survivable; it
is evidence that node *content* and *subscriptions* are the variables.

Also noted, since it bounds expectations: a maintainer's stated position in the
100+ node discussion is that the HTML renderer is the constraint and a canvas
renderer for nodes has not been attempted and "is currently not very high
prioritized" (<https://github.com/xyflow/xyflow/discussions/5446>).

## Measured on this app, 2026-09-09

Everything above is other people's claims with a citation. This section is ours, so it
has a method instead.

To take a reading by hand, on a real board, load the canvas with **`?fps=1`**
(`client/src/debug/fps.js`). It reports per gesture rather than continuously, because an
idle canvas sits at the refresh rate and that number answers nothing — the question is
whether DRAGGING drops frames, and the answer has to survive letting go of the mouse to
be read. It learns the display's own frame time from idle frames instead of assuming
16.7ms, which on a 120Hz screen is already two frames late. `window.__fps.dump()` gives
the settled gestures. Chrome's Rendering → Frame Rendering Stats is the zero-code
alternative and gives an instantaneous FPS number only.

The numbers below came from the automated version of the same thing: a production
`vite build` served by the engine
(`UNFRAMED_CLIENT_DIST`, so no dev server, no HMR and no StrictMode double-render),
driven in headless Chrome over CDP with real `Input.dispatchMouseEvent` gestures, frame
gaps sampled with `requestAnimationFrame` and component renders counted by temporary
per-component counters. Synthetic boards of prompt + image + `imageOutput` clusters with
real PNG files. The machine idles at 8.3ms a frame (120Hz), which is the floor every
number below is against, not 16.7.

Two gestures, 50 steps each, on a 120-node board — before, and after the changes this
research produced:

| | renders | median frame | frames >16.7ms | frames >33ms |
| --- | --- | --- | --- | --- |
| drag one node, before | 3,950 | 25.0ms | 50 of 79 | 18 |
| drag one node, after | 290 | 8.3ms | 2 of 144 | 0 |
| pan, before | 56 | 8.3ms | 0 | 0 |
| pan, after | 4 | 8.3ms | 0 | 0 |

The isolating detail, and the reason §1 is the whole story: during the "before" drag
`PromptNode` rendered **zero** times while every image and output node rendered ~94
times each. The only difference between them was that the others called `useNodes()`.
Panning was never slow — v12 keeps the transform out of React (§4) — and the 56 pan
renders were one component subscribing to `s.transform` with nothing selected.

At 300 nodes the drag was still 24ms a frame on 204 renders, so the remainder was not
React. A CPU profile of the drag named it: `bucketSources` 12.3% self time and
`findFreeSource` 7.1%, ~200ms of a 1,700ms gesture. Both open by building a node-by-id
`Map` over the whole array, and the canvas calls them once per output node per frame.
Caching that map on the array's identity took them to 2.4% and 1.3% — 126ms → 23ms and
73ms → 13ms — and the 300-node drag from 24ms to 10.2ms a frame, with frames over 33ms
going 8 → 1. After that `(program)` (browser layout, paint, composite) is 47% of the
profile and is the floor.

**§6's CSS costs are UNMEASURED, not disproved — and this file said otherwise for one
revision.** They were A/B'd by injecting `!important` overrides and panning 60 ticks
each: baseline, no `backdrop-filter`, no `box-shadow`, no dash animation, and all three
off together all came out at 8.3ms median with zero late frames, which was written up as
"the CSS costs did not reproduce". Then the instrument was validated and that conclusion
had to be withdrawn.

**Validate the instrument before believing a negative result.** Two deliberate
slowdowns, injected into the running page, panning the same 60 ticks:

| injected | rAF median | presented-frame median |
| --- | --- | --- |
| nothing (baseline) | 8.3ms | 24.9ms |
| 25ms busy loop inside rAF (main thread) | **25.0ms** | — |
| `blur(6px) drop-shadow()` on every node (paint only) | 8.3ms | 25.1ms |
| full-screen `backdrop-filter: blur(30px)` (paint only) | 8.3ms | 24.9ms |

rAF gaps track main-thread work exactly and are **completely blind to paint and
composite**: headless Chrome has no display, so rAF runs on a synthetic clock that is
not gated on rasterisation. `Page.screencastFrame` intervals were tried as a
paint-sensitive substitute and are blind too — every run returned exactly 71 frames at
~25ms, pinned to the harness's own input cadence rather than to presentation.

So everything in the "Measured" table above stands, because it is main-thread work and
is corroborated independently by the CPU profile — but **no claim about `backdrop-filter`,
`box-shadow` or the dash animation can be supported from this environment at all**, in
either direction. On real hardware rAF *is* vsync-aligned, so the in-app `?fps=1` meter
does catch paint cost; a reading taken on the actual machine is the authority here and
nothing headless can substitute for it.

**On the real boards, the main-thread cost was never the problem.** The table above is
synthetic boards. Re-run against copies of eight actual projects (the largest 55 nodes,
45 of them images), the **pre-fix** build already dragged at 8.3ms median with 1 late
frame — at fit view and at every zoom up to 1.17. The synthetic boards over-represented
the one thing the `useNodes()` cost scales on: output nodes and edges. `rolesIndex` is
O(consumers × (N+E)) per subscriber, and a real board is sparsely wired — 55 nodes but
only **5 outputs and 21 edges**, against 120 nodes with 24 outputs and 96 edges
synthetically. That is ~15× less work per frame, and it lands under the frame budget
either way. The fix is still right, and it is what makes a dense board survive, but it
is not what a real board was waiting on.

Nor is loading. A pre-media-extraction project carries every image inline as a base64
`dataUrl`, so `graph.json` is 51MB — and the one-time server-side rewrite to files
(`server/media.js`) takes **0.64s once**, 4ms on every open after, and leaves a 34KB
snapshot. Browser open to 55 nodes with 50 images decoded: **~295ms**.

**The dev server is not the app, and it is what "slow and heavy" turned out to mean.**
A reading taken on the real machine at 120Hz, on `dither-landing-page`, dragging: the
dev server dropped **one frame in three** with worst frames of 75–125ms, and the
production build of the same commit dropped **none**. Reproduced headlessly, and
decomposed — late frames per gesture, ~270 frames each:

| build | zoom 0.12 (1548× minification) | zoom 0.50 (84×) |
| --- | --- | --- |
| dev server, StrictMode on | 34% | 29% |
| dev server, StrictMode off | 21% | 20% |
| production build | **1%** | **0%** |

So roughly 20 points come from unminified dev code and another 13 from StrictMode
rendering every component twice — both dev-only, and both **zoom-independent**. Anyone
measuring frame rate on `npm run dev` is measuring the dev server. Use a
`UNFRAMED_CLIENT_DIST` build for any number that gets quoted.

It also says something about headroom, which "0% late" alone hides: one render pass per
frame fits the 8.3ms budget and two does not, so there is about 2× of it. A board
denser than these — which is what the synthetic tests were — spends that, and is why the
subscription fixes above are worth having even though these boards did not need them.

**The overdraw hypothesis below is NOT supported, and is kept only as a memory fact.**
An earlier revision proposed image minification as the remaining cost. It fails two
ways: the production build is clean at 1490× minification on the real machine, and the
lateness that was there is flat across a 18× range of minification. Whatever else the
decoded bitmap costs, it is not costing frames here. Decoded bitmap versus the screen
area it is drawn into, at fit view:

| project | images | zoom | decoded | on screen | overdraw |
| --- | --- | --- | --- | --- | --- |
| dither-landing-page | 50 | 0.13 | 64.4MP (~260MB RGBA) | 0.05MP | **1210×** |
| portfolio | 34 | 0.14 | 39.9MP (~160MB RGBA) | 0.04MP | 1031× |
| tattoo | 11 | 0.52 | 12.0MP (~50MB RGBA) | 0.19MP | 65× |

Every full-resolution bitmap is held to be drawn as a thumbnail, so ~260MB of RGBA is
resident for a board whose images occupy 0.05 megapixels of screen. That is worth
knowing for memory — it is most of what a tab on one of these projects holds — but it is
not a frame-rate problem, per the measurements above. Thumbnailing would buy memory, not
smoothness, and it would cost image fidelity, so nothing here argues for it.

**`onlyRenderVisibleElements` must stay off here**, for an app-specific reason the docs
do not have: culled nodes unmount, and `ImageOutputNode` holds a finished batch's bytes
in component state, which its own comment calls "the only place a freshly returned
base64 lives". Panning away from a node mid-batch would throw away images the user paid
for. That is a correctness objection, not a performance one, and it does not expire.

**`React.memo` on the custom node components helps load, not dragging.** Measured
separately: it left the drag numbers where they were (React Flow already memoises its own
`NodeWrapper` behind a per-node selector, §1) but cut mount churn on a 120-node board by
a third to two thirds — `PromptNode` 150 → 50 renders, `ImageNode` 144 → 96. Kept for
that.

## Unknown / not documented

- **Whether `backdrop-filter: blur()` is recomputed on every frame of a pan.** No
  primary source states it. It follows from the filter sampling its backdrop, but
  neither Chrome's docs nor any xyflow issue confirms the per-frame cost, and
  Chrome may cache. Still open as a mechanism: the A/B above shows only that it
  costs this app nothing measurable in frame pacing, which is not the same as
  showing it is not recomputed. Paint flashing and the Performance panel would
  settle the mechanism (<https://developer.chrome.com/docs/devtools/rendering/performance>).
- **What the dash animation and the blur cost in GPU time and battery.** The A/B
  above measured main-thread frame pacing, which is blind to both. #4149's
  95%-GPU report (§2) is therefore neither confirmed nor refuted here, and it is
  the reason to keep asking: a laptop on battery is the case a 120Hz desktop with
  headroom cannot speak for.
- **Any node-count threshold for `onlyRenderVisibleElements`.** The docs give none,
  the prop reference gives none, and the tracker's data points are anecdotal and
  contradictory (it helped in #967, it did nothing for #4149). The stress-test
  example implies 450 plain nodes do not need it.
- **Whether xyflow considers `useNodes()` inside a custom node acceptable at small
  node counts.** The warning is unconditional and unquantified: "a common cause of
  performance issues" (<https://reactflow.dev/api-reference/hooks/use-nodes>). No
  doc says "fine below N".
- **A documented pattern for a whole-graph-derived per-node value** (this repo's
  `sourceRoles` ordinal). The computing-flows guide covers connected-neighbour
  data only (<https://reactflow.dev/learn/advanced-use/computing-flows>); nothing
  covers an ordering over all nodes.
- **A documented way to avoid an app-level re-render per drag frame.** The Zustand
  guide's argument is architectural, not performance
  (<https://reactflow.dev/learn/advanced-use/state-management>), and no doc claims
  the external store removes the frame-rate render. It relocates the subscriber.
- **An official recommendation for animated-edge motion.** #4149 closed with no
  guidance (<https://github.com/xyflow/xyflow/issues/4149>); the transform-based
  alternative in §2 is the web.dev rule applied, not an xyflow pattern.
- **Whether `will-change: transform` on `.react-flow` is endorsed.** It is
  community advice in two discussions
  (<https://github.com/xyflow/xyflow/discussions/5446>,
  <https://github.com/xyflow/xyflow/discussions/4617>) with no maintainer
  endorsement and no ship into the library's own CSS — checked: the string does not
  appear in `@xyflow/react/dist/base.css`. MDN's "last resort" framing applies
  (<https://developer.mozilla.org/en-US/docs/Web/CSS/will-change>).
- **The cost of `<img>`/`<video>` in nodes on a transformed layer, quantified.**
  Only the qualitative report in #5446 exists
  (<https://github.com/xyflow/xyflow/discussions/5446>).
- **Whether `content-visibility: auto` on node cards is safe with React Flow's
  measurement.** Untested and unmentioned by either project. It applies size
  containment offscreen (<https://web.dev/articles/content-visibility>), which
  interacts with the `ResizeObserver` of §5 in a way nobody has documented.
- **Which docs statement about `width`/`height` on a node is current** — the type
  reference forbids it, the migration guide demonstrates it
  (<https://reactflow.dev/api-reference/types/node> vs
  <https://reactflow.dev/learn/troubleshooting/migrate-to-v12>).
- **Whether `edgesReconnectable={false}` or `nodeDragThreshold` changes measurably
  cost anything.** No doc or issue quantifies either.
