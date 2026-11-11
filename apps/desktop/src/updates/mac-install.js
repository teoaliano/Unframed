const fs = process.versions.electron ? require('original-fs') : require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const { execFile } = require('node:child_process');

const STAGE_PREFIX = '.unframed-update-';
const RELAUNCH_FLAG = '--unframed-relaunch-after=';

function relaunchedAfter(argv) {
  const arg = argv.find((a) => a.startsWith(RELAUNCH_FLAG));
  const pid = arg ? Number(arg.slice(RELAUNCH_FLAG.length)) : NaN;
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

async function waitForExit(pid, { alive = isAlive, everyMs = 100, timeoutMs = 15000 } = {}) {
  const end = Date.now() + timeoutMs;
  while (alive(pid)) {
    if (Date.now() >= end) return false;
    await new Promise((r) => setTimeout(r, everyMs));
  }
  return true;
}

const execRun = (cmd, args) =>
  new Promise((resolve, reject) =>
    execFile(cmd, args, { maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        err.message = `${cmd} failed: ${(stderr || err.message).trim()}`;
        return reject(err);
      }
      resolve({ stdout, stderr });
    }),
  );

function createMacInstaller({ appPath, run = execRun, log }) {
  const parent = path.dirname(appPath);

  async function canInstall() {
    if (!appPath.endsWith('.app') || appPath.includes('/AppTranslocation/')) return false;
    try {
      await fsp.access(parent, fs.constants.W_OK);
      await fsp.access(appPath, fs.constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }

  async function designatedRequirement() {
    const { stdout, stderr } = await run('codesign', ['-d', '-r-', appPath]);
    const match = `${stdout}\n${stderr ?? ''}`.match(/designated => (.+)/);
    if (!match) throw new Error('The running app has no designated requirement to check the update against.');
    return match[1].trim();
  }

  async function findApp(stage) {
    const apps = (await fsp.readdir(stage)).filter((n) => n.endsWith('.app'));
    if (apps.length !== 1) throw new Error(`The update archive holds ${apps.length} app bundles, expected one.`);
    return path.join(stage, apps[0]);
  }

  async function bundleVersion(bundle) {
    const plist = path.join(bundle, 'Contents', 'Info.plist');
    const { stdout } = await run('plutil', ['-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', plist]);
    return stdout.trim();
  }

  async function install({ zipPath, version }) {
    const requirement = await designatedRequirement();
    const stage = await fsp.mkdtemp(path.join(parent, STAGE_PREFIX));
    try {
      log.info(`unpacking ${zipPath}`);
      await run('ditto', ['-x', '-k', zipPath, stage]);
      const next = await findApp(stage);
      await run('codesign', ['--verify', '--deep', '--strict', '-R', `=${requirement}`, next]);
      const found = await bundleVersion(next);
      if (found !== version) throw new Error(`The update archive holds version ${found}, expected ${version}.`);
      const previous = path.join(stage, 'previous.app');
      await fsp.rename(appPath, previous);
      try {
        await fsp.rename(next, appPath);
      } catch (err) {
        await fsp.rename(previous, appPath);
        throw err;
      }
      log.info(`installed ${version} at ${appPath}`);
    } catch (err) {
      await fsp.rm(stage, { recursive: true, force: true });
      throw err;
    }
  }

  async function cleanup() {
    let names = [];
    try {
      names = await fsp.readdir(parent);
    } catch {
      return;
    }
    for (const name of names.filter((n) => n.startsWith(STAGE_PREFIX))) {
      await fsp.rm(path.join(parent, name), { recursive: true, force: true }).catch((err) =>
        log.warn(`could not remove ${name}: ${err.message}`),
      );
    }
  }

  async function relaunch(pid = process.pid) {
    await run('open', ['-n', appPath, '--args', `${RELAUNCH_FLAG}${pid}`]);
  }

  return { canInstall, install, cleanup, relaunch };
}

module.exports = { createMacInstaller, relaunchedAfter, waitForExit };
