import { Handle, Position, useReactFlow, useNodes } from '@xyflow/react';
import { Card } from '@astryxdesign/core/Card';
import NodeHeader from './NodeHeader.jsx';
import NodeLine from './NodeLine.jsx';
import MediaResize from './MediaResize.jsx';
import PromptEditor from './PromptEditor.jsx';

export default function PromptNode({ id, data }) {
  const { updateNodeData } = useReactFlow();
  const nodes = useNodes();

  // The field IS the node now — no rows box, no inner border, no body padding. It fills
  // the card, and the card fills whatever box a border-drag writes onto the node
  // wrapper.
  return (
    <>
      <NodeHeader kind="prompt" family="input" />
      {/* width: 100%, not fit-content — the node wrapper now carries the size a border
          drag writes, and the card fills it. */}
      <Card width="100%" padding={0} elevation="low" className="xnode-prompt">
        <Handle type="source" position={Position.Right} />
        <div className="xnode-body">
          <PromptEditor
            nodeId={id}
            value={data.text || ''}
            nodes={nodes}
            onChange={(text) => updateNodeData(id, { text })}
            placeholder="Describe the image. Reference a prompt, text output or character with @"
          />
        </div>
      </Card>
      {/* A prompt has no connection role — sourceRoles answers only for media — so its
          slot in the name row carries the one other fact worth having on the canvas: the
          id every @reference is written against. */}
      <NodeLine>{`@${id}`}</NodeLine>
      {/* Both axes, unlike media: there is no aspect ratio here to preserve. */}
      <MediaResize free />
    </>
  );
}
