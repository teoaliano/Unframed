import { useEffect, useRef, useState } from 'react';
import { Handle, Position, useReactFlow } from '@xyflow/react';
import NodeLine from './NodeLine.jsx';
import MediaResize from './MediaResize.jsx';
import { renameRefs } from '../graph/resolve.js';
import { slug } from '../graph/starter.js';
import { useDoc } from '../graph/useDocument.js';

// The box. It holds nothing itself: its members are ordinary nodes carrying `parentId`,
// which React Flow renders as separate elements positioned against this one, so this
// component draws the surface they sit on and nothing else. That is the whole point of
// the shape -- there is still exactly one way to hold an image on the canvas.
//
// It has the one handle for everything inside it (bulkWire.js `canSource` is false for a
// member), and the one @id -- and that id IS the name. There is no second string: the
// label a prompt references, the label on the canvas and the name you type are one
// thing, so a box called `character` is referenced as @character. Renaming therefore
// renames what every reference points AT, which is why it cannot be an ordinary edit to
// node data: it goes through the document as a `renameNode` op with the prompt rewrites
// beside it, one batch and one undo step (commit() below, server/graph.js).
//
// The name IS the node's label -- there is no tab. A group first showed a "GROUP" tab
// and a name field inside the box, which said the same thing twice and spent the box's
// top strip on a form; then the tab read the name and the id sat opposite it, which said
// two different things in two places. Now there is one bare label, in the same corner and
// the same ink as a prompt's @id, because a group on the canvas is the same kind of
// thing: a name you reference. Rename in place -- double-click the label, or press F2
// while the box is selected.
//
// Not ⌘R, which was the other candidate: it is the browser's reload, so taking it would
// mean a user with a box selected cannot refresh the page. F2 is the platform-neutral
// rename key and collides with nothing here.
export default function GroupNode({ id, data, selected, width, height }) {
  const { getNodes } = useReactFlow();
  const { send } = useDoc();
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
    setDraft(id);
    setEditing(true);
  }

  // The rename, as one op. `slug` is the same one that mints a preset's id, so what a
  // person types ("Red Fox") becomes something a prompt can address (@red-fox) -- the
  // server refuses anything else, and refusing a name the user just typed is a worse
  // answer than shaping it. A name already on the canvas is suffixed rather than
  // rejected: the label says immediately which one you got, and nothing is blocked
  // mid-flow over a collision.
  //
  // The prompt rewrites travel in the same batch, so undo takes the whole rename back --
  // an undo that renamed the box but left @red-fox in three prompts would leave them
  // resolving to nothing, silently.
  function commit() {
    setEditing(false);
    const wanted = slug(draft);
    if (!wanted || wanted === id) return;
    const nodes = getNodes();
    const taken = new Set(nodes.map((n) => n.id));
    let to = wanted;
    for (let i = 2; taken.has(to); i += 1) to = `${wanted}-${i}`;

    const ops = [{ type: 'renameNode', id, to }];
    for (const n of nodes) {
      if (typeof n.data?.text !== 'string') continue;
      const text = renameRefs(n.data.text, id, to);
      if (text !== n.data.text) ops.push({ type: 'updateNode', id: n.id, patch: { text } });
    }
    send(ops.length > 1 ? { type: 'batch', ops } : ops[0]);
  }

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  return (
    <>
      {/* One label, in the corner a docked tab used to own and the same ink as a
          prompt's @id (NodeLine's `--start`). `nodrag` on the input alone: the label
          itself stays part of the box's drag surface, and only the caret is exempt. */}
      <NodeLine className="xnode-line--start" onDoubleClick={editing ? undefined : start}>
        {editing ? (
          <span className="xnode-group-name">
            @
            <input
              ref={inputRef}
              className="xnode-group-input nodrag"
              value={draft}
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
          `@${id}`
        )}
      </NodeLine>
      <div className="xnode-group" style={{ width, height }} />
      {/* Both axes are the user's, like a prompt: a box has no ratio to keep. The larger
          max is the point of the prop -- a box wrapping three images starts wider than
          any single node's ceiling. `grips` gives it the same selection as a prompt. */}
      <MediaResize free grips max={4000} />
      <Handle type="source" position={Position.Right} />
    </>
  );
}
