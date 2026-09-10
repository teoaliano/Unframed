// Run: node client/src/agent/models.test.js
import assert from 'node:assert/strict';
import { selectedModel, effortsFor } from './models.js';

const ALL = ['low', 'medium', 'high', 'xhigh', 'max'];
// The shape /api/providers actually returns, ids and all (probe, 2026-09-10).
const MODELS = [
  { id: 'opus[1m]', name: 'Opus 5 · 1M', efforts: ALL, legacy: false },
  { id: 'claude-fable-5-1[1m]', name: 'Fable 5.1 · 1M', efforts: ALL, legacy: false },
  { id: 'haiku', name: 'Haiku 4.5', efforts: [], legacy: false },
  { id: 'claude-opus-4-8', name: 'Opus 4.8', efforts: ALL, legacy: true },
];

// The regression this module exists for: '' is the provider default, and no row is ever
// called 'default'. It must resolve to the first CURRENT row -- the one the trigger
// shows -- so the Reasoning picker appears for it.
assert.equal(selectedModel(MODELS, '').id, 'opus[1m]');
assert.deepEqual(effortsFor(MODELS, ''), ALL);
assert.equal(MODELS.some((m) => m.id === 'default'), false, 'the probe never returns a `default` row');

// An explicit pick wins, legacy included.
assert.equal(selectedModel(MODELS, 'claude-opus-4-8').id, 'claude-opus-4-8');
assert.deepEqual(effortsFor(MODELS, 'claude-opus-4-8'), ALL);

// A model that accepts no levels is the one honest reason to hide the picker.
assert.deepEqual(effortsFor(MODELS, 'haiku'), []);

// A stale id (a thread saved against a model the probe no longer lists) resolves to
// nothing rather than silently falling back to a different model's levels.
assert.equal(selectedModel(MODELS, 'gone'), null);
assert.deepEqual(effortsFor(MODELS, 'gone'), []);

// '' with only legacy rows still names something, so the trigger is never blank.
assert.equal(selectedModel([{ id: 'old', efforts: [], legacy: true }], '').id, 'old');

// Empty and missing lists are answers, not throws: the panel renders before the probe.
assert.equal(selectedModel([], ''), null);
assert.equal(selectedModel(undefined, ''), null);
assert.deepEqual(effortsFor([], ''), []);

console.log('models.test.js: ok');
