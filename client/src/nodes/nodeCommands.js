// The selection toolbar's Generate/Run drives the selected output node's own action.
// The node owns that action -- its request, its markers, its error branch -- so the
// toolbar does not call into the node; it announces a command by node id on the window,
// and the node that owns the id runs what it would have run on its own button. No second
// copy of any run logic, and nothing in App.jsx has to know how a node runs.
import { useEffect } from 'react';

const EVENT = 'unframed:node-command';

export function sendNodeCommand(id, command) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { id, command } }));
}

// `handler` is read through a ref-like closure each time, so the latest render's
// function runs: onGenerate closes over the node's current data.
export function useNodeCommand(id, command, handler) {
  useEffect(() => {
    const on = (e) => {
      if (e.detail?.id === id && e.detail?.command === command) handler();
    };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, [id, command, handler]);
}
