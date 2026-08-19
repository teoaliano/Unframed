import { useRef, useState } from 'react';
import { Handle, Position, useReactFlow } from '@xyflow/react';
import { Card } from '@astryxdesign/core/Card';
import { TextArea } from '@astryxdesign/core/TextArea';
import NodeHeader from './NodeHeader.jsx';
import { isReferenceable } from '../graph/resolve.js';

// Match a partial "@query" ending exactly at the caret, so the menu only shows
// while you're actively typing a reference.
const TRIGGER_RE = /@([\w-]*)$/;

export default function PromptNode({ id, data }) {
  const { updateNodeData, getNodes } = useReactFlow();
  const ref = useRef(null);
  const [query, setQuery] = useState(null); // null = menu closed; string = open
  const [sel, setSel] = useState(0);

  // Other prompt and text output nodes whose id starts with the current @query, with a
  // preview so opaque ids stay identifiable. (Images aren't @-referenced — they
  // are typed as "image N", see the number on each connected reference node.)
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

  // A CSS resize sets no pointer capture, so mouseup lands on whatever is under the
  // cursor when the drag ends -- not necessarily the field. Growing is safe (the
  // corner tracks the cursor), but shrinking past min-width/min-height stalls the box
  // while the cursor keeps travelling, so the release can land on the canvas and a
  // mouseup handler on the field itself would never fire. Stashing the field on
  // mousedown and reading ITS size from a one-shot window mouseup sidesteps the
  // target entirely. The pending listener ref means a second mousedown before the
  // first's mouseup (drag restarted, or the pointer left the window) replaces rather
  // than stacks the listener, so nothing accumulates on window.
  const pendingResizeUp = useRef(null);
  function onResizeMouseDown(e) {
    const box = e.target.closest?.('.astryx-textarea');
    if (!box) return;
    if (pendingResizeUp.current) window.removeEventListener('mouseup', pendingResizeUp.current);
    function onUp() {
      pendingResizeUp.current = null;
      if (!box.style.width && !box.style.height) return;
      const size = { width: box.style.width, height: box.style.height };
      // A plain click (place the caret, select text) re-delivers the same size on
      // every mouseup once one is set; skip the write when nothing actually changed
      // so it doesn't cost a redundant save and a no-op undo entry.
      if (data.size?.width === size.width && data.size?.height === size.height) return;
      updateNodeData(id, { size });
    }
    pendingResizeUp.current = onUp;
    window.addEventListener('mouseup', onUp, { once: true });
  }

  // The menu is a sibling of the Card, not a child of it: the Card clips to its
  // rounded corners (overflow: clip), and the menu hangs below the Card's box, so
  // nested it was laid out correctly and then clipped away — present in the DOM,
  // never painted. Out here it anchors to the React Flow node wrapper instead,
  // which is positioned and does not clip.
  return (
    <>
      <Card width="fit-content" padding={0} className="xnode-prompt">
        <Handle type="source" position={Position.Right} />
        <NodeHeader kind="prompt" family="input" right={`@${id}`} />
        <div
          className="xnode-body"
          onKeyDown={onKeyDown}
          onClick={() => syncMenu(ref.current)}
          onMouseDown={onResizeMouseDown}
        >
          <TextArea
            className="nodrag"
            style={data.size}
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
