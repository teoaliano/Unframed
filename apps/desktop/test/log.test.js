const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createLog, createRecordStore } = require('../src/log');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'unframed-log-'));

test('lines are written with their level', () => {
  const dir = tmp();
  const log = createLog({ dir, echo: false });
  log.info('hello');
  log.error('broken');
  const text = fs.readFileSync(path.join(dir, 'main.log'), 'utf8');
  assert.match(text, /\[info\] hello/);
  assert.match(text, /\[error\] broken/);
});

test('a full log rotates to main.old.log', () => {
  const dir = tmp();
  const log = createLog({ dir, maxBytes: 100, echo: false });
  for (let i = 0; i < 10; i++) log.info(`line ${i} ${'x'.repeat(20)}`);
  assert.ok(fs.existsSync(path.join(dir, 'main.old.log')));
  assert.ok(fs.statSync(path.join(dir, 'main.log')).size <= 200);
});

test('a log that cannot be written does not throw', () => {
  const log = createLog({ dir: '/dev/null/nope', echo: false });
  assert.doesNotThrow(() => log.warn('still fine'));
});

test('the record store round-trips and treats a missing or broken file as empty', () => {
  const file = path.join(tmp(), 'record.json');
  const store = createRecordStore(file);
  assert.equal(store.read(), null);
  store.write({ fromVersion: '1.0.0', targetVersion: '1.1.0' });
  assert.deepEqual(store.read(), { fromVersion: '1.0.0', targetVersion: '1.1.0' });
  store.remove();
  assert.equal(store.read(), null);
  fs.writeFileSync(file, '{not json');
  assert.equal(store.read(), null);
  assert.doesNotThrow(() => store.remove());
  assert.doesNotThrow(() => store.remove());
});
