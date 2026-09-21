import { useEffect, useRef } from 'react';

// Hand an artifact's saved parameter values (`data.dials`) to the frame showing it, so the
// preview ON THE CANVAS is the artifact as it is tuned rather than as it was written.
//
// Without this the values existed only where they were set: the editor pushed them into
// its own frame, the node kept them in `data.dials`, and the node's preview went on
// showing the composition's defaults. Coming back to the canvas after tuning something
// showed the untuned thing (Matteo, 2026-09-07).
//
// The artifact announces itself when it is ready (`unframed:dials`, server/dials.js), and
// that is the moment to answer: a value posted before the bridge exists is simply lost,
// and neither `load` nor a timer tells us when a composition has run its script. So this
// waits to be spoken to. `hello` is sent as well because a MOTION sits inside the viewer,
// which replays the last announcement to whoever says it -- a frame that announced before
// this listener attached would otherwise never be answered.
//
// Two topologies, one code path: a motion is framed by the viewer (which relays both
// ways), a page is framed by the canvas directly. The bridge accepts values from whoever
// framed it, so both work without this knowing which it is.
export function useDialValues(frameRef, dials) {
  // The latest values, read at post time. A ref so a change during the handshake is not
  // missed and a stale set is never sent.
  const latest = useRef(dials);
  latest.current = dials;

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return undefined;
    const send = () => {
      const values = latest.current;
      if (!values || !Object.keys(values).length) return;
      frame.contentWindow?.postMessage({ type: 'unframed:dials:set', values }, '*');
    };
    const hello = () => frame.contentWindow?.postMessage({ type: 'unframed:dials:hello' }, '*');
    function onMessage(event) {
      if (event.source !== frame.contentWindow) return;
      if (event.data?.type !== 'unframed:dials') return;
      send();
    }
    window.addEventListener('message', onMessage);
    frame.addEventListener('load', hello);
    hello();
    return () => {
      window.removeEventListener('message', onMessage);
      frame.removeEventListener('load', hello);
    };
  }, [frameRef]);

  // A change made elsewhere -- the editor, another tab, an undo -- reaches the frame
  // without waiting to be announced to again.
  useEffect(() => {
    if (!dials || !Object.keys(dials).length) return;
    frameRef.current?.contentWindow?.postMessage({ type: 'unframed:dials:set', values: dials }, '*');
  }, [dials, frameRef]);
}
