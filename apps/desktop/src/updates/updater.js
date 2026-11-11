const { initialState, reduce, notAppliedVersion } = require('./machine');

function createUpdater({
  updater,
  log,
  version,
  records,
  prepareInstall,
  recoverInstall,
  applyUpdate,
  onChange = () => {},
  startupDelayMs = 10000,
  pollMs = 60 * 60 * 1000,
  installWatchdogMs = 3 * 60 * 1000,
}) {
  let state = initialState(version);
  let timers = [];
  let watchdog = null;
  let downloadedFile = null;
  let firstCheckDone;
  const firstCheck = new Promise((r) => (firstCheckDone = r));

  const dispatch = (event) => {
    const next = reduce(state, event);
    if (next === state) return;
    state = next;
    onChange(state);
  };

  const describe = (err) => (err && err.message ? err.message.split('\n')[0] : String(err));

  function readRecord() {
    let record = null;
    try {
      record = records.read();
    } catch (err) {
      log.warn(`could not read the install record: ${describe(err)}`);
    }
    const missed = notAppliedVersion(record, version);
    if (missed) log.warn(`the last install of ${missed} did not apply; still on ${version}`);
    else if (record) records.remove();
    return missed;
  }

  async function failInstall(message) {
    if (state.status !== 'installing') return;
    clearTimeout(watchdog);
    log.error(`install failed: ${message}`);
    try {
      records.remove();
    } catch {}
    dispatch({ type: 'install-failed', message });
    try {
      await recoverInstall();
    } catch (err) {
      log.error(`could not recover after a failed install: ${describe(err)}`);
    }
  }

  function wire() {
    updater.on('checking-for-update', () => dispatch({ type: 'check-started' }));
    updater.on('update-available', (info) => {
      log.info(`update ${info.version} available`);
      dispatch({ type: 'available', version: info.version });
    });
    updater.on('update-not-available', () => dispatch({ type: 'not-available' }));
    updater.on('download-progress', (p) => dispatch({ type: 'progress', percent: p.percent }));
    updater.on('update-downloaded', (info) => {
      log.info(`update ${info.version} downloaded`);
      downloadedFile = info.downloadedFile ?? null;
      dispatch({ type: 'downloaded', version: info.version });
    });
    updater.on('error', (err) => {
      const message = describe(err);
      if (state.status === 'installing') return void failInstall(message);
      log.warn(`updater error while ${state.status}: ${message}`);
      if (state.status === 'checking') dispatch({ type: 'check-failed', message });
      if (state.status === 'downloading') dispatch({ type: 'download-failed', message });
    });
  }

  async function check() {
    if (['disabled', 'checking', 'downloading', 'installing'].includes(state.status)) return false;
    try {
      await updater.checkForUpdates();
    } catch (err) {
      dispatch({ type: 'check-failed', message: describe(err) });
    } finally {
      if (state.status === 'checking') dispatch({ type: 'not-available' });
      firstCheckDone();
    }
    return true;
  }

  async function download() {
    if (state.status !== 'available') return false;
    dispatch({ type: 'download-started' });
    try {
      await updater.downloadUpdate();
    } catch (err) {
      dispatch({ type: 'download-failed', message: describe(err) });
    }
    return true;
  }

  async function install() {
    if (state.status !== 'downloaded' || !state.downloadedVersion) return false;
    const target = state.downloadedVersion;
    dispatch({ type: 'install-started' });
    log.info(`installing ${target}`);
    try {
      records.write({ fromVersion: version, targetVersion: target });
      await prepareInstall();
      watchdog = setTimeout(() => failInstall('The installer did not take over in time.'), installWatchdogMs);
      watchdog.unref?.();
      if (applyUpdate) await applyUpdate({ file: downloadedFile, version: target });
      else updater.quitAndInstall(true, true);
      return true;
    } catch (err) {
      await failInstall(describe(err));
      return false;
    }
  }

  function enable() {
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.logger = log;
    state = initialState(version, { notAppliedVersion: readRecord() });
    wire();
    dispatch({ type: 'enabled' });
    const first = setTimeout(() => check(), startupDelayMs);
    const poll = setInterval(() => check(), pollMs);
    poll.unref?.();
    first.unref?.();
    timers = [first, poll];
  }

  function stop() {
    for (const t of timers) clearTimeout(t);
    clearTimeout(watchdog);
    timers = [];
  }

  return { enable, stop, check, download, install, state: () => state, firstCheck: () => firstCheck };
}

module.exports = { createUpdater };
