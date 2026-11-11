const { app, autoUpdater: nativeUpdater, BrowserWindow, dialog, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { createLog, createRecordStore } = require('./log');
const { createEngine } = require('./engine');
const { createLifecycle } = require('./lifecycle');
const { createWindow } = require('./window');
const { createUpdater } = require('./updates/updater');
const { createMacInstaller } = require('./updates/mac-install');
const { paintScript, DOWNLOAD_URL, INSTALL_URL } = require('./updates/pill');

const mac = process.platform === 'darwin';
const ENGINE_FAILURE_CHECK_MS = 15000;

function boot() {
  const userData = app.getPath('userData');
  const log = createLog({ dir: path.join(userData, 'logs') });
  log.info(`Unframed ${app.getVersion()} starting from ${process.execPath}`);

  const engineDir =
    process.env.UNFRAMED_ENGINE_DIR ||
    (app.isPackaged
      ? path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'unframed')
      : path.join(__dirname, '..', 'node_modules', 'unframed'));
  const outputDir = path.join(app.getPath('pictures'), 'Unframed');

  const engine = createEngine({
    script: path.join(engineDir, 'server', 'index.js'),
    execPath: process.execPath,
    log,
    // Hosting contract (spec 01): installed engines read these exact variable names.
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      UNFRAMED_DATA_DIR: userData,
      UNFRAMED_CLIENT_DIST: path.join(engineDir, 'client', 'dist'),
      OUTPUT_DIR: outputDir,
      PORT: '0',
    },
  });

  let win = null;
  const destroyWindows = () => BrowserWindow.getAllWindows().forEach((w) => w.destroy());
  const lifecycle = createLifecycle({ app, nativeUpdater, engine, log, destroyWindows });
  lifecycle.register();

  const { autoUpdater } = require('electron-updater');
  const appBundle = path.resolve(process.execPath, '..', '..', '..');
  const macInstaller = mac && app.isPackaged ? createMacInstaller({ appPath: appBundle, log }) : null;

  async function installInPlace({ file, version }) {
    if (!file || !(await macInstaller.canInstall())) {
      log.warn(`cannot replace ${appBundle} in place, handing the install to Squirrel`);
      autoUpdater.quitAndInstall(true, true);
      return;
    }
    await macInstaller.install({ zipPath: file, version });
    app.relaunch();
    app.quit();
  }

  const updates = createUpdater({
    updater: autoUpdater,
    log,
    version: app.getVersion(),
    records: createRecordStore(path.join(userData, 'desktop-update-install.json')),
    prepareInstall: () => engine.stop(),
    recoverInstall: async () => {
      if (!win || win.isDestroyed()) return;
      const port = await startEngine();
      await win.loadURL(`http://127.0.0.1:${port}`);
    },
    applyUpdate: macInstaller ? installInPlace : undefined,
    onChange: (state) => paint(state),
  });

  function paint(state = updates.state()) {
    if (!win || win.isDestroyed()) return;
    win.webContents.executeJavaScript(paintScript(state)).catch(() => {});
  }

  function onAppUrl(url) {
    if (url === DOWNLOAD_URL) updates.download();
    if (url === INSTALL_URL) updates.install();
  }

  function revealFiles(files) {
    if (!Array.isArray(files) || !files.length) return;
    if (!files.every((f) => typeof f === 'string' && path.isAbsolute(f))) return;
    if (files.length > 1) return shell.openPath(path.dirname(files[0]));
    let isDir = false;
    try {
      isDir = fs.statSync(files[0]).isDirectory();
    } catch {
      return;
    }
    if (isDir) shell.openPath(files[0]);
    else shell.showItemInFolder(files[0]);
  }

  engine.onMessage((msg) => {
    if (msg?.type === 'reveal') revealFiles(msg.files);
  });

  engine.onUnexpectedExit((code, signal) => {
    if (lifecycle.quitting() || updates.state().status === 'installing') return;
    fatal(`The engine stopped unexpectedly (${signal || `code ${code}`}).`);
  });

  async function startEngine() {
    const { port } = await engine.start();
    return port;
  }

  function fatal(message) {
    log.error(message);
    dialog.showErrorBox('Unframed', message);
    app.exit(1);
  }

  async function engineFailed(message) {
    log.error(message);
    if (!app.isPackaged) return fatal(message);
    updates.check();
    await Promise.race([updates.firstCheck(), new Promise((r) => setTimeout(r, ENGINE_FAILURE_CHECK_MS))]);
    const state = updates.state();
    const version = state.downloadedVersion || (state.status === 'available' ? state.availableVersion : null);
    if (!version) return fatal(message);

    const { response } = await dialog.showMessageBox({
      type: 'error',
      title: 'Unframed',
      message: 'Unframed could not start.',
      detail: `${message}\n\nVersion ${version} is available and may fix this. Unframed will download it and restart.`,
      buttons: [`Install version ${version}`, 'Quit'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response !== 0) return app.exit(1);
    if (updates.state().status === 'available') await updates.download();
    if (updates.state().status !== 'downloaded' || !(await updates.install())) {
      return fatal(`${message}\n\nVersion ${version} could not be installed: ${updates.state().message || 'unknown error'}`);
    }
  }

  app.on('second-instance', () => {
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(async () => {
    if (app.isPackaged) updates.enable();
    if (macInstaller) macInstaller.cleanup();
    fs.mkdirSync(outputDir, { recursive: true });

    let port;
    try {
      port = await startEngine();
    } catch (err) {
      return engineFailed(`${err.message}\n\nEngine: ${engineDir}`);
    }

    win = createWindow({ url: `http://127.0.0.1:${port}`, onAppUrl, onLoad: () => paint(), log });
    win.on('closed', () => (win = null));
  });
}

if (app.requestSingleInstanceLock()) boot();
else app.quit();
