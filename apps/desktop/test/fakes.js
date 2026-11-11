const { EventEmitter } = require('node:events');

const quietLog = { info() {}, warn() {}, error() {}, debug() {} };

function fakeUpdater() {
  const u = new EventEmitter();
  u.calls = [];
  u.autoDownload = true;
  u.autoInstallOnAppQuit = true;
  u.next = { check: null, download: null };
  u.checkForUpdates = () => {
    u.calls.push('check');
    u.emit('checking-for-update');
    return u.next.check ? u.next.check() : Promise.resolve(null);
  };
  u.downloadUpdate = () => {
    u.calls.push('download');
    return u.next.download ? u.next.download() : Promise.resolve([]);
  };
  u.quitAndInstall = (isSilent, isForceRunAfter) => {
    u.calls.push(`quitAndInstall(${isSilent},${isForceRunAfter})`);
  };
  return u;
}

function fakeApp() {
  const app = new EventEmitter();
  app.calls = [];
  app.quit = () => {
    app.calls.push('quit');
    const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    app.emit('before-quit', event);
    if (!event.defaultPrevented) {
      app.calls.push('exited');
      app.emit('will-quit');
    }
  };
  app.exit = (code) => app.calls.push(`exit(${code})`);
  return app;
}

function fakeEngine({ stopMs = 20 } = {}) {
  const engine = { calls: [], isRunning: true };
  engine.stop = () => {
    engine.calls.push('stop');
    return new Promise((r) =>
      setTimeout(() => {
        engine.isRunning = false;
        engine.calls.push('stopped');
        r();
      }, stopMs),
    );
  };
  engine.running = () => engine.isRunning;
  return engine;
}

function memoryRecordStore(initial = null) {
  const store = { value: initial };
  return {
    store,
    read: () => store.value,
    write: (record) => {
      store.value = record;
    },
    remove: () => {
      store.value = null;
    },
  };
}

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

module.exports = { quietLog, fakeUpdater, fakeApp, fakeEngine, memoryRecordStore, tick };
