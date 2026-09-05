import { Text } from '@astryxdesign/core/Text';

// The right end of a node's name row, opposite the tab. Every node type has exactly one
// fact that reports on the node as a whole rather than being part of its content, and
// this is where that fact goes — outside the card, so nothing is ever drawn over a
// picture, a clip or a field.
//
//   image / video  the connection role from sourceRoles ("image 1", "first frame", …)
//   prompt         its @id
//   outputs        what the run cost, the result count, a video's estimate
//
// `live` is the difference between "this is feeding something right now" and "this is
// just a fact about the node": a live line gets the accent dot and medium weight, an
// idle one is secondary at regular weight with no dot. `not connected`, an @id and a
// cost are all idle. Two channels, not colour alone.
//
// Nothing renders when there is nothing to say (an empty image node has no role), so
// the line takes no space at all rather than reserving an empty strip.
export default function NodeLine({ live = false, className = '', children }) {
  if (children == null || children === '') return null;
  return (
    <span
      className={`xnode-line${live ? ' xnode-line--live' : ''}${className ? ` ${className}` : ''}`}
    >
      {live && <span className="xnode-line-dot" />}
      <Text type="supporting" weight={live ? 'medium' : undefined} color={live ? undefined : 'secondary'}>
        {children}
      </Text>
    </span>
  );
}
