import { useEffect, useRef, useState } from 'react';
import { Handle, Position, useReactFlow } from '@xyflow/react';
import NodeHeader from './NodeHeader.jsx';
import NodeLine from './NodeLine.jsx';
import MediaResize from './MediaResize.jsx';

// The box. It holds nothing itself: its members are ordinary nodes carrying `parentId`,
// which React Flow renders as separate elements positioned against this one, so this
// component draws the surface they sit on and nothing else. That is the whole point of
// the shape -- there is still exactly one way to hold an image on the canvas.
//
// It has the one handle for everything inside it (bulkWire.js `canSource` is false for a
// member), and the one @id, which is why the name matters: the tag a prompt shows reads
// this name while the reference stays tied to the id, so renaming cannot break a
// reference.
//
// The name IS the node's label -- there is no second one. A group first showed a "GROUP"
// tab and a name field inside the box, which said the same thing twice and spent the
// box's top strip on a form. Now the tab reads the name, exactly as an image node's tab
// reads its medium, and renaming happens in place: double-click the tab, or press F2
// while the box is selected.
//
// Not ⌘R, which was the other candidate: it is the browser's reload, so taking it would
// mean a user with a box selected cannot refresh the page. F2 is the platform-neutral
// rename key and collides with nothing here.
const PLACEHOLDER = 'Group';

export default function GroupNode({ id, data, selected, width, height }) {
  const { updateNodeData } = useReactFlow();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef(null);

  // F2 renames the selected box. Bound while selected rather than pushed up into
  // App.jsx's key handler, which would have to know which node is being renamed and hand
  // the editing state back down -- state that belongs to this component alone.
  useEffect(() => {
    if (!selected || editing) return undefined;
    function onKeyDown(e) {
      if (e.key !== 'F2') return;
      const el = e.target;
      if (el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      e.preventDefault();
      start();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  function start() {
    setDraft(data?.name ?? '');
    setEditing(true);
  }

  function commit() {
    updateNodeData(id, { name: draft.trim() });
    setEditing(false);
  }

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  return (
    <>
      {editing ? (
        // Shaped as the tab it replaces, so the name does not jump between reading and
        // editing. `nodrag` or the canvas takes the pointer and no caret can be placed.
        <span className="xnode-tab xnode-tab--input xnode-tab--editing nodrag">
          <input
            ref={inputRef}
            className="xnode-group-input"
            value={draft}
            placeholder={PLACEHOLDER}
            aria-label="Group name"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              // Escape abandons the draft rather than saving it, the one thing that makes
              // a rename safe to start by accident.
              else if (e.key === 'Escape') setEditing(false);
              // The canvas deletes the selected node on Backspace, and this input is
              // inside it: without stopping here, clearing the name deletes the box.
              else e.stopPropagation();
            }}
            autoFocus
          />
        </span>
      ) : (
        <NodeHeader kind="group" title={data?.name?.trim() || PLACEHOLDER} onDoubleClick={start} />
      )}
      <div className="xnode-group" style={{ width, height }} />
      <NodeLine>{`@${id}`}</NodeLine>
      {/* Both axes are the user's, like a prompt: a box has no ratio to keep. The larger
          max is the point of the prop -- a box wrapping three images starts wider than
          any single node's ceiling. */}
      <MediaResize free max={4000} />
      <Handle type="source" position={Position.Right} />
    </>
  );
}
