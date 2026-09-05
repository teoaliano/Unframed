import { useRef, useState } from 'react';
import { Handle, Position, useReactFlow } from '@xyflow/react';
import { Card } from '@astryxdesign/core/Card';
import { TextArea } from '@astryxdesign/core/TextArea';
import NodeHeader from './NodeHeader.jsx';
import NodeLine from './NodeLine.jsx';
import MediaResize from './MediaResize.jsx';
import { isReferenceable } from '../graph/resolve.js';

// Match a partial "@query" ending exactly at the caret, so the menu only shows
// while you're actively typing a reference.
const TRIGGER_RE = /@([\w-]*)$/;

export default function PromptNode({ id, data, parentId }) {
  const { updateNodeData, getNodes } = useReactFlow();
  const ref = useRef(null);
  const [query, setQuery] = useState(null); // null = menu closed; string = open
  const [sel, setSel] = useState(0);

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
    } else if (e.key === 'Escape') {
      setQuery(null);
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
  return (
    <>
      <NodeHeader kind="prompt" family="input" />
      {/* width: 100%, not fit-content — the node wrapper now carries the size a border
          drag writes, and the card fills it. */}
      <Card width="100%" padding={0} elevation="low" className="xnode-prompt">
        {/* A node inside a group has no handle of its own: the group holds the one
            handle and wires for everything in it (graph/bulkWire.js canSource). Two
            handles for one image would be two ways to send it, and the wires would
            stop saying what a generation carries. */}
        {!parentId && <Handle type="source" position={Position.Right} />}
        <div className="xnode-body" onKeyDown={onKeyDown} onClick={() => syncMenu(ref.current)}>
          <TextArea
            className="nodrag nowheel"
            ref={ref}
            label="Prompt text"
            isLabelHidden
            rows={4}
            hasSpellCheck={false}
            placeholder="Describe the image. Reference another prompt with @id"
            value={data.text || ''}
            onChange={(v, e) => {
              updateNodeData(id, { text: v });
              syncMenu(e.target);
            }}
            onBlur={() => setQuery(null)}
          />
        </div>
      </Card>
      {/* A prompt has no connection role — sourceRoles answers only for media — so its
          slot in the name row carries the one other fact worth having on the canvas: the
          id every @reference is written against. */}
      <NodeLine>{`@${id}`}</NodeLine>
      {/* Both axes, unlike media: there is no aspect ratio here to preserve. */}
      <MediaResize free />
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
