// `node test/keep-awake.smoke.js`: the shell's keep-awake handler against a fake
// powerSaveBlocker. Electron is never started, so this runs anywhere.
const assert = require('node:assert/strict');
const { createKeepAwake } = require('../src/keep-awake.js');

const calls = [];
let next = 1;
const blocker = {
  start(type) {
    calls.push(['start', type]);
    return next++;
  },
  stop(id) {
    calls.push(['stop', id]);
  },
};

const keepAwake = createKeepAwake(blocker);

assert.equal(keepAwake.held(), false, 'nothing is held before the first message');

keepAwake.set(true);
keepAwake.set(true);
assert.deepEqual(calls, [['start', 'prevent-app-suspension']], 'a second on starts no second blocker');
assert.equal(keepAwake.held(), true);

keepAwake.set(false);
keepAwake.set(false);
assert.deepEqual(calls.slice(1), [['stop', 1]], 'a second off stops nothing');
assert.equal(keepAwake.held(), false);

keepAwake.set(true);
keepAwake.set(false);
assert.deepEqual(calls.slice(2), [['start', 'prevent-app-suspension'], ['stop', 2]], 'on after off starts a fresh blocker and stops it');
assert.equal(keepAwake.held(), false);

process.stdout.write('  keep-awake smoke: one blocker at most, stopped on off\n');
