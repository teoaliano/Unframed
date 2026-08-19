import { useState } from 'react';
import { Handle, Position, useReactFlow, useNodes, useEdges } from '@xyflow/react';
import { Card } from '@astryxdesign/core/Card';
import { FileInput } from '@astryxdesign/core/FileInput';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { Text } from '@astryxdesign/core/Text';
import NodeHeader from './NodeHeader.jsx';
import StatusLine from './StatusLine.jsx';
import VideoPlayer from './VideoPlayer.jsx';
import { sourceRoles } from '../graph/resolve.js';

// Base64 inflates ~4/3 and the whole graph rides in one JSON body (and lands in
// graph.json on every autosave), so a hard cap keeps a single clip from blowing
// the server's body limit or making saves crawl.
export const MAX_VIDEO_BYTES = 25 * 1024 * 1024;
export const VIDEO_TOO_BIG = 'Video is too large. Keep it under 25MB.';

export default function VideoNode({ id, data }) {
  const { updateNodeData } = useReactFlow();
  const [error, setError] = useState('');
  // Draft of the "paste a link" field, only until it is applied.
  const [link, setLink] = useState('');
  // Same per-consumer role reporting as images, read off this node's own type, so
  // "image 1" and "video 1" can coexist on one output.
  const roles = sourceRoles(useNodes(), useEdges(), id);

  function onFile(file) {
    if (!file) return;
    if (file.size > MAX_VIDEO_BYTES) return setError(VIDEO_TOO_BIG);
    setError('');
    const reader = new FileReader();
    reader.onload = () => updateNodeData(id, { dataUrl: reader.result, fileName: file.name });
    reader.readAsDataURL(file);
  }

  // A clip that is already hosted needs no file at all: dataUrl holds the https
  // URL, everything downstream treats it as opaque, and video generation can use
  // it directly — that path takes only public https links. The 25MB cap is a
  // base64-in-the-graph concern, so it does not apply here.
  function onLink() {
    const url = link.trim();
    if (!/^https:\/\/.+/.test(url)) {
      return setError('Paste a full https:// link to a video file.');
    }
    setError('');
    setLink('');
    const name = url.split('/').pop()?.split('?')[0] || 'linked video';
    updateNodeData(id, { dataUrl: url, fileName: name });
  }

  const status = roles.length ? roles.join(' / ') : data.dataUrl ? 'not connected' : undefined;

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
        rightTone={roles.length ? 'accent' : 'secondary'}
      />
      <div className="xnode-body">
        {data.dataUrl ? (
          // Same shape as an image reference: the clip fills the node and remove is
          // an X over its corner, rather than a labelled button in a footer. The
          // file name moves to the title, which is where Thumbnail keeps it too.
          <span className="xnode-media">
            <VideoPlayer src={data.dataUrl} />
            <span className="xnode-media-remove nodrag">
              <Button
                label={`Remove ${data.fileName || 'video'}`}
                isIconOnly
                icon={<Icon icon="close" size="xsm" />}
                size="sm"
                onClick={() => updateNodeData(id, { dataUrl: '', fileName: '' })}
              />
            </span>
          </span>
        ) : (
          <>
            <FileInput
              className="nodrag"
              label="Reference video"
              isLabelHidden
              accept="video/*"
              value={null}
              onChange={onFile}
            />
            <div className="xnode-linkrow nodrag">
              <TextInput
                label="Or paste a video link"
                isLabelHidden
                placeholder="or paste an https:// link"
                value={link}
                onChange={(v) => {
                  setLink(v);
                  setError('');
                }}
              />
              {/^https:\/\/.+/.test(link.trim()) && (
                <Button label="Use link" size="sm" variant="secondary" onClick={onLink} />
              )}
            </div>
            {error && <StatusLine type="error">{error}</StatusLine>}
          </>
        )}
      </div>
    </Card>
  );
}
