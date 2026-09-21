// What a composer message comes WITH -- the selection, as context. Pure, pinned in
// target.test.js.
//
// This file used to decide what a message was ABOUT: one artifact selected made it the
// "To", none made it a new asset, several were ambiguous and the composer said "pick
// one". That is gone. The selection is context and the agent decides what the sentence
// means about it (docs/superpowers/specs/2026-09-06-chats-and-tags-design.md, decision
// 2), so several artifacts is an ordinary thing to select, not an error to resolve, and
// there is no mode for the person to pick. Nothing here may re-invent a target: the only
// job left is saying, in words, what the agent is about to be shown.
import { isArtifact } from '../graph/resolve.js';

// -> { selection: [ids], artifacts: [ids] }
// `artifacts` is the subset that can carry a tag, kept separately because the strip
// filters on it and a new chat is created tagged with it.
export function messageContext(selected) {
  return {
    selection: selected.map((n) => n.id),
    artifacts: selected.filter(isArtifact).map((n) => n.id),
  };
}

// Clicking another node while the composer is open. Idempotent -- clicking the same node
// twice adds it once -- and returns the SAME object when nothing changed, so the composer
// does not re-render on a no-op.
export function addToContext(state, node) {
  if (state.selection.includes(node.id)) return state;
  return {
    selection: [...state.selection, node.id],
    artifacts: isArtifact(node) ? [...state.artifacts, node.id] : state.artifacts,
  };
}

const NAMES = 3;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const nameOf = (n) => n.data?.title || n.data?.fileName?.replace(/\.html?$/i, '') || n.id;

// "2 motions", "1 image" -- the node's own kind when they are all the same kind, and the
// `fallback` when they are mixed, since there is no honest shorter word for a page and a
// motion together, or for an image and a prompt.
function countOf(picked, fallback) {
  const kinds = new Set(picked.map((n) => n.type));
  return plural(picked.length, kinds.size === 1 ? [...kinds][0] : fallback);
}

// What the composer's context chip reads: the artifacts by name, then what else came
// along. It names the artifacts and only counts the rest because the artifacts are what
// the message will change and the rest is material -- "which two motions" is a question
// worth answering before you type, "which three images" is not.
export function contextLabel({ selection, artifacts }, nodes) {
  if (!selection.length) return 'nothing selected';
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const picked = artifacts.map((id) => byId.get(id)).filter(Boolean);
  const inputs = selection.filter((id) => !artifacts.includes(id)).map((id) => byId.get(id)).filter(Boolean);
  if (!picked.length) return inputs.length ? countOf(inputs, 'input') : 'nothing selected';

  const names = picked.slice(0, NAMES).map(nameOf).join(', ');
  const more = picked.length > NAMES ? ` +${picked.length - NAMES}` : '';
  const rest = inputs.length ? ` · with ${countOf(inputs, 'input')}` : '';
  return `${countOf(picked, 'artifact')} — ${names}${more}${rest}`;
}
