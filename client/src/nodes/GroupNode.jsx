import { Handle, Position, useReactFlow } from '@xyflow/react';
import NodeHeader from './NodeHeader.jsx';
import NodeLine from './NodeLine.jsx';

// The box. It holds nothing itself: its members are ordinary nodes carrying `parentId`,
// which React Flow renders as separate elements positioned against this one, so this
// component draws the surface they sit on and nothing else. That is the whole point of
// the shape -- there is still exactly one way to hold an image on the canvas.
//
// It has the one handle for everything inside it (bulkWire.js `canSource` is false for a
// member), and the one @id, which is why the name is editable here: the tag a prompt
// shows reads this name while the reference stays tied to the id, so renaming cannot
// break a reference.
//
// The name input is `nodrag` for the same reason every other control is: without it the
// canvas takes the pointer and you cannot place a caret. `nowheel` is deliberately NOT
// here -- React Flow honours it for the whole subtree, which would kill scroll-to-pan
// over the entire box and everything in it (see starter.js's note).
export default function GroupNode({ id, data, width, height }) {
  const { updateNodeData } = useReactFlow();
  return (
    <>
      <NodeHeader kind="group" title={data?.name?.trim() || 'group'} />
      <div className="xnode-group" style={{ width, height }}>
        <input
          className="xnode-group-name nodrag"
          value={data?.name ?? ''}
          placeholder="Name this group"
          aria-label="Group name"
          onChange={(e) => updateNodeData(id, { name: e.target.value })}
        />
      </div>
      <NodeLine>{`@${id}`}</NodeLine>
      <Handle type="source" position={Position.Right} />
    </>
  );
}
