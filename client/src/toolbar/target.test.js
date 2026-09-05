// Assert-based self-check. Run with: node client/src/toolbar/target.test.js
import assert from 'node:assert/strict';
import { messageTarget, addToTarget, targetLabel } from './target.js';

const n = (id, type, data = {}) => ({ id, type, data, position: { x: 0, y: 0 } });
const page = (id, title) => n(id, 'page', { file: `${id}.html`, title });

// One artifact in the selection: it is "To", the rest come "with".
assert.deepEqual(messageTarget([n('i1', 'image'), page('g', 'Launch'), n('p', 'prompt')]), { target: 'g', with: ['i1', 'p'], artifacts: ['g'] });
// None: "To" is a new asset, everything selected comes with.
assert.deepEqual(messageTarget([n('i1', 'image'), n('v', 'video')]), { target: 'new', with: ['i1', 'v'], artifacts: [] });
assert.deepEqual(messageTarget([]), { target: 'new', with: [], artifacts: [] });
// Several: the agent must ask before acting.
assert.deepEqual(messageTarget([page('g1'), page('g2'), n('i', 'image')]), { target: 'ask', with: ['g1', 'g2', 'i'], artifacts: ['g1', 'g2'] });

// Clicking another node while the composer is open.
{
  const s0 = messageTarget([n('i1', 'image')]);
  const s1 = addToTarget(s0, n('p', 'prompt'));
  assert.deepEqual(s1, { target: 'new', with: ['i1', 'p'], artifacts: [] });
  assert.equal(addToTarget(s1, n('p', 'prompt')), s1, 'idempotent, by identity');
  // The first artifact becomes the target.
  const s2 = addToTarget(s1, page('g', 'Launch'));
  assert.deepEqual(s2, { target: 'g', with: ['i1', 'p'], artifacts: ['g'] });
  assert.equal(addToTarget(s2, page('g')), s2, 'the target itself is not added again');
  // A second artifact makes it ambiguous, and both are in the list.
  const s3 = addToTarget(s2, page('h'));
  assert.equal(s3.target, 'ask');
  assert.deepEqual(s3.artifacts, ['g', 'h']);
  assert.deepEqual([...s3.with].sort(), ['g', 'h', 'i1', 'p']);
  const s4 = addToTarget(s3, page('k'));
  assert.equal(s4.target, 'ask');
  assert.deepEqual(s4.artifacts, ['g', 'h', 'k']);
  assert.equal(new Set(s4.with).size, s4.with.length, 'no duplicates');
}

// The "To" line.
const nodes = [page('g', 'Launch'), n('i', 'image', { fileName: 'hero.png' })];
assert.equal(targetLabel({ target: 'new', with: [], artifacts: [] }, nodes), 'new asset');
assert.equal(targetLabel({ target: 'ask', with: [], artifacts: ['g', 'h'] }, nodes), '2 artifacts selected — pick one');
assert.equal(targetLabel({ target: 'g', with: [], artifacts: ['g'] }, nodes), 'page · Launch');
assert.equal(targetLabel({ target: 'zz', with: [], artifacts: ['zz'] }, nodes), 'zz');

console.log('target.test.js: ok');
