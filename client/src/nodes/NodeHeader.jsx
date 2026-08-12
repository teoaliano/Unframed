import { useState } from 'react';
import { Text } from '@astryxdesign/core/Text';
import { Icon } from '@astryxdesign/core/Icon';
import { NODE_ICONS } from './nodeIcons.jsx';

// The node title bar. Doubles as the React Flow drag handle (.xnode-head).
// `family` distinguishes inputs (prompt, image, video — they only feed edges) from
// outputs (they consume edges), which is the engine's one rule made visible.
// When copyId is set, clicking (without dragging) copies "@<id>" so it can be
// pasted into a prompt as a reference; `right` shows static text instead.
//
// `kind` is the type id and `title` is what the header reads, because after the
// output split the two differ: the output types are `imageOutput`/`videoOutput`/
// `textOutput` internally so they cannot collide with the `image`/`video` INPUT
// nodes, but they are titled by their medium on the canvas, where the accent colour
// already marks the family. Defaults to the type id, which is every other node.
export default function NodeHeader({ kind, title, family = 'input', copyId, right, rightTone = 'secondary' }) {
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard?.writeText(`@${copyId}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1000);
  }

  return (
    <div
      className={`xnode-head xnode-head--${family}${copyId != null ? ' xnode-head--copy' : ''}`}
      onClick={copyId != null ? copy : undefined}
      title={copyId != null ? 'Click to copy this reference' : undefined}
    >
      <span className="xnode-head-title">
        {NODE_ICONS[kind] && (
          <Icon icon={NODE_ICONS[kind]} size="xsm" color={family === 'output' ? 'accent' : 'secondary'} />
        )}
        <Text type="supporting" weight="medium" color={family === 'output' ? 'accent' : undefined}>
          {title ?? kind}
        </Text>
      </span>
      {copyId != null && (
        <Text type="supporting" color={copied ? 'accent' : 'secondary'}>
          {copied ? 'copied!' : `@${copyId}`}
        </Text>
      )}
      {right != null && (
        <Text type="supporting" color={rightTone}>{right}</Text>
      )}
    </div>
  );
}
