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
import { isArtifact } from '../graph/resolve.js';
import { visibleThreads, nextActive, tabLabel } from './tabs.js';

// The agent panel: a right-hand panel over the project's threads, one tab each. The
// design's states 1, 8 and 10 (docs/superpowers/specs/2026-09-04-agent-canvas-slice-1-design.md)
// and the tab strip of the slice-3 design (2026-09-05-agent-canvas-slice-3-design.md,
// section 1): the selection filters which tabs show (tabs.js), the active tab is always
// one of them, and the composer sends to the active tab -- creating a thread when none is
// visible, bound to the one selected artifact if there is one. The active thread's
// artifact is reported up through `onFocus` so App.jsx can ring it on the canvas.
//
// Everything durable is the server's: the record is the transcript, this component only
// mirrors it. Closing the panel mid-turn changes nothing -- the turn finishes on the
// server and the transcript is there when the panel reopens.

const PROVIDER_ORDER = ['claude', 'codex'];

// What the panel says while each tool runs.
const ACTIVITY = {
  mcp__unframed__canvas_read: 'Reading the canvas…',
  mcp__unframed__canvas_write: 'Changing the canvas…',
  mcp__unframed__page_write: 'Writing the page…',
  mcp__unframed__page_read: 'Reading the page…',
};

// `initialThreadId` opens the panel on a particular thread -- the anchored reply's
// "Open thread". `refreshKey` changes when something outside the panel (the toolbar's
// composer) created a thread, so the strip re-reads the list. `onFocus` receives the
// active thread's artifact id, or null.
export default function AgentPanel({ project, nodes, providers, onCheckProviders, checking, onClose, initialThreadId = null, refreshKey = 0, onFocus }) {
  const selection = nodes.filter((n) => n.selected).map((n) => n.id);
  const [threads, setThreads] = useState([]);
  const [chosenId, setChosenId] = useState(null);
  // The strip and the active tab, from the selection (tabs.js). `chosenId` is what was
  // last active; `threadId` is what is active now, which differs only when the
  // re-filter hid the chosen one.
  const visible = visibleThreads(threads, selection, nodes);
  const threadId = nextActive(chosenId, visible);
  const thread = threads.find((t) => t.id === threadId) ?? null;
  useEffect(() => {
    if (threadId !== chosenId) setChosenId(threadId);
  }, [threadId, chosenId]);
  useEffect(() => {
    onFocus?.(thread?.kind === 'artifact' ? thread.artifactId ?? null : null);
  }, [thread?.id, thread?.kind, thread?.artifactId, onFocus]);
  useEffect(() => () => onFocus?.(null), [onFocus]);
  const [messages, setMessages] = useState([]);
  const [notes, setNotes] = useState([]); // the agent's changes, from stored and live ops_applied events
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);
  const [draft, setDraft] = useState(''); // the assistant's answer as it streams
  const [activity, setActivity] = useState(null); // "Reading the canvas…" while a tool runs
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const scroller = useRef(null);

  const ready = PROVIDER_ORDER.map((k) => providers?.[k]).filter((p) => p?.status === 'ready');
  const provider = ready[0] ?? null;

  // The project's threads, newest first. Which one is active is the strip's business
  // above; `initialThreadId` (the anchored reply's "Open thread") is honoured when it is
  // among them. No thread yet is fine: the first message creates one.
  useEffect(() => {
    let alive = true;
    listThreads(project).then((list) => {
      if (!alive) return;
      setThreads(list);
      if (initialThreadId && list.some((t) => t.id === initialThreadId)) setChosenId(initialThreadId);
    });
    return () => {
      alive = false;
    };
  }, [project, initialThreadId, refreshKey]);

  // One stream per open thread. `state` seeds the transcript; events after it are
  // applied as they come, so a panel opened mid-turn picks the turn up where it is.
  useEffect(() => {
    if (!threadId) {
      setMessages([]);
      setNotes([]);
      setStatus('idle');
      setError(null);
      setDraft('');
      setActivity(null);
      return undefined;
    }
    let draftText = '';
    // The tab's dot and the strip's order follow the record, so its summary is re-read
    // when this thread's status changes.
    const refresh = () =>
      listThreads(project)
        .then((list) => setThreads(list))
        .catch(() => {});
    const close = subscribeThreadEvents(project, threadId, 0, {
      onState: (s) => {
        setMessages(s.messages ?? []);
        setNotes([]);
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
            setThreads((ts) => ts.map((t) => (t.id === threadId ? { ...t, status: 'running' } : t)));
            break;
          case 'text_delta':
            draftText += e.text;
            setDraft(draftText);
            setActivity(null);
            break;
          case 'tool_use':
            setActivity(ACTIVITY[e.name] || 'Working…');
            break;
          case 'ops_applied':
            // A change the agent made, as a line in the transcript. The stream replays
            // stored events before going live, so a reopened panel gets these too;
            // keyed by journal version so a reconnect cannot double one.
            setNotes((ns) => (ns.some((x) => x.version === e.version) ? ns : [...ns, { version: e.version, text: e.summary, at: e.at }]));
            // The agent's first page_write binds an unbound artifact thread to the node
            // it made; the strip learns that here rather than on the next list read.
            if (e.page?.created) setThreads((ts) => ts.map((t) => (t.id === threadId && !t.artifactId ? { ...t, artifactId: e.page.nodeId } : t)));
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
            refresh();
            break;
          case 'error':
            setStatus('failed');
            setError(e.message);
            draftText = '';
            setDraft('');
            setActivity(null);
            refresh();
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

  // What a new thread would be about, when none is active: the one selected artifact,
  // or the board. With several artifacts selected and no thread among them there is no
  // answer, and Send says so instead of guessing.
  const selectedArtifacts = nodes.filter((n) => n.selected && isArtifact(n));
  const newKind = selectedArtifacts.length === 1 ? { kind: 'artifact', artifactId: selectedArtifacts[0].id } : selectedArtifacts.length === 0 ? { kind: 'canvas' } : null;

  async function startThread() {
    const t = await createThread(project, { provider: provider.kind, ...newKind });
    setThreads((ts) => [{ ...t, title: '' }, ...ts]);
    setChosenId(t.id);
    return t;
  }

  async function send() {
    const body = text.trim();
    if (!body || !provider || sending || status === 'running') return;
    if (!thread && !newKind) return;
    setSending(true);
    setError(null);
    try {
      const t = thread ?? (await startThread());
      // The thread's artifact is fixed; the selection is this message's "with" (minus the
      // artifact itself, which is what the message is about).
      const about = t.kind === 'artifact' && t.artifactId ? { target: t.artifactId, with: selection.filter((id) => id !== t.artifactId) } : {};
      // Optimistic: the user message shows at once; the stream's `turn` event confirms.
      setMessages((ms) => [...ms, { role: 'user', text: body, at: Date.now(), selection, ...about }]);
      setText('');
      await sendThreadMessage(project, t.id, { text: body, selection, ...about });
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  async function newThread() {
    if (!provider || !newKind) return;
    try {
      await startThread();
    } catch (err) {
      setError(err.message);
    }
  }

  const scope = selection.length ? `${selection.length} selected` : 'whole canvas';
  const running = status === 'running';
  // The transcript: messages and the agent's change notes, in time order.
  const lines = [...messages, ...notes.map((n) => ({ role: 'note', text: n.text, at: n.at }))].sort((a, b) => (a.at ?? 0) - (b.at ?? 0));

  return (
    <aside className="agent-panel" aria-label="Agent">
      <div className="agent-panel-head">
        <HStack gap={2} align="center">
          <Icon icon={Sparkles} size="sm" />
          <Text type="label">Agent</Text>
          <StackItem size="fill" />
          <IconButton
            variant="ghost"
            size="sm"
            label="New thread"
            tooltip={newKind ? (newKind.kind === 'artifact' ? 'New thread about the selected artifact' : 'New thread about the board') : 'Select one artifact, or none, to start a thread'}
            icon={<Icon icon={Plus} />}
            onClick={newThread}
            isDisabled={!provider || !newKind}
          />
          <IconButton variant="ghost" size="sm" label="Close" icon={<Icon icon={X} />} onClick={onClose} />
        </HStack>
        {/* The strip: one tab per visible thread (tabs.js decides which). Empty when the
            selection names artifacts nobody has talked about yet. */}
        <div className="agent-tabs" role="tablist" aria-label="Threads">
          {visible.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={t.id === threadId}
              className={`agent-tab${t.id === threadId ? ' agent-tab--active' : ''}${t.kind === 'artifact' ? ' agent-tab--artifact' : ''}`}
              onClick={() => setChosenId(t.id)}
              title={t.title || undefined}
            >
              {t.status === 'running' && <span className="agent-dot agent-dot--live" />}
              {tabLabel(t, nodes)}
            </button>
          ))}
          {visible.length === 0 && (
            <Text type="supporting" color="secondary" className="agent-tabs-empty">
              {selectedArtifacts.length > 1 ? 'No thread yet about these' : selectedArtifacts.length === 1 ? 'No thread yet about this artifact — your first message starts one' : 'No threads yet'}
            </Text>
          )}
        </div>
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
        {provider && lines.length === 0 && !draft && (
          <div className="agent-empty">
            <Text type="supporting">
              {thread?.kind === 'artifact' || newKind?.kind === 'artifact'
                ? 'Tell the agent what to change on this artifact. Whatever else is selected when you send comes with the message.'
                : 'Ask about the board — what is on it, what feeds what, what a prompt says — or tell the agent what to change or make. Select an artifact to talk about it alone.'}
            </Text>
          </div>
        )}
        {lines.map((m, i) =>
          m.role === 'note' ? (
            <Text key={`${m.at}-${i}`} type="supporting" className="agent-note">
              {m.text}
            </Text>
          ) : (
            <div key={`${m.at}-${i}`} className={`agent-msg agent-msg-${m.role}`}>
              <Text type="supporting" className="agent-msg-role">
                {m.role === 'user' ? 'You' : provider?.name ?? 'Agent'}
                {m.role === 'user' && m.target ? (m.target === 'new' ? ' · to a new asset' : ` · to ${m.target}`) : ''}
                {m.role === 'user' && m.selection?.length ? ` · ${m.selection.length} selected` : ''}
              </Text>
              <div className="agent-msg-text">{m.text}</div>
            </div>
          ),
        )}
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
        {/* Cmd/Ctrl+Enter sends. Caught on a wrapper, since keydown bubbles and the
            TextArea component does not promise to forward it. */}
        <div
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              send();
            }
          }}
        >
          <TextArea
            className="nowheel"
            label="Message"
            isLabelHidden
            rows={3}
            value={text}
            placeholder={
              !provider
                ? 'Connect Claude or Codex to start'
                : !thread && !newKind
                  ? 'Several artifacts are selected — select one to start a thread about it'
                  : thread?.kind === 'artifact' || newKind?.kind === 'artifact'
                    ? 'What should change? (⌘↵ to send)'
                    : 'Ask about the board… (⌘↵ to send)'
            }
            isDisabled={!provider || (!thread && !newKind)}
            onChange={setText}
          />
        </div>
        <HStack gap={2} align="center">
          <Text type="supporting" className="agent-meta">
            {provider ? 'Subscription · not metered' : ''}
          </Text>
          <StackItem size="fill" />
          {running ? (
            <Button label="Stop" variant="secondary" size="sm" icon={<Icon icon={Square} />} onClick={() => interruptThread(project, threadId)} />
          ) : (
            <Button label="Send" variant="primary" size="sm" isDisabled={!provider || !text.trim() || sending || (!thread && !newKind)} isLoading={sending} onClick={send} />
          )}
        </HStack>
      </div>
    </aside>
  );
}
