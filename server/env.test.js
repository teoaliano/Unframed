// node server/env.test.js  (also runs as part of `npm test`)
import assert from 'node:assert/strict';
import { upsertEnv, PATTERNS, envFile, outputPath } from './env.js';

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

console.log('env.test.js: ok');
