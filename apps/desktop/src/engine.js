const { fork } = require('node:child_process');

function createEngine({ script, execPath, env, log, startTimeoutMs = 30000 }) {
  let child = null;
  let stopping = null;
  const messageListeners = [];
  const crashListeners = [];

  const signalGroup = (pid, signal) => {
    try {
      process.kill(-pid, signal);
    } catch {
      try {
        process.kill(pid, signal);
      } catch {}
    }
  };

  const pipeLines = (stream, write) => {
    let buffered = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      buffered += chunk;
      const lines = buffered.split('\n');
      buffered = lines.pop();
      for (const line of lines) if (line.trim()) write(`engine: ${line}`);
    });
  };

  function start() {
    return new Promise((resolve, reject) => {
      const proc = fork(script, [], {
        env,
        execPath,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      });
      child = proc;
      pipeLines(proc.stdout, (line) => log.info(line));
      pipeLines(proc.stderr, (line) => log.warn(line));
      let ready = false;
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        log.error(`engine did not start within ${startTimeoutMs / 1000}s`);
        stop().then(() => reject(new Error(`The engine did not start within ${startTimeoutMs / 1000} seconds.`)));
      }, startTimeoutMs);

      proc.on('message', (msg) => {
        if (msg?.type === 'ready' && !ready) {
          ready = true;
          clearTimeout(timer);
          log.info(`engine ready on ${msg.port}, previews on ${msg.previewPort ?? 'none'}`);
          resolve({ port: msg.port, previewPort: msg.previewPort ?? null });
          return;
        }
        for (const fn of messageListeners) fn(msg);
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        log.error(`engine process error: ${err.message}`);
        if (!ready) reject(err);
      });

      proc.on('exit', (code, signal) => {
        clearTimeout(timer);
        if (child === proc) child = null;
        log.info(`engine exited (code ${code}, signal ${signal})`);
        if (!ready) {
          if (!timedOut) reject(new Error(`The engine exited before it was ready (code ${code}).`));
          return;
        }
        if (!stopping) for (const fn of crashListeners) fn(code, signal);
      });
    });
  }

  function stop({ graceMs = 3000, killMs = 2000 } = {}) {
    if (stopping) return stopping;
    const proc = child;
    if (!proc || proc.exitCode !== null || proc.signalCode !== null) return Promise.resolve();
    stopping = new Promise((resolve) => {
      const pid = proc.pid;
      let escalation;
      let giveUp;
      const done = () => {
        clearTimeout(escalation);
        clearTimeout(giveUp);
        signalGroup(pid, 'SIGKILL');
        resolve();
      };
      proc.once('exit', done);
      log.info('stopping engine');
      signalGroup(pid, 'SIGTERM');
      escalation = setTimeout(() => {
        log.warn(`engine ignored SIGTERM for ${graceMs}ms, killing it`);
        signalGroup(pid, 'SIGKILL');
        giveUp = setTimeout(() => {
          log.error('engine still alive after SIGKILL, carrying on');
          proc.removeListener('exit', done);
          resolve();
        }, killMs);
      }, graceMs);
    }).finally(() => {
      stopping = null;
    });
    return stopping;
  }

  return {
    start,
    stop,
    running: () => child !== null,
    pid: () => child?.pid ?? null,
    send: (msg) => child?.send(msg),
    onMessage: (fn) => messageListeners.push(fn),
    onUnexpectedExit: (fn) => crashListeners.push(fn),
  };
}

module.exports = { createEngine };
