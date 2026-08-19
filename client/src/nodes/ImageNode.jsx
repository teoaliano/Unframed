import { useEffect } from 'react';
import { Handle, Position, useReactFlow, useNodes, useEdges } from '@xyflow/react';
import { Card } from '@astryxdesign/core/Card';
import { FileInput } from '@astryxdesign/core/FileInput';
import { Thumbnail } from '@astryxdesign/core/Thumbnail';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import NodeHeader from './NodeHeader.jsx';
import MediaResize from './MediaResize.jsx';
import { sourceRoles } from '../graph/resolve.js';

export default function ImageNode({ id, data }) {
  const { updateNodeData } = useReactFlow();
  // What each consuming node will do with this image, recomputed as connections,
  // positions and input modes change. "2 / —" = image 2 to one output, unused by
  // another. Empty = not wired anywhere.
  const roles = sourceRoles(useNodes(), useEdges(), id);

  function onFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () =>
      updateNodeData(id, { dataUrl: reader.result, fileName: file.name, aspect: null });
    reader.readAsDataURL(file);
  }

  // The node follows the image's shape instead of forcing a square. Measured once
  // and stored in node data, so it survives reload (and covers older graphs that
  // were saved before this existed).
  useEffect(() => {
    if (!data.dataUrl || data.aspect) return;
    const img = new Image();
    img.onload = () => updateNodeData(id, { aspect: img.naturalWidth / img.naturalHeight });
    img.src = data.dataUrl;
  }, [data.dataUrl, data.aspect, id, updateNodeData]);

  const status = roles.length ? roles.join(' / ') : data.dataUrl ? 'not connected' : undefined;

  // Dropping a picture anywhere on the node fills (or replaces) it. Stopping
  // propagation matters: the canvas has its own drop handler that would otherwise
  // also spawn a brand-new image node from the same file.
  function onDrop(e) {
    const file = [...(e.dataTransfer?.files || [])].find((f) => f.type.startsWith('image/'));
    if (!file) return;
    e.preventDefault();
    e.stopPropagation();
    onFile(file);
  }

  return (
    <>
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
        <Handle type="source" position={Position.Right} />
        <NodeHeader
          kind="image"
          family="input"
          right={status}
          rightTone={roles.length ? 'accent' : 'secondary'}
        />
        <div className="xnode-body">
          {data.dataUrl ? (
            // Thumbnail's own onRemove is not used: its X is translucent, so how
            // visible it is depends on the picture behind it, and it cannot be
            // restyled from out here. One overlay serves both reference kinds instead.
            <span className="xnode-media">
              <Thumbnail
                className="xnode-thumb"
                style={{ aspectRatio: data.aspect || 1 }}
                src={data.dataUrl}
                alt={data.fileName || 'image'}
              />
              <span className="xnode-media-remove nodrag">
                <Button
                  label={`Remove ${data.fileName || 'image'}`}
                  isIconOnly
                  icon={<Icon icon="close" size="xsm" />}
                  size="sm"
                  onClick={() => updateNodeData(id, { dataUrl: '', fileName: '', aspect: null })}
                />
              </span>
            </span>
          ) : (
            <FileInput
              className="nodrag"
              label="Reference image"
              isLabelHidden
              accept="image/*"
              value={null}
              onChange={onFile}
            />
          )}
        </div>
      </Card>
      {/* Resizable from any edge once it holds something — nodes/MediaResize.jsx owns
          why that includes the right one, where the handle also lives. */}
      {data.dataUrl && <MediaResize />}
    </>
  );
}
