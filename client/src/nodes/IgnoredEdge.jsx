import { BaseEdge, getBezierPath } from '@xyflow/react';

// An edge whose source the target will not send. Red, still, and titled: colour is
// never the only channel here (see StatusLine), so the badge reads "—", the node
// carries a count, and this carries a sentence on hover. BaseEdge's default
// interactionWidth gives the invisible 20px band that makes hovering a 1.5px line
// possible at all.
export default function IgnoredEdge({
  sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd,
}) {
  const [path] = getBezierPath({
    sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition,
  });
  return (
    <g className="xedge-ignored">
      <title>
        Not sent: this output&apos;s input mode has no slot for it. Switch the mode to
        References, or unwire it.
      </title>
      <BaseEdge path={path} markerEnd={markerEnd} />
    </g>
  );
}
