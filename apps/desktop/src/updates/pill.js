const DOWNLOAD_URL = 'unframed-update://download';
const INSTALL_URL = 'unframed-update://install';

function view(state) {
  const v = state.availableVersion;
  switch (state.status) {
    case 'available':
      return state.message
        ? { stage: 'download-failed', text: `Couldn't download Unframed ${v}`, action: 'Try again', url: DOWNLOAD_URL, percent: null }
        : { stage: 'available', text: `Unframed ${v} is available`, action: 'Download', url: DOWNLOAD_URL, percent: null };
    case 'downloading':
      return { stage: 'downloading', text: `Downloading Unframed ${v}`, action: null, url: null, percent: state.percent ?? 0 };
    case 'downloaded':
      return state.message
        ? { stage: 'install-failed', text: `Couldn't install Unframed ${state.downloadedVersion}`, action: 'Try again', url: INSTALL_URL, percent: null }
        : { stage: 'downloaded', text: `Unframed ${state.downloadedVersion} is ready`, action: 'Restart', url: INSTALL_URL, percent: null };
    case 'installing':
      return { stage: 'installing', text: 'Restarting to update…', action: null, url: null, percent: null };
    default:
      return state.notAppliedVersion
        ? { stage: 'not-applied', text: `The update to ${state.notAppliedVersion} did not install`, action: null, url: null, percent: null }
        : null;
  }
}

const PILL_SCRIPT = `(() => {
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
      '<button data-x="go" style="display:none;font:inherit;color:#111;background:#f2f2f3;border:0;border-radius:6px;padding:4px 10px;cursor:pointer"></button>' +
      '<button data-x="close" title="Hide" style="font:inherit;color:inherit;background:none;border:0;opacity:.5;cursor:pointer;padding:0 2px">×</button>';
    document.body.appendChild(el);
    el.querySelector('[data-x="go"]').addEventListener('click', (e) => {
      const url = e.currentTarget.dataset.url;
      if (!url) return;
      e.currentTarget.disabled = true;
      window.open(url);
    });
    el.querySelector('[data-x="close"]').addEventListener('click', () => {
      el.dataset.hidden = el.dataset.stage || '1';
      el.style.display = 'none';
    });
  }
  window.__unframedUpdate = (v) => {
    const q = (n) => el.querySelector('[data-x="' + n + '"]');
    if (!v) { el.style.display = 'none'; delete el.dataset.stage; return; }
    el.dataset.stage = v.stage;
    q('text').textContent = v.text + (v.percent != null ? ' — ' + v.percent + '%' : '');
    q('track').style.display = v.percent != null ? 'inline-block' : 'none';
    if (v.percent != null) q('bar').style.width = v.percent + '%';
    const go = q('go');
    go.style.display = v.action ? 'inline-block' : 'none';
    go.textContent = v.action || '';
    go.dataset.url = v.url || '';
    go.disabled = false;
    el.style.display = el.dataset.hidden === v.stage ? 'none' : 'flex';
  };
  return true;
})()`;

const paintScript = (state) => `${PILL_SCRIPT};window.__unframedUpdate(${JSON.stringify(view(state))});`;

module.exports = { view, paintScript, DOWNLOAD_URL, INSTALL_URL };
