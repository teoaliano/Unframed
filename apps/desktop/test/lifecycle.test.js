const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createLifecycle } = require('../src/lifecycle');
const { quietLog, fakeApp, fakeEngine, tick } = require('./fakes');

function setup(opts = {}) {
  const app = fakeApp();
  const nativeUpdater = new EventEmitter();
  const engine = fakeEngine(opts);
  const destroyed = [];
  const lifecycle = createLifecycle({
    app,
    nativeUpdater,
    engine,
    log: quietLog,
    destroyWindows: () => destroyed.push('windows'),
  });
  lifecycle.register();
  return { app, nativeUpdater, engine, destroyed, lifecycle };
}

test('an ordinary quit waits for the engine to stop before the app exits', async () => {
  const { app, engine } = setup();
  app.quit();
  assert.deepEqual(app.calls, ['quit']);
  assert.deepEqual(engine.calls, ['stop']);
  await tick(60);
  assert.deepEqual(engine.calls, ['stop', 'stopped']);
  assert.deepEqual(app.calls, ['quit', 'quit', 'exited']);
});

test('a second quit while the engine is stopping does not exit early or stop twice', async () => {
  const { app, engine } = setup();
  app.quit();
  app.quit();
  assert.ok(!app.calls.includes('exited'));
  await tick(60);
  assert.deepEqual(engine.calls, ['stop', 'stopped']);
  assert.equal(app.calls.filter((c) => c === 'exited').length, 1);
});

test('the updater quit is let through untouched and windows are destroyed first', () => {
  const { app, nativeUpdater, engine, destroyed } = setup();
  nativeUpdater.emit('before-quit-for-update');
  assert.deepEqual(destroyed, ['windows']);
  app.quit();
  assert.deepEqual(app.calls, ['quit', 'exited']);
  assert.deepEqual(engine.calls, []);
});

test('closing the last window quits, unless a quit is already under way', async () => {
  const { app } = setup();
  app.emit('window-all-closed');
  assert.deepEqual(app.calls, ['quit']);
  app.emit('window-all-closed');
  assert.deepEqual(app.calls, ['quit']);
  await tick(60);
});

test('closing windows during an updater quit does not start a second quit', () => {
  const { app, nativeUpdater } = setup();
  nativeUpdater.emit('before-quit-for-update');
  app.emit('window-all-closed');
  assert.deepEqual(app.calls, []);
});

test('quitting reports whether a quit has begun', async () => {
  const { app, lifecycle } = setup();
  assert.equal(lifecycle.quitting(), false);
  app.quit();
  assert.equal(lifecycle.quitting(), true);
  await tick(60);
});
