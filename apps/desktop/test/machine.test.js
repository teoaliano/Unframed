const test = require('node:test');
const assert = require('node:assert/strict');
const { initialState, reduce, notAppliedVersion } = require('../src/updates/machine');

const run = (events, state = initialState('1.0.0')) => events.reduce(reduce, state);

test('starts disabled until the updater is configured', () => {
  assert.equal(initialState('1.0.0').status, 'disabled');
  assert.equal(run([{ type: 'enabled' }]).status, 'idle');
});

test('a check that finds a newer version offers it without downloading', () => {
  const s = run([{ type: 'enabled' }, { type: 'check-started' }, { type: 'available', version: '1.1.0' }]);
  assert.equal(s.status, 'available');
  assert.equal(s.availableVersion, '1.1.0');
  assert.equal(s.downloadedVersion, null);
});

test('a check that finds nothing returns to idle', () => {
  const s = run([{ type: 'enabled' }, { type: 'check-started' }, { type: 'not-available' }]);
  assert.equal(s.status, 'idle');
  assert.equal(s.availableVersion, null);
});

test('downloading reports progress and ends ready to install', () => {
  const s = run([
    { type: 'enabled' },
    { type: 'available', version: '1.1.0' },
    { type: 'download-started' },
    { type: 'progress', percent: 41.6 },
  ]);
  assert.equal(s.status, 'downloading');
  assert.equal(s.percent, 42);
  const done = reduce(s, { type: 'downloaded', version: '1.1.0' });
  assert.equal(done.status, 'downloaded');
  assert.equal(done.downloadedVersion, '1.1.0');
});

test('a failed download goes back to offering the version, with the reason', () => {
  const s = run([
    { type: 'enabled' },
    { type: 'available', version: '1.1.0' },
    { type: 'download-started' },
    { type: 'download-failed', message: 'socket hang up' },
  ]);
  assert.equal(s.status, 'available');
  assert.equal(s.message, 'socket hang up');
});

test('a failed check keeps an update that is already downloaded', () => {
  const s = run([
    { type: 'enabled' },
    { type: 'available', version: '1.1.0' },
    { type: 'downloaded', version: '1.1.0' },
    { type: 'check-started' },
    { type: 'check-failed', message: 'offline' },
  ]);
  assert.equal(s.status, 'downloaded');
  assert.equal(s.downloadedVersion, '1.1.0');
});

test('a failed check with nothing downloaded is an error', () => {
  const s = run([{ type: 'enabled' }, { type: 'check-started' }, { type: 'check-failed', message: 'offline' }]);
  assert.equal(s.status, 'error');
  assert.equal(s.message, 'offline');
});

test('a later check finding the downloaded version keeps it ready', () => {
  const s = run([
    { type: 'enabled' },
    { type: 'available', version: '1.1.0' },
    { type: 'downloaded', version: '1.1.0' },
    { type: 'check-started' },
    { type: 'available', version: '1.1.0' },
  ]);
  assert.equal(s.status, 'downloaded');
});

test('a later check finding a newer version than the downloaded one offers the newer one', () => {
  const s = run([
    { type: 'enabled' },
    { type: 'available', version: '1.1.0' },
    { type: 'downloaded', version: '1.1.0' },
    { type: 'available', version: '1.2.0' },
  ]);
  assert.equal(s.status, 'available');
  assert.equal(s.availableVersion, '1.2.0');
  assert.equal(s.downloadedVersion, null);
});

test('checks and downloads do not disturb an install in progress', () => {
  const installing = run([
    { type: 'enabled' },
    { type: 'available', version: '1.1.0' },
    { type: 'downloaded', version: '1.1.0' },
    { type: 'install-started' },
  ]);
  assert.equal(installing.status, 'installing');
  for (const event of [
    { type: 'check-started' },
    { type: 'not-available' },
    { type: 'available', version: '1.2.0' },
    { type: 'check-failed', message: 'x' },
  ]) {
    assert.equal(reduce(installing, event).status, 'installing', event.type);
  }
});

test('a failed install keeps the download and says why', () => {
  const s = run([
    { type: 'enabled' },
    { type: 'available', version: '1.1.0' },
    { type: 'downloaded', version: '1.1.0' },
    { type: 'install-started' },
    { type: 'install-failed', message: 'Squirrel said no' },
  ]);
  assert.equal(s.status, 'downloaded');
  assert.equal(s.message, 'Squirrel said no');
});

test('a not-applied install is carried in the state until a newer install starts', () => {
  const s = run([{ type: 'enabled' }], initialState('1.0.0', { notAppliedVersion: '1.1.0' }));
  assert.equal(s.notAppliedVersion, '1.1.0');
  assert.equal(
    run([{ type: 'available', version: '1.1.0' }, { type: 'downloaded', version: '1.1.0' }, { type: 'install-started' }], s)
      .notAppliedVersion,
    null,
  );
});

test('an install record names the version that did not apply', () => {
  assert.equal(notAppliedVersion({ fromVersion: '1.0.0', targetVersion: '1.1.0' }, '1.0.0'), '1.1.0');
  assert.equal(notAppliedVersion({ fromVersion: '1.0.0', targetVersion: '1.1.0' }, '1.1.0'), null);
  assert.equal(notAppliedVersion({ fromVersion: '0.9.0', targetVersion: '1.1.0' }, '1.0.0'), null);
  assert.equal(notAppliedVersion(null, '1.0.0'), null);
  assert.equal(notAppliedVersion({ nonsense: true }, '1.0.0'), null);
});
