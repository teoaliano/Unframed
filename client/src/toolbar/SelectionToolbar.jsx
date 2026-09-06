import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStore } from '@xyflow/react';
import { Button } from '@astryxdesign/core/Button';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Icon } from '@astryxdesign/core/Icon';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { HStack, VStack, StackItem } from '@astryxdesign/core/Stack';
import { Sparkles, ArrowLeft, ExternalLink, Play } from 'lucide-react';
import { place, selectionBox, toScreen } from './placement.js';
import { useCanvasWheel } from './canvasWheel.js';
import { toolbarActions } from './actions.js';
import { contextLabel } from './target.js';

// The floating toolbar over a selection, and the composer it morphs into (design canvas
// "E · States", boards 2, 2a, 3, 3a). One element, two modes: `tools` shows the
// selection's own action and the filled Agent button; `composer` is the same box grown
// upward on the same centre and the same bottom edge -- placement.js keeps that true --
// with one chip saying what the agent will be shown, a field, and Send. Back or Esc
// returns to tools. Design: docs/superpowers/specs/2026-09-06-chats-and-tags-design.md.
//
// The card only STARTS a chat. Send opens the panel on it and the reply lives there, so
// there is no Stop here and no answer here -- there used to be both, in a card anchored
// on the node, and neither survived the subject being two artifacts at once.
//
// The composer's state (`composer`: { selection, artifacts }) is App.jsx's, because two
// canvas gestures change it -- clicking another node adds it, clicking empty canvas
// collapses it -- and those are React Flow callbacks App owns. This component renders it
// and sends it.

const DEFAULT_SIZE = { tools: { width: 220, height: 40 }, composer: { width: 380, height: 180 } };

export default function SelectionToolbar({
  nodes,
  hidden,
  canvasEl,
  composer,
  onOpenComposer,
  onCloseComposer,
  provider,
  providerMessage,
  // The chat this message would continue (a thread summary), or null for a new one, and
  // the toggle between them. Said before you type, because "which conversation did that
  // go into" is not a question anyone should have to answer afterwards.
  continues,
  onToggleContinue,
  onSend,
  onRun,
  onOpenPage,
}) {
  const transform = useStore((s) => s.transform);
  const el = useRef(null);
  const [size, setSize] = useState(null);
  const [text, setText] = useState('');
  const mode = composer ? 'composer' : 'tools';

  const selected = nodes.filter((n) => n.selected);
  const flowBox = selectionBox(nodes);

  // Measure after each render, so the flip and the clamp see the real box.
  useLayoutEffect(() => {
    const r = el.current?.getBoundingClientRect();
    if (r && (r.width !== size?.width || r.height !== size?.height)) setSize({ width: r.width, height: r.height });
  });

  // Esc closes the composer from anywhere in it (the field included).
  useEffect(() => {
    if (!composer) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseComposer();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [composer, onCloseComposer]);

  useEffect(() => {
    if (!composer) setText('');
  }, [composer]);

  // The bar floats over the canvas, so it must not swallow the canvas's own gestures.
  useCanvasWheel(el, canvasEl);

  if (!flowBox || hidden || !canvasEl) return null;

  const viewport = { width: canvasEl.clientWidth, height: canvasEl.clientHeight };
  const box = toScreen(flowBox, transform);
  const at = place({ box, size: size ?? DEFAULT_SIZE[mode], viewport });
  const actions = toolbarActions(selected);

  const canSend = Boolean(provider) && Boolean(text.trim());
  const send = () => {
    if (!canSend) return;
    onSend(text.trim());
    setText('');
  };

  return (
    <div
      ref={el}
      className={`sel-toolbar sel-toolbar--${mode}${at.below ? ' sel-toolbar--below' : ''}`}
      style={{ left: at.x, top: at.y }}
      // Nothing here is a canvas gesture: a click inside must not deselect or start a
      // drag underneath.
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
      role="toolbar"
      aria-label="Selection"
    >
      {mode === 'tools' ? (
        <>
          {actions.primary?.kind === 'run' && (
            <Button
              size="sm"
              variant="secondary"
              label={actions.primary.label}
              icon={<Icon icon={Play} />}
              isDisabled={actions.primary.busy}
              onClick={() => onRun(actions.primary.nodeId)}
            />
          )}
          {actions.primary?.kind === 'run' && actions.primary.hint && (
            <Text type="supporting" color="secondary" className="sel-toolbar-hint">
              {actions.primary.hint}
            </Text>
          )}
          {actions.primary?.kind === 'open' && (
            <Button size="sm" variant="secondary" label="Open" icon={<Icon icon={ExternalLink} />} onClick={() => onOpenPage(actions.primary.nodeId)} />
          )}
          {actions.primary?.kind === 'count' && (
            <Text type="supporting" color="secondary" className="sel-toolbar-hint">
              {actions.primary.label}
            </Text>
          )}
          {actions.primary && <span className="sel-toolbar-sep" />}
          <Button
            size="sm"
            variant="primary"
            label="Agent"
            icon={<Icon icon={Sparkles} />}
            tooltip={provider ? undefined : providerMessage}
            onClick={onOpenComposer}
          />
        </>
      ) : (
        <VStack gap={2} className="sel-composer">
          <HStack gap={1} align="center">
            <IconButton variant="ghost" size="sm" label="Back to tools" tooltip="Back to tools (Esc)" icon={<Icon icon={ArrowLeft} />} onClick={onCloseComposer} />
            <Icon icon={Sparkles} size="sm" />
            <Text type="label">Agent</Text>
          </HStack>
          {/* One chip: what the agent is about to be shown. It used to be a "To" line
              plus a chip per node, which turned a selection into a sentence about a
              target -- and two artifacts into an error the person had to resolve. */}
          <HStack gap={1} align="center" wrap>
            <span className="agent-chip">{contextLabel(composer, nodes)}</span>
          </HStack>
          {/* Which conversation this joins, and the way out of it. */}
          <HStack gap={1} align="center" wrap>
            <Text type="supporting" color="secondary">
              {continues ? (
                <>
                  continues <em>{continues.title?.trim() || continues.preview || 'an earlier chat'}</em>
                </>
              ) : (
                'new chat'
              )}
            </Text>
            {onToggleContinue && (
              <Button size="sm" variant="ghost" label={continues ? 'New chat instead' : 'Continue the earlier chat'} onClick={onToggleContinue} />
            )}
          </HStack>
          {!provider && (
            <Text type="supporting" color="secondary">
              {providerMessage}
            </Text>
          )}
          <div
            onKeyDown={(e) => {
              // Enter sends; Shift+Enter or Option+Enter breaks the line (same as the panel).
              if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.isComposing) {
                e.preventDefault();
                send();
              }
            }}
          >
            <TextArea
              className="nowheel"
              label="Instruction"
              isLabelHidden
              rows={2}
              autoFocus
              value={text}
              placeholder={provider ? 'Ask, or say what should change… (↵ to send)' : 'Connect Claude or Codex to start'}
              isDisabled={!provider}
              onChange={setText}
            />
          </div>
          <HStack gap={2} align="center">
            <Text type="supporting" className="agent-meta">
              {provider ? `${provider.name} · not metered` : ''}
            </Text>
            <StackItem size="fill" />
            <Button label="Send" variant="primary" size="sm" isDisabled={!canSend} onClick={send} />
          </HStack>
        </VStack>
      )}
    </div>
  );
}
