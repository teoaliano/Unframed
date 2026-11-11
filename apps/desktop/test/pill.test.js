const test = require('node:test');
const assert = require('node:assert/strict');
const { view, DOWNLOAD_URL, INSTALL_URL } = require('../src/updates/pill');
const { initialState, reduce } = require('../src/updates/machine');

const run = (...events) => events.reduce(reduce, initialState('1.0.0'));
const enabled = { type: 'enabled' };

test('nothing shows while there is nothing to act on', () => {
  assert.equal(view(run()), null);
  assert.equal(view(run(enabled)), null);
  assert.equal(view(run(enabled, { type: 'check-started' })), null);
  assert.equal(view(run(enabled, { type: 'check-started' }, { type: 'check-failed', message: 'offline' })), null);
});

test('a found version offers a download', () => {
  const v = view(run(enabled, { type: 'available', version: '1.1.0' }));
  assert.equal(v.stage, 'available');
  assert.match(v.text, /1\.1\.0 is available/);
  assert.deepEqual([v.action, v.url], ['Download', DOWNLOAD_URL]);
});

test('a download in progress shows its progress and no action', () => {
  const v = view(run(enabled, { type: 'available', version: '1.1.0' }, { type: 'download-started' }, { type: 'progress', percent: 41.6 }));
  assert.equal(v.stage, 'downloading');
  assert.equal(v.percent, 42);
  assert.equal(v.action, null);
});

test('a downloaded version offers the restart', () => {
  const v = view(run(enabled, { type: 'downloaded', version: '1.1.0' }));
  assert.equal(v.stage, 'downloaded');
  assert.match(v.text, /1\.1\.0 is ready/);
  assert.deepEqual([v.action, v.url], ['Restart', INSTALL_URL]);
});

test('installing says so and offers nothing to click', () => {
  const v = view(run(enabled, { type: 'downloaded', version: '1.1.0' }, { type: 'install-started' }));
  assert.equal(v.stage, 'installing');
  assert.equal(v.action, null);
});

test('a failed download offers to try again', () => {
  const v = view(run(enabled, { type: 'available', version: '1.1.0' }, { type: 'download-started' }, { type: 'download-failed', message: 'socket hang up' }));
  assert.equal(v.stage, 'download-failed');
  assert.deepEqual([v.action, v.url], ['Try again', DOWNLOAD_URL]);
});

test('a failed install offers to try again', () => {
  const v = view(run(enabled, { type: 'downloaded', version: '1.1.0' }, { type: 'install-started' }, { type: 'install-failed', message: 'nope' }));
  assert.equal(v.stage, 'install-failed');
  assert.deepEqual([v.action, v.url], ['Try again', INSTALL_URL]);
});

test('an install that did not apply is reported once nothing else is showing', () => {
  const state = reduce(initialState('1.0.0', { notAppliedVersion: '1.1.0' }), enabled);
  const v = view(state);
  assert.equal(v.stage, 'not-applied');
  assert.match(v.text, /1\.1\.0/);
  assert.equal(v.action, null);
  assert.equal(view(reduce(state, { type: 'available', version: '1.1.0' })).stage, 'available');
});
