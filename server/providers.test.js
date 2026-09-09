// node server/providers.test.js  (also runs as part of `npm test`)
//
// The pure half of the provider layer: how a configured binary name becomes something
// that can be spawned, what environment the CLI runs with, and how the two probes'
// results become one of the statuses the settings dialog shows. The spawning itself is
// exercised against fake binaries in host.test.js.
import assert from 'node:assert/strict';
import {
  mergeClaudeModels,
  CLAUDE_CATALOGUE,
  resolveExecutable,
  providerEnv,
  hydratedPath,
  parseVersion,
  classify,
  parseCodexLoginStatus,
  PROVIDERS,
} from './providers.js';

// ---- the two providers, and only those two ----
assert.deepEqual(Object.keys(PROVIDERS).sort(), ['claude', 'codex']);
assert.equal(PROVIDERS.claude.binary, 'claude');
assert.equal(PROVIDERS.codex.binary, 'codex');

// ---- resolveExecutable ----
{
  const none = () => false;
  // Anywhere but Windows the value is spawned as configured: a bare name goes through
  // PATH at spawn time, an absolute path is used as-is.
  assert.equal(resolveExecutable('claude', { platform: 'darwin', env: {}, isFile: none }), 'claude');
  assert.equal(resolveExecutable('/opt/homebrew/bin/claude', { platform: 'linux', env: {}, isFile: none }), '/opt/homebrew/bin/claude');
  // Windows: a bare name is looked up on PATH with PATHEXT, because the Agent SDK
  // spawns without a shell and cannot do that itself.
  const winEnv = { PATH: 'C:\\Users\\me\\AppData\\Roaming\\npm;C:\\Windows\\System32', PATHEXT: '.COM;.EXE;.BAT;.CMD' };
  const files = new Set([
    'C:\\Users\\me\\AppData\\Roaming\\npm\\claude.cmd',
    'C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js',
  ]);
  const isFile = (p) => files.has(p);
  // An npm launcher shim (.cmd) is followed to the package entry next to it -- the SDK
  // cannot spawn a .cmd (spawn EINVAL since Node 20.12). Older packages ship cli.js.
  assert.equal(
    resolveExecutable('claude', { platform: 'win32', env: winEnv, isFile }),
    'C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js',
  );
  // Newer packages ship a native bin/claude.exe, preferred when present.
  files.add('C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe');
  assert.equal(
    resolveExecutable('claude', { platform: 'win32', env: winEnv, isFile }),
    'C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe',
  );
  // A real .exe on PATH is used directly.
  const exeFiles = new Set(['C:\\Program Files\\Claude\\claude.exe']);
  assert.equal(
    resolveExecutable('claude', { platform: 'win32', env: { PATH: 'C:\\Program Files\\Claude', PATHEXT: '.EXE;.CMD' }, isFile: (p) => exeFiles.has(p) }),
    'C:\\Program Files\\Claude\\claude.exe',
  );
  // Nothing found: hand back the name and let the spawn report ENOENT honestly.
  assert.equal(resolveExecutable('claude', { platform: 'win32', env: winEnv, isFile: none }), 'claude');
  // A shim with no known package entry beside it: the shim path itself, not the bare name.
  const lonelyShim = new Set(['C:\\Users\\me\\AppData\\Roaming\\npm\\claude.cmd']);
  assert.equal(
    resolveExecutable('claude', { platform: 'win32', env: winEnv, isFile: (p) => lonelyShim.has(p) }),
    'C:\\Users\\me\\AppData\\Roaming\\npm\\claude.cmd',
  );
}

// ---- providerEnv: CLAUDE_CONFIG_DIR only when asked; HOME never overridden ----
{
  const base = { HOME: '/Users/me', PATH: '/usr/bin' };
  assert.deepEqual(providerEnv(base, {}), base, 'nothing configured: the environment is the environment');
  assert.notEqual(providerEnv(base, {}), base, 'but a copy, never the process object');
  assert.deepEqual(providerEnv(base, { configDir: '/Users/me/.claude-unframed' }), { ...base, CLAUDE_CONFIG_DIR: '/Users/me/.claude-unframed' });
  assert.deepEqual(providerEnv(base, { configDir: '  ' }), base, 'blank is not configured');
  // Overriding HOME relocates the macOS keychain lookup and the CLI reports "Not logged
  // in" -- so a config dir must never be expressed that way, and a present HOME is kept.
  assert.equal(providerEnv(base, { configDir: '/x' }).HOME, '/Users/me');
  // A missing HOME (some launchers) is filled from the OS, since the keychain lookup
  // needs it; a present one is left alone.
  assert.equal(providerEnv({ PATH: '/usr/bin' }, { homedir: '/Users/fallback' }).HOME, '/Users/fallback');
  assert.equal(providerEnv(base, { homedir: '/Users/fallback' }).HOME, '/Users/me');
}

// ---- hydratedPath: what we had first, the login shell's entries appended, no duplicates ----
{
  assert.equal(hydratedPath('/opt/homebrew/bin:/usr/local/bin', '/usr/bin:/bin', 'darwin'), '/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin');
  assert.equal(hydratedPath('/usr/bin:/opt/homebrew/bin', '/usr/bin:/bin', 'darwin'), '/usr/bin:/bin:/opt/homebrew/bin');
  assert.equal(hydratedPath('', '/usr/bin', 'darwin'), '/usr/bin', 'no shell answer: unchanged');
  assert.equal(hydratedPath(undefined, '/usr/bin', 'linux'), '/usr/bin');
  assert.equal(hydratedPath('C:\\a;C:\\b', 'C:\\b;C:\\c', 'win32'), 'C:\\b;C:\\c;C:\\a', 'Windows separates with ;');
}

// ---- parseVersion ----
assert.equal(parseVersion('2.1.258 (Claude Code)\n'), '2.1.258');
assert.equal(parseVersion('codex-cli 0.149.0'), '0.149.0');
assert.equal(parseVersion('v1.2.3-beta.4'), '1.2.3-beta.4');
assert.equal(parseVersion('nothing here'), null);
assert.equal(parseVersion(''), null);

// ---- parseCodexLoginStatus ----
assert.deepEqual(parseCodexLoginStatus('Logged in using ChatGPT\n'), { ok: true, plan: 'ChatGPT' });
assert.deepEqual(parseCodexLoginStatus('Logged in using an API key'), { ok: true, plan: 'API key' });
assert.deepEqual(parseCodexLoginStatus('Not logged in'), { ok: false, signedOut: true });
assert.deepEqual(parseCodexLoginStatus('something unexpected'), { ok: false, signedOut: false });

// ---- classify: the outcomes the settings dialog shows, each its own message ----
{
  const c = (v, p) => classify('claude', { version: v, probe: p });
  // Spawn failed because the binary is not there.
  let r = c({ ok: false, code: 'ENOENT' });
  assert.equal(r.status, 'not_installed');
  assert.equal(r.installed, false);
  assert.match(r.message, /not installed|not on PATH/i);
  // Spawn worked but the process failed or hung.
  r = c({ ok: false, code: 'ETIMEDOUT' });
  assert.equal(r.status, 'wont_run');
  assert.equal(r.installed, true);
  assert.match(r.message, /timed out/i);
  r = c({ ok: true, exitCode: 1, stdout: '', stderr: 'boom' });
  assert.equal(r.status, 'wont_run');
  assert.match(r.message, /failed to run/i);
  // Runs, but the auth probe could not answer.
  r = c({ ok: true, exitCode: 0, stdout: '2.1.258 (Claude Code)' }, { ok: false });
  assert.equal(r.status, 'auth_unknown');
  assert.equal(r.version, '2.1.258');
  assert.match(r.message, /could not verify/i);
  r = c({ ok: true, exitCode: 0, stdout: '2.1.258 (Claude Code)' }, undefined);
  assert.equal(r.status, 'auth_unknown');
  // Runs, and the probe says nobody is signed in.
  r = c({ ok: true, exitCode: 0, stdout: '2.1.258' }, { ok: false, signedOut: true });
  assert.equal(r.status, 'signed_out');
  assert.match(r.message, /sign in|log in/i);
  // Ready.
  r = c({ ok: true, exitCode: 0, stdout: '2.1.258 (Claude Code)' }, { ok: true, email: 'me@example.com', plan: 'max' });
  assert.equal(r.status, 'ready');
  assert.equal(r.installed, true);
  assert.equal(r.version, '2.1.258');
  assert.deepEqual(r.auth, { email: 'me@example.com', plan: 'max' });
  assert.equal(r.message, undefined);
  // The provider's display name travels with it.
  assert.equal(r.name, PROVIDERS.claude.name);
  assert.equal(classify('codex', { version: { ok: false, code: 'ENOENT' } }).name, PROVIDERS.codex.name);
}

// ---- mergeClaudeModels: the SDK's aliases, named from the catalogue, then the rest ----
{
  const sdk = [
    { value: 'default', displayName: 'Default (recommended)', description: 'Opus 5 with 1M context', supportedEffortLevels: ['low', 'high'] },
    { value: 'opus[1m]', displayName: 'Opus (1M context)', description: 'Opus 5 with 1M context', supportedEffortLevels: ['low', 'high'] },
    { value: 'sonnet', displayName: 'Sonnet', description: 'Sonnet 5', supportedEffortLevels: ['low'] },
    { value: 'haiku', displayName: 'Haiku', description: 'Haiku 4.5', supportedEffortLevels: [] },
    { value: 'mystery-9', displayName: 'Mystery', description: '', supportedEffortLevels: [] },
  ];
  const rows = mergeClaudeModels(sdk);
  assert.equal(rows.some((r) => r.id === 'default'), false, 'the default alias is folded away');
  assert.deepEqual(rows.slice(0, 4).map((r) => [r.id, r.name, r.legacy]), [
    ['opus[1m]', 'Opus 5 · 1M', false],
    ['sonnet', 'Sonnet 5', false],
    ['haiku', 'Haiku 4.5', false],
    ['mystery-9', 'Mystery', false],
  ]);
  assert.deepEqual(rows[0].efforts, ['low', 'high'], 'an SDK row keeps the levels the SDK reported');
  const rest = rows.slice(4);
  assert.ok(rest.every((r) => CLAUDE_CATALOGUE.some((c) => c.id === r.id)), 'the rest is the catalogue');
  assert.equal(rest.some((r) => r.id === 'claude-opus-5' || r.id === 'claude-sonnet-5' || r.id === 'claude-haiku-4-5'), false, 'models the SDK covered are not repeated');
  assert.ok(rest.some((r) => r.id === 'claude-fable-5-1' && !r.legacy), 'a current model the SDK did not list is still offered, as current');
  assert.ok(rest.some((r) => r.id === 'claude-opus-4-8' && r.legacy), 'and the older ones as legacy');
  assert.deepEqual(rest.find((r) => r.id === 'claude-opus-4-8').efforts, ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.deepEqual(mergeClaudeModels([]).map((r) => r.id), CLAUDE_CATALOGUE.map((c) => c.id), 'no SDK list: the catalogue alone');
}

console.log('providers.test.js: ok');
