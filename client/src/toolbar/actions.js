// What the selection toolbar's first group offers, decided by the selection (design
// canvas boards 2, 2a, 3): one output -> its own action with the output's size as the
// hint; one page -> Open; a lone input -> nothing but Agent; several -> the count.
// Connect/Disconnect stay in the right-click menu. Pure, pinned in actions.test.js.
import { isOutput, isArtifact } from '../graph/resolve.js';

// The one line an output's Generate carries: what it is set to make.
export function sizeHint(node) {
  const d = node?.data ?? {};
  if (typeof d.size === 'string' && /\d+x\d+/i.test(d.size)) return d.size.toLowerCase().replace('x', '×');
  const parts = [d.resolution, d.aspect_ratio].filter((v) => typeof v === 'string' && v);
  return parts.join(' · ');
}

// -> { primary: { kind, label, hint, nodeId } | null, count }
export function toolbarActions(selected) {
  const count = selected.length;
  if (count === 0) return { primary: null, count };
  if (count > 1) return { primary: { kind: 'count', label: `${count} selected` }, count };
  const [n] = selected;
  if (isOutput(n)) {
    const busy = Boolean(n.data?.running || n.data?.job);
    return {
      primary: {
        kind: 'run',
        label: n.type === 'textOutput' ? 'Run' : 'Generate',
        hint: n.type === 'textOutput' ? '' : sizeHint(n),
        nodeId: n.id,
        busy,
      },
      count,
    };
  }
  if (isArtifact(n)) {
    return { primary: n.data?.file ? { kind: 'open', label: 'Open', hint: n.data?.title || '', nodeId: n.id } : null, count };
  }
  return { primary: null, count };
}
