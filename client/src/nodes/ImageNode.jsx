import { useEffect } from 'react';
import { Handle, Position, useReactFlow, useNodes, useEdges } from '@xyflow/react';
import { Card } from '@astryxdesign/core/Card';
import { FileInput } from '@astryxdesign/core/FileInput';
import { Thumbnail } from '@astryxdesign/core/Thumbnail';
import NodeHeader from './NodeHeader.jsx';
import { imageRefNumber } from '../graph/resolve.js';

export default function ImageNode({ id, data }) {
  const { updateNodeData } = useReactFlow();
  // Live number this image will be sent as, recomputed as connections/positions
  // change. null = not wired to the output (so it won't be sent).
  const num = imageRefNumber(useNodes(), useEdges(), id);

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

  const status = num != null ? String(num) : data.dataUrl ? 'not connected' : undefined;

  return (
    <Card width={240} padding={0}>
      <Handle type="source" position={Position.Right} />
      <NodeHeader
        kind="image"
        family="input"
        right={status}
        rightTone={num != null ? 'accent' : 'secondary'}
      />
      <div className="xnode-body">
        {data.dataUrl ? (
          <Thumbnail
            className="xnode-thumb"
            style={{ aspectRatio: data.aspect || 1 }}
            src={data.dataUrl}
            alt={data.fileName || 'image'}
            label={data.fileName || 'image'}
            onRemove={() => updateNodeData(id, { dataUrl: '', fileName: '', aspect: null })}
          />
        ) : (
          <FileInput
            label="Reference image"
            isLabelHidden
            accept="image/*"
            value={null}
            onChange={onFile}
          />
        )}
      </div>
    </Card>
  );
}
