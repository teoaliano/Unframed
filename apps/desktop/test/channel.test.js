const test = require('node:test');
const assert = require('node:assert/strict');
const { channelOf } = require('../src/channel');

test('a build without a channel is the production app: it updates itself and turns on no features', () => {
  assert.deepEqual(channelOf({ name: 'unframed-app' }, {}), { dev: false, updates: true, dataFolder: null, outputFolder: 'Unframed', engineEnv: {} });
});

test('the production app ignores a features variable it did not set', () => {
  assert.deepEqual(channelOf({}, { UNFRAMED_FEATURES: 'all' }).engineEnv, {});
});

test('the dev app never updates itself, keeps its own data and Pictures folders and turns every feature on', () => {
  assert.deepEqual(channelOf({ unframedChannel: 'dev' }, {}), { dev: true, updates: false, dataFolder: 'Unframed Dev', outputFolder: 'Unframed Dev', engineEnv: { UNFRAMED_FEATURES: 'all' } });
});

test('the dev app keeps a features list given in its environment', () => {
  assert.deepEqual(channelOf({ unframedChannel: 'dev' }, { UNFRAMED_FEATURES: 'nodes' }).engineEnv, {});
});
