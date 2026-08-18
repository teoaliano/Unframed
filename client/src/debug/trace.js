// Pointer/selection tracer. Loaded ONLY when the URL carries ?trace=1 (see
// main.jsx), via a dynamic import, so none of this reaches a normal bundle.
//
// It exists because reasoning about React Flow's selection was wrong twice. The
// library selects a node from three different places and any of them can be
// silently cancelled by a capture-phase listener on an ancestor -- and a
// cancelled event looks exactly like a handler that never ran. So this records
// what actually happened, in order, per gesture:
//
//   - every pointer/mouse/click event, at CAPTURE and at BUBBLE on window, so a
//     listener in between that stops propagation shows up as a capture line with
//     no matching bubble line. That gap IS the diagnosis.
//   - who called stopPropagation/preventDefault, with the call site.
//   - the modifier keys, and which node (if any) the event landed on.
//   - the set of selected node ids before the gesture and after it settles.
//
// Read it in the console, or from automation via window.__trace.dump().

const PHASES = ['capture', 'bubble'];
const WATCH = ['pointerdown', 'mousedown', 'mouseup', 'click', 'dragstart'];

let gesture = null;
const gestures = [];

const selected = () =>
  [...document.querySelectorAll('.react-flow__node.selected')].map((n) => n.dataset.id).sort();

const nodeIdAt = (target) => {
  const el = target?.closest?.('.react-flow__node');
  return el ? el.dataset.id : null;
};

// Where in OUR code (or React Flow's) the cancel came from. The first frame that
// is not this file is the interesting one.
function callSite() {
  const lines = (new Error().stack || '').split('\n').slice(1);
  const hit = lines.find((l) => !l.includes('/debug/trace.js'));
  return (hit || '?').trim().replace(/^at\s+/, '').slice(0, 120);
}

// Patched on the prototype rather than per-event: React re-dispatches through
// SyntheticEvent, and the native event is the one every listener shares.
for (const method of ['stopPropagation', 'stopImmediatePropagation', 'preventDefault']) {
  const original = Event.prototype[method];
  Event.prototype[method] = function patched(...args) {
    if (gesture && WATCH.includes(this.type)) {
      gesture.rows.push({ mark: `!! ${method}`, type: this.type, by: callSite() });
    }
    return original.apply(this, args);
  };
}

function record(event, phase) {
  if (!gesture || gesture.done) return;
  const mods = ['shift', 'meta', 'ctrl', 'alt'].filter((m) => event[`${m}Key`]).join('+') || '-';
  gesture.rows.push({
    mark: phase === 'capture' ? '>' : '  <',
    type: event.type,
    node: nodeIdAt(event.target),
    on: event.target?.className?.baseVal ?? String(event.target?.className || '').slice(0, 40),
    mods,
  });
}

function openGesture(event) {
  gesture = { at: gestures.length + 1, before: selected(), rows: [], done: false };
  gestures.push(gesture);
  record(event, 'capture');
}

// The gesture closes a tick after the click, so React has flushed and the
// selection classes on the DOM reflect the settled state.
function closeGesture() {
  const g = gesture;
  if (!g || g.done) return;
  g.done = true;
  setTimeout(() => {
    g.after = selected();
    g.verdict =
      String(g.before) === String(g.after)
        ? 'NO CHANGE'
        : `${g.before.join(',') || '(none)'} -> ${g.after.join(',') || '(none)'}`;
    print(g);
  }, 80);
}

function print(g) {
  /* eslint-disable no-console */
  console.groupCollapsed(
    `%c#${g.at} selection: ${g.verdict}`,
    `color:${g.verdict === 'NO CHANGE' ? '#ff6b6b' : '#51cf66'};font-weight:bold`,
  );
  console.table(g.rows);
  console.groupEnd();
}

for (const type of WATCH) {
  for (const phase of PHASES) {
    window.addEventListener(
      type,
      (event) => {
        if (type === 'pointerdown' && phase === 'capture') openGesture(event);
        else record(event, phase);
        if (type === 'click' && phase === 'bubble') closeGesture();
      },
      { capture: phase === 'capture' },
    );
  }
}

// A click that never arrives is the whole point, so a gesture also closes on
// pointerup -- otherwise a swallowed click would leave it open forever and the
// next gesture would silently inherit its rows.
window.addEventListener('pointerup', () => setTimeout(closeGesture, 0), { capture: false });

for (const type of ['keydown', 'keyup']) {
  window.addEventListener(
    type,
    (event) => {
      if (event.key !== 'Shift' && event.key !== 'Meta' && event.key !== 'Control') return;
      console.log(`%c${type} ${event.key}`, 'color:#868e96');
    },
    { capture: true },
  );
}

window.__trace = {
  dump: (n = 5) => gestures.slice(-n).map((g) => ({ ...g, rows: g.rows })),
  clear: () => gestures.splice(0),
  selected,
};

console.log(
  '%c[trace] armed. Every gesture prints a group; "!!" rows are cancellations.',
  'color:#4dabf7;font-weight:bold',
);
