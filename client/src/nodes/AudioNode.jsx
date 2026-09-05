import { useState } from 'react';
import { Handle, Position, useReactFlow, useNodes, useEdges } from '@xyflow/react';
import { Card } from '@astryxdesign/core/Card';
import { FileInput } from '@astryxdesign/core/FileInput';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { VStack } from '@astryxdesign/core/Stack';
import NodeHeader from './NodeHeader.jsx';
import NodeLine from './NodeLine.jsx';
import MediaResize from './MediaResize.jsx';
import StatusLine from './StatusLine.jsx';
import { sourceRoles, hasMedia } from '../graph/resolve.js';
import { mediaSrc } from './ImageNode.jsx';
import { useProject } from '../graph/project.js';
import { uploadFile } from '../api.js';

// A clip you supply, held the same way ImageNode/VideoNode hold theirs -- uploaded to
// the project folder (media left the document, server/media.js) rather than carried as
// node data. It is not yet usable as a generation reference: resolve.js's bucketSources/
// sourceRoles only recognise 'image' and 'video', so this node numbers as "not connected"
// no matter how it is wired. That is deliberate scope for this PR, not an oversight --
// wiring it into input_references (Seedance 2.5 accepts audio_url alongside image_url/
// video_url) is a follow-up.
export const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
export const AUDIO_TOO_BIG = 'Audio is too large. Keep it under 10MB.';

export default function AudioNode({ id, data, parentId }) {
  const { updateNodeData } = useReactFlow();
  const { name: project } = useProject();
  const [error, setError] = useState('');
  const src = mediaSrc(data, project);
  // Same per-consumer role reporting as image/video, read off this node's own type --
  // see the file header comment for why this always comes back empty for now.
  const roles = sourceRoles(useNodes(), useEdges(), id);

  // The bytes go to the project folder and the node keeps the file's name -- see
  // ImageNode.onFile.
  async function onFile(file) {
    if (!file) return;
    if (file.size > MAX_AUDIO_BYTES) return setError(AUDIO_TOO_BIG);
    setError('');
    try {
      const saved = await uploadFile(project, file);
      updateNodeData(id, { file: saved.file, fileName: saved.fileName || file.name, dataUrl: undefined });
    } catch (err) {
      setError(err.message);
    }
  }

  const role = roles.length ? `audio ${roles.join(' / ')}` : hasMedia({ data }) ? 'not connected' : null;

  // Dropping a clip anywhere on the node fills (or replaces) it, same as
  // Image/VideoNode -- stopping propagation keeps the canvas's own drop
  // handler from also spawning a second, brand-new node from the same file.
  function onDrop(e) {
    const file = [...(e.dataTransfer?.files || [])].find((f) => f.type.startsWith('audio/'));
    if (!file) return;
    e.preventDefault();
    e.stopPropagation();
    onFile(file);
  }

  return (
    <>
      <NodeHeader kind="audio" family="input" />
      <Card
        width="100%"
        elevation="low"
        padding={0}
        onDrop={onDrop}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        {/* A node inside a group has no handle of its own -- see ImageNode. */}
        {!parentId && <Handle type="source" position={Position.Right} />}
        {/* Not .xnode-media: that wrapper fills a node edge-to-edge for a picture or a
            video frame, which is right for a thumbnail and wrong for a scrubber bar --
            an audio control wants the body's own padding, not to bleed into the card's
            corners. */}
        <div className="xnode-body">
          <VStack gap={2}>
            {src ? (
              <>
                <audio className="nodrag" controls src={src} style={{ width: '100%' }} />
                <Button
                  className="nodrag"
                  label={`Remove ${data.fileName || 'audio'}`}
                  variant="ghost"
                  size="sm"
                  icon={<Icon icon="close" size="xsm" />}
                  onClick={() => updateNodeData(id, { file: undefined, dataUrl: undefined, fileName: '' })}
                />
              </>
            ) : (
              <>
                <FileInput
                  className="nodrag"
                  label="Reference audio"
                  isLabelHidden
                  accept="audio/*"
                  value={null}
                  onChange={onFile}
                />
                {error && <StatusLine type="error">{error}</StatusLine>}
              </>
            )}
          </VStack>
        </div>
      </Card>
      <NodeLine live={roles.length > 0}>{role}</NodeLine>
      {/* `free`: no aspect ratio to keep -- an audio control has no visual dimension
          the way a picture or a clip frame does, so both axes are the user's. */}
      {src && <MediaResize free />}
    </>
  );
}
