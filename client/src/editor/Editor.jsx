import { useEffect } from 'react';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Icon } from '@astryxdesign/core/Icon';
import { Text } from '@astryxdesign/core/Text';
import { HStack, StackItem } from '@astryxdesign/core/Stack';
import { ArrowLeft, ExternalLink, SlidersHorizontal } from 'lucide-react';
import AgentPanel from '../agent/AgentPanel.jsx';
import { artifactUrl } from '../api.js';
import { NODE_ICONS } from '../nodes/nodeIcons.jsx';

// The editor: one artifact, full window, three columns -- the chats about it, the artifact
// itself, its parameters. Design: docs/superpowers/specs/2026-09-06-chats-and-tags-design.md,
// decision 8.
//
// It REPLACES the canvas rather than covering it (App.jsx renders one or the other): a
// canvas underneath would keep every node's frame and every clip alive for nothing, and
// the document does not care -- the server owns it, the tab only holds a replica, and
// the viewport is put back on the way out. The frame here is the same one the node
// shows, same origin, same sandbox (PageNode says why each attribute is there), just
// given the room it deserves and live from the start.
export default function Editor({ node, project, previewPort, onClose, onOpenExternal, agent }) {
  // Escape goes back to the canvas, unless it is typed into a field -- the composer and
  // the rename box own their own Escape.
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const el = e.target;
      if (el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const title = node.data?.title || node.data?.fileName?.replace(/\.html?$/i, '') || node.id;
  const src = node.data?.file && previewPort ? artifactUrl(previewPort, project, node) : '';
  const KindIcon = NODE_ICONS[node.type];

  return (
    <div className="editor" role="region" aria-label={`Editing ${title}`}>
      <aside className="editor-col">
        <AgentPanel {...agent} embedded />
      </aside>
      <section className="editor-stage">
        <header className="editor-head">
          <HStack gap={2} align="center">
            <IconButton variant="ghost" size="sm" label="Back to canvas" tooltip="Back to canvas (Esc)" icon={<Icon icon={ArrowLeft} />} onClick={onClose} />
            {KindIcon && <Icon icon={KindIcon} size="sm" />}
            <Text type="label">{title}</Text>
            <Text type="supporting" color="secondary">
              {node.type}
            </Text>
            <StackItem size="fill" />
            {src && <IconButton variant="ghost" size="sm" label="Open in a new tab" tooltip="Open in a new tab" icon={<Icon icon={ExternalLink} />} onClick={() => onOpenExternal(node.id)} />}
          </HStack>
        </header>
        <div className="editor-frame-wrap">
          {src ? (
            <iframe key={node.data.file} className="editor-frame" src={src} title={title} sandbox="allow-scripts allow-same-origin" referrerPolicy="no-referrer" allow="" />
          ) : (
            <Text type="supporting" color="secondary" className="editor-hint">
              This {node.type} has no file yet — ask the agent to write one.
            </Text>
          )}
        </div>
      </section>
      <aside className="editor-col">
        <div className="editor-col-head">
          <HStack gap={2} align="center">
            <Icon icon={SlidersHorizontal} size="sm" />
            <Text type="label">Parameters</Text>
          </HStack>
        </div>
        <Text type="supporting" color="secondary" className="editor-hint">
          No parameters yet. Ask the agent to expose some — "expose the accent colour and the intro speed as parameters".
        </Text>
      </aside>
    </div>
  );
}
