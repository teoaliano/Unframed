import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};


const desktop = path.resolve(import.meta.dirname, '..');
const root = process.env.E2E_ROOT ?? path.join(os.tmpdir(), 'unframed-update-e2e');
const FROM = option('from', '90.0.0');
const TO = option('to', '90.0.1');
const FEED_PORT = 47821;
const DEBUG_PORT = 47822;
const BUNDLE_ID = 'com.teoaliano.unframed';
const SHIPIT_LOG = path.join(os.homedir(), 'Library/Caches', `${BUNDLE_ID}.ShipIt`, 'ShipIt_stderr.log');
const UPDATER_CACHE = path.join(os.homedir(), 'Library/Caches/unframed-app-e2e-updater');
const appPath = path.join(root, 'install', 'Unframed.app');
const runDir = path.join(root, `run-${new Date().toISOString().replace(/[:.]/g, '-')}`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (line) => console.log(`[e2e ${new Date().toISOString().slice(11, 19)}] ${line}`);
const sh = (cmd, cmdArgs, opts = {}) => execFileSync(cmd, cmdArgs, { encoding: 'utf8', ...opts });
const APP_DATA = path.join(os.homedir(), 'Library', 'Application Support', 'unframed-app-e2e');
const APP_LOG = path.join(APP_DATA, 'logs', 'main.log');
const shQuiet = (cmd, cmdArgs) => spawnSync(cmd, cmdArgs, { encoding: 'utf8', timeout: 15000, maxBuffer: 256 * 1024 * 1024 }).stdout ?? '';

async function waitFor(label, fn, timeoutMs, everyMs = 500) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const value = await fn();
    if (value) return value;
    await sleep(everyMs);
  }
  throw new Error(`timed out after ${timeoutMs / 1000}s waiting for ${label}`);
}

const buildDir = (version) => path.join(root, `build-${version}`);

function build(version) {
  const out = buildDir(version);
  if (flag('skip-build') && fs.existsSync(path.join(out, 'latest-mac.yml'))) return say(`reusing build ${version}`);
  say(`building ${version} (signed, not notarized)`);
  fs.rmSync(out, { recursive: true, force: true });
  sh('npx', ['electron-builder', '--mac', '--publish', 'never', '--config', 'e2e/builder.e2e.cjs'], {
    cwd: desktop,
    stdio: 'inherit',
    env: { ...process.env, E2E_OUT: out, E2E_VERSION: version, E2E_FEED_URL: `http://127.0.0.1:${FEED_PORT}/` },
  });
}

function serveFeed(dir) {
  const server = http.createServer((req, res) => {
    const file = path.join(dir, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end();
      return;
    }
    fs.appendFileSync(path.join(runDir, 'feed.log'), `${new Date().toISOString()} ${req.method} ${req.url}\n`);
    res.writeHead(200, { 'content-length': fs.statSync(file).size });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((r) => server.listen(FEED_PORT, '127.0.0.1', () => r(server)));
}

const installedVersion = () =>
  shQuiet('defaults', ['read', path.join(appPath, 'Contents/Info.plist'), 'CFBundleShortVersionString']).trim();

const appPids = () =>
  shQuiet('pgrep', ['-f', `${appPath}/Contents/MacOS/Unframed`])
    .split('\n')
    .filter(Boolean);

const realAppRunning = () => shQuiet('pgrep', ['-f', '/Applications/Unframed.app/Contents/MacOS/Unframed']).trim() !== '';

function backgroundTaskDisposition() {
  const dump = shQuiet('sfltool', ['dumpbtm']);
  const block = dump.split(/\n\s*#\d+:\n/).find((b) => b.includes('Name: Unframed - background tasks'));
  return block?.match(/Disposition: (\[[^\]]*\])/)?.[1] ?? 'not registered';
}

async function cdp(expression) {
  const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json();
  const page = targets.find((t) => t.type === 'page');
  if (!page) return undefined;
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  try {
    return await new Promise((resolve) => {
      ws.onmessage = (m) => {
        const msg = JSON.parse(m.data);
        if (msg.id === 1) resolve(msg.result?.result?.value);
      };
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true, userGesture: true } }));
    });
  } finally {
    ws.close();
  }
}

const PILL = `(() => {
  const el = document.getElementById('unframed-update-pill');
  if (!el || el.style.display === 'none') return { shown: false };
  const go = el.querySelector('[data-x="go"]');
  return {
    shown: true,
    text: el.textContent.trim(),
    stage: el.dataset.stage ?? null,
    action: go && go.style.display !== 'none' && !go.disabled ? go.textContent.trim() : null,
  };
})()`;

const pill = () => cdp(PILL).catch(() => undefined);
const clickPill = () => cdp(`document.querySelector('#unframed-update-pill [data-x="go"]').click()`);

const localTime = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

const appLogSince = (offset) => (fs.existsSync(APP_LOG) ? fs.readFileSync(APP_LOG, 'utf8').slice(offset) : '');

function systemLog(sinceIso) {
  const out = shQuiet('/usr/bin/log', [
    'show', '--style', 'compact', '--start', localTime(new Date(sinceIso)),
    '--predicate', 'process == "loginwindow" OR process == "launchd" OR process == "ShipIt"',
  ]);
  return out
    .split('\n')
    .filter((l) => /libquit|removing job|quitOrKillSubordinate|ShipIt|unframed/i.test(l) && /unframed|ShipIt|libquit/i.test(l))
    .join('\n');
}

async function main() {
  if (process.platform !== 'darwin') throw new Error('this test drives Squirrel.Mac and runs on macOS only');
  if (realAppRunning()) throw new Error('quit /Applications/Unframed.app first: it shares the bundle id, the ShipIt job and the background item');
  fs.mkdirSync(runDir, { recursive: true });

  build(FROM);
  build(TO);

  say(`installing ${FROM} at ${appPath}`);
  fs.rmSync(path.dirname(appPath), { recursive: true, force: true });
  fs.mkdirSync(path.dirname(appPath), { recursive: true });
  sh('ditto', [path.join(buildDir(FROM), 'mac-arm64', 'Unframed.app'), appPath]);
  fs.rmSync(UPDATER_CACHE, { recursive: true, force: true });
  fs.rmSync(path.join(APP_DATA, 'desktop-update-install.json'), { force: true });
  const appLogOffset = fs.existsSync(APP_LOG) ? fs.statSync(APP_LOG).size : 0;

  const server = await serveFeed(buildDir(TO));
  const shipItOffset = fs.existsSync(SHIPIT_LOG) ? fs.statSync(SHIPIT_LOG).size : 0;
  const startedAt = new Date().toISOString();
  const result = { from: FROM, to: TO, backgroundTasks: backgroundTaskDisposition() };
  say(`background tasks item: ${result.backgroundTasks}`);

  try {
    say('launching');
    sh('open', ['-a', appPath, '--stdout', path.join(runDir, 'app.out.log'), '--stderr', path.join(runDir, 'app.err.log'), '--args', `--remote-debugging-port=${DEBUG_PORT}`]);
    await waitFor('the window', async () => (await cdp('document.readyState').catch(() => null)) === 'complete', 60000);

    let clickedRestart = false;
    await waitFor('the update to be offered and acted on', async () => {
      const p = await pill();
      if (!p?.shown || !p.action) return false;
      if (/download/i.test(p.action)) {
        say(`pill: "${p.text}" -> clicking ${p.action}`);
        await clickPill();
        return false;
      }
      say(`pill: "${p.text}" -> clicking ${p.action}`);
      await clickPill();
      clickedRestart = true;
      return true;
    }, 300000, 1000);

    result.clickedRestart = clickedRestart;

    await waitFor('the app to exit', () => appPids().length === 0 || installedVersion() === TO, 60000).catch(() => {});
    result.installed = await waitFor(`version ${TO} on disk`, () => installedVersion() === TO, 120000).then(() => true, () => false);
    result.versionOnDisk = installedVersion();
    result.relaunched = await waitFor('a relaunch', () => appPids().length > 0, 20000).then(() => true, () => false);
    const relaunchLog = () => appLogSince(appLogOffset).split(`Unframed ${TO} starting`)[1] ?? '';
    result.engineStartedAfterRelaunch = await waitFor('the relaunched engine', () => /engine ready/.test(relaunchLog()), 30000).then(() => true, () => false);
    await sleep(5000);
    result.engineStillUpAfterRelaunch = result.engineStartedAfterRelaunch && !/engine stopped unexpectedly|engine exited/i.test(relaunchLog());
    const leftovers = () => fs.readdirSync(path.dirname(appPath)).filter((n) => n.startsWith('.unframed-update-'));
    result.stagingRemoved = await waitFor('the staging folder to be removed', () => leftovers().length === 0, 30000).then(() => true, () => false);
  } finally {
    server.close();
    await sleep(2000);
    for (const pid of appPids()) spawnSync('kill', [pid]);
    await sleep(2000);
    for (const pid of appPids()) spawnSync('kill', ['-9', pid]);
    const shipIt = fs.existsSync(SHIPIT_LOG)
      ? fs.readFileSync(SHIPIT_LOG, 'utf8').slice(shipItOffset).split('\n').filter((l) => l && !l.includes('Unrecognized attribute')).join('\n')
      : '';
    fs.writeFileSync(path.join(runDir, 'shipit.log'), shipIt);
    fs.writeFileSync(path.join(runDir, 'system.log'), systemLog(startedAt));
    if (fs.existsSync(APP_LOG)) fs.writeFileSync(path.join(runDir, 'main.log'), fs.readFileSync(APP_LOG, 'utf8').slice(appLogOffset));
    result.forceQuitByLoginwindow = /libquit.*force quit|removing job: caller = loginwindow/.test(fs.readFileSync(path.join(runDir, 'system.log'), 'utf8'));
    result.shipIt = /Installation completed successfully/.test(shipIt)
      ? 'completed'
      : /Too many attempts/.test(shipIt) ? 'gave up' : /App Still Running/i.test(shipIt) ? 'app still running' : shipIt ? 'started, no result' : 'never ran';
    result.logs = runDir;
    fs.writeFileSync(path.join(runDir, 'result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  }
  process.exitCode = result.installed && result.engineStillUpAfterRelaunch && result.stagingRemoved ? 0 : 1;
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 2;
});
