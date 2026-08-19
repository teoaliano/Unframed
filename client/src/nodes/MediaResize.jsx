import { NodeResizeControl } from '@xyflow/react';

// The resize edges of a reference node. Shared by ImageNode and VideoNode: the rules
// below are subtle enough that two copies would drift, and neither node has anything to
// add to them.
//
// All four edges, the right one included. It overlaps the source handle, which is fine
// because the handle sits above these strips (styles.css) and so keeps its own 24px
// target — the dot still starts a connection, the rest of that edge resizes.
//
// No corner controls: an edge is enough, and four little tabs on every reference node is
// chrome nobody asked for.
const EDGES = ['top', 'right', 'bottom', 'left'];

export default function MediaResize() {
  return EDGES.map((pos) => (
    <NodeResizeControl
      key={pos}
      className="xnode-resize"
      position={pos}
      variant="line"
      // Scale, and only scale: keep the media's ratio and write WIDTH only, so its own
      // aspect ratio computes the height in CSS and the picture keeps its exact
      // proportions from any edge — nothing is ever cropped or letterboxed. React Flow
      // derives a width from a vertical drag when keepAspectRatio is on, which is what
      // lets the top and bottom edges scale as well as the sides.
      //
      // minHeight/maxHeight are not dead despite no height ever being written: with
      // keepAspectRatio on, React Flow clamps the derived width through them too.
      //
      // No props here may change while a node is mounted, and no handlers are passed at
      // all, both on purpose. NodeResizeControl's effect calls its resizer's destroy()
      // — which strips d3's mousedown listener — on any change to a handler identity or
      // to keepAspectRatio, but it only CREATES a resizer when its ref is empty, and
      // destroy() does not empty it. A changed prop therefore does not rebuild the drag
      // behaviour, it removes it: the control silently stops resizing until the
      // component remounts. An inline arrow handler would break it on the first drag.
      keepAspectRatio
      resizeDirection="horizontal"
      minWidth={140}
      maxWidth={900}
      minHeight={100}
      maxHeight={900}
    />
  ));
}
