// What a composer message is about, from the selection: exactly one artifact selected ->
// it is the target and the rest come "with"; otherwise the target is a new asset the agent
// creates beside the selection, and everything selected comes with it. Pure, pinned in
// target.test.js.
//
// Several artifacts used to be a third case -- "the agent must ask" -- written for the
// edit ("which page do you mean?"). It was reversed on 2026-09-06 for the case it did not
// foresee: several motions selected and "stitch these" is not ambiguous, it is a
// statement, and the statement is "a new asset from these". If the person did mean to
// edit one of them, the agent asks in its reply, which is a better place for the
// question than a warning under the composer (slice-4 spec).
import { isArtifact } from '../graph/resolve.js';

// `focus` is the artifact the panel's active thread is about (slice 3): with no artifact
// in the selection, the message goes to it ("Add to <title>") rather than to a new asset.
// A selected artifact still wins -- selecting one is a more deliberate statement than
// having a tab open.
// -> { target: <id> | 'new', with: [ids], artifacts: [ids] }
export function messageTarget(selected, focus = null) {
  const artifacts = selected.filter(isArtifact).map((n) => n.id);
  const rest = selected.filter((n) => !isArtifact(n)).map((n) => n.id);
  if (artifacts.length === 1) return { target: artifacts[0], with: rest, artifacts };
  if (artifacts.length === 0 && focus) return { target: focus, with: rest, artifacts: [focus] };
  if (artifacts.length === 0) return { target: 'new', with: rest, artifacts };
  return { target: 'new', with: selected.map((n) => n.id), artifacts };
}

// Adding a node to an open composer: an input joins "with"; the first artifact becomes
// the target; a second turns the message into "a new asset from these", with both of
// them along. Idempotent -- clicking the same node twice adds it once.
export function addToTarget(state, node) {
  if (state.with.includes(node.id) || state.target === node.id) return state;
  if (isArtifact(node)) {
    const artifacts = [...state.artifacts, node.id];
    if (state.target === 'new' && artifacts.length === 1) return { target: node.id, with: state.with, artifacts };
    const previous = state.target !== 'new' ? [state.target] : [];
    return { target: 'new', with: [...state.with, ...previous, node.id].filter((v, i, a) => a.indexOf(v) === i), artifacts };
  }
  return { ...state, with: [...state.with, node.id] };
}

// What the composer's "To" line reads.
export function targetLabel(state, nodes) {
  if (state.target === 'new') return state.artifacts.length > 1 ? `new asset from ${state.artifacts.length} artifacts` : 'new asset';
  const n = nodes.find((x) => x.id === state.target);
  if (!n) return state.target;
  return `${n.type} · ${n.data?.title || n.data?.fileName || n.id}`;
}
