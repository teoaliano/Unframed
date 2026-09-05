import { Text } from '@astryxdesign/core/Text';
import { Icon } from '@astryxdesign/core/Icon';
import { NODE_ICONS } from './nodeIcons.jsx';

// The node's name tag. It is DOCKED onto the card's top-left edge rather than being a
// bar inside it — `border-bottom: none` plus a -1px margin makes its bottom border and
// the card's top border one line, which is what makes it read as part of the node
// instead of a chip floating above one. See
// docs/superpowers/specs/2026-08-20-node-anatomy-redesign-design.md.
//
// Why it left the card at all: the box now holds CONTENT ONLY. A title bar inside an
// image node was 28px of the picture you were trying to look at, and the medium is
// already said by the icon. Everything that reports ON a node rather than being part of
// it — the connection role, an @id, a run's cost — lives in NodeLine below the card.
//
// It carries no interaction of its own beyond an optional `onDoubleClick`. It used to
// copy "@<id>" on single click, which put a button on the one strip of a node that has to
// stay grabbable; the reference moved to the right-click menu (App.jsx). A DOUBLE click
// is a different matter and is what a group uses to rename itself: it cannot be hit by
// accident while dragging, so the strip stays grabbable, which was the whole objection.
//
// `family` is the ONLY colour telling the two families apart, and that is deliberate:
// the accent border that used to ring every output card is gone, so both families share
// one neutral card border. An input tab is a surface-filled tag; an output tab is SOLID
// accent. Two consequences that are expensive to rediscover:
//
//   1. The tab's FILL is spent on family, which is why selection is a doubled border
//      (styles.css) and not a filled tab. Moving family back to ink frees the fill.
//   2. Below the zoom threshold the tab is hidden, so nothing distinguishes the
//      families out there any more. The spec's "Left open" records the fix if it
//      turns out to matter.
//
// `kind` is the type id and `title` is what the tab reads, because after the output
// split the two differ: the output types are `imageOutput`/`videoOutput`/`textOutput`
// internally so they cannot collide with the `image`/`video` INPUT nodes, but they are
// titled by their medium on the canvas. Defaults to the type id, which is every other
// node.
export default function NodeHeader({ kind, title, family = 'input', onDoubleClick }) {
  return (
    <span className={`xnode-tab xnode-tab--${family}`} onDoubleClick={onDoubleClick}>
      {NODE_ICONS[kind] && <Icon icon={NODE_ICONS[kind]} size="xsm" />}
      <Text type="supporting" weight="medium">{title ?? kind}</Text>
    </span>
  );
}
