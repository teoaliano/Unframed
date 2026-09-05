// The provider layer, pure half: the two local agent CLIs Unframed can run on a user's
// own subscription, how a configured binary becomes something spawnable, what
// environment it runs with, and how the probes' answers become one status. Spawning,
// the auth probes, the cache and the route are in index.js; tests in providers.test.js
// and (against fake binaries) host.test.js. Ported from what t3code learned the hard
// way: docs/research/2026-08-21-local-agent-cli-providers.md.
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { query } from '@anthropic-ai/claude-agent-sdk';

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
// even though the terminal finds it instantly. The process's own PATH stays first --
// whoever launched it chose that order -- and the login shell's entries are appended,
// without duplicates. Empty or missing shell answer: unchanged.
export function hydratedPath(loginShellPath, currentPath, platform) {
  const sep = platform === 'win32' ? ';' : ':';
  const seen = new Set();
  const out = [];
  for (const part of `${currentPath || ''}${sep}${loginShellPath || ''}`.split(sep)) {
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
    return { ...base, status: 'ready', installed: true, version: parsed, auth, ...(probe.models ? { models: probe.models } : {}) };
  }
  if (probe?.signedOut) {
    return { ...base, status: 'signed_out', installed: true, version: parsed, message: `${p.name} is installed but not signed in. Sign in with \`${p.binary} login\`, then check again.` };
  }
  return { ...base, status: 'auth_unknown', installed: true, version: parsed, message: `${p.name} runs, but Unframed could not verify who is signed in.` };
}

// ---- I/O: running the probes ----
// Thin, and every failure is a VALUE, not a rejection: the route has to answer either
// way, and classify() above is what reads these shapes.

const isFile = (p) => {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};

// Runs a command with no shell and a deadline. Resolves { ok: true, exitCode, stdout,
// stderr } when the process ran at all, { ok: false, code } when it could not be
// spawned (ENOENT: not installed) or did not finish in time (ETIMEDOUT).
export function runCommand(cmd, args, { env, cwd, timeoutMs = 3000, input } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, { env, cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    } catch (err) {
      return resolve({ ok: false, code: err.code || 'ESPAWN' });
    }
    let stdout = '';
    let stderr = '';
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish({ ok: false, code: 'ETIMEDOUT' });
    }, timeoutMs);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (err) => finish({ ok: false, code: err.code || 'ESPAWN' }));
    child.on('close', (exitCode) => finish({ ok: true, exitCode, stdout, stderr }));
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

// The login shell's PATH, asked once per process. A GUI-launched app inherits launchd's
// PATH, which has none of the Homebrew or npm directories the CLIs are installed into.
let shellPathPromise = null;
export function loginShellPath({ platform = process.platform, shell = process.env.SHELL, env = process.env } = {}) {
  if (platform === 'win32') return Promise.resolve(null);
  if (!shellPathPromise) {
    const sh = shell && shell.trim() ? shell : '/bin/sh';
    shellPathPromise = runCommand(sh, ['-lc', 'echo "$PATH"'], { env, timeoutMs: 4000 }).then((r) => {
      if (!r.ok || r.exitCode !== 0) return null;
      const lines = r.stdout.trim().split('\n').filter(Boolean);
      return lines.length ? lines[lines.length - 1].trim() : null;
    });
  }
  return shellPathPromise;
}

const withTimeout = (promise, ms) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('probe timed out')), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });

// Who is signed in to Claude, for zero tokens: an Agent SDK session whose prompt never
// yields a message, read for its initialization result and then closed. No prompt ever
// reaches Anthropic. `signedOut` is claimed only when the CLI answered with an account
// that has nothing in it; any other failure is "could not tell".
export async function probeClaude(executable, env, { cwd = os.homedir(), timeoutMs = 15000 } = {}) {
  const abort = new AbortController();
  const prompt = (async function* neverYields() {
    await new Promise((resolve) => abort.signal.addEventListener('abort', resolve, { once: true }));
  })();
  let q;
  try {
    q = query({
      prompt,
      options: {
        pathToClaudeCodeExecutable: executable,
        env,
        cwd,
        settingSources: [],
        tools: [],
        permissionMode: 'default',
        persistSession: false,
        abortController: abort,
      },
    });
    const init = await withTimeout(q.initializationResult(), timeoutMs);
    const a = init?.account || {};
    if (!a.email && !a.subscriptionType && !a.apiKeySource && !a.tokenSource && !init?.apiKeySource) {
      return { ok: false, signedOut: true };
    }
    // The models this account can run, with the effort levels each accepts -- the
    // panel's model and effort controls are built from this. Still zero tokens: it is
    // a control request on the same handshake, not a prompt.
    const models = await withTimeout(q.supportedModels(), timeoutMs)
      .then((list) => (list ?? []).map((m) => ({ id: m.value, name: m.displayName || m.value, description: m.description || '', efforts: m.supportedEffortLevels ?? [] })))
      .catch(() => []);
    return { ok: true, email: a.email, plan: a.subscriptionType || (a.apiKeySource || init?.apiKeySource ? 'API key' : undefined), tokenSource: a.tokenSource, models };
  } catch {
    return { ok: false, signedOut: false };
  } finally {
    abort.abort();
    try {
      q?.close?.();
    } catch {
      // already gone
    }
  }
}

export async function probeCodex(executable, env) {
  const r = await runCommand(executable, ['login', 'status'], { env, timeoutMs: 8000 });
  if (!r.ok) return { ok: false, signedOut: false };
  return parseCodexLoginStatus(`${r.stdout}\n${r.stderr}`);
}

// The whole detection for one provider: PATH hydrated from the login shell, the
// executable resolved, `--version` run, then the auth probe if it ran. Never rejects.
export async function detectProvider(kind, { binaryPath, configDir } = {}, { platform = process.platform, env = process.env } = {}) {
  const p = PROVIDERS[kind];
  const shellPath = await loginShellPath({ platform, env });
  const penv = providerEnv(
    { ...env, PATH: hydratedPath(shellPath, env.PATH, platform) },
    { configDir: kind === 'claude' ? configDir : undefined, homedir: os.homedir() },
  );
  const cmd = typeof binaryPath === 'string' && binaryPath.trim() ? binaryPath.trim() : p.binary;
  const executable = resolveExecutable(cmd, { platform, env: penv, isFile });
  const version = await runCommand(executable, ['--version'], { env: penv, timeoutMs: 5000 });
  let probe;
  if (version.ok && version.exitCode === 0) {
    probe = kind === 'claude' ? await probeClaude(executable, penv) : await probeCodex(executable, penv);
  }
  return { ...classify(kind, { version, probe }), executable, checkedAt: new Date().toISOString() };
}

// Five minutes, per provider. A refresh, or a settings change, throws the cache away.
const STATUS_TTL_MS = 5 * 60 * 1000;
const statusCache = new Map(); // kind -> { at, promise }

export function forgetProviderStatus(kind) {
  if (kind) statusCache.delete(kind);
  else statusCache.clear();
}

export function providerStatus(kind, settings, { refresh = false } = {}) {
  const hit = statusCache.get(kind);
  if (!refresh && hit && Date.now() - hit.at < STATUS_TTL_MS) return hit.promise;
  const promise = detectProvider(kind, settings);
  statusCache.set(kind, { at: Date.now(), promise });
  return promise;
}

export async function providerStatuses(settingsFor, opts) {
  const kinds = Object.keys(PROVIDERS);
  const results = await Promise.all(kinds.map((k) => providerStatus(k, settingsFor(k), opts)));
  return Object.fromEntries(kinds.map((k, i) => [k, results[i]]));
}
