// node server/env.test.js  (also runs as part of `npm test`)
import assert from 'node:assert/strict';
import { upsertEnv, PATTERNS } from './env.js';

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

console.log('env.test.js: ok');
