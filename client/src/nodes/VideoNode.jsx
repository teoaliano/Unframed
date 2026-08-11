import { useState } from 'react';
import { Handle, Position, useReactFlow, useNodes, useEdges } from '@xyflow/react';
import { Card } from '@astryxdesign/core/Card';
import { FileInput } from '@astryxdesign/core/FileInput';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { Text } from '@astryxdesign/core/Text';
import NodeHeader from './NodeHeader.jsx';
import { imageRefNumbers } from '../graph/resolve.js';

// Base64 inflates ~4/3 and the whole graph rides in one JSON body (and lands in
// graph.json on every autosave), so a hard cap keeps a single clip from blowing
// the server's body limit or making saves crawl.
export const MAX_VIDEO_BYTES = 25 * 1024 * 1024;
export const VIDEO_TOO_BIG = 'Video is too large — keep it under 25MB.';

export default function VideoNode({ id, data }) {
  const { updateNodeData } = useReactFlow();
  const [error, setError] = useState('');
  // Same per-consumer numbering as images, counted among video nodes only, so
  // "image 1" and "video 1" can coexist on one output.
  const nums = imageRefNumbers(useNodes(), useEdges(), id, 'video');

  function onFile(file) {
    if (!file) return;
    if (file.size > MAX_VIDEO_BYTES) return setError(VIDEO_TOO_BIG);
    setError('');
    const reader = new FileReader();
    reader.onload = () => updateNodeData(id, { dataUrl: reader.result, fileName: file.name });
    reader.readAsDataURL(file);
  }

  const status = nums.length ? nums.join(' / ') : data.dataUrl ? 'not connected' : undefined;

  // Dropping a clip anywhere on the node fills (or replaces) it. Stopping
  // propagation matters: the canvas drop handler would otherwise also spawn a
  // brand-new video node from the same file.
  function onDrop(e) {
    const file = [...(e.dataTransfer?.files || [])].find((f) => f.type.startsWith('video/'));
    if (!file) return;
    e.preventDefault();
    e.stopPropagation();
    onFile(file);
  }

  return (
    <Card
      width={240}
      padding={0}
      onDrop={onDrop}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <Handle type="source" position={Position.Right} />
      <NodeHeader
        kind="video"
        family="input"
        right={status}
        rightTone={nums.length ? 'accent' : 'secondary'}
      />
      <div className="xnode-body">
        {data.dataUrl ? (
          // Same shape as an image reference: the clip fills the node and remove is
          // an X over its corner, rather than a labelled button in a footer. The
          // file name moves to the title, which is where Thumbnail keeps it too.
          <span className="xnode-media">
            {/* nodrag/nowheel so the player's controls scrub instead of panning
                the canvas. */}
            <video
              className="xnode-video nodrag nowheel"
              src={data.dataUrl}
              title={data.fileName || 'video'}
              controls
              muted
            />
            <span className="xnode-media-remove">
              {/* Matched to what Thumbnail renders for an image: a secondary sm
                  Button carrying an xsm icon. Thumbnail also pins the box to 20px
                  through internal styles a prop cannot reach, hence the class. */}
              <Button
                label={`Remove ${data.fileName || 'video'}`}
                isIconOnly
                icon={<Icon icon="close" size="xsm" />}
                variant="secondary"
                size="sm"
                onClick={() => updateNodeData(id, { dataUrl: '', fileName: '' })}
              />
            </span>
          </span>
        ) : (
          <>
            <FileInput
              label="Reference video"
              isLabelHidden
              accept="video/*"
              value={null}
              onChange={onFile}
            />
            {error && <Text type="supporting" color="error">{error}</Text>}
          </>
        )}
      </div>
    </Card>
  );
}
