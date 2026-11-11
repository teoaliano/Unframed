const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createEngine } = require('../src/engine');

const script = path.join(__dirname, 'fixtures', 'engine.js');
const quietLog = { info() {}, warn() {}, error() {}, debug() {} };
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const engineIn = (mode, extra = {}) =>
  createEngine({
    script,
    execPath: process.execPath,
    env: { ...process.env, FIXTURE_MODE: mode, ...extra.env },
    log: quietLog,
    startTimeoutMs: extra.startTimeoutMs ?? 5000,
  });

test('start resolves with the ports from the ready message', async () => {
  const engine = engineIn('normal');
  assert.deepEqual(await engine.start(), { port: 4321, previewPort: 4322 });
  assert.equal(engine.running(), true);
  await engine.stop();
  assert.equal(engine.running(), false);
});

test('start rejects when the engine exits before it is ready', async () => {
  await assert.rejects(engineIn('crash-on-boot').start(), /exited before it was ready \(code 3\)/);
});

test('start rejects and stops the engine when it never says it is ready', async () => {
  const engine = engineIn('silent', { startTimeoutMs: 300 });
  await assert.rejects(engine.start(), /did not start within/);
  assert.equal(engine.running(), false);
});

test('stop escalates to SIGKILL when the engine ignores SIGTERM', async () => {
  const engine = engineIn('stubborn');
  await engine.start();
  const pid = engine.pid();
  const started = Date.now();
  await engine.stop({ graceMs: 300 });
  assert.equal(alive(pid), false);
  assert.ok(Date.now() - started < 2000);
});

test('stop also takes down processes the engine started', async () => {
  const pidfile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'engine-test-')), 'pid');
  const engine = engineIn('grandchild', { env: { FIXTURE_PIDFILE: pidfile } });
  await engine.start();
  const grandchild = Number(fs.readFileSync(pidfile, 'utf8'));
  assert.equal(alive(grandchild), true);
  await engine.stop({ graceMs: 300 });
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(alive(grandchild), false);
});

test('stop on an engine that is not running resolves at once', async () => {
  await engineIn('normal').stop();
});

test('stopping twice waits for the same exit', async () => {
  const engine = engineIn('normal');
  await engine.start();
  await Promise.all([engine.stop(), engine.stop()]);
  assert.equal(engine.running(), false);
});

test('an exit nobody asked for is reported, a requested stop is not', async () => {
  const crashes = [];
  const engine = engineIn('normal');
  engine.onUnexpectedExit((code) => crashes.push(code));
  await engine.start();
  engine.send('die');
  await new Promise((r) => setTimeout(r, 300));
  assert.deepEqual(crashes, [7]);

  const again = engineIn('normal');
  again.onUnexpectedExit((code) => crashes.push(code));
  await again.start();
  await again.stop();
  assert.deepEqual(crashes, [7]);
});

test('messages other than ready reach the listener', async () => {
  const engine = engineIn('normal');
  const seen = [];
  engine.onMessage((msg) => seen.push(msg));
  await engine.start();
  engine.send('reveal');
  await new Promise((r) => setTimeout(r, 200));
  await engine.stop();
  assert.deepEqual(seen, [{ type: 'reveal', files: ['/tmp/a.png'] }]);
});
