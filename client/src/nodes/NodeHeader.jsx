import { useState } from 'react';
import { Text } from '@astryxdesign/core/Text';

// The node title bar. Doubles as the React Flow drag handle (.xnode-head).
// `family` distinguishes inputs (prompt, image — they only feed edges) from outputs
// (output, text — they consume edges), which is the engine's one rule made visible.
// When copyId is set, clicking (without dragging) copies "@<id>" so it can be
// pasted into a prompt as a reference; `right` shows static text instead.
export default function NodeHeader({ kind, family = 'input', copyId, right, rightTone = 'secondary' }) {
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
      <Text type="supporting" weight="medium" color={family === 'output' ? 'accent' : undefined}>
        {kind}
      </Text>
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
