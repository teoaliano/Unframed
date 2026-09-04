import { useEffect, useState } from 'react';
import { Handle, Position, useReactFlow, useNodes, useEdges } from '@xyflow/react';
import { Card } from '@astryxdesign/core/Card';
import { FileInput } from '@astryxdesign/core/FileInput';
import { Thumbnail } from '@astryxdesign/core/Thumbnail';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import NodeHeader from './NodeHeader.jsx';
import NodeLine from './NodeLine.jsx';
import MediaResize from './MediaResize.jsx';
import StatusLine from './StatusLine.jsx';
import { sourceRoles, hasMedia } from '../graph/resolve.js';
import { useProject } from '../graph/project.js';
import { uploadFile, fileUrl } from '../api.js';

// The browser-side address of a media node's bytes. A file lives in the project folder
// and is served by /api/file; the only non-file case is a hosted https link (video).
export const mediaSrc = (data, project) => (data?.file ? fileUrl(project, data.file) : data?.dataUrl || '');

export default function ImageNode({ id, data }) {
  const { updateNodeData } = useReactFlow();
  const { name: project } = useProject();
  const [error, setError] = useState('');
  // What each consuming node will do with this image, recomputed as connections,
  // positions and input modes change. "image 1 / —" = image 1 to one output, unused by
  // another. Empty = not wired anywhere.
  const roles = sourceRoles(useNodes(), useEdges(), id);
  const src = mediaSrc(data, project);

  // The bytes go to the project folder, not into node data: media left the document
  // (server/media.js), so the node keeps the file's name and the picture is served back
  // by URL. dataUrl is cleared in the same write, in case this node carried one.
  async function onFile(file) {
    if (!file) return;
    setError('');
    try {
      const saved = await uploadFile(project, file);
      updateNodeData(id, { file: saved.file, fileName: saved.fileName || file.name, dataUrl: undefined, aspect: null });
    } catch (err) {
      setError(err.message);
    }
  }

  // The node follows the image's shape instead of forcing a square. Measured once
  // and stored in node data, so it survives reload (and covers older graphs that
  // were saved before this existed).
  useEffect(() => {
    if (!src || data.aspect) return;
    const img = new Image();
    img.onload = () => updateNodeData(id, { aspect: img.naturalWidth / img.naturalHeight });
    img.src = src;
  }, [src, data.aspect, id, updateNodeData]);

  // sourceRoles answers with bare ranks ("1", "1 / 2"), which read fine beside a header
  // that already said "image" and read as nothing at all on a line of their own. The
  // medium is spelled out here rather than in resolve.js so the pure module keeps
  // answering the graph question and this one owns the wording.
  const role = roles.length ? `image ${roles.join(' / ')}` : hasMedia({ data }) ? 'not connected' : null;

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
      <NodeHeader kind="image" family="input" />
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
        <div className="xnode-body">
          {src ? (
            // Thumbnail's own onRemove is not used: its X is translucent, so how
            // visible it is depends on the picture behind it, and it cannot be
            // restyled from out here. One overlay serves both reference kinds instead.
            <span className="xnode-media">
              <Thumbnail
                className="xnode-thumb"
                style={{ aspectRatio: data.aspect || 1 }}
                src={src}
                alt={data.fileName || 'image'}
              />
              <span className="xnode-media-remove nodrag">
                <Button
                  label={`Remove ${data.fileName || 'image'}`}
                  isIconOnly
                  icon={<Icon icon="close" size="xsm" />}
                  size="sm"
                  onClick={() => updateNodeData(id, { file: undefined, dataUrl: undefined, fileName: '', aspect: null })}
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
          {error && <StatusLine type="error">{error}</StatusLine>}
        </div>
      </Card>
      {/* The right end of the name row, opposite the tab. Outside the card on purpose:
          a badge on the picture needs a scrim to survive an arbitrary photograph, and
          the scrim is then the thing covering the photograph. Out here it needs neither.
          It is absolutely positioned (styles.css) so the node wrapper stays exactly the
          card's box. */}
      <NodeLine live={roles.length > 0}>{role}</NodeLine>
      {/* Resizable from any edge once it holds something — nodes/MediaResize.jsx owns
          why that includes the right one, where the handle also lives. */}
      {src && <MediaResize />}
    </>
  );
}
