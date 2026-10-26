// The shell. Starts the engine, waits for it to say which port it got, and points
// a window at it. Everything the window needs is served by the engine over HTTP,
// so there is no preload and no IPC bridge -- the canvas is the same code the free
// clone runs, unmodified.
const { app, BrowserWindow, Notification, shell, dialog, nativeTheme } = require('electron');
const { autoUpdater } = require('electron-updater');
const { fork } = require('node:child_process');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

// One instance only. Not for the port -- PORT=0 already removed that fight -- but
// because PUT /api/presets replaces the whole array, so two windows each holding a
// stale copy in React state would erase each other's saved presets.
if (!app.requestSingleInstanceLock()) app.quit();

// The engine is an npm dependency pinned to a git tag, not a sibling clone, so a
// build cannot pick up whatever happened to be on the build machine. Packaged, it
// is unpacked beside the asar because a child process cannot be forked from inside
// an archive. UNFRAMED_ENGINE_DIR overrides both, for pointing at a local clone
// while working on the engine itself.
const ENGINE_DIR =
  process.env.UNFRAMED_ENGINE_DIR ||
  (app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'unframed')
    : path.join(__dirname, '..', 'node_modules', 'unframed'));
const ENGINE = path.join(ENGINE_DIR, 'server', 'index.js');
// The built canvas, which the engine serves from the same origin as its API. The
// published bundle ships it prebuilt, so the shell no longer builds anything.
const CLIENT_DIST = path.join(ENGINE_DIR, 'client', 'dist');

let engine = null;
let win = null;
// The engine's second listener, where rendered previews are served. Nothing in the
// shell loads it yet; it is kept so the log says where it is.
let previewPort = null;

// Config goes where the OS says application data belongs; generated files go
// somewhere a person would look for pictures. Neither may be inside the app bundle,
// which is read-only once signed.
const dataDir = () => app.getPath('userData');
const outputDir = () => path.join(app.getPath('pictures'), 'Unframed');

// Resolves with the port the engine bound, or rejects if it dies or never answers.
function startEngine() {
  return new Promise((resolve, reject) => {
    engine = fork(ENGINE, [], {
      // ELECTRON_RUN_AS_NODE makes the bundled Electron binary behave as plain
      // node, which is what gives fork() the ordinary IPC channel process.send
      // needs. Electron's own utilityProcess does NOT: it hands the child a
      // parentPort instead, so the engine's process.send is silently dropped.
      // Measured, not assumed -- see spike/run-engine.js.
      //
      // The engine reads the hosting variables (UNFRAMED_DATA_DIR,
      // UNFRAMED_CLIENT_DIST, PORT=0) from its process environment only, and they
      // must never be written to .env: a .env value overrides the environment, so
      // a line there would shadow what this sets. OUTPUT_DIR is a settings
      // variable instead, so a folder saved in the app's settings wins over this
      // default on purpose.
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        UNFRAMED_DATA_DIR: dataDir(),
        UNFRAMED_CLIENT_DIST: CLIENT_DIST,
        OUTPUT_DIR: outputDir(),
        PORT: '0',
      },
      execPath: process.execPath,
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });

    const timer = setTimeout(
      () => reject(new Error('The engine did not start within 30 seconds.')),
      30000,
    );

    engine.on('message', (msg) => {
      if (msg?.type === 'ready') {
        clearTimeout(timer);
        previewPort = msg.previewPort ?? null;
        console.log(`engine ready on ${msg.port}, previews on ${previewPort}`);
        resolve(msg.port);
      }
      if (msg?.type === 'reveal') revealFiles(msg.files);
    });

    engine.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    // Only a failure once the window is up; before that, startEngine's caller
    // reports it.
    engine.on('exit', (code) => {
      clearTimeout(timer);
      engine = null;
      if (win) fatal(`The engine stopped unexpectedly (code ${code}).`);
      else reject(new Error(`The engine exited immediately (code ${code}).`));
    });
  });
}

// The engine sends absolute paths: the files that exist, or the folder alone when
// none of them did. showItemInFolder on a folder would highlight it inside its
// parent rather than open it, so a directory is opened instead. showItemInFolder
// highlights a single item, so several files degrade to opening their folder --
// the same shape the engine's own Windows and Linux branches settled on.
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

function fatal(message) {
  dialog.showErrorBox('Unframed', message);
  app.exit(1);
}

// What the update check has learned so far, read only by the engine-failure path
// below. `version` is set as soon as a newer Release is seen, long before its
// bytes have arrived; `downloaded` is the one that means we can install.
const update = { version: null, downloaded: false };
// The in-flight check itself, so the engine-failure path can wait for the answer
// rather than read a field that is still null. Never rejects.
let updateCheck = null;

// The window is an ordinary web page with no preload and no IPC bridge, so this
// process cannot tell the renderer anything -- that seam is deliberate, it is what
// keeps Electron out of the public engine. The title bar is the one piece of UI
// this process owns outright, which makes it the only place an update can show
// itself without either coupling the canvas to Electron or teaching the public
// engine what an app update is.
let updateLabel = '';
function paintTitle(label) {
  if (label !== undefined) updateLabel = label;
  if (win) win.setTitle(updateLabel ? `Unframed \u2014 ${updateLabel}` : 'Unframed');
}

// Staged and waiting, which is the awkward part: autoInstallOnAppQuit needs a quit
// the user has no reason to make, and the first real update took two restarts
// because the first quit landed mid-download with nothing on screen to say so.
//
// A notification, deliberately not a dialog. The update is ready, not urgent, and a
// generation may be running -- a modal appearing over one invites a restart that
// kills it and the money it cost. This does not steal focus, is silent, and costs
// nothing to ignore: the update still installs on the next ordinary quit. Clicking
// it is simply the shortcut. If notifications are switched off the title label
// still says the same thing, so nothing is lost, only the one-click path.
// The one place a restart is triggered from, so the notification and the pill
// cannot drift apart.
//
// quitAndInstall goes out through app.quit(), which means before-quit runs and now
// WAITS for the engine to die before letting the quit finish. That wait is the
// whole fix: the engine is another instance of this bundle, and Squirrel refuses
// to swap a bundle that still has one.
function installUpdate() {
  if (!update.downloaded) return; // nothing staged; the pill only offers this when there is
  console.log('installing update, quitting');
  autoUpdater.quitAndInstall();
}

function offerRestart(version) {
  if (!Notification.isSupported()) return;
  const note = new Notification({
    title: `Unframed ${version} is ready`,
    body: 'Click to restart and install it now, or it installs next time you quit.',
    silent: true,
  });
  // quitAndInstall goes out through app.quit(), so before-quit still kills the
  // engine -- no orphan holding a port while the installer swaps the bundle.
  note.on('click', () => installUpdate());
  note.show();
}

// The update, shown where the person is actually looking.
//
// The title bar was the only surface this process owned, and it is a poor one: a
// label nobody reads, on a window whose own <title> has to be suppressed to keep
// it. It also cannot be clicked, so the ONLY way to act on a ready update was a
// notification -- which is transient, silenced system-wide by plenty of people,
// and gone forever once dismissed.
//
// This injects a small pill into the page instead. Injection, not a preload: the
// window has no bridge and must not grow one (that seam is what keeps Electron
// out of the public engine), but this process already reaches into the page twice
// -- insertCSS for the window chrome, executeJavaScript to read canvas colours.
// A pill is the same move, and the public canvas stays a plain web page that
// knows nothing about updates.
//
// Two deliberate choices:
//
//   Appended to <body> with inline styles, NOT hung off .unframed-chrome-left or
//   styled through a sheet. The chrome CSS is already a selector contract with
//   the engine's HTML that breaks silently on a rename; this adds nothing to that
//   surface. Inline styles also sidestep the insertCSS cascade trap -- an
//   injected rule loses a specificity tie against a page rule and looks like it
//   never ran.
//
//   The click goes out through window.open on a scheme setWindowOpenHandler
//   already sees. No preload, no ipcRenderer, no contextBridge: a URL the handler
//   below recognises and turns into quitAndInstall.
const UPDATE_URL = 'unframed-update://install';

const UPDATE_PILL_JS = `(() => {
  const ID = 'unframed-update-pill';
  let el = document.getElementById(ID);
  if (!el) {
    if (!document.body) return false;
    el = document.createElement('div');
    el.id = ID;
    el.style.cssText = [
      'position:fixed', 'left:16px', 'bottom:16px', 'z-index:2147483647',
      'display:none', 'align-items:center', 'gap:10px',
      'padding:8px 12px', 'border-radius:10px',
      'background:rgba(20,20,22,.92)', 'color:#f2f2f3',
      'border:1px solid rgba(255,255,255,.14)',
      'box-shadow:0 6px 24px rgba(0,0,0,.28)',
      'font:500 12px/1.35 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif',
      'user-select:none', '-webkit-app-region:no-drag',
    ].join(';');
    el.innerHTML =
      '<span data-x="text"></span>' +
      '<span data-x="track" style="display:none;width:96px;height:4px;border-radius:2px;background:rgba(255,255,255,.18);overflow:hidden">' +
        '<span data-x="bar" style="display:block;height:100%;width:0%;background:#f2f2f3;transition:width .2s ease"></span>' +
      '</span>' +
      '<button data-x="go" style="display:none;font:inherit;color:#111;background:#f2f2f3;border:0;border-radius:6px;padding:4px 10px;cursor:pointer">Restart</button>' +
      '<button data-x="close" title="Hide" style="font:inherit;color:inherit;background:none;border:0;opacity:.5;cursor:pointer;padding:0 2px">×</button>';
    document.body.appendChild(el);
    el.querySelector('[data-x="go"]').addEventListener('click', () => {
      // Feedback first: Squirrel can take a few seconds to swap the bundle, and a
      // button that does nothing visible is what this whole change is fixing.
      el.querySelector('[data-x="text"]').textContent = 'Restarting…';
      el.querySelector('[data-x="go"]').disabled = true;
      window.open('UPDATE_URL_TOKEN');
    });
    el.querySelector('[data-x="close"]').addEventListener('click', () => {
      el.dataset.hidden = '1';
      el.style.display = 'none';
    });
  }
  window.__unframedUpdate = (s) => {
    const q = (n) => el.querySelector('[data-x="' + n + '"]');
    if (!s || s.stage === 'idle') { el.style.display = 'none'; return; }
    // A new stage is worth showing again even if the pill was dismissed earlier:
    // dismissing "downloading" should not swallow "ready to restart".
    if (el.dataset.stage !== s.stage) delete el.dataset.hidden;
    el.dataset.stage = s.stage;
    const ready = s.stage === 'ready';
    q('text').textContent = ready
      ? 'Unframed ' + s.version + ' ready'
      : 'Downloading Unframed ' + (s.version || '') + (s.percent != null ? ' — ' + s.percent + '%' : '…');
    q('track').style.display = ready ? 'none' : 'inline-block';
    if (!ready && s.percent != null) q('bar').style.width = s.percent + '%';
    q('go').style.display = ready ? 'inline-block' : 'none';
    el.style.display = el.dataset.hidden ? 'none' : 'flex';
  };
  return true;
})()`.replace('UPDATE_URL_TOKEN', UPDATE_URL);

// What the pill is currently showing, kept here because the page can go away and
// come back -- a reload, or the SPA remounting -- and the update state has to
// survive that. Re-injected and re-applied on every load.
let updateUi = { stage: 'idle' };

async function paintUpdate(state) {
  if (state) updateUi = state;
  if (!win) return;
  try {
    await win.webContents.executeJavaScript(
      `${UPDATE_PILL_JS};window.__unframedUpdate(${JSON.stringify(updateUi)});`,
    );
  } catch {
    // The page went away mid-write, or has not painted yet. The title label still
    // carries the same information, so nothing is lost worth reporting.
  }
}

// How often to look again after the launch check. Six hours is far more often
// than releases happen and still catches one the same day it ships.
const RECHECK_EVERY = 6 * 60 * 60 * 1000;

// Updates are checked on launch and every RECHECK_EVERY after, downloaded in the
// background, and installed when the app next quits -- never mid-session, since a
// generation may be running and the engine writing to disk.
//
// Silent by design: an update that fails is not the user's problem to solve, and a
// dialog about it would interrupt work to deliver nothing actionable. Failures are
// logged and the app carries on with the version it has.
//
// Only in a packaged build. Running from source there is no Release to compare
// against, and electron-updater throws rather than shrugging.
function checkForUpdates() {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => paintTitle('checking for updates\u2026'));
  autoUpdater.on('update-not-available', () => {
    paintTitle('');
    paintUpdate({ stage: 'idle' });
  });
  autoUpdater.on('error', (err) => {
    // Still silent as a matter of policy -- the label just stops claiming work is
    // happening, rather than announcing a failure nobody can act on.
    paintTitle('');
    paintUpdate({ stage: 'idle' });
    console.log('update check failed:', err.message);
  });
  autoUpdater.on('update-available', (info) => {
    update.version = info.version;
    paintTitle(`downloading update ${info.version}\u2026`);
    paintUpdate({ stage: 'downloading', version: info.version, percent: 0 });
  });
  autoUpdater.on('download-progress', (p) => {
    paintTitle(`downloading update ${update.version || ''} \u2014 ${Math.round(p.percent)}%`);
    paintUpdate({ stage: 'downloading', version: update.version, percent: Math.round(p.percent) });
  });
  autoUpdater.on('update-downloaded', (info) => {
    update.downloaded = true;
    paintTitle(`update ${info.version} ready \u2014 restart to install`);
    console.log(`update ${info.version} downloaded, installing on quit`);
    paintUpdate({ stage: 'ready', version: info.version });
    offerRestart(info.version);
  });

  const poll = () => {
    updateCheck = autoUpdater
      .checkForUpdates()
      .catch((err) => console.log('update check failed:', err.message));
  };
  poll();

  // Again every few hours, not only at launch. This app gets left open for days,
  // and a launch-only check meant a published fix could sit unnoticed the whole
  // time -- neither the title label nor the restart offer can help, because the
  // check that triggers them never ran again. Cheap: one small HTTPS request.
  //
  // The listeners above are wired once and only the check repeats; re-entering
  // this function would stack a second copy of every handler and fire the restart
  // notification once per copy. Stops once something is downloaded, since there is
  // nothing further to learn until it is installed. unref'd so a pending timer
  // cannot keep the process alive at quit.
  const timer = setInterval(() => {
    if (!update.downloaded) poll();
  }, RECHECK_EVERY);
  timer.unref?.();
}

// The engine failing to start is the one failure the app cannot recover from on
// its own, and it used to be the one where the update mechanism was guaranteed
// unreachable: `checkForUpdates()` ran after the window loaded, which this path
// never gets to. 0.0.2 shipped an engine that could not start, so every install
// of it was stranded permanently and had to be replaced by hand.
//
// Two changes fix that. The check now runs before anything that can fail, and a
// failure that has a newer version to point at says so and offers a way to it.
//
// It does NOT wait for the download. Measured against the real 0.0.3 Release, a
// ~97MB update does not finish inside the time anyone spends reading a dialog,
// so blocking on it would mean staring at nothing to usually still end up here.
// If the bytes did happen to land -- the dialog was left open, a previous launch
// cached them -- installing is strictly better, so that branch is taken when it
// is true rather than waited for. Otherwise the Releases page is one click away,
// which is the difference between a dead end and a download.
async function fatalEngine(message) {
  // The engine dies in milliseconds, while the check is a network round trip
  // still in flight, so reading `update.version` here without waiting finds it
  // null every time and lands back on the old dead end. This path is already
  // fatal, so a bounded pause costs nothing that is not already lost; the ceiling
  // exists only so an unreachable update server cannot hold the error hostage.
  await Promise.race([
    updateCheck ?? Promise.resolve(),
    new Promise((r) => setTimeout(r, 10000)),
  ]);

  if (!update.version) return fatal(message);

  console.log(`engine failed with update ${update.version} available`);
  const { response } = await dialog.showMessageBox({
    type: 'error',
    title: 'Unframed',
    message: 'Unframed could not start.',
    detail: `${message}\n\nVersion ${update.version} is available and may fix this. Getting it is the best thing to try.`,
    buttons: ['Get version ' + update.version, 'Quit'],
    defaultId: 0,
    cancelId: 1,
  });

  if (response === 0) {
    if (update.downloaded) return autoUpdater.quitAndInstall();
    await shell.openExternal('https://github.com/teoaliano/Unframed/releases/latest');
  }
  app.exit(1);
}

// ---- window chrome ---------------------------------------------------------
// The default OS title bar is a grey strip carrying our own name, sitting above a
// canvas that already has its own floating toolbar cards: two headers, one of
// them empty. Hiding it gives the whole window to the canvas. What that costs is
// the two jobs the strip was doing for free, and each platform drops a different
// one:
//
//   - macOS keeps both the traffic lights and an invisible drag strip across the
//     top, so neither has to be rebuilt. The lights land on the canvas's
//     left-hand toolbar card. Rather than move the card out from under them, the
//     card seats them: they take the first slot in its existing row, ahead of the
//     logo, and the card grows a left inset deep enough to hold them.
//   - Windows paints its buttons into an overlay pinned to the *right* corner --
//     landing on the other card, which drops below them rather than beside them --
//     and drags nothing at all. A frameless window there cannot be moved until
//     some element declares `-webkit-app-region: drag`.
//
// Both repairs are injected from here rather than committed to the canvas. The
// canvas belongs to the public engine and has to keep looking right in a browser
// tab with this repo deleted, so a `padding-left: 70px` that means nothing except
// underneath macOS traffic lights is a shell concern and lives in the shell.
const mac = process.platform === 'darwin';

// The canvas picks its own colours with CSS light-dark(), so it follows the
// system without being told. Anything the shell paints -- the window's own
// background, the strip behind the Windows caption buttons -- is outside the
// page and does not.
//
// These two are the fallback, and only ever show for the moment before the page
// exists: the real values are read off the canvas by askCanvasColours() below.
// Copies go stale -- these were the engine's body colour until it changed the
// palette underneath them -- so nothing downstream of the first paint uses them.
const palette = () =>
  (nativeTheme.shouldUseDarkColors
    ? { background: '#1a1a1a', symbol: '#a3a3a3' }
    : { background: '#f7f7f7', symbol: '#525252' });

// Ask the page what it is painting rather than keeping a copy of it. Three things
// this has to work around, each of which returns something useless otherwise:
//
//   - Custom properties do not resolve. Reading `--unframed-text-secondary` can
//     hand back a literal like `light-dark(#525252, #a3a3a3)`, because the
//     substitution happens where a real property uses it. So a throwaway span
//     uses it, and its computed `color` is read instead. It is appended and
//     removed inside one synchronous block, so React never sees it. The engine
//     sets the variable on <html>, which is also where `data-unframed-theme`
//     lives, so there is no theme scope left to look for.
//   - The theme's overrides are applied by a React component at runtime, not by
//     a stylesheet, so this is called at `did-finish-load` -- by `dom-ready` the
//     tokens are still the base theme's.
//   - On a theme flip the renderer recalculates on its own schedule, and
//     nativeTheme's event does not wait for it. Two frames does.
//
// Returned as hex because it is fed straight to setTitleBarOverlay, and rgb()
// strings are not worth finding out about on a platform this cannot test.
const CANVAS_COLOURS = `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => {
  const hex = (c) => {
    const n = (c.match(/\\d+/g) || []).slice(0, 3);
    return n.length === 3 ? '#' + n.map((v) => (+v).toString(16).padStart(2, '0')).join('') : '';
  };
  const probe = document.createElement('span');
  probe.style.color = 'var(--unframed-text-secondary)';
  document.documentElement.appendChild(probe);
  const symbol = hex(getComputedStyle(probe).color);
  probe.remove();
  resolve({ background: hex(getComputedStyle(document.body).backgroundColor), symbol });
})))`;

// A function, not a const: nativeTheme is only meaningful once the app is ready,
// and this module is required well before that.
const windowChrome = () => {
  const theme = palette();
  return mac
    ? { titleBarStyle: 'hidden', trafficLightPosition: { x: 20, y: 17 } }
    : {
        titleBarStyle: 'hidden',
        // These three properties are the whole of it -- Chromium hard-codes the
        // buttons at 45+1 DIP wide and paints their glyphs at 10 DIP, and
        // neither is reachable from here (docs/research-windows-titlebar.md).
        // So the only lever on how loud they look is what sits behind them, and
        // it has to be whatever the canvas is painting right now. `height` moves
        // the hit area, never the glyph.
        //
        // 40 is the one number on this branch that is assumed rather than
        // measured. Chromium silently discards a height at or below
        // SM_CYCAPTION and uses the system caption instead, and SM_CYCAPTION is
        // not readable from here -- so on a system where it exceeds 40, the band
        // grows and the card below it (top: 40) stops clearing the buttons.
        // Typical values are well under 40; this is where to look if they ever
        // are not.
        titleBarOverlay: { color: theme.background, symbolColor: theme.symbol, height: 40 },
      };
};

// Every number here is derived from the top bar, which sits flush with the window's top edge and is 48 tall, so its row
// centres on y 24.
//
// The lights measure ~13 across, 23 centre to centre, ~60 for the group, and
// trafficLightPosition.y lands about 6.75 above their centre -- measured from a
// 2x screenshot, not taken from Apple's docs. So y 17 centres them on y 24, and
// x 20 sets them 12 inside the card's left edge.
//
// `!important` is load-bearing, not defensive. insertCSS lands its sheet with
// *lower* cascade priority than the page's own, so an override that merely ties
// on specificity with the page's rule silently loses and the window looks
// exactly as if nothing had been injected at all.
const PLATFORM_CSS = mac
  ? ''
  // The right card moves DOWN rather than sideways. Windows pins its caption
  // buttons to the corner -- unlike macOS, where trafficLightPosition put the
  // lights wherever the card wanted them -- so the only question is which
  // direction the card yields in, and down is the one that costs it nothing: it
  // keeps its radius and its corner. Sideways cost it the corner and left the
  // buttons' width of dead canvas outboard of it.
  //
  // 40 is the band the buttons fill, so the card starts directly under them. It
  // needs no measurement of the buttons themselves: only their height is ours to
  // set, and we set it.
  //
  // The strip itself sits at z-index 5, under the chrome cards at 400, so their
  // buttons still take their own clicks. Everything else in that band is empty
  // canvas -- which is exactly what a title bar is. It hangs off <body> because
  // the engine's hook contract names no app root element, and the web never
  // reorders <body>'s children.
  : `.unframed-chrome-right { top: 40px !important; }
     body::before {
       content: ''; display: block; position: fixed; top: 0; left: 0; right: 0;
       height: 40px; z-index: 5; -webkit-app-region: drag;
     }`;

// A title bar is not only a strip: it is a strip you can grab and double-click to
// zoom, and the OS gives that to whatever declares itself draggable. The bare
// canvas beside the card already had it; the card did not, because page content
// is no-drag by default -- so the one piece of chrome that most looks like a
// title bar was the one dead spot in it. `drag` makes the card's own surface
// behave like the strip it sits in. The exception is everything interactive:
// a draggable region swallows clicks, so the project menu would stop opening.
// `:not(svg, [role="img"])` is what spares the logo, which the new web renders as
// a <span role="img"> (the old one was a bare <svg>) and has nothing to click -- so
// it drags and zooms like the padding around it.
//
// Dragging is all of the card; double-click-to-zoom is only its top 20px, and no
// amount of CSS changes that. macOS dispatches zoom from the NSWindow titlebar
// rect -- about 28px tall, not resizable from Electron -- so of a card spanning
// y 8 to 52, only the part above 28 is somewhere the OS still looks. Reaching
// the rest means a preload catching the double-click and calling maximize() from
// main, which buys a gesture nobody performs on purpose at the cost of the
// no-preload decision at the top of this file. Deliberately not done.
const CHROME_CSS = `${PLATFORM_CSS}
  .unframed-chrome-left { -webkit-app-region: drag; }
  .unframed-chrome-left > *:not(svg, [role="img"]) { -webkit-app-region: no-drag; }`;

// Repaint the shell's own surfaces to whatever the canvas is currently painting.
// A failed read is not worth reporting: the window keeps the colours it has,
// which are a shade off at worst, and the usual cause is the page going away
// mid-read.
async function matchCanvas() {
  if (!win) return;
  let canvas;
  try {
    canvas = await win.webContents.executeJavaScript(CANVAS_COLOURS);
  } catch {
    return;
  }
  if (!win) return;
  const fallback = palette();
  const background = canvas.background || fallback.background;
  const symbol = canvas.symbol || fallback.symbol;
  win.setBackgroundColor(background);
  if (!mac) win.setTitleBarOverlay({ color: background, symbolColor: symbol });
}

async function main() {
  // Before anything that can fail, and deliberately not awaited: the check is
  // fire-and-forget, so starting it here costs the window nothing while making
  // it reachable on the one path that used to skip it entirely.
  checkForUpdates();

  await fsp.mkdir(outputDir(), { recursive: true });

  let port;
  try {
    port = await startEngine();
  } catch (err) {
    return fatalEngine(`${err.message}\n\nEngine: ${ENGINE}`);
  }

  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'Unframed',
    // What shows for the moment before the canvas paints. #111111 was neither
    // theme's background, so it flashed dark on a light system and slightly-wrong
    // dark on a dark one.
    backgroundColor: palette().background,
    show: false,
    ...windowChrome(),
    // No preload and no node integration: the window is an ordinary web page
    // talking to localhost, exactly as it is under Vite.
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });

  win.once('ready-to-show', () => win.show());
  // Electron mirrors the page's <title> onto the window by default, which would
  // wipe whatever the update check is reporting the moment the canvas loads.
  win.webContents.on('page-title-updated', (e) => {
    e.preventDefault();
    paintTitle();
  });
  win.on('closed', () => (win = null));

  // The canvas restyles itself when the system flips; nothing the shell painted
  // does, so both of its surfaces have to be repainted from what the canvas now
  // says. The background is not cosmetic-only -- it is what shows through on
  // resize and before the first paint of any reload, so a stale one is visible on
  // both platforms. The overlay is Windows-only, because setTitleBarOverlay
  // throws on a window that was not built with an overlay, which is every macOS
  // one. Wired once, alongside the window it belongs to, rather than anywhere
  // that can be re-entered.
  nativeTheme.on('updated', () => matchCanvas());

  // Links to anywhere else belong in the user's browser, not in a canvas window
  // with no address bar.
  win.webContents.setWindowOpenHandler(({ url }) => {
    // The pill's Restart button, arriving as a window.open the page is allowed to
    // make. This is the whole click channel -- no preload, no ipcRenderer, no
    // contextBridge, and nothing the canvas needs to know about. Checked before
    // openExternal, or the shell would hand this scheme to the OS.
    if (url === UPDATE_URL) {
      installUpdate();
      return { action: 'deny' };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // dom-ready, not did-finish-load: the window is shown on `ready-to-show`, which
  // lands first, so injecting at the end of the load let the unstyled arrangement
  // paint -- lights over the logo, right card under the caption buttons -- and
  // then jump. The canvas is a SPA, so the cards do not exist at dom-ready either
  // way; a stylesheet does not need them to, and applies the moment React mounts
  // them.
  win.webContents.on('dom-ready', () => win.webContents.insertCSS(CHROME_CSS));

  // Colours, unlike the layout above, wait for the end of the load: the theme's
  // overrides are applied by a React component rather than a stylesheet, so
  // earlier than this reads the base theme. Re-run on every load, not just the
  // first, so a reload after a palette change picks it up.
  win.webContents.on('did-finish-load', () => matchCanvas());

  // The pill lives in the page, so every load starts without it -- a reload, or a
  // navigation inside the SPA. Re-injected here rather than only when an event
  // fires, because the interesting case is exactly the one where the state was
  // set before this load: an update that went ready while the window was showing
  // something else must still offer its restart afterwards.
  win.webContents.on('did-finish-load', () => paintUpdate());

  await win.loadURL(`http://127.0.0.1:${port}`);

  // The check runs before the window exists, so anything it already reported has
  // no title to paint onto. Repaint once there is one.
  paintTitle();
}

app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

// The engine is a child process, so it would outlive a crash of this one. Kill it
// on the way out rather than leaving an orphan holding a port and a data dir.
// How long a quit will wait for the engine to actually die before going anyway.
// Squirrel refuses to swap a bundle that still has running instances, and the
// engine IS an instance -- it is this bundle's own Electron binary, forked with
// ELECTRON_RUN_AS_NODE, so `ps` shows two processes under Unframed.app. Killing
// without waiting is what made "restart to install" do nothing: quitAndInstall
// exits, Squirrel looks, the engine is still dying, and the install aborts with
// SQRLInstallerErrorDomain -9 "App Still Running Error" -- logged and swallowed,
// because updater failures are silent by policy. Three of those in a row then
// trip Squirrel's own attempt limit ("Too many attempts to install"), which is
// why an ordinary quit stopped working too, until the count reset.
//
// A ceiling, not a promise: a wedged engine must never trap the app in a quit it
// cannot finish. 2s is far more than the ~30ms the exit actually takes (measured
// at +140ms from before-quit, against a window that closes at +109ms).
const ENGINE_EXIT_CEILING = 2000;

app.on('before-quit', (e) => {
  if (engine) {
    const child = engine;
    engine = null;
    // Hold the quit open until the child is gone, then quit again -- the re-entry
    // finds `engine` null and falls straight through.
    e.preventDefault();
    // Detach before killing. This kill is deliberate, but the exit handler cannot
    // tell it from a crash: it guards on `win`, and the window is still alive for
    // about 100ms into a quit. Measured, not guessed -- before-quit at +9ms, the
    // window closing at +109ms, the engine's exit landing at +140ms. On a slower
    // renderer teardown, a canvas holding a generated image, the exit arrives
    // inside that gap and a clean shutdown announces itself to the user as
    // "The engine stopped unexpectedly (code 0)" over a window that never closes,
    // because showErrorBox blocks the quit it was triggered by.
    child.removeAllListeners('exit');
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      app.quit();
    };
    const timer = setTimeout(finish, ENGINE_EXIT_CEILING);
    child.once('exit', () => {
      clearTimeout(timer);
      finish();
    });
    child.kill();
  }
});

app.on('window-all-closed', () => app.quit());

app.whenReady().then(main);
