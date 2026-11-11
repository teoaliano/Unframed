function createLifecycle({ app, nativeUpdater, engine, log, destroyWindows }) {
  let phase = 'running';

  function onBeforeQuit(event) {
    if (phase === 'allowed') return;
    event.preventDefault();
    if (phase === 'stopping') return;
    phase = 'stopping';
    log.info('quit requested, stopping the engine first');
    engine.stop().finally(() => {
      phase = 'allowed';
      log.info('engine stopped, quitting');
      app.quit();
    });
  }

  function onBeforeQuitForUpdate() {
    phase = 'allowed';
    log.info('updater is quitting the app to install');
    try {
      destroyWindows();
    } catch (err) {
      log.error(`could not destroy windows before the updater quit: ${err.message}`);
    }
  }

  function register() {
    app.on('before-quit', onBeforeQuit);
    nativeUpdater.on('before-quit-for-update', onBeforeQuitForUpdate);
    app.on('window-all-closed', () => {
      if (phase === 'running') app.quit();
    });
    if (process.platform !== 'win32') {
      for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => app.quit());
    }
  }

  return { register, quitting: () => phase !== 'running' };
}

module.exports = { createLifecycle };
