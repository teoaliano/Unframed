// Throwaway spike. Answers one question before any shell code is written: can the
// engine -- an ESM Express app that reports readiness with process.send -- be
// started by Electron's sanctioned utilityProcess, or does it need
// child_process.fork with ELECTRON_RUN_AS_NODE?
//
// Run: npm run spike
const { app, utilityProcess } = require('electron');
const { fork } = require('node:child_process');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const ENGINE = path.join(__dirname, '..', '..', 'Unframed', 'server', 'index.js');

async function tempEnv() {
  const dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'unframed-spike-'));
  const out = path.join(dataDir, 'out');
  await fsp.mkdir(out);
  return { UNFRAMED_DATA_DIR: dataDir, OUTPUT_DIR: out, PORT: '0' };
}

// Attempt A: the sanctioned API. Note utilityProcess gives the child
// process.parentPort, NOT process.send -- so watch both channels and stdout, to
// tell "ESM would not load" apart from "started but cannot talk back".
function tryUtilityProcess(env) {
  return new Promise(async (resolve) => {
    const child = utilityProcess.fork(ENGINE, [], {
      env: { ...process.env, ...(await tempEnv()) },
      stdio: 'pipe',
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => (stdout += d));
    child.stderr?.on('data', (d) => (stderr += d));
    let gotMessage = null;
    child.on('message', (m) => (gotMessage = m));
    child.on('exit', (code) => finish(`exited (code ${code})`));

    const timer = setTimeout(() => finish('timeout'), 8000);
    let done = false;
    function finish(why) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        child.kill();
      } catch {}
      resolve({
        why,
        booted: /Unframed server/.test(stdout),
        port: (stdout.match(/localhost:(\d+)/) || [])[1] || null,
        message: gotMessage,
        stderrHead: stderr.split('\n').slice(0, 4).join(' | '),
      });
    }
  });
}

// Attempt B: a real Node child. ELECTRON_RUN_AS_NODE makes the bundled Electron
// binary behave as plain node, so fork() provides the ordinary IPC channel that
// process.send needs.
function tryNodeFork(env) {
  return new Promise(async (resolve) => {
    const child = fork(ENGINE, [], {
      env: { ...process.env, ...(await tempEnv()), ELECTRON_RUN_AS_NODE: '1' },
      execPath: process.execPath,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    let gotMessage = null;
    child.on('message', (m) => (gotMessage = m));
    child.on('exit', (code) => finish(`exited (code ${code})`));

    const timer = setTimeout(() => finish('timeout'), 8000);
    let done = false;
    function finish(why) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        child.kill();
      } catch {}
      resolve({
        why,
        booted: /Unframed server/.test(stdout),
        port: (stdout.match(/localhost:(\d+)/) || [])[1] || null,
        message: gotMessage,
        stderrHead: stderr.split('\n').slice(0, 4).join(' | '),
      });
    }
  });
}

app.whenReady().then(async () => {
  console.log('engine:', ENGINE);
  const a = await tryUtilityProcess();
  console.log('\n--- A: utilityProcess ---');
  console.log(JSON.stringify(a, null, 2));

  const b = await tryNodeFork();
  console.log('\n--- B: child_process.fork + ELECTRON_RUN_AS_NODE ---');
  console.log(JSON.stringify(b, null, 2));

  app.exit(0);
});
