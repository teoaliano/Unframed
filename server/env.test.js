// node server/env.test.js  (also runs as part of `npm test`)
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { upsertEnv, PATTERNS, envFile, outputPath, writeEnvFile } from './env.js';

// Replaces in place, leaves the rest of the file alone.
assert.equal(
  upsertEnv('# note\nOPENROUTER_API_KEY=sk-or-old\nPORT=8787\n', {
    OPENROUTER_API_KEY: 'sk-or-new',
  }),
  '# note\nOPENROUTER_API_KEY=sk-or-new\nPORT=8787\n',
);

// Appends when missing, and doesn't glue itself onto an unterminated last line.
assert.equal(upsertEnv('PORT=8787', { OUTPUT_DIR: '/tmp/out' }), 'PORT=8787\nOUTPUT_DIR=/tmp/out\n');
assert.equal(upsertEnv('', { OUTPUT_DIR: './output' }), 'OUTPUT_DIR=./output\n');

// null deletes the whole line, so a shell-provided value isn't shadowed by an
// empty assignment.
assert.equal(
  upsertEnv('A=1\nOPENROUTER_API_KEY=sk-or-x\nB=2\n', { OPENROUTER_API_KEY: null }),
  'A=1\nB=2\n',
);

// Duplicate lines: dotenv's last assignment wins at load, so upsertEnv has to act
// on ALL of them, not just the first. A key left on disk twice is how "Remove key"
// reports success and the key is back after a restart, and how "replace" leaves the
// stale one winning.
assert.equal(
  upsertEnv('OPENROUTER_API_KEY=sk-or-first\nPORT=8787\nOPENROUTER_API_KEY=sk-or-second\n', {
    OPENROUTER_API_KEY: null,
  }),
  'PORT=8787\n',
  'deleting a key removes every duplicate line, not just the first',
);
assert.equal(
  upsertEnv('OPENROUTER_API_KEY=sk-or-first\nPORT=8787\nOPENROUTER_API_KEY=sk-or-second\n', {
    OPENROUTER_API_KEY: 'sk-or-new',
  }),
  'OPENROUTER_API_KEY=sk-or-new\nPORT=8787\n',
  'setting a key collapses duplicates to one, in the first line\'s place',
);

// Several keys in one pass, mixing update, insert and delete.
assert.equal(
  upsertEnv('OPENROUTER_IMAGE_MODEL=a/b\nOPENROUTER_API_KEY=sk-or-x\n', {
    OPENROUTER_IMAGE_MODEL: 'c/d',
    OPENROUTER_TEXT_MODEL: 'e/f',
    OPENROUTER_API_KEY: null,
  }),
  'OPENROUTER_IMAGE_MODEL=c/d\nOPENROUTER_TEXT_MODEL=e/f\n',
);

// A key name that is a prefix of another must not match it.
assert.equal(
  upsertEnv('OPENROUTER_TEXT_MODEL=a/b\n', { OPENROUTER_TEXT_MODEL_X: 'c/d' }),
  'OPENROUTER_TEXT_MODEL=a/b\nOPENROUTER_TEXT_MODEL_X=c/d\n',
);

// Validation: the injection shapes that would break .env or the auth header.
assert.ok(PATTERNS.OPENROUTER_API_KEY.test('sk-or-v1-abcd1234'));
assert.ok(!PATTERNS.OPENROUTER_API_KEY.test('sk-or-v1-abcd\nHost: evil'));
assert.ok(!PATTERNS.OPENROUTER_API_KEY.test('nope'));
assert.ok(PATTERNS.OPENROUTER_IMAGE_MODEL.test('openai/gpt-image-2'));
assert.ok(PATTERNS.OPENROUTER_VIDEO_MODEL.test('bytedance/seedance-2.0'));
assert.ok(PATTERNS.OPENROUTER_TEXT_MODEL.test('anthropic/claude-3.5-sonnet:beta'));
assert.ok(!PATTERNS.OPENROUTER_IMAGE_MODEL.test('no-slash'));
assert.ok(!PATTERNS.OPENROUTER_IMAGE_MODEL.test('a/b\nPORT=1'));
assert.ok(PATTERNS.OUTPUT_DIR.test('/Users/me/Pictures/Unframed output'));
assert.ok(PATTERNS.OUTPUT_DIR.test('./output'));
assert.ok(!PATTERNS.OUTPUT_DIR.test('./out\nPORT=1'));
assert.ok(!PATTERNS.OUTPUT_DIR.test(''));

// Path rules. The default keeps a clone writing exactly where it always did;
// UNFRAMED_DATA_DIR moves both, because in a packaged app the project root is a
// read-only bundle and a key written there would fail or vanish on update.
delete process.env.UNFRAMED_DATA_DIR;
assert.equal(envFile('/repo'), '/repo/.env');
assert.equal(outputPath('/repo'), '/repo/output');
assert.equal(outputPath('/repo', './output'), '/repo/output');

// An absolute output dir passes through untouched -- what the folder picker
// returns and what the packaged app always supplies.
assert.equal(outputPath('/repo', '/Users/me/Pictures/Unframed'), '/Users/me/Pictures/Unframed');

process.env.UNFRAMED_DATA_DIR = '/data';
assert.equal(envFile('/repo'), '/data/.env');
assert.equal(outputPath('/repo', './output'), '/data/output');
assert.equal(outputPath('/repo', '/abs'), '/abs');
delete process.env.UNFRAMED_DATA_DIR;

// --- writeEnvFile ---------------------------------------------------------
// The file this writes holds a payment credential that nothing can re-fetch, so
// two properties matter beyond the content: who can read it, and whether an
// interrupted write can destroy what was already there.
{
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'unframed-env-'));
  const file = path.join(dir, '.env');

  await writeEnvFile(file, 'OPENROUTER_API_KEY=sk-or-v1-secretone\n');
  assert.equal(await fs.readFile(file, 'utf8'), 'OPENROUTER_API_KEY=sk-or-v1-secretone\n');
  // 0600. A plain fs.writeFile lands at 0644 under the usual umask, which makes
  // the key readable by every other account on the machine.
  assert.equal((await fs.stat(file)).mode & 0o777, 0o600, 'a new .env is private');

  // And an .env that ALREADY exists world-readable is tightened by the next
  // write, which is what every install predating this has. The rename is what
  // does it: the destination inherits the temp file's mode, so this needs no
  // separate chmod pass and no migration step.
  await fs.chmod(file, 0o644);
  await writeEnvFile(file, 'OPENROUTER_API_KEY=sk-or-v1-secrettwo\n');
  assert.equal((await fs.stat(file)).mode & 0o777, 0o600, 'an existing 0644 .env is tightened');

  // Nothing left behind. A stray .tmp beside .env would be a second copy of the
  // key, at whatever mode it happened to get.
  assert.deepEqual(await fs.readdir(dir), ['.env'], 'no temp file survives');

  // A rename that FAILS must not leave the temp behind -- that temp holds the full
  // key, and nothing else ever deletes it, so every failed write would add another
  // plaintext copy while "Remove key" reported success. Forced by pointing the
  // write at a path that is a directory, so the rename onto it cannot succeed.
  const dir2 = await fs.mkdtemp(path.join(os.tmpdir(), 'unframed-env-fail-'));
  const asDir = path.join(dir2, '.env');
  await fs.mkdir(asDir); // .env is a directory here: rename onto it must fail
  await assert.rejects(writeEnvFile(asDir, 'OPENROUTER_API_KEY=sk-or-v1-mustnotleak'), 'the failed write rejects');
  assert.deepEqual(await fs.readdir(dir2), ['.env'], 'and leaves no .tmp copy of the key behind');
  await fs.rm(dir2, { recursive: true, force: true });

  await fs.rm(dir, { recursive: true, force: true });
}

console.log('env.test.js: ok');
