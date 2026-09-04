import { useEffect, useRef, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Icon } from '@astryxdesign/core/Icon';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { Link } from '@astryxdesign/core/Link';
import { HStack, VStack, StackItem } from '@astryxdesign/core/Stack';
import { X, Plus, RefreshCw, Sparkles, Square } from 'lucide-react';
import {
  createThread,
  listThreads,
  getThread,
  sendThreadMessage,
  interruptThread,
  subscribeThreadEvents,
} from '../api.js';

// The agent panel, slice 1: a right-hand panel with the project's Canvas thread. The
// design's states 1, 8 and 10 (docs/superpowers/specs/2026-09-04-agent-canvas-slice-1-design.md):
// an Agent button opens it; the conversation streams from the thread's event stream
// (server/agent.js); when no local agent is ready the panel says what was checked and
// how to fix it, and Send is disabled. Tabs, the focus ring and select-while-open are
// slice 3; the toolbar and composer are slice 2.
//
// Everything durable is the server's: the record is the transcript, this component only
// mirrors it. Closing the panel mid-turn changes nothing -- the turn finishes on the
// server and the transcript is there when the panel reopens.

const PROVIDER_ORDER = ['claude', 'codex'];

export default function AgentPanel({ project, selection, providers, onCheckProviders, checking, onClose }) {
  const [threads, setThreads] = useState([]);
  const [threadId, setThreadId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);
  const [draft, setDraft] = useState(''); // the assistant's answer as it streams
  const [activity, setActivity] = useState(null); // "Reading the canvas…" while a tool runs
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const scroller = useRef(null);

  const ready = PROVIDER_ORDER.map((k) => providers?.[k]).filter((p) => p?.status === 'ready');
  const provider = ready[0] ?? null;

  // The project's threads, newest first; the newest is opened. No thread yet is fine:
  // the first message creates one.
  useEffect(() => {
    let alive = true;
    setThreadId(null);
    setMessages([]);
    setDraft('');
    setError(null);
    listThreads(project).then((list) => {
      if (!alive) return;
      setThreads(list);
      if (list[0]) setThreadId(list[0].id);
    });
    return () => {
      alive = false;
    };
  }, [project]);

  // One stream per open thread. `state` seeds the transcript; events after it are
  // applied as they come, so a panel opened mid-turn picks the turn up where it is.
  useEffect(() => {
    if (!threadId) return undefined;
    let draftText = '';
    const close = subscribeThreadEvents(project, threadId, 0, {
      onState: (s) => {
        setMessages(s.messages ?? []);
        setStatus(s.status ?? 'idle');
        setError(s.error ?? null);
        draftText = '';
        setDraft('');
        setActivity(null);
      },
      onEvent: (e) => {
        switch (e.type) {
          case 'turn':
            setStatus('running');
            setError(null);
            break;
          case 'text_delta':
            draftText += e.text;
            setDraft(draftText);
            setActivity(null);
            break;
          case 'tool_use':
            setActivity('Reading the canvas…');
            break;
          case 'tool_result':
            setActivity(null);
            break;
          case 'result':
            // The record already has the assistant message; re-read it so the panel shows
            // exactly what was stored rather than what it pieced together from deltas.
            getThread(project, threadId)
              .then((t) => {
                setMessages(t.messages);
                setStatus(t.status);
                setError(t.error ?? null);
              })
              .catch(() => {});
            draftText = '';
            setDraft('');
            setActivity(null);
            break;
          case 'error':
            setStatus('failed');
            setError(e.message);
            draftText = '';
            setDraft('');
            setActivity(null);
            break;
          default:
            break;
        }
      },
    });
    return close;
  }, [project, threadId]);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, draft, activity]);

  async function send() {
    const body = text.trim();
    if (!body || !provider || sending || status === 'running') return;
    setSending(true);
    setError(null);
    try {
      let id = threadId;
      if (!id) {
        const t = await createThread(project, { provider: provider.kind });
        setThreads((ts) => [{ id: t.id, title: '', updatedAt: t.updatedAt }, ...ts]);
        setThreadId(t.id);
        id = t.id;
      }
      // Optimistic: the user message shows at once; the stream's `turn` event confirms.
      setMessages((ms) => [...ms, { role: 'user', text: body, at: Date.now(), selection }]);
      setText('');
      await sendThreadMessage(project, id, { text: body, selection });
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  async function newThread() {
    if (!provider) return;
    try {
      const t = await createThread(project, { provider: provider.kind });
      setThreads((ts) => [{ id: t.id, title: '', updatedAt: t.updatedAt }, ...ts]);
      setThreadId(t.id);
    } catch (err) {
      setError(err.message);
    }
  }

  const scope = selection.length ? `${selection.length} selected` : 'whole canvas';
  const running = status === 'running';

  return (
    <aside className="agent-panel" aria-label="Agent">
      <div className="agent-panel-head">
        <HStack gap={2} align="center">
          <Icon icon={Sparkles} size="sm" />
          <Text type="label">Agent</Text>
          <span className="agent-chip">Canvas</span>
          <StackItem size="fill" />
          <IconButton variant="ghost" size="sm" label="New thread" tooltip="New thread" icon={<Icon icon={Plus} />} onClick={newThread} isDisabled={!provider} />
          <IconButton variant="ghost" size="sm" label="Close" icon={<Icon icon={X} />} onClick={onClose} />
        </HStack>
      </div>

      <div className="agent-panel-thread" ref={scroller}>
        {!provider && (
          <div className="agent-empty">
            <VStack gap={2}>
              <Text weight="medium">No Claude or Codex found on this Mac.</Text>
              <Text type="supporting">
                Install one and sign in, and the agent runs on your plan. Nothing is sent anywhere until then.
              </Text>
              <VStack gap={1}>
                {PROVIDER_ORDER.map((k) => {
                  const p = providers?.[k];
                  return (
                    <HStack key={k} gap={2} align="center" wrap>
                      <Text type="supporting">
                        <strong>{p?.name ?? k}</strong>
                        {p ? ` — ${p.message || p.status}` : checking ? ' — checking…' : ' — not checked yet'}
                      </Text>
                      {p?.install && p.status === 'not_installed' && (
                        <Link href={p.install} target="_blank" rel="noreferrer">
                          How to install
                        </Link>
                      )}
                    </HStack>
                  );
                })}
              </VStack>
              <HStack gap={2}>
                <Button label="Check again" variant="secondary" size="sm" icon={<Icon icon={RefreshCw} />} isLoading={checking} onClick={onCheckProviders} />
              </HStack>
            </VStack>
          </div>
        )}
        {provider && messages.length === 0 && !draft && (
          <div className="agent-empty">
            <Text type="supporting">
              Ask about the board — what is on it, what feeds what, what a prompt says. The agent reads the canvas through one tool and cannot change it yet.
            </Text>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={`${m.at}-${i}`} className={`agent-msg agent-msg-${m.role}`}>
            <Text type="supporting" className="agent-msg-role">
              {m.role === 'user' ? 'You' : provider?.name ?? 'Agent'}
              {m.role === 'user' && m.selection?.length ? ` · ${m.selection.length} selected` : ''}
            </Text>
            <div className="agent-msg-text">{m.text}</div>
          </div>
        ))}
        {draft && (
          <div className="agent-msg agent-msg-assistant">
            <Text type="supporting" className="agent-msg-role">
              {provider?.name ?? 'Agent'}
            </Text>
            <div className="agent-msg-text">{draft}</div>
          </div>
        )}
        {activity && (
          <Text type="supporting" className="agent-activity">
            {activity}
          </Text>
        )}
        {running && !draft && !activity && (
          <Text type="supporting" className="agent-activity">
            Thinking…
          </Text>
        )}
        {error && <div className="agent-error">{error}</div>}
      </div>

      <div className="agent-panel-composer">
        <HStack gap={1} align="center" wrap>
          <Text type="supporting" className="agent-meta">
            Scope
          </Text>
          <span className="agent-chip">{scope}</span>
          {provider && (
            <span className="agent-chip">
              <span className="agent-dot" />
              {provider.name}
              {provider.auth?.plan ? ` · ${provider.auth.plan}` : ''}
            </span>
          )}
        </HStack>
        <TextArea
          className="nowheel"
          label="Message"
          isLabelHidden
          rows={3}
          value={text}
          placeholder={provider ? 'Ask about the board…' : 'Connect Claude or Codex to start'}
          isDisabled={!provider}
          onChange={setText}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              send();
            }
          }}
        />
        <HStack gap={2} align="center">
          <Text type="supporting" className="agent-meta">
            {provider ? 'Subscription · not metered' : ''}
          </Text>
          <StackItem size="fill" />
          {running ? (
            <Button label="Stop" variant="secondary" size="sm" icon={<Icon icon={Square} />} onClick={() => interruptThread(project, threadId)} />
          ) : (
            <Button label="Send" variant="primary" size="sm" isDisabled={!provider || !text.trim() || sending} isLoading={sending} onClick={send} />
          )}
        </HStack>
      </div>
    </aside>
  );
}
