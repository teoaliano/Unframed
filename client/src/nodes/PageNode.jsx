import { useState } from 'react';
import { useReactFlow } from '@xyflow/react';
import { Card } from '@astryxdesign/core/Card';
import { FileInput } from '@astryxdesign/core/FileInput';
import NodeHeader from './NodeHeader.jsx';
import NodeLine from './NodeLine.jsx';
import MediaResize from './MediaResize.jsx';
import StatusLine from './StatusLine.jsx';
import { useProject } from '../graph/project.js';
import { uploadFile, previewUrl } from '../api.js';

// The page asset: an HTML file in the project folder, shown live. The third node family
// ("artifact"): it neither feeds an output nor consumes one, so it has no handles. Design:
// docs/superpowers/specs/2026-09-04-agent-canvas-slice-2-design.md, section 2.
//
// The frame is the safety boundary on this side, and every attribute is deliberate:
//   - the src is the preview ORIGIN (server/preview.js), never /api/file -- a page shown
//     from the API's origin would be Unframed to the browser;
//   - sandbox="allow-scripts allow-same-origin" and nothing else: no popups, no top
//     navigation, no forms, no modals. allow-same-origin keeps the document on the
//     PREVIEW origin rather than an opaque one, and that is required, not a loosening:
//     the preview server answers `Cross-Origin-Resource-Policy: same-origin`, and an
//     opaque-origin page is cross-origin to its own folder, so its pictures would not
//     load (found in the headless probe, 2026-09-05). The wall is that the preview origin
//     is not the API's, and a sandboxed page that is same-origin with itself but not with
//     the canvas cannot lift its own sandbox;
//   - referrerpolicy and an empty allow list, so a page learns nothing about the canvas
//     and gets no device permissions.
// Files are never overwritten: an edit is a new file and a new `data.file`, which is
// what lets Cmd-Z show the previous page (the spec, "files are immutable").
const isHtml = (file) => file && (file.type === 'text/html' || /\.html?$/i.test(file.name || ''));

export default function PageNode({ id, data, dragging, selected }) {
  const { updateNodeData } = useReactFlow();
  const { name: project, previewPort } = useProject();
  const [error, setError] = useState('');
  const src = data.file && previewPort ? previewUrl(previewPort, project, data.file) : '';
  const title = data.title || data.fileName?.replace(/\.html?$/i, '') || '';

  async function onFile(file) {
    if (!isHtml(file)) return;
    setError('');
    try {
      const saved = await uploadFile(project, file);
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

  // A page IS the page it shows, the same way a reference is its picture: once it holds
  // a file the card around it is chrome over the very thing being looked at, so it goes.
  // An EMPTY one keeps its frame and its tab, because an empty one is a box asking for a
  // file, not a page.
  const bare = Boolean(src);

  return (
    <>
      {!bare && <NodeHeader kind="page" family="artifact" />}
      <Card
        width="100%"
        elevation="low"
        padding={0}
        className={`xnode-page${bare ? ' xnode-bare' : ''}`}
        onDrop={onDrop}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        <div className="xnode-body">
          {src ? (
            // Inert until the node is selected, so a click lands on the node (selecting
            // it) rather than inside the page; the same rule keeps a drag from being
            // swallowed by the frame. Keyed by file so a new version is a fresh document.
            <iframe
              key={data.file}
              className={`xnode-frame${selected && !dragging ? ' xnode-frame--live' : ''}`}
              src={src}
              title={title || 'page'}
              sandbox="allow-scripts allow-same-origin"
              referrerPolicy="no-referrer"
              allow=""
              loading="lazy"
            />
          ) : (
            <FileInput
              className="nodrag"
              label="HTML page"
              isLabelHidden
              accept=".html,.htm,text/html"
              value={null}
              onChange={onFile}
            />
          )}
          {error && <StatusLine type="error">{error}</StatusLine>}
        </div>
      </Card>
      {/* `--start`: the one fact takes the corner the tab used to own, as everywhere else. */}
      <NodeLine className="xnode-line--start">{title || null}</NodeLine>
      {/* Both axes are the user's: a page has no ratio to keep. */}
      <MediaResize free />
    </>
  );
}
