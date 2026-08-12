// node server/presets.test.js  (also part of `npm test`)
//
// One property, and it is a data-loss guard rather than a correctness check:
// readPresets answers [] ONLY for a file that isn't there. Every other way of
// failing to read must throw.
//
// Why that matters: saving a preset is read-all → append → write-all. If a failed
// read came back as [], the append would produce a list of one and the write would
// replace a full presets.json with it. No error, no warning, library gone. The two
// cases sit one line apart in presets.js and the safe one looks like redundancy, so
// this file exists to fail loudly if anyone ever collapses them.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readPresets, writePresets, presetsPath } from './presets.js';

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'unframed-presets-test-'));
const file = presetsPath(dir);
const threw = async (fn) => await fn().then(() => false).catch(() => true);

// Nothing saved yet: [] is the honest answer, and the first save must go through.
assert.deepEqual(await readPresets(dir), [], 'a missing file is genuinely empty');

// Round trip, so the guard below is guarding something that works.
const saved = [{ id: 'user-abc', name: 'Mine', type: 'block', kind: 'image' }];
await writePresets(dir, saved);
assert.deepEqual(await readPresets(dir), saved, 'what was written comes back');

// THE TRIPWIRE. Truncated by a crash mid-write, a full disk, or a hand-edit: the
// presets are still in there, so returning [] here is what erases them.
await fs.writeFile(file, '[{"id":"user-abc","name":"Mi');
assert.ok(await threw(() => readPresets(dir)), 'damaged JSON throws, never []');

// Same rule for a read that fails without the file being absent. A directory in the
// file's place is the deterministic version of "exists, cannot be read" — chmod 000
// proves nothing when the test happens to run as root.
await fs.rm(file);
await fs.mkdir(file);
assert.ok(await threw(() => readPresets(dir)), 'an unreadable file throws, never []');
await fs.rm(file, { recursive: true });

// writePresets creates the folder: a brand-new output dir must accept a first save.
const fresh = path.join(dir, 'nested', 'output');
await writePresets(fresh, saved);
assert.deepEqual(await readPresets(fresh), saved, 'a missing output dir is created');

await fs.rm(dir, { recursive: true, force: true });
console.log('presets.test.js: ok');
