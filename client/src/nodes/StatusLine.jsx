import { Icon } from '@astryxdesign/core/Icon';
import { Text } from '@astryxdesign/core/Text';
import { HStack } from '@astryxdesign/core/Stack';

// One shape for every status a node shows: an icon and a sentence. Never a bare
// dot — a dot says "something is up" and leaves the reader to infer what from its
// colour alone, which is also the one channel colour-blind users don't have.
//
// The icon carries the semantic colour and the text stays supporting: Text has no
// error/warning/success colour (only primary/secondary/disabled/placeholder/accent),
// so `color="error"` on a Text was silently doing nothing wherever it was used.
const ICONS = { error: 'error', warning: 'warning', success: 'success', info: 'info' };
// info is the odd one out: it marks guidance rather than an outcome, so it stays
// quiet instead of pulling accent colour.
const COLORS = { error: 'error', warning: 'warning', success: 'success', info: 'secondary' };

// An error is only useful if it can be read in full, and provider messages carry
// unbreakable tokens — OpenRouter's request ids are 40+ characters with no space
// in them. Left alone, one of those sets the row's min-content width and pushes
// the text out past the node's edge, clipping every line. Hence the class: shrink
// below content width, and break anywhere rather than overflow.
export default function StatusLine({ type = 'info', children }) {
  return (
    <HStack gap={1} align="start">
      <Icon icon={ICONS[type]} size="sm" color={COLORS[type]} />
      <Text type="supporting" className="xnode-status-text">
        {children}
      </Text>
    </HStack>
  );
}
