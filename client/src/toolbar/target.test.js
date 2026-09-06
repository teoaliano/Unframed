// Assert-based self-check. Run with: node client/src/toolbar/target.test.js
import assert from 'node:assert/strict';
import { messageContext, addToContext, contextLabel } from './target.js';

const n = (id, type, data = {}) => ({ id, type, data, position: { x: 0, y: 0 } });
const page = (id, title) => n(id, 'page', { file: `${id}.html`, title });
const motion = (id, title) => n(id, 'motion', { file: `${id}.html`, title });

// The selection travels whole; the artifacts within it are noted, because the strip
// filters on them and a new chat is tagged with them.
assert.deepEqual(messageContext([n('i1', 'image'), page('g', 'Launch'), n('p', 'prompt')]), {
  selection: ['i1', 'g', 'p'],
  artifacts: ['g'],
});
assert.deepEqual(messageContext([n('i1', 'image'), n('v', 'video')]), { selection: ['i1', 'v'], artifacts: [] });
assert.deepEqual(messageContext([]), { selection: [], artifacts: [] });
// Several artifacts is an ordinary selection now, not an ambiguity to resolve: there is
// no 'ask', no 'new' and no target anywhere in the answer.
assert.deepEqual(messageContext([motion('m1', 'Intro'), motion('m2', 'Outro'), n('i', 'image')]), {
  selection: ['m1', 'm2', 'i'],
  artifacts: ['m1', 'm2'],
});

// Clicking another node while the composer is open.
{
  const s0 = messageContext([n('i1', 'image')]);
  const s1 = addToContext(s0, n('p', 'prompt'));
  assert.deepEqual(s1, { selection: ['i1', 'p'], artifacts: [] });
  assert.equal(addToContext(s1, n('p', 'prompt')), s1, 'idempotent, by identity: no re-render on a no-op');
  const s2 = addToContext(s1, page('g', 'Launch'));
  assert.deepEqual(s2, { selection: ['i1', 'p', 'g'], artifacts: ['g'] });
  // A second artifact simply joins the first.
  const s3 = addToContext(s2, motion('m1', 'Intro'));
  assert.deepEqual(s3.artifacts, ['g', 'm1']);
  assert.deepEqual(s3.selection, ['i1', 'p', 'g', 'm1']);
  assert.equal(addToContext(s3, page('g')), s3, 'an artifact already there is not added again');
}

// ---- the context chip ----
const nodes = [
  motion('m1', 'Intro'),
  motion('m2', 'Outro'),
  motion('m3', 'Bridge'),
  motion('m4', 'Coda'),
  page('g', 'Launch'),
  n('i', 'image', { fileName: 'hero.png' }),
  n('i2', 'image', { fileName: 'sky.png' }),
  n('p', 'prompt', { text: 'a fox' }),
];
const ctx = (selection, artifacts) => contextLabel({ selection, artifacts }, nodes);

assert.equal(ctx([], []), 'nothing selected');
// The row from the plan's checklist: two motions and an image.
assert.equal(ctx(['m1', 'm2', 'i'], ['m1', 'm2']), '2 motions — Intro, Outro · with 1 image');
assert.equal(ctx(['m1'], ['m1']), '1 motion — Intro', 'the count is always there, so "1 motion" cannot read as a mode');
// Mixed kinds: there is no shorter honest word for a page and a motion together.
assert.equal(ctx(['m1', 'g'], ['m1', 'g']), '2 artifacts — Intro, Launch');
// The rest is counted, not named -- by its own kind when it is all one kind, and as
// plain "inputs" when it is mixed.
assert.equal(ctx(['i', 'i2', 'p'], []), '3 inputs', 'an image, an image and a prompt: no shorter honest word');
assert.equal(ctx(['i', 'i2'], []), '2 images');
assert.equal(ctx(['i'], []), '1 image');
assert.equal(ctx(['m1', 'g', 'i', 'p'], ['m1', 'g']), '2 artifacts — Intro, Launch · with 2 inputs');
// Many artifacts: the first few by name, then how many more.
assert.equal(ctx(['m1', 'm2', 'm3', 'm4'], ['m1', 'm2', 'm3', 'm4']), '4 motions — Intro, Outro, Bridge +1');
// An artifact whose node has gone is not named -- but its company is still counted.
assert.equal(ctx(['zz', 'i'], ['zz']), '1 image');
assert.equal(ctx(['zz'], ['zz']), 'nothing selected', 'a selection of nothing that exists says so');

console.log('target.test.js: ok');
