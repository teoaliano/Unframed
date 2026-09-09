// Frame-rate meter for the canvas. Loaded ONLY when the URL carries ?fps=1 (see
// main.jsx), via a dynamic import, so none of this reaches a normal bundle. From a
// console with no flag: `location.search = '?fps=1'`.
//
// Chrome's own Rendering → Frame Rendering Stats already draws an FPS number, so this
// exists for the two things that one cannot do. It reports **per gesture**, because an
// idle canvas sits at the display's refresh rate and that number answers nothing — the
// question is always "does DRAGGING drop frames", and the answer has to survive letting
// go of the mouse to be read. And it measures against the display this is actually on:
// the machine these numbers were first taken on runs at 120Hz, where the familiar
// 16.7ms budget is already two frames late, so a fixed threshold would have called a
// perfect drag perfect and a bad one perfect too.
//
// Read it in the overlay, or from automation via window.__fps.dump().

// A gesture is over once nothing has driven it for this long. Long enough that the
// pauses inside one drag do not split it into three, short enough to read the summary
// before you have moved on.
const SETTLE_MS = 350;
// A frame is "late" past this multiple of the display's own frame time. 1.5 rather than
// 2, because the eye catches a stutter well before a frame is fully doubled.
const LATE = 1.5;

const q = (list, p) => list[Math.min(list.length - 1, Math.floor(list.length * p))];

// The display's frame time, learned rather than assumed, from IDLE frames only: with
// nothing to do the browser delivers exactly one frame per refresh, so an idle median
// IS the refresh interval. Reading it off every frame instead — the low percentile of
// all gaps, idle and busy together — was the first attempt and it reported a 120Hz
// display as 133Hz, because a gap can come in under the refresh interval when a
// callback slips early, and there is no percentile low enough to be the refresh rate
// but high enough to exclude those. The median of a quiet stretch has neither problem.
const IDLE_SAMPLE = 240;
let idleGaps = [];
let native = 16.7;
// Until a quiet stretch has been seen, `native` is a guess and so is every "late"
// count derived from it. Said on the overlay rather than left to be trusted: on a
// 120Hz display the 16.7ms placeholder calls nothing late that is.
let learned = false;
function learn(gap) {
  if (gesture) return;
  idleGaps.push(gap);
  if (idleGaps.length < IDLE_SAMPLE) return;
  native = q([...idleGaps].sort((a, b) => a - b), 0.5);
  learned = true;
  idleGaps = [];
}

let gesture = null; // { kind, gaps, started }
let last = null; // the settled summary, kept on screen
const history = [];

function summarise(g) {
  const gaps = [...g.gaps].sort((a, b) => a - b);
  if (!gaps.length) return null;
  const late = gaps.filter((x) => x > native * LATE).length;
  return {
    kind: g.kind,
    frames: gaps.length,
    fps: Math.round(1000 / q(gaps, 0.5)),
    median: +q(gaps, 0.5).toFixed(1),
    p95: +q(gaps, 0.95).toFixed(1),
    worst: +gaps[gaps.length - 1].toFixed(1),
    late,
    // The number the eye actually reacted to. A gesture with a clean median and 20% late
    // frames feels worse than its median says, which is why both are shown.
    latePct: Math.round((late / gaps.length) * 100),
  };
}

function begin(kind) {
  if (gesture?.kind === kind) return;
  end();
  gesture = { kind, gaps: [], started: performance.now() };
}

function end() {
  if (!gesture) return;
  const s = summarise(gesture);
  if (s && s.frames > 4) {
    last = s;
    history.push({ ...s, at: new Date().toISOString() });
    if (history.length > 200) history.shift();
  }
  gesture = null;
}

// ---- what counts as which gesture ----
// Capture phase and passive, so this can never change what the canvas receives -- the
// whole point of trace.js is that a listener in between is invisible, and a meter that
// alters the thing it measures would be worse than no meter.
let settle = null;
const poke = (kind) => {
  begin(kind);
  clearTimeout(settle);
  settle = setTimeout(end, SETTLE_MS);
};

addEventListener(
  'pointerdown',
  (e) => {
    if (!e.target?.closest?.('.react-flow')) return;
    // A press on a node is a drag; on the pane it is a box-select or a hand pan. Named
    // apart because they cost wildly different things and conflating them was how the
    // canvas got called "slow" when only one of the two was.
    poke(e.target.closest('.react-flow__node') ? 'drag' : 'pane');
  },
  { capture: true, passive: true },
);
// Only ever EXTENDS a gesture a pointerdown already opened -- a held button whose press
// landed outside the canvas is not a canvas gesture, and starting one here would file
// every drag of a dialog as a canvas drag.
addEventListener(
  'pointermove',
  (e) => {
    if (e.buttons && gesture) poke(gesture.kind);
  },
  { capture: true, passive: true },
);
addEventListener(
  'pointerup',
  () => {
    clearTimeout(settle);
    settle = setTimeout(end, SETTLE_MS);
  },
  { capture: true, passive: true },
);
addEventListener(
  'wheel',
  (e) => {
    if (!e.target?.closest?.('.react-flow')) return;
    // Cmd/Ctrl+wheel zooms, a bare wheel pans -- the canvas's own mapping (App.jsx).
    poke(e.metaKey || e.ctrlKey ? 'zoom' : 'pan');
  },
  { capture: true, passive: true },
);

// ---- the overlay ----
// Plain DOM outside the React root. A React component here would re-render inside the
// commit it is trying to time, and would be one more subscriber to the store whose
// subscribers are the thing under investigation.
const el = document.createElement('div');
el.style.cssText = [
  'position:fixed',
  'left:8px',
  // Under the left toolbar card, not in a corner: the tools rail and the FABs own
  // bottom-right, and bottom-left is the toast viewport (main.jsx), so a failed save
  // would land on top of the numbers exactly when you are watching them.
  'top:58px',
  'z-index:2147483647',
  'pointer-events:none',
  'font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace',
  'white-space:pre',
  'padding:6px 8px',
  'border-radius:6px',
  'color:#fff',
  'background:rgba(0,0,0,.72)',
  // No backdrop-filter: this sits over the canvas being measured.
].join(';');
document.body.appendChild(el);

const row = (s) =>
  s
    ? `${s.kind.padEnd(5)} ${String(s.fps).padStart(3)}fps  med ${String(s.median).padStart(5)}ms  ` +
      `p95 ${String(s.p95).padStart(5)}ms  worst ${String(s.worst).padStart(6)}ms  late ${s.late}/${s.frames} (${s.latePct}%)`
    : '';

let painted = 0;
let prev = null;
function tick(now) {
  if (prev !== null) {
    const gap = now - prev;
    learn(gap);
    if (gesture) gesture.gaps.push(gap);
  }
  prev = now;
  // Four times a second: the overlay's own text updates are layout, and a meter that
  // reflows every frame is measuring itself.
  if (now - painted > 250) {
    painted = now;
    const live = gesture && summarise(gesture);
    el.textContent = [
      learned
        ? `display ${(1000 / native).toFixed(0)}Hz (${native.toFixed(1)}ms)  late > ${(native * LATE).toFixed(1)}ms`
        : `display …measuring (assuming ${native.toFixed(1)}ms — leave the canvas alone for a moment)`,
      live ? row(live) : 'idle',
      last && (!live || last.kind !== live.kind) ? `last: ${row(last)}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    el.style.color = (live || last)?.latePct > 10 ? '#ff9d9d' : '#fff';
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

window.__fps = {
  // The settled gestures, newest last. `reset` before a run you want to report on.
  dump: () => history.slice(),
  reset: () => {
    history.length = 0;
    last = null;
  },
  hide: () => el.remove(),
};

// eslint-disable-next-line no-console
console.log('fps meter armed — window.__fps.dump() for the settled gestures');
