// Dev-only guard for the one dangerous half of whole-node dragging.
//
// The whole card is the drag surface and controls opt OUT with `nodrag`
// (docs/superpowers/specs/2026-08-18-canvas-interaction-design.md). An exclusion list
// fails badly: forget the class on a control added later and it silently becomes a drag
// surface that eats the click, which is invisible in review and invisible in the UI --
// the button simply does nothing when your hand is not perfectly still. This says so out
// loud instead, in every dev session rather than only when someone remembers ?trace=1.
//
// Imported from main.jsx behind import.meta.env.DEV, so it is never in a real bundle.

const INTERACTIVE = 'button, input, select, textarea, video, [contenteditable="true"]';

// Astryx renders its own inner elements, so the class can sit on any ancestor up to the
// node -- that is exactly how React Flow's own hasSelector resolves it, and checking it
// the same way is the point: this must agree with the library, not with our intent.
function covered(el, node) {
  return el.closest('.nodrag') !== null && node.contains(el.closest('.nodrag'));
}

function scan() {
  const offenders = [];
  for (const node of document.querySelectorAll('.react-flow__node')) {
    for (const el of node.querySelectorAll(INTERACTIVE)) {
      if (!covered(el, node)) {
        offenders.push({
          node: node.dataset.id,
          type: node.className.match(/react-flow__node-(\w+)/)?.[1] ?? '?',
          control: el.tagName.toLowerCase(),
          label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40),
        });
      }
    }
  }
  if (offenders.length) {
    /* eslint-disable no-console */
    console.warn(
      `%c[nodrag] ${offenders.length} control(s) inside a node can be dragged, so a press that moves even slightly will drag the node instead of working the control. Add className="nodrag".`,
      'color:#ff922b;font-weight:bold',
    );
    console.table(offenders);
  }
}

// Debounced, and watching rather than scanning once: a node added mid-session is the
// case a single startup scan would miss, and that is the case where a new control most
// often arrives.
let queued;
const observer = new MutationObserver(() => {
  clearTimeout(queued);
  queued = setTimeout(scan, 500);
});
observer.observe(document.body, { childList: true, subtree: true });
setTimeout(scan, 1000);

window.__nodragCheck = scan;
