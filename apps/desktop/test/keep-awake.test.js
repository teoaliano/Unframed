const test = require('node:test');
const assert = require('node:assert/strict');
const { createKeepAwake } = require('../src/keep-awake');

function fakeBlocker() {
  const calls = [];
  let next = 1;
  return {
    calls,
    start(type) {
      calls.push(['start', type]);
      return next++;
    },
    stop(id) {
      calls.push(['stop', id]);
    },
  };
}

test('nothing is held before the first message', () => {
  assert.equal(createKeepAwake(fakeBlocker()).held(), false);
});

test('a second on starts no second blocker, and a second off stops nothing', () => {
  const blocker = fakeBlocker();
  const keepAwake = createKeepAwake(blocker);
  keepAwake.set(true);
  keepAwake.set(true);
  assert.equal(keepAwake.held(), true);
  keepAwake.set(false);
  keepAwake.set(false);
  assert.equal(keepAwake.held(), false);
  assert.deepEqual(blocker.calls, [['start', 'prevent-app-suspension'], ['stop', 1]]);
});

test('on after off starts a fresh blocker', () => {
  const blocker = fakeBlocker();
  const keepAwake = createKeepAwake(blocker);
  keepAwake.set(true);
  keepAwake.set(false);
  keepAwake.set(true);
  keepAwake.set(false);
  assert.deepEqual(blocker.calls, [
    ['start', 'prevent-app-suspension'],
    ['stop', 1],
    ['start', 'prevent-app-suspension'],
    ['stop', 2],
  ]);
});
