const { BrowserWindow, nativeTheme, shell } = require('electron');

const mac = process.platform === 'darwin';

const palette = () =>
  nativeTheme.shouldUseDarkColors
    ? { background: '#1a1a1a', symbol: '#a3a3a3' }
    : { background: '#f7f7f7', symbol: '#525252' };

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

const windowChrome = () => {
  const theme = palette();
  return mac
    ? { titleBarStyle: 'hidden', trafficLightPosition: { x: 12, y: 11 } }
    : {
        titleBarStyle: 'hidden',
        titleBarOverlay: { color: theme.background, symbolColor: theme.symbol, height: 40 },
      };
};

const PLATFORM_CSS = mac
  ? ''
  : `.unframed-chrome-right { top: 40px !important; }
     body::before {
       content: ''; display: block; position: fixed; top: 0; left: 0; right: 0;
       height: 40px; z-index: 5; -webkit-app-region: drag;
     }`;

const CHROME_CSS = `${PLATFORM_CSS}
  .unframed-chrome-left { -webkit-app-region: drag; }
  .unframed-chrome-left > *:not(svg, [role="img"]) { -webkit-app-region: no-drag; }`;

function createWindow({ url, onAppUrl, onLoad, log }) {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'Unframed',
    backgroundColor: palette().background,
    show: false,
    ...windowChrome(),
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });

  async function matchCanvas() {
    if (win.isDestroyed()) return;
    let canvas;
    try {
      canvas = await win.webContents.executeJavaScript(CANVAS_COLOURS);
    } catch {
      return;
    }
    if (win.isDestroyed()) return;
    const fallback = palette();
    const background = canvas.background || fallback.background;
    const symbol = canvas.symbol || fallback.symbol;
    win.setBackgroundColor(background);
    if (!mac) win.setTitleBarOverlay({ color: background, symbolColor: symbol });
  }

  const onTheme = () => matchCanvas();
  nativeTheme.on('updated', onTheme);
  win.on('closed', () => nativeTheme.off('updated', onTheme));
  win.once('ready-to-show', () => win.show());
  win.on('page-title-updated', (e) => e.preventDefault());

  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (target.startsWith('unframed-update://')) onAppUrl(target);
    else shell.openExternal(target);
    return { action: 'deny' };
  });
  win.webContents.on('dom-ready', () => win.webContents.insertCSS(CHROME_CSS));
  win.webContents.on('did-finish-load', () => {
    matchCanvas();
    onLoad();
  });

  win.loadURL(url).catch((err) => log.error(`could not load ${url}: ${err.message}`));
  return win;
}

module.exports = { createWindow };
