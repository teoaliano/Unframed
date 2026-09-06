import { useEffect, useRef, useState } from 'react';
import { useReactFlow } from '@xyflow/react';
import { Card } from '@astryxdesign/core/Card';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { Text } from '@astryxdesign/core/Text';
import { FileInput } from '@astryxdesign/core/FileInput';
import { Clapperboard } from 'lucide-react';
import NodeHeader from './NodeHeader.jsx';
import NodeLine from './NodeLine.jsx';
import MediaResize from './MediaResize.jsx';
import StatusLine from './StatusLine.jsx';
import { freeSpot } from './output/core.js';
import { withDrag } from '../graph/starter.js';
import { useProject } from '../graph/project.js';
import { uploadMotion, motionUrl, startMotionRender, pollMotionRender } from '../api.js';

// The motion asset: a HyperFrames composition in the project folder, played live and
// rendered to an MP4 that joins the canvas as an ordinary video node. Design:
// docs/superpowers/specs/2026-09-06-agent-canvas-slice-4-design.md.
//
// The frame is PageNode's frame with one difference: its src is the VIEWER beside the
// composition (server/motion.js), which mounts HyperFrames' player on the composition
// named in its query -- the player has to be same-origin with the composition to drive it,
// and the canvas must not be. Everything PageNode says about the sandbox holds here
// unchanged; read it there.
//
// Rendering is the one action a page does not have. It is a server job (the composition
// is captured frame by frame in a headless Chrome and encoded by ffmpeg), polled from
// here, and its output is placed in the folder like any generation -- so "Render" ends
// with a video node beside this one that names the file, exactly as a video output's
// "Add to canvas" does. Nothing about the render is paid, and nothing is durable across
// a restart: a render lost to one costs a click.
const isHtml = (file) => file && (file.type === 'text/html' || /\.html?$/i.test(file.name || ''));
const POLL_MS = 700;

export default function MotionNode({ id, data, dragging, selected }) {
  const { updateNodeData, addNodes, getNode, getNodes } = useReactFlow();
  const { name: project, ref: projectRef, previewPort } = useProject();
  const [error, setError] = useState('');
  const [render, setRender] = useState(null); // { id, status, progress, message } | null
  // Set on mount, not only cleared on unmount: React's development double-mount runs
  // the cleanup between the two, and a flag that is only ever cleared stays false --
  // which left every poll loop returning on its first tick (found 2026-09-06).
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const src = data.file && previewPort ? motionUrl(previewPort, project, data.file) : '';
  const title = data.title || data.fileName?.replace(/\.html?$/i, '') || '';

  async function onFile(file) {
    if (!isHtml(file)) return;
    setError('');
    try {
      // Through the motion route, not the plain upload: the runtime tag and the library
      // beside it are what make a brought-in composition play like a written one.
      const saved = await uploadMotion(project, file);
      updateNodeData(id, { file: saved.file, fileName: file.name, title: data.title || file.name.replace(/\.html?$/i, '') });
    } catch (err) {
      setError(err.message);
    }
  }

  function onDrop(e) {
    const file = [...(e.dataTransfer?.files || [])].find(isHtml);
    if (!file) return;
    e.preventDefault();
    e.stopPropagation();
    onFile(file);
  }

  async function renderClip() {
    if (!data.file || render) return;
    setError('');
    const started = project;
    try {
      const { id: renderId } = await startMotionRender(project, data.file, title);
      setRender({ id: renderId, status: 'queued', progress: 0, message: '' });
      for (;;) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        if (!alive.current) return;
        const job = await pollMotionRender(started, renderId);
        setRender({ id: renderId, status: job.status, progress: job.progress, message: job.message });
        if (job.status === 'failed') throw new Error(job.error || 'The render failed.');
        if (job.status === 'done') {
          // Into the project the render started in, not the one now showing.
          if (projectRef.current === started) {
            addNodes(
              withDrag({
                id: `render-${Date.now()}`,
                type: 'video',
                position: freeSpot(getNode, getNodes, id),
                data: { fileName: job.output, file: job.output },
              }),
            );
          }
          break;
        }
      }
    } catch (err) {
      if (alive.current) setError(err.message);
    } finally {
      if (alive.current) setRender(null);
    }
  }

  const rendering = render !== null;

  return (
    <>
      <NodeHeader kind="motion" family="artifact" />
      <Card
        width="100%"
        elevation="low"
        padding={0}
        className="xnode-motion"
        onDrop={onDrop}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        <div className="xnode-body">
          {src ? (
            // Inert until selected, so a click selects the node rather than the player;
            // keyed by file so a new version is a fresh document (PageNode).
            <iframe
              key={data.file}
              className={`xnode-frame${selected && !dragging ? ' xnode-frame--live' : ''}`}
              src={src}
              title={title || 'motion'}
              sandbox="allow-scripts allow-same-origin"
              referrerPolicy="no-referrer"
              allow=""
              loading="lazy"
            />
          ) : (
            <FileInput className="nodrag" label="HyperFrames composition" isLabelHidden accept=".html,.htm,text/html" value={null} onChange={onFile} />
          )}
          {error && <StatusLine type="error">{error}</StatusLine>}
        </div>
      </Card>
      <NodeLine>{title || null}</NodeLine>
      {data.file && (
        <div className="xnode-motion-render nodrag">
          <Button label="Render" variant="secondary" size="sm" icon={<Icon icon={Clapperboard} />} isLoading={rendering} isDisabled={rendering || !data.file} onClick={renderClip} />
          {rendering && (
            <>
              <div className="xnode-motion-progress" aria-hidden="true">
                <span style={{ width: `${render.progress}%` }} />
              </div>
              <Text type="supporting" color="secondary">
                {`${render.progress}%${render.message ? ` · ${render.message}` : ''}`}
              </Text>
            </>
          )}
        </div>
      )}
      {/* Both axes are the user's: the composition keeps its own frame inside. */}
      <MediaResize free />
    </>
  );
}
