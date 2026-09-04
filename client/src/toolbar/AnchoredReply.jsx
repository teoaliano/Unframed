import { useLayoutEffect, useRef, useState } from 'react';
import { useStore } from '@xyflow/react';
import { Button } from '@astryxdesign/core/Button';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Icon } from '@astryxdesign/core/Icon';
import { Text } from '@astryxdesign/core/Text';
import { HStack, StackItem } from '@astryxdesign/core/Stack';
import { X, Undo2, MessageSquare, ExternalLink } from 'lucide-react';
import { place, selectionBox, toScreen } from './placement.js';

// The agent's reply, anchored below the node it worked on (design canvas board 4): the
// text, Undo, Open thread, and the artifact's own action. It stays until dismissed,
// until the next message, or until a different selection is made -- not on a timer, so a
// reply you have not looked at yet is still there when you do.
//
// Undo is offered only while the agent's batch is the newest undoable entry (App.jsx asks
// the server), because undo is one server-side ladder: once you have edited after it,
// the button goes and the card points at Cmd-Z instead.
export default function AnchoredReply({ reply, nodes, canvasEl, onDismiss, onUndo, onOpenThread, onOpenPage }) {
  const transform = useStore((s) => s.transform);
  const el = useRef(null);
  const [size, setSize] = useState({ width: 360, height: 120 });
  useLayoutEffect(() => {
    const r = el.current?.getBoundingClientRect();
    if (r && (r.width !== size.width || r.height !== size.height)) setSize({ width: r.width, height: r.height });
  });
  if (!reply || !canvasEl) return null;

  // Below the node it worked on; below the selection it came from when there is none.
  const anchorNode = reply.nodeId ? nodes.find((n) => n.id === reply.nodeId) : null;
  const anchorNodes = anchorNode ? [{ ...anchorNode, selected: true }] : nodes.filter((n) => reply.selection?.includes(n.id)).map((n) => ({ ...n, selected: true }));
  const flowBox = selectionBox(anchorNodes);
  if (!flowBox) return null;
  const box = toScreen(flowBox, transform);
  const viewport = { width: canvasEl.clientWidth, height: canvasEl.clientHeight };
  // Ask for "below" by handing place() a box whose top is unreachable: the card wants
  // the bottom edge, the toolbar wants the top.
  const at = place({ box: { ...box, y: box.y + box.height, height: 0 }, size, viewport, gap: 12 });
  const y = at.below ? at.y : box.y + box.height + 12;
  const page = anchorNode?.type === 'page' && anchorNode.data?.file ? anchorNode : null;

  return (
    <div
      ref={el}
      className={`sel-reply${reply.status === 'running' ? ' sel-reply--running' : ''}${reply.status === 'failed' ? ' sel-reply--failed' : ''}`}
      style={{ left: at.x, top: y }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      role="status"
    >
      <HStack gap={2} align="center">
        <Text type="supporting" className="agent-meta">
          {reply.status === 'running' ? (reply.activity || 'Working…') : reply.summary || (reply.status === 'failed' ? 'The agent stopped' : 'Reply')}
        </Text>
        <StackItem size="fill" />
        <IconButton variant="ghost" size="sm" label="Dismiss" icon={<Icon icon={X} />} onClick={onDismiss} />
      </HStack>
      {reply.text && <div className="sel-reply-text">{reply.text}</div>}
      {reply.status !== 'running' && (
        <HStack gap={2} align="center" wrap>
          {reply.version != null && reply.canUndo && !reply.undone && (
            <Button size="sm" variant="secondary" label="Undo" icon={<Icon icon={Undo2} />} onClick={onUndo} />
          )}
          {reply.version != null && !reply.canUndo && !reply.undone && (
            <Text type="supporting" color="secondary">
              Edited since — use ⌘Z to step back
            </Text>
          )}
          {reply.undone && (
            <Text type="supporting" color="secondary">
              Undone
            </Text>
          )}
          <StackItem size="fill" />
          {page && <Button size="sm" variant="ghost" label="Open" icon={<Icon icon={ExternalLink} />} onClick={() => onOpenPage(page.id)} />}
          <Button size="sm" variant="ghost" label="Open thread" icon={<Icon icon={MessageSquare} />} onClick={() => onOpenThread(reply.threadId)} />
        </HStack>
      )}
    </div>
  );
}
