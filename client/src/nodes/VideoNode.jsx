import { useState } from 'react';
import { Handle, Position, useReactFlow, useNodes, useEdges } from '@xyflow/react';
import { Card } from '@astryxdesign/core/Card';
import { FileInput } from '@astryxdesign/core/FileInput';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import NodeHeader from './NodeHeader.jsx';
import NodeLine from './NodeLine.jsx';
import MediaResize from './MediaResize.jsx';
import StatusLine from './StatusLine.jsx';
import { useVideoPlayback, VideoFrame, VideoControls } from './VideoPlayer.jsx';
import { sourceRoles, hasMedia } from '../graph/resolve.js';
import { mediaSrc } from './ImageNode.jsx';
import { useProject } from '../graph/project.js';
import { uploadFile } from '../api.js';

// A local clip is inlined to base64 at the OpenRouter boundary (server/media.js) and
// shared over the tunnel for video-to-video, so the cap is what keeps one clip from
// blowing a request body or a share. Bytes no longer ride in the graph (media left the
// document), so the cap is no longer about saves.
export const MAX_VIDEO_BYTES = 25 * 1024 * 1024;
export const VIDEO_TOO_BIG = 'Video is too large. Keep it under 25MB.';

export default function VideoNode({ id, data }) {
  const { updateNodeData } = useReactFlow();
  const { name: project } = useProject();
  const [error, setError] = useState('');
  const src = mediaSrc(data, project);
  // Draft of the "paste a link" field, only until it is applied.
  const [link, setLink] = useState('');
  // Same per-consumer role reporting as images, read off this node's own type, so
  // "image 1" and "video 1" can coexist on one output.
  const roles = sourceRoles(useNodes(), useEdges(), id);
  // One playback state, two placements: the clip inside the card, the transport below
  // it — see VideoPlayer.jsx.
  const player = useVideoPlayback();

  // The bytes go to the project folder and the node keeps the file's name -- see
  // ImageNode.onFile.
  async function onFile(file) {
    if (!file) return;
    if (file.size > MAX_VIDEO_BYTES) return setError(VIDEO_TOO_BIG);
    setError('');
    try {
      const saved = await uploadFile(project, file);
      updateNodeData(id, { file: saved.file, fileName: saved.fileName || file.name, dataUrl: undefined });
    } catch (err) {
      setError(err.message);
    }
  }

  // A clip that is already hosted needs no file at all: dataUrl holds the https
  // URL, everything downstream treats it as opaque, and video generation can use
  // it directly — that path takes only public https links. The 25MB cap is a
  // local-bytes concern, so it does not apply here.
  function onLink() {
    const url = link.trim();
    if (!/^https:\/\/.+/.test(url)) {
      return setError('Paste a full https:// link to a video file.');
    }
    setError('');
    setLink('');
    const name = url.split('/').pop()?.split('?')[0] || 'linked video';
    updateNodeData(id, { dataUrl: url, file: undefined, fileName: name });
  }

  // sourceRoles answers with bare ranks ("1", "1 / 2") for reference mode and with
  // words ("first", "last") for a frame mode. A rank alone said nothing once it left
  // the header that used to sit beside it, so the medium is spelled out — but only for
  // the numeric case, since "video first frame" would be worse than "first frame". The
  // wording lives here rather than in resolve.js so that pure module keeps answering
  // the graph question and the node owns how it reads.
  const numeric = roles.every((r) => /^[\d—]+$/.test(r));
  const role = roles.length
    ? numeric
      ? `video ${roles.join(' / ')}`
      : roles.map((r) => (r === 'first' || r === 'last' ? `${r} frame` : r)).join(' / ')
    : hasMedia({ data })
      ? 'not connected'
      : null;

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
    <>
      <NodeHeader kind="video" family="input" />
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
            // Same shape as an image reference: the clip fills the node and remove is
            // an X over its corner. The file name is on the Thumbnail's alt, and the
            // transport is OUTSIDE the card entirely — see below.
            <span className="xnode-media">
              <VideoFrame player={player} src={src} />
              <span className="xnode-media-remove nodrag">
                <Button
                  label={`Remove ${data.fileName || 'video'}`}
                  isIconOnly
                  icon={<Icon icon="close" size="xsm" />}
                  size="sm"
                  onClick={() => updateNodeData(id, { file: undefined, dataUrl: undefined, fileName: '' })}
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
      {/* The transport lives out here, between the card and the role line. It cannot go
          ON the clip: VideoPlayer.jsx already moved its controls out of the <video> for
          exactly this reason — a press on a scrubber retargets to the video element and
          nothing downstream can tell a scrub from a node drag. Inside the card it ate
          10px of frame on every side and made the clip stop short of the node's edge. */}
      <NodeLine live={roles.length > 0}>{role}</NodeLine>
      {/* The transport is the one thing that still has to go BELOW: it is a control, so
          it cannot sit on the clip (a press there is indistinguishable from a node drag
          — see VideoPlayer.jsx), and it is far too wide for the name row. */}
      {src && (
        <div className="xnode-under">
          <VideoControls player={player} />
        </div>
      )}
      {/* Resizable from any edge once it holds something — nodes/MediaResize.jsx owns
          why that includes the right one, where the handle also lives. */}
      {src && <MediaResize />}
    </>
  );
}
