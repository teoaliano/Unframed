// A CSS resize sets no pointer capture, so mouseup lands on whatever is under the
// cursor when the drag ends -- not necessarily the field. Growing is safe (the
// corner tracks the cursor), but shrinking past min-width/min-height stalls the box
// while the cursor keeps travelling, so the release can land on the canvas and a
// mouseup handler on the field itself would never fire. Stashing the field on
// mousedown and reading ITS size from a one-shot window mouseup sidesteps the
// target entirely. The pending-listener ref means a second mousedown before the
// first's mouseup (drag restarted, or the pointer left the window) replaces rather
// than stacks the listener, so nothing accumulates on window. A node can also
// unmount mid-drag (deleted, or a project switch remounts every node) with the
// listener still armed; the effect cleanup below removes it so it can't fire later
// against a detached box and a stale updateNodeData/data closure.

import { useRef, useEffect } from 'react';

// Given the inline style of the resized element and the size currently stored in
// node data, what should be written, if anything. Pure -- no DOM, no React -- so it
// runs under bare node.
export function resizedSize(style, current) {
  if (!style?.width && !style?.height) return null;
  const size = { width: style.width, height: style.height };
  // A plain click (place the caret, select text) re-delivers the same size on
  // every mouseup once one is set; skip the write when nothing actually changed
  // so it doesn't cost a redundant save and a no-op undo entry.
  if (current?.width === size.width && current?.height === size.height) return null;
  return size;
}

// Owns the ref, the mousedown handler, the one-shot window mouseup listener and the
// unmount cleanup for both call sites. `keyFor(box)` picks which node-data key the
// resized element's size belongs under -- PromptNode has exactly one resizable
// field and always answers 'size'; TextOutputNode has two and tells them apart by
// the `xnode-text-result` class on the Result field.
export function useFieldResize({ id, data, updateNodeData, keyFor }) {
  const pendingResizeUp = useRef(null);

  function onResizeMouseDown(e) {
    const box = e.target.closest?.('.astryx-textarea');
    if (!box) return;
    if (pendingResizeUp.current) window.removeEventListener('mouseup', pendingResizeUp.current);
    const key = keyFor(box);
    function onUp() {
      pendingResizeUp.current = null;
      const size = resizedSize(box.style, data[key]);
      if (!size) return;
      updateNodeData(id, { [key]: size });
    }
    pendingResizeUp.current = onUp;
    window.addEventListener('mouseup', onUp, { once: true });
  }

  useEffect(() => {
    return () => {
      if (pendingResizeUp.current) {
        window.removeEventListener('mouseup', pendingResizeUp.current);
        pendingResizeUp.current = null;
      }
    };
  }, []);

  return onResizeMouseDown;
}
