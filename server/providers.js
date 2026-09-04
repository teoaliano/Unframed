// The provider layer, pure half: the two local agent CLIs Unframed can run on a user's
// own subscription, how a configured binary becomes something spawnable, what
// environment it runs with, and how the probes' answers become one status. Spawning,
// the auth probes, the cache and the route are in index.js; tests in providers.test.js
// and (against fake binaries) host.test.js. Ported from what t3code learned the hard
// way: docs/research/2026-08-21-local-agent-cli-providers.md.
import path from 'node:path';

export const PROVIDERS = {
  claude: {
    name: 'Claude',
    binary: 'claude',
    // The npm package whose launcher shim a Windows PATH lookup lands on, and the entries
    // inside it the Agent SDK CAN spawn (it spawns without a shell, so a .cmd shim fails
    // with EINVAL). Newer packages ship a native binary; older ones only cli.js.
    npmPackage: ['@anthropic-ai', 'claude-code'],
    packageEntries: [['bin', 'claude.exe'], ['cli.js']],
    install: 'https://claude.com/product/claude-code',
  },
  codex: {
    name: 'Codex',
    binary: 'codex',
    npmPackage: ['@openai', 'codex'],
    packageEntries: [],
    install: 'https://developers.openai.com/codex/cli',
  },
};

const WINDOWS_SHIMS = new Set(['.cmd', '.bat', '.ps1']);

// Anywhere but Windows the configured value is spawned as-is: a bare name resolves on
// PATH at spawn time, a path is a path. On Windows the SDK's spawn does neither, so the
// name is looked up here with PATHEXT, and an npm launcher shim is followed to the
// package entry beside it.
export function resolveExecutable(binary, { platform, env, isFile }) {
  if (platform !== 'win32') return binary;
  const win = path.win32;
  let resolved = binary;
  if (!win.isAbsolute(binary) && !binary.includes('\\') && !binary.includes('/')) {
    const dirs = String(env.PATH || env.Path || '').split(';').filter(Boolean);
    const exts = String(env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean);
    const hasExt = win.extname(binary) !== '';
    let found = null;
    outer: for (const dir of dirs) {
      for (const ext of hasExt ? [''] : exts) {
        const candidate = win.join(dir, binary + ext.toLowerCase());
        if (isFile(candidate)) {
          found = candidate;
          break outer;
        }
      }
    }
    if (!found) return binary; // let the spawn report ENOENT honestly
    resolved = found;
  }
  if (!WINDOWS_SHIMS.has(win.extname(resolved).toLowerCase())) return resolved;
  const shimDir = win.dirname(resolved);
  const provider = Object.values(PROVIDERS).find((p) => p.binary === win.basename(resolved, win.extname(resolved)).toLowerCase());
  for (const entry of provider?.packageEntries ?? []) {
    const candidate = win.join(shimDir, 'node_modules', ...provider.npmPackage, ...entry);
    if (isFile(candidate)) return candidate;
  }
  return resolved;
}

// The CLI's environment. CLAUDE_CONFIG_DIR only when the user configured a separate
// config dir -- and never HOME for that purpose: overriding HOME relocates the macOS
// keychain lookup ($HOME/Library/Keychains), the CLI cannot find its stored OAuth
// credentials, and it reports "Not logged in". A missing HOME is filled from the OS for
// the same reason; a present one is never touched.
export function providerEnv(base, { configDir, homedir } = {}) {
  const env = { ...base };
  const dir = typeof configDir === 'string' ? configDir.trim() : '';
  if (dir) env.CLAUDE_CONFIG_DIR = dir;
  if (!env.HOME && homedir) env.HOME = homedir;
  return env;
}

// A GUI-launched app does not inherit the shell's PATH, so `claude` is invisible to it
// even though the terminal finds it instantly. The login shell's PATH goes first, then
// whatever the process had, without duplicates. Empty or missing shell answer: unchanged.
export function hydratedPath(loginShellPath, currentPath, platform) {
  const sep = platform === 'win32' ? ';' : ':';
  const seen = new Set();
  const out = [];
  for (const part of `${loginShellPath || ''}${sep}${currentPath || ''}`.split(sep)) {
    if (!part || seen.has(part)) continue;
    seen.add(part);
    out.push(part);
  }
  return out.join(sep);
}

export function parseVersion(text) {
  const m = /(\d+\.\d+\.\d+(?:-[\w.]+)?)/.exec(String(text || ''));
  return m ? m[1] : null;
}

// `codex login status` prints one line. Anything unrecognised is "could not tell", not
// "signed out": the wording may change under us, and guessing signed-out would tell a
// logged-in user to log in.
export function parseCodexLoginStatus(text) {
  const t = String(text || '').trim();
  const m = /logged in using (.+)/i.exec(t);
  if (m) return { ok: true, plan: m[1].replace(/^an?\s+/i, '').trim() };
  if (/not logged in/i.test(t)) return { ok: false, signedOut: true };
  return { ok: false, signedOut: false };
}

// One status per provider, each with its own message, so the settings dialog can say
// what to do rather than "something went wrong".
//
//   version: { ok: false, code }                    spawn failed (ENOENT, ETIMEDOUT, ...)
//            { ok: true, exitCode, stdout, stderr } ran
//   probe:   undefined | { ok: false, signedOut? } | { ok: true, email?, plan? }
export function classify(kind, { version, probe }) {
  const p = PROVIDERS[kind];
  const base = { kind, name: p.name, binary: p.binary, install: p.install };
  if (!version || !version.ok) {
    if (version?.code === 'ENOENT') {
      return { ...base, status: 'not_installed', installed: false, version: null, message: `${p.name} is not installed or not on PATH.` };
    }
    return {
      ...base,
      status: 'wont_run',
      installed: true,
      version: null,
      message: version?.code === 'ETIMEDOUT' ? `${p.name} is installed but timed out while starting.` : `${p.name} is installed but failed to run${version?.code ? ` (${version.code})` : ''}.`,
    };
  }
  const parsed = parseVersion(`${version.stdout || ''}\n${version.stderr || ''}`);
  if (version.exitCode !== 0) {
    return { ...base, status: 'wont_run', installed: true, version: parsed, message: `${p.name} is installed but failed to run.` };
  }
  if (probe?.ok) {
    const auth = {};
    if (probe.email) auth.email = probe.email;
    if (probe.plan) auth.plan = probe.plan;
    return { ...base, status: 'ready', installed: true, version: parsed, auth };
  }
  if (probe?.signedOut) {
    return { ...base, status: 'signed_out', installed: true, version: parsed, message: `${p.name} is installed but not signed in. Sign in with \`${p.binary} login\`, then check again.` };
  }
  return { ...base, status: 'auth_unknown', installed: true, version: parsed, message: `${p.name} runs, but Unframed could not verify who is signed in.` };
}
