const test = require('node:test');
const assert = require('node:assert/strict');
const { createUpdater } = require('../src/updates/updater');
const { quietLog, fakeUpdater, memoryRecordStore, tick } = require('./fakes');

function setup({ record = null, version = '1.0.0', ...opts } = {}) {
  const updater = fakeUpdater();
  const records = memoryRecordStore(record);
  const order = [];
  const states = [];
  const driver = createUpdater({
    updater,
    log: quietLog,
    version,
    records,
    prepareInstall: async () => {
      order.push('prepare');
      await tick(10);
      order.push('prepared');
    },
    recoverInstall: async () => order.push('recover'),
    onChange: (s) => states.push(s),
    startupDelayMs: 0,
    pollMs: 60 * 60 * 1000,
    installWatchdogMs: opts.installWatchdogMs ?? 5000,
    applyUpdate: opts.applyUpdate,
  });
  return { updater, records, order, states, driver };
}

const offer = (updater, version = '1.1.0') => {
  updater.next.check = () => {
    updater.emit('update-available', { version });
    return Promise.resolve({ updateInfo: { version } });
  };
};

test('the updater never downloads or installs on its own', () => {
  const { updater, driver } = setup();
  driver.enable();
  assert.equal(updater.autoDownload, false);
  assert.equal(updater.autoInstallOnAppQuit, false);
  driver.stop();
});

test('enabling checks once after the startup delay and offers a found version', async () => {
  const { updater, driver } = setup();
  offer(updater);
  driver.enable();
  await tick(20);
  assert.deepEqual(updater.calls, ['check']);
  assert.equal(driver.state().status, 'available');
  assert.equal(driver.state().availableVersion, '1.1.0');
  driver.stop();
});

test('download is only accepted when a version is on offer', async () => {
  const { updater, driver } = setup();
  driver.enable();
  await tick(5);
  assert.equal(await driver.download(), false);
  offer(updater);
  await driver.check();
  updater.next.download = () => {
    updater.emit('download-progress', { percent: 50 });
    updater.emit('update-downloaded', { version: '1.1.0' });
    return Promise.resolve([]);
  };
  assert.equal(await driver.download(), true);
  assert.equal(driver.state().status, 'downloaded');
  driver.stop();
});

test('a failed download goes back to offering the version', async () => {
  const { updater, driver } = setup();
  offer(updater);
  driver.enable();
  await tick(5);
  updater.next.download = () => Promise.reject(new Error('socket hang up'));
  await driver.download();
  assert.equal(driver.state().status, 'available');
  assert.equal(driver.state().message, 'socket hang up');
  driver.stop();
});

async function downloaded(ctx) {
  offer(ctx.updater);
  ctx.driver.enable();
  await tick(5);
  ctx.updater.next.download = () => {
    ctx.updater.emit('update-downloaded', { version: '1.1.0' });
    return Promise.resolve([]);
  };
  await ctx.driver.download();
}

test('install stops the engine first, records the attempt, then hands off to the installer', async () => {
  const ctx = setup();
  await downloaded(ctx);
  ctx.updater.quitAndInstall = (silent, runAfter) => {
    ctx.order.push(`quitAndInstall(${silent},${runAfter})`);
    assert.deepEqual(ctx.records.read(), { fromVersion: '1.0.0', targetVersion: '1.1.0' });
  };
  assert.equal(await ctx.driver.install(), true);
  assert.deepEqual(ctx.order, ['prepare', 'prepared', 'quitAndInstall(true,true)']);
  assert.equal(ctx.driver.state().status, 'installing');
  ctx.driver.stop();
});

test('install is refused without a download and while one is already running', async () => {
  const ctx = setup();
  ctx.driver.enable();
  assert.equal(await ctx.driver.install(), false);
  await downloaded(ctx);
  const first = ctx.driver.install();
  assert.equal(await ctx.driver.install(), false);
  assert.equal(await first, true);
  assert.equal(ctx.updater.calls.filter((c) => c.startsWith('quitAndInstall')).length, 1);
  ctx.driver.stop();
});

test('an installer error recovers the app and keeps the download', async () => {
  const ctx = setup();
  await downloaded(ctx);
  await ctx.driver.install();
  ctx.updater.emit('error', new Error('Code signature did not match'));
  await tick(5);
  assert.deepEqual(ctx.order.slice(-1), ['recover']);
  assert.equal(ctx.driver.state().status, 'downloaded');
  assert.match(ctx.driver.state().message, /Code signature/);
  assert.equal(ctx.records.read(), null);
  ctx.driver.stop();
});

test('an install that never quits the app is treated as failed', async () => {
  const ctx = setup({ installWatchdogMs: 30 });
  await downloaded(ctx);
  await ctx.driver.install();
  await tick(60);
  assert.deepEqual(ctx.order.slice(-1), ['recover']);
  assert.equal(ctx.driver.state().status, 'downloaded');
  ctx.driver.stop();
});

test('a throwing quitAndInstall recovers instead of leaving the engine stopped', async () => {
  const ctx = setup();
  await downloaded(ctx);
  ctx.updater.quitAndInstall = () => {
    throw new Error('boom');
  };
  assert.equal(await ctx.driver.install(), false);
  assert.deepEqual(ctx.order.slice(-1), ['recover']);
  assert.equal(ctx.driver.state().status, 'downloaded');
  ctx.driver.stop();
});

test('a launch after an install that did not apply says so', async () => {
  const ctx = setup({ record: { fromVersion: '1.0.0', targetVersion: '1.1.0' } });
  ctx.driver.enable();
  assert.equal(ctx.driver.state().notAppliedVersion, '1.1.0');
  ctx.driver.stop();
});

test('a launch after an install that applied clears the record', async () => {
  const ctx = setup({ version: '1.1.0', record: { fromVersion: '1.0.0', targetVersion: '1.1.0' } });
  ctx.driver.enable();
  assert.equal(ctx.driver.state().notAppliedVersion, null);
  assert.equal(ctx.records.read(), null);
  ctx.driver.stop();
});

test('checks are skipped while downloading or installing', async () => {
  const ctx = setup();
  await downloaded(ctx);
  await ctx.driver.install();
  const before = ctx.updater.calls.length;
  await ctx.driver.check();
  assert.equal(ctx.updater.calls.length, before);
  ctx.driver.stop();
});

test('a check error is reported in the state, not thrown', async () => {
  const ctx = setup();
  ctx.updater.next.check = () => Promise.reject(new Error('offline'));
  ctx.driver.enable();
  await tick(5);
  assert.equal(ctx.driver.state().status, 'error');
  ctx.driver.stop();
});

test('firstCheck resolves once the first check settles', async () => {
  const ctx = setup();
  offer(ctx.updater);
  ctx.driver.enable();
  await ctx.driver.firstCheck();
  assert.equal(ctx.driver.state().availableVersion, '1.1.0');
  ctx.driver.stop();
});

test('every state change is published', async () => {
  const ctx = setup();
  offer(ctx.updater);
  ctx.driver.enable();
  await tick(5);
  assert.deepEqual(
    ctx.states.map((s) => s.status),
    ['idle', 'checking', 'available'],
  );
  ctx.driver.stop();
});

test('a custom install step gets the downloaded file and version instead of quitAndInstall', async () => {
  const applied = [];
  const ctx = setup({ applyUpdate: async (u) => applied.push(u) });
  offer(ctx.updater);
  ctx.driver.enable();
  await tick(5);
  ctx.updater.next.download = () => {
    ctx.updater.emit('update-downloaded', { version: '1.1.0', downloadedFile: '/cache/Unframed-arm64.zip' });
    return Promise.resolve([]);
  };
  await ctx.driver.download();
  assert.equal(await ctx.driver.install(), true);
  assert.deepEqual(applied, [{ file: '/cache/Unframed-arm64.zip', version: '1.1.0' }]);
  assert.equal(ctx.updater.calls.filter((c) => c.startsWith('quitAndInstall')).length, 0);
  assert.deepEqual(ctx.order.slice(0, 2), ['prepare', 'prepared']);
  ctx.driver.stop();
});

test('a failing custom install step recovers and keeps the download', async () => {
  const ctx = setup({ applyUpdate: async () => { throw new Error('code failed to satisfy requirement'); } });
  await downloaded(ctx);
  assert.equal(await ctx.driver.install(), false);
  assert.deepEqual(ctx.order.slice(-1), ['recover']);
  assert.equal(ctx.driver.state().status, 'downloaded');
  assert.match(ctx.driver.state().message, /satisfy/);
  assert.equal(ctx.records.read(), null);
  ctx.driver.stop();
});
