import { NodeResizeControl } from '@xyflow/react';

// The resize edges of an input node. Shared by ImageNode, VideoNode and PromptNode: the
// rules below are subtle enough that three copies would drift.
//
// All four edges, the right one included. It overlaps the source handle, which is fine
// because the handle sits above these strips (styles.css) and so keeps its own 32px
// target — the dot still starts a connection, the rest of that edge resizes.
//
// No corner controls: an edge is enough, and four little tabs on every node is chrome
// nobody asked for. The strips used to draw NOTHING, not even on hover, with a comment
// saying the affordance was a redesign's to decide. It now lights the edge under the
// pointer (styles.css) — see
// docs/superpowers/specs/2026-08-20-node-anatomy-redesign-design.md.
const EDGES = ['top', 'right', 'bottom', 'left'];

// `free` is a per-TYPE constant, never a value that flips while a node is mounted, and
// that is load-bearing rather than incidental — see the props warning below.
//
//   free={false}  media. Scale, and only scale: keep the picture's ratio and write
//                 WIDTH only, so its own aspect ratio computes the height in CSS and
//                 the media keeps its exact proportions from any edge — nothing is ever
//                 cropped or letterboxed. React Flow derives a width from a vertical
//                 drag when keepAspectRatio is on, which is what lets the top and bottom
//                 edges scale as well as the sides.
//
//   free={true}   the prompt. A text field has no ratio to preserve, so both axes are
//                 the user's and both get written. This is why `withDrag` in
//                 graph/starter.js now has to seed a height for prompt nodes and not
//                 only a width: for media, an undefined height is what makes the ratio
//                 rule above work, so the two cases genuinely differ.
// `max` follows the same rule as `free`: a per-TYPE constant, never a value that flips
// while the node is mounted. A group is a box drawn AROUND other nodes, so it routinely
// needs to be larger than any single node ever is -- 900 would have clamped a box the
// moment you tried to widen one wrapping three images.
export default function MediaResize({ free = false, max = 900 }) {
  return EDGES.map((pos) => (
    <NodeResizeControl
      key={pos}
      className="xnode-resize"
      position={pos}
      variant="line"
      // minHeight/maxHeight are not dead for the media case despite no height ever being
      // written: with keepAspectRatio on, React Flow clamps the derived width through
      // them too.
      //
      // No props here may change while a node is mounted, and no handlers are passed at
      // all, both on purpose. NodeResizeControl's effect calls its resizer's destroy()
      // — which strips d3's mousedown listener — on any change to a handler identity or
      // to keepAspectRatio, but it only CREATES a resizer when its ref is empty, and
      // destroy() does not empty it. A changed prop therefore does not rebuild the drag
      // behaviour, it removes it: the control silently stops resizing until the
      // component remounts. An inline arrow handler would break it on the first drag,
      // and so would deriving `free` from anything but the node's type.
      keepAspectRatio={!free}
      resizeDirection={free ? undefined : 'horizontal'}
      minWidth={free ? 180 : 140}
      maxWidth={max}
      minHeight={free ? 96 : 100}
      maxHeight={max}
    />
  ));
}
