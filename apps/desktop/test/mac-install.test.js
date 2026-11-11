const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createMacInstaller } = require('../src/updates/mac-install');
const { quietLog } = require('./fakes');

const DR = 'identifier "com.teoaliano.unframed" and anchor apple generic and certificate leaf[subject.OU] = N2X3SV5FDD';

function makeApp(dir, version) {
  const contents = path.join(dir, 'Contents');
  fs.mkdirSync(contents, { recursive: true });
  fs.writeFileSync(path.join(contents, 'version'), version);
}

async function setup({ appName = 'Unframed.app', fromVersion = '1.0.0', zipVersion = '1.1.0', verifies = true, zipAppName = 'Unframed.app' } = {}) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'mac-install-'));
  const apps = path.join(root, 'Applications');
  const appPath = path.join(apps, appName);
  makeApp(appPath, fromVersion);
  const zipPath = path.join(root, 'update.zip');
  fs.writeFileSync(zipPath, 'zip');
  const calls = [];
  const run = async (cmd, args) => {
    calls.push([cmd, ...args]);
    if (cmd === 'ditto') {
      makeApp(path.join(args.at(-1), zipAppName), zipVersion);
      return { stdout: '' };
    }
    if (cmd === 'codesign' && args[0] === '-d') return { stdout: `# designated => ${DR}\n` };
    if (cmd === 'codesign' && args[0] === '--verify') {
      if (!verifies) throw new Error('code object is not signed at all');
      return { stdout: '' };
    }
    if (cmd === 'plutil') {
      return { stdout: fs.readFileSync(path.join(args.at(-1), '..', 'version'), 'utf8') };
    }
    throw new Error(`unexpected ${cmd}`);
  };
  const installer = createMacInstaller({ appPath, run, log: quietLog });
  const versionOnDisk = () => fs.readFileSync(path.join(appPath, 'Contents', 'version'), 'utf8');
  const leftovers = () => fs.readdirSync(apps).filter((n) => n !== appName);
  return { root, apps, appPath, zipPath, calls, installer, versionOnDisk, leftovers };
}

test('install swaps the verified new bundle into place', async () => {
  const ctx = await setup();
  await ctx.installer.install({ zipPath: ctx.zipPath, version: '1.1.0' });
  assert.equal(ctx.versionOnDisk(), '1.1.0');
});

test('the new bundle must satisfy the running app’s designated requirement', async () => {
  const ctx = await setup();
  await ctx.installer.install({ zipPath: ctx.zipPath, version: '1.1.0' });
  const verify = ctx.calls.find((c) => c[0] === 'codesign' && c[1] === '--verify');
  assert.ok(verify.includes('--deep') && verify.includes('--strict'));
  assert.equal(verify[verify.indexOf('-R') + 1], `=${DR}`);
});

test('a bundle that fails verification is never installed and leaves nothing behind', async () => {
  const ctx = await setup({ verifies: false });
  await assert.rejects(ctx.installer.install({ zipPath: ctx.zipPath, version: '1.1.0' }), /not signed/);
  assert.equal(ctx.versionOnDisk(), '1.0.0');
  assert.deepEqual(ctx.leftovers(), []);
});

test('a bundle carrying a different version than offered is refused', async () => {
  const ctx = await setup({ zipVersion: '0.9.0' });
  await assert.rejects(ctx.installer.install({ zipPath: ctx.zipPath, version: '1.1.0' }), /0\.9\.0/);
  assert.equal(ctx.versionOnDisk(), '1.0.0');
  assert.deepEqual(ctx.leftovers(), []);
});

test('an archive without exactly one app is refused', async () => {
  const ctx = await setup({ zipAppName: 'Other/thing' });
  await assert.rejects(ctx.installer.install({ zipPath: ctx.zipPath, version: '1.1.0' }), /app bundle/);
  assert.equal(ctx.versionOnDisk(), '1.0.0');
});

test('a renamed app is updated under its own name', async () => {
  const ctx = await setup({ appName: 'My Unframed.app' });
  await ctx.installer.install({ zipPath: ctx.zipPath, version: '1.1.0' });
  assert.equal(ctx.versionOnDisk(), '1.1.0');
  assert.deepEqual(fs.readdirSync(ctx.apps).filter((n) => n.endsWith('.app')), ['My Unframed.app']);
});

test('a translocated or read-only app cannot install in place', async () => {
  const ctx = await setup();
  assert.equal(await ctx.installer.canInstall(), true);
  const translocated = createMacInstaller({
    appPath: '/private/var/folders/x/AppTranslocation/ABC/d/Unframed.app',
    run: async () => ({ stdout: '' }),
    log: quietLog,
  });
  assert.equal(await translocated.canInstall(), false);
  await fsp.chmod(ctx.apps, 0o555);
  try {
    assert.equal(await ctx.installer.canInstall(), false);
  } finally {
    await fsp.chmod(ctx.apps, 0o755);
  }
});

test('cleanup removes what an earlier install left beside the app', async () => {
  const ctx = await setup();
  await ctx.installer.install({ zipPath: ctx.zipPath, version: '1.1.0' });
  assert.equal(ctx.leftovers().length, 1);
  await ctx.installer.cleanup();
  assert.deepEqual(ctx.leftovers(), []);
  assert.equal(ctx.versionOnDisk(), '1.1.0');
});
