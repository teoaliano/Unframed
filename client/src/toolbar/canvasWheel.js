import { useEffect } from 'react';

// A wheel over a floating card still pans and zooms the canvas.
//
// The toolbar and the anchored reply are ordinary DOM ABOVE React Flow, not inside its
// zoom pane, so the browser hands them the wheel and the canvas does not move at all --
// which reads as the canvas being frozen wherever the card happens to sit, for as long
// as something is selected. This forwards the event to `.react-flow__pane`, the element
// d3-zoom listens on, keeping the pointer position so a zoom still centres under the
// cursor.
//
// Its own file because both cards need it and neither can own it. A native listener
// rather than React's `onWheel`: React registers wheel passively at the root, so
// preventDefault there is ignored with a console warning.

// Something between the pointer and the card that can scroll itself keeps its wheel --
// the composer's field, once the instruction is longer than fits.
function scrollsItself(target, root) {
  for (let el = target; el && el !== root; el = el.parentElement) {
    if (el.scrollHeight > el.clientHeight && /auto|scroll/.test(getComputedStyle(el).overflowY)) return true;
  }
  return false;
}

export function useCanvasWheel(ref, canvasEl) {
  // No dependency list on purpose: these components render null while there is no
  // selection and the element behind `ref` is replaced when they come back, so the
  // listener has to be re-attached after every render, the way the placement
  // measurement in both files already re-runs.
  useEffect(() => {
    const el = ref.current;
    if (!el || !canvasEl) return undefined;
    const onWheel = (e) => {
      if (scrollsItself(e.target, el)) return;
      e.preventDefault();
      const copy = new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        // Required: d3-zoom reaches for `event.view.document`, and a synthetic wheel's
        // view is null unless it is named here -- which threw inside React Flow and lost
        // the zoom while leaving the pan working.
        view: window,
        deltaX: e.deltaX,
        deltaY: e.deltaY,
        deltaZ: e.deltaZ,
        deltaMode: e.deltaMode,
        clientX: e.clientX,
        clientY: e.clientY,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
      });
      // On a timeout, not inline: d3-zoom, which serves the pinch and ⌘-wheel ZOOM,
      // ignores a wheel dispatched from inside another wheel's own dispatch, so a
      // forwarded zoom did nothing while panning (React Flow's own scroll handler, which
      // does not care) worked. One turn later both arrive. Observed 2026-09-05.
      // The pane is looked up here rather than above because React Flow remounts on a
      // project switch (canvasGeneration in App.jsx).
      setTimeout(() => canvasEl.querySelector('.react-flow__pane')?.dispatchEvent(copy), 0);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });
}
