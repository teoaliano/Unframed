import { useEffect, useRef, useState } from 'react';
import { Handle, Position, useReactFlow } from '@xyflow/react';
import { Card } from '@astryxdesign/core/Card';
import { TextArea } from '@astryxdesign/core/TextArea';
import NodeLine from './NodeLine.jsx';
import MediaResize from './MediaResize.jsx';
import { isReferenceable } from '../graph/resolve.js';

// Match a partial "@query" ending exactly at the caret, so the menu only shows
// while you're actively typing a reference.
const TRIGGER_RE = /@([\w-]*)$/;

// How wide an auto-sized prompt may get before it wraps instead of growing. Content
// pixels, i.e. before the field's padding and the node's border.
const AUTO_MAX_WIDTH = 320;

export default function PromptNode({ id, data, parentId, selected }) {
  const { updateNodeData, getNodes, setNodes } = useReactFlow();
  const ref = useRef(null);
  const [query, setQuery] = useState(null); // null = menu closed; string = open
  const [sel, setSel] = useState(0);
  // FigJam/Miro two-step: a single click SELECTS the element, editing only starts on a
  // double-click or Enter. `editing` gates that — until it is true the field is read-only
  // and lets pointer events through (styles.css) so the click lands on the node, and a
  // drag moves it, rather than placing a caret.
  const [editing, setEditing] = useState(false);

  // A prompt HUGS its text. There is no default box size to speak of: the node is
  // measured from what it says and rewritten on every keystroke, so it is never larger
  // than its own words. `data.sized` is the one thing that stops it — see the drag
  // effect below.
  //
  // The measuring is done in a throwaway mirror element on document.body — OUTSIDE React
  // Flow's zoom transform — so every number is a layout pixel whatever the canvas is
  // zoomed to. Measuring the real textarea instead would read a transform-scaled box and
  // mis-size the node at any zoom other than 1.
  function fitToText() {
    const el = ref.current;
    const wrapper = el?.closest('.react-flow__node');
    if (!el || !wrapper) return;

    const cs = getComputedStyle(el);
    const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    // The node box is a little wider than the field inside it, and the difference has to
    // be carried through or the fit writes a box one wrap short and clips the last line.
    const chromeX = wrapper.offsetWidth - el.offsetWidth;
    const chromeY = wrapper.offsetHeight - el.offsetHeight;

    const mirror = document.createElement('div');
    Object.assign(mirror.style, {
      position: 'absolute',
      visibility: 'hidden',
      left: '-9999px',
      top: '0',
      // Same wrapping model as the textarea, so the mirror breaks lines exactly where
      // the field does.
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      overflowWrap: 'break-word',
      boxSizing: 'content-box',
      padding: '0',
      margin: '0',
      border: '0',
      fontFamily: cs.fontFamily,
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      fontStyle: cs.fontStyle,
      lineHeight: cs.lineHeight,
      letterSpacing: cs.letterSpacing,
    });
    // `max-content` is the whole trick: with pre-wrap it lays the text out as its own
    // longest line, breaking only where the text itself does. An EMPTY node is measured
    // from the placeholder instead, so the hint has room to be read rather than being
    // clipped by a 40px box.
    mirror.style.width = 'max-content';
    mirror.textContent = el.value || el.placeholder || ' ';
    document.body.appendChild(mirror);
    // Fractional, via the rect, and rounded UP — offsetWidth rounds to the nearest pixel,
    // and rounding a line's width DOWN gives it a box a fraction narrower than the text,
    // which wraps the last word onto a line the fitted height has no room for. (That is
    // what turned an empty node's "Add text…" into "Add".)
    let contentW = Math.ceil(mirror.getBoundingClientRect().width);
    // Past the ceiling it stops growing sideways and grows down instead, like every
    // canvas text tool: one 900px line of prose is not a shape anybody wants.
    if (contentW > AUTO_MAX_WIDTH) {
      mirror.style.width = `${AUTO_MAX_WIDTH}px`;
      contentW = AUTO_MAX_WIDTH;
    }
    const contentH = Math.ceil(mirror.getBoundingClientRect().height);
    document.body.removeChild(mirror);

    // The floors match MediaResize's `text` minimums; a fit must not write a size a drag
    // would refuse to reproduce.
    const width = Math.max(40, Math.ceil(contentW + padX + chromeX));
    const height = Math.max(28, Math.ceil(contentH + padY + chromeY));
    setNodes((nodes) =>
      nodes.map((n) => (n.id === id ? { ...n, width, height } : n)),
    );
  }

  // Hug the text, on mount and on every change to it — unless the user has taken the
  // size for themselves. `data.sized` is persisted with the node, so a box someone sized
  // by hand stays that size across a reload; everything else is measured fresh, which is
  // also how a prompt written by the agent or restored from a preset ends up the size of
  // its words rather than the size it was saved at.
  useEffect(() => {
    if (data.sized) return;
    fitToText();
  }, [data.text, data.sized]);

  function enterEdit() {
    setEditing(true);
  }

  function exitEdit() {
    setEditing(false);
    setQuery(null);
  }

  // Focus follows `editing`, in an effect rather than after the state call: the field is
  // readOnly until React has committed the flip, and only an effect is guaranteed to run
  // after that commit. (A requestAnimationFrame lands after it too — until the window is
  // in the background, where rAF simply stops firing and the focus never moves.)
  //
  // Entering selects ALL the text, Figma-style: double-clicking a text element highlights
  // everything, so the next keystroke replaces it. Leaving hands focus back to the node
  // wrapper, but only when the field still HAS it — that is the Escape path; a blur means
  // the user already clicked something else, and stealing focus back would fight them.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (editing) {
      el.focus();
      el.setSelectionRange(0, el.value.length);
    } else if (document.activeElement === el) {
      el.blur();
      el.closest('.react-flow__node')?.focus();
    }
  }, [editing]);

  // Enter starts editing when the node is selected but not yet being edited. The keydown
  // is caught on React Flow's node WRAPPER — the element that takes focus on selection —
  // so the listener is attached imperatively to it: a child cannot catch a key pressed
  // while an ancestor holds focus.
  useEffect(() => {
    if (editing || !selected) return;
    const wrapper = ref.current?.closest('.react-flow__node');
    if (!wrapper) return;
    const onKey = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        enterEdit();
      }
    };
    wrapper.addEventListener('keydown', onKey);
    return () => wrapper.removeEventListener('keydown', onKey);
  }, [editing, selected]);

  // Dragging a resize control hands the size to the user for good: the box stops hugging
  // the text and keeps whatever it is dragged to. The flag is set on the first pointer
  // MOVE rather than on the press, which is what keeps a double-click (two presses, no
  // movement) from claiming the size a moment before it asks to give it back.
  //
  // The controls are React Flow's own elements (MediaResize), so both listeners are
  // delegated from the node wrapper — which also means they survive a control remounting.
  useEffect(() => {
    const wrapper = ref.current?.closest('.react-flow__node');
    if (!wrapper) return;
    const onDown = (e) => {
      if (!e.target.closest('.xnode-resize')) return;
      const from = { x: e.clientX, y: e.clientY };
      const stop = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', stop);
      };
      const onMove = (m) => {
        if (Math.abs(m.clientX - from.x) < 2 && Math.abs(m.clientY - from.y) < 2) return;
        stop();
        updateNodeData(id, { sized: true });
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', stop);
    };
    // ...and double-clicking an edge gives it back: the box returns to hugging its text.
    // Both halves of that are needed — clearing the flag re-arms the effect above for
    // every later keystroke, and the direct call is what resizes the box now, since a
    // node that was already hugging sees no state change to fit on.
    const onDbl = (e) => {
      if (!e.target.closest('.xnode-resize.line')) return;
      e.preventDefault();
      e.stopPropagation();
      updateNodeData(id, { sized: false });
      fitToText();
    };
    wrapper.addEventListener('pointerdown', onDown);
    wrapper.addEventListener('dblclick', onDbl);
    return () => {
      wrapper.removeEventListener('pointerdown', onDown);
      wrapper.removeEventListener('dblclick', onDbl);
    };
  }, [id]);

  // Other prompt and text output nodes whose id starts with the current @query, with a
  // preview so opaque ids stay identifiable. (Images aren't @-referenced — they
  // are typed as "image N", see the number under each connected reference node.)
  function candidates(q) {
    if (q == null) return [];
    const lower = q.toLowerCase();
    return getNodes()
      .filter((n) => isReferenceable(n) && n.id !== id && n.id.toLowerCase().startsWith(lower))
      .map((n) => ({
        id: n.id,
        preview: (n.data.result || n.data.text || '').replace(/\s+/g, ' ').slice(0, 24),
      }));
  }

  function syncMenu(el) {
    if (!el) return;
    const m = el.value.slice(0, el.selectionStart).match(TRIGGER_RE);
    setQuery(m ? m[1] : null);
    setSel(0);
  }

  function insert(refId) {
    const el = ref.current;
    const before = el.value.slice(0, el.selectionStart).replace(TRIGGER_RE, `@${refId} `);
    const text = before + el.value.slice(el.selectionStart);
    updateNodeData(id, { text });
    setQuery(null);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(before.length, before.length);
    });
  }

  function onKeyDown(e) {
    const list = candidates(query);
    // Escape closes the mention menu when it is open, and otherwise leaves edit mode for
    // a still-selected element. Stopped here either way so it does not bubble to the
    // canvas and deselect the node as well.
    if (e.key === 'Escape') {
      e.stopPropagation();
      if (list.length) {
        setQuery(null);
      } else {
        // The effect above hands focus back to the node wrapper, so the element stays
        // selected and Enter can re-enter editing.
        exitEdit();
      }
      return;
    }
    if (!list.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSel((s) => (s + 1) % list.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSel((s) => (s - 1 + list.length) % list.length);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      insert(list[sel].id);
    }
  }

  const list = candidates(query);

  // The menu and the @id line are siblings of the Card, not children of it: the Card
  // clips to its rounded corners (overflow: clip) and both hang below the Card's box,
  // so nested they were laid out correctly and then clipped away — present in the DOM,
  // never painted. Out here they anchor to the React Flow node wrapper instead, which
  // is positioned and does not clip.
  //
  // The field IS the node now — no rows box, no inner border, no body padding. It fills
  // the card, and the card fills whatever box a border-drag writes onto the node
  // wrapper. That replaced the field's own CSS `resize: both` handle, and with it the
  // whole fieldResize.js dance: a NodeResizeControl sets pointer capture, so there is
  // no longer a mouseup that can land on the canvas instead of the field.
  //
  // A prompt is a FigJam/Miro text element: no docked tab, no border, no fill — bare
  // text on the canvas. It is the one node with nothing to show BUT its text, so the
  // card that frames a picture or a result is pure chrome here. The Card element stays
  // as React Flow's measurement box (a border drag writes width/height through it, see
  // MediaResize and withDrag); `.xnode-prompt--bare` in styles.css strips every surface
  // it paints. The one fact worth keeping — the @id references are written against —
  // moves into the corner the tab used to own.
  return (
    <>
      {/* Idle, not live (secondary, no dot): an @id is a fact about the node, not a
          connection. `--start` docks it left, where the tab was. */}
      <NodeLine className="xnode-line--start">{`@${id}`}</NodeLine>
      {/* width: 100%, not fit-content — the node wrapper now carries the size a border
          drag writes, and the card fills it. */}
      <Card
        width="100%"
        padding={0}
        elevation="low"
        className={`xnode-prompt xnode-prompt--bare${editing ? ' xnode-prompt--editing' : ''}`}
      >
        {/* A node inside a group has no handle of its own: the group holds the one
            handle and wires for everything in it (graph/bulkWire.js canSource). Two
            handles for one image would be two ways to send it, and the wires would
            stop saying what a generation carries. */}
        {!parentId && <Handle type="source" position={Position.Right} />}
        <div
          className="xnode-body"
          onKeyDown={onKeyDown}
          onDoubleClick={enterEdit}
          onClick={() => editing && syncMenu(ref.current)}
        >
          {/* `nowheel` only while editing: an unedited prompt should let the wheel pan
              and zoom the canvas like any other node. */}
          <TextArea
            className={`nodrag${editing ? ' nowheel' : ''}`}
            ref={ref}
            label="Prompt text"
            isLabelHidden
            rows={4}
            hasSpellCheck={false}
            isReadOnly={!editing}
            placeholder="Add text…"
            value={data.text || ''}
            onChange={(v, e) => {
              updateNodeData(id, { text: v });
              syncMenu(e.target);
            }}
            onBlur={exitEdit}
          />
        </div>
      </Card>
      {/* Both axes, unlike media: there is no aspect ratio here to preserve. `text` adds
          the corner grips a selected text element shows. */}
      <MediaResize free text />
      {list.length > 0 && (
        <ul className="mention-menu">
          {list.map((c, i) => (
            <li
              key={c.id}
              className={i === sel ? 'active' : ''}
              onMouseDown={(e) => {
                e.preventDefault();
                insert(c.id);
              }}
            >
              <span className="mention-id">@{c.id}</span>
              {c.preview && <span className="mention-preview">{c.preview}</span>}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
