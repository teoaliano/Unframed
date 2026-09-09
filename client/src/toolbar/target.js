// What a composer message is about, from the selection (the two rules settled in
// status.md and the slice-1 spec): exactly one artifact selected -> it is the target and
// the rest come "with"; none -> the target is a new asset the agent creates beside the
// selection; several -> the agent must ask, and the composer says so before you type.
// Pure, pinned in target.test.js.
import { isArtifact } from '../graph/resolve.js';

// `focus` is the artifact the panel's active thread is about (slice 3): with no artifact
// in the selection, the message goes to it ("Add to <title>") rather than to a new asset.
// A selected artifact still wins -- selecting one is a more deliberate statement than
// having a tab open.
// -> { target: <id> | 'new' | 'ask', with: [ids], artifacts: [ids] }
export function messageTarget(selected, focus = null) {
  const artifacts = selected.filter(isArtifact).map((n) => n.id);
  const rest = selected.filter((n) => !isArtifact(n)).map((n) => n.id);
  if (artifacts.length === 1) return { target: artifacts[0], with: rest, artifacts };
  if (artifacts.length === 0 && focus) return { target: focus, with: rest, artifacts: [focus] };
  if (artifacts.length === 0) return { target: 'new', with: rest, artifacts };
  return { target: 'ask', with: selected.map((n) => n.id), artifacts };
}

// Adding a node to an open composer: a second artifact makes the target ambiguous, an
// input joins "with". Idempotent -- clicking the same node twice adds it once.
export function addToTarget(state, node) {
  if (state.with.includes(node.id) || state.target === node.id) return state;
  if (isArtifact(node)) {
    const artifacts = [...state.artifacts, node.id];
    if (state.target === 'new') return { target: node.id, with: state.with, artifacts };
    return { target: 'ask', with: [...state.with, node.id, ...(state.target !== 'ask' ? [state.target] : [])].filter((v, i, a) => a.indexOf(v) === i), artifacts };
  }
  return { ...state, with: [...state.with, node.id] };
}

// What the composer's "To" line reads.
export function targetLabel(state, nodes) {
  if (state.target === 'new') return 'new asset';
  if (state.target === 'ask') return `${state.artifacts.length} artifacts selected — pick one`;
  const n = nodes.find((x) => x.id === state.target);
  if (!n) return state.target;
  return `${n.type} · ${n.data?.title || n.data?.fileName || n.id}`;
}
