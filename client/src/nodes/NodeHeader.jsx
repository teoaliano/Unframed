import { Text } from '@astryxdesign/core/Text';
import { Icon } from '@astryxdesign/core/Icon';
import { NODE_ICONS } from './nodeIcons.jsx';

// The node title bar. Doubles as the React Flow drag handle (.xnode-head).
// `family` distinguishes inputs (prompt, image, video — they only feed edges) from
// outputs (they consume edges), which is the engine's one rule made visible.
//
// It carries NO interaction of its own. It used to copy "@<id>" on click, which put a
// button on the one strip of a node that has to stay grabbable: the drag handle. Every
// attempt to drag or select a prompt by its header also copied, and a click that lands
// on a control is a click that is not selecting. The reference moved to the right-click
// menu (App.jsx), where it costs nothing to reach and nothing to avoid. Referenceable
// nodes pass their id as plain `right` text, so the id is still readable on the canvas.
//
// `kind` is the type id and `title` is what the header reads, because after the
// output split the two differ: the output types are `imageOutput`/`videoOutput`/
// `textOutput` internally so they cannot collide with the `image`/`video` INPUT
// nodes, but they are titled by their medium on the canvas, where the accent colour
// already marks the family. Defaults to the type id, which is every other node.
export default function NodeHeader({ kind, title, family = 'input', right, rightTone = 'secondary' }) {
  return (
    <div className={`xnode-head xnode-head--${family}`}>
      <span className="xnode-head-title">
        {NODE_ICONS[kind] && (
          <Icon icon={NODE_ICONS[kind]} size="xsm" color={family === 'output' ? 'accent' : 'secondary'} />
        )}
        <Text type="supporting" weight="medium" color={family === 'output' ? 'accent' : undefined}>
          {title ?? kind}
        </Text>
      </span>
      {right != null && (
        <Text type="supporting" color={rightTone}>{right}</Text>
      )}
    </div>
  );
}
