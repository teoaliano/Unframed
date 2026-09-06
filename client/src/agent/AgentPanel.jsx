import { useEffect, useRef, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Icon } from '@astryxdesign/core/Icon';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { Link } from '@astryxdesign/core/Link';
import { HStack, VStack, StackItem } from '@astryxdesign/core/Stack';
import { TabList, Tab, TabMenu } from '@astryxdesign/core/TabList';
import { ModelPicker, EffortPicker } from './ModelPicker.jsx';
import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { X, Plus, RefreshCw, Sparkles, Square, Trash2, Crosshair } from 'lucide-react';
import {
  createThread,
  listThreads,
  getThread,
  sendThreadMessage,
  interruptThread,
  updateThread,
  deleteThread,
  subscribeThreadEvents,
} from '../api.js';
import { isArtifact } from '../graph/resolve.js';
import { visibleThreads, nextActive, tabLabel, artifactLabel } from './tabs.js';

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

// How many threads get a tab of their own before the rest go behind the strip's overflow
// menu. Three is what fits the 380px panel without the tabs shrinking; Astryx's own
// advice is 6-8, which is for a page header, not a side panel. The active thread does
// not have to be among them -- TabMenu shows the selected option's label as its trigger,
// so an older thread you switch to reads on the strip either way.
const INLINE_TABS = 3;

// What the panel says while each tool runs.
const ACTIVITY = {
  mcp__unframed__canvas_read: 'Reading the canvas…',
  mcp__unframed__canvas_write: 'Changing the canvas…',
  mcp__unframed__page_write: 'Writing the page…',
  mcp__unframed__page_read: 'Reading the page…',
  mcp__unframed__motion_write: 'Writing the motion…',
  mcp__unframed__motion_read: 'Reading the motion…',
};

// `initialThreadId` opens the panel on a particular thread -- the anchored reply's
// "Open thread". `refreshKey` changes when something outside the panel (the toolbar's
// composer) created a thread, so the strip re-reads the list. `onFocus` receives the
// active thread's artifact id, or null.
// `onLocate(nodeId)` pans and zooms the canvas to a node -- the Locate action beside the
// artifact's name in the scope row.
// `embedded` is the editor's column (editor/Editor.jsx): the panel is the page's left
// third rather than a card floating over the canvas, so it has no Close of its own (the
// editor's Back is the way out) and no Locate (there is no canvas to pan).
export default function AgentPanel({ project, nodes, providers, onCheckProviders, checking, onClose, initialThreadId = null, refreshKey = 0, onFocus, onLocate, embedded = false }) {
  const selection = nodes.filter((n) => n.selected).map((n) => n.id);
  const [threads, setThreads] = useState([]);
  const [chosenId, setChosenId] = useState(null);
  // The strip and the active tab, from the selection (tabs.js). `chosenId` is what was
  // last active; `threadId` is what is active now, which differs only when the
  // re-filter hid the chosen one.
  const visible = visibleThreads(threads, selection, nodes);
  const threadId = nextActive(chosenId, visible);
  const inlineTabs = visible.slice(0, INLINE_TABS);
  const menuTabs = visible.slice(INLINE_TABS);
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
  const [confirmDelete, setConfirmDelete] = useState(false);
  // The tab being renamed, and the draft in its box. Double-click starts it; there is no
  // rename for a thread sitting in the overflow menu, which has nothing to double-click.
  const [renaming, setRenaming] = useState(null); // { id, draft } | null
  // Model and effort for a thread that does not exist yet; a thread carries its own.
  const [pending, setPending] = useState({ model: '', effort: '' });
  const scroller = useRef(null);

  const ready = PROVIDER_ORDER.map((k) => providers?.[k]).filter((p) => p?.status === 'ready');
  const provider = ready[0] ?? null;
  // What the provider's account can run (providers.js probe); '' is the provider default.
  const models = provider?.models ?? [];
  const settings = thread ? { model: thread.model || '', effort: thread.effort || '' } : pending;
  // The SDK lists the provider's default under the id 'default', so '' looks it up there.
  const efforts = models.find((m) => m.id === (settings.model || 'default'))?.efforts ?? [];
  const codex = providers?.codex ?? null;

  async function changeSettings(patch) {
    if (!thread) {
      setPending((p) => ({ ...p, ...patch }));
      return;
    }
    try {
      const t = await updateThread(project, thread.id, patch);
      setThreads((ts) => ts.map((x) => (x.id === t.id ? { ...x, model: t.model, effort: t.effort ?? '' } : x)));
    } catch (err) {
      setError(err.message);
    }
  }

  // A name is a label, not a setting: the server takes it mid-turn and closes no session
  // (server/index.js's PATCH), so this never has to ask whether a turn is running.
  // Blank clears it and the tab goes back to saying what it is about.
  async function commitRename() {
    const { id, draft } = renaming;
    setRenaming(null);
    const title = draft.trim();
    const before = threads.find((t) => t.id === id);
    if (!before || before.title === title) return;
    try {
      const t = await updateThread(project, id, { title });
      setThreads((ts) => ts.map((x) => (x.id === t.id ? { ...x, title: t.title } : x)));
    } catch (err) {
      setError(err.message);
    }
  }

  async function removeThread() {
    setConfirmDelete(false);
    if (!thread) return;
    const id = thread.id;
    try {
      await deleteThread(project, id);
      setThreads((ts) => ts.filter((t) => t.id !== id));
      setChosenId(null);
    } catch (err) {
      setError(err.message);
    }
  }

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
    const t = await createThread(project, { provider: provider.kind, model: pending.model, effort: pending.effort, ...newKind });
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

  const running = status === 'running';
  const focusArtifact = thread?.kind === 'artifact' && thread.artifactId && nodes.some((n) => n.id === thread.artifactId) ? thread.artifactId : null;
  // The transcript: messages and the agent's change notes, in time order.
  const lines = [...messages, ...notes.map((n) => ({ role: 'note', text: n.text, at: n.at }))].sort((a, b) => (a.at ?? 0) - (b.at ?? 0));

  return (
    <aside className={`agent-panel${embedded ? ' agent-panel--embedded' : ''}`} aria-label="Agent">
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
          <IconButton variant="ghost" size="sm" label="Delete thread" tooltip="Delete this thread" icon={<Icon icon={Trash2} />} onClick={() => setConfirmDelete(true)} isDisabled={!thread || running} />
          {!embedded && <IconButton variant="ghost" size="sm" label="Close" icon={<Icon icon={X} />} onClick={onClose} />}
        </HStack>
        {/* The strip: one tab per visible thread (tabs.js decides which), the oldest behind
            the overflow menu. Empty when the selection names artifacts nobody has talked
            about yet. The rule under it belongs to this wrapper rather than to the tabs,
            so it runs the full width of the panel and the selected tab notches it. */}
        <div className="agent-tabs">
          {visible.length > 0 && (
            <TabList size="sm" value={threadId ?? ''} onChange={setChosenId} aria-label="Threads">
              {inlineTabs.map((t) =>
                renaming?.id === t.id ? (
                  // Shaped as the tab it replaces -- by wearing Astryx's own theming
                  // class, so the folder silhouette stays defined in exactly one place
                  // (theme.js) and this box cannot drift from it.
                  <span key={t.id} className="astryx-tab selected agent-tab-rename">
                    <input
                      value={renaming.draft}
                      // The box grows with the name rather than scrolling it, capped in
                      // CSS so a long one cannot push the rest of the strip out.
                      size={Math.max(6, renaming.draft.length + 1)}
                      placeholder={tabLabel({ ...t, title: '' }, nodes)}
                      aria-label="Thread name"
                      onChange={(e) => setRenaming({ id: t.id, draft: e.target.value })}
                      onBlur={commitRename}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename();
                        // Escape abandons the draft, the one thing that makes a rename
                        // safe to start by accident.
                        else if (e.key === 'Escape') setRenaming(null);
                      }}
                      autoFocus
                    />
                  </span>
                ) : (
                  <Tab
                    key={t.id}
                    value={t.id}
                    label={tabLabel(t, nodes)}
                    className={t.kind === 'artifact' ? 'agent-tab--artifact' : undefined}
                    // A tab can be narrower than its name, so the tooltip carries the
                    // name in full, and what the conversation opened with after it.
                    title={[tabLabel(t, nodes), t.preview].filter(Boolean).join(' — ')}
                    onDoubleClick={() => setRenaming({ id: t.id, draft: t.title ?? '' })}
                    endContent={t.status === 'running' ? <span className="agent-dot agent-dot--live" /> : undefined}
                  />
                ),
              )}
              {menuTabs.length > 0 && (
                <TabMenu
                  label="More"
                  options={menuTabs.map((t) => ({
                    value: t.id,
                    label: tabLabel(t, nodes),
                    // A menu option has no end slot, so a running thread's dot leads it.
                    icon: t.status === 'running' ? <span className="agent-dot agent-dot--live" /> : undefined,
                  }))}
                />
              )}
            </TabList>
          )}
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
        {/* What to say, for a thread with nothing in it yet. It sits at the FOOT of the
            transcript, next to the composer it is about, and is drawn as plain text: a
            box would read as the first message, and there isn't one. */}
        {provider && lines.length === 0 && !draft && (
          <Text type="supporting" color="secondary" className="agent-hint">
            {thread?.kind === 'artifact' || newKind?.kind === 'artifact'
              ? 'Tell the agent what to change on this artifact. Whatever else is selected when you send comes with the message.'
              : 'Ask about the board — what is on it, what feeds what, what a prompt says — or tell the agent what to change or make. Select an artifact to talk about it alone.'}
          </Text>
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
        {/* What the next message carries besides its own text: the page this thread is
            about, and whatever else is selected. Both absent means the row is absent --
            an empty selection IS the whole canvas, so a chip saying so was a label on
            the default, and a heading over one chip was a label on a label. */}
        {(focusArtifact || selection.length > 0) && (
          <HStack gap={1} align="center" wrap>
            {focusArtifact && (
              <span className="agent-chip agent-chip--focus">
                <span className="agent-dot agent-dot--focus" />
                {artifactLabel(thread, nodes)}
                {!embedded && (
                  <button type="button" className="agent-locate" title="Locate on canvas" aria-label="Locate on canvas" onClick={() => onLocate?.(focusArtifact)}>
                    <Icon icon={Crosshair} size="sm" />
                  </button>
                )}
              </span>
            )}
            {selection.length > 0 && <span className="agent-chip">{selection.length} selected</span>}
          </HStack>
        )}
        {/* Enter sends; Shift+Enter or Option+Enter breaks the line. Caught on a wrapper,
            since keydown bubbles and the TextArea component does not promise to forward it. */}
        <div
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.isComposing) {
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
                    ? 'What should change? (↵ to send, ⇧↵ for a new line)'
                    : 'Ask about the board… (↵ to send, ⇧↵ for a new line)'
            }
            isDisabled={!provider || (!thread && !newKind)}
            onChange={setText}
          />
        </div>
        {/* One footer line: what the turn will run on, then Send. */}
        <HStack gap={2} align="center">
          {/* Model and effort for the next turn (the thread's own, or the next thread's),
              after T3 Code's composer footer: two small ghost controls, the model picker
              searchable and grouped by provider with a description under each name, the
              effort a short list with what each level means. Astryx Selectors: their
              popovers anchor fine here, outside React Flow's transform -- the
              native-select exception is for the nodes only. */}
          {provider && <ModelPicker provider={provider} codex={codex} models={models} value={settings.model} onChange={(id) => changeSettings({ model: id, effort: '' })} disabled={running} />}
          {provider && efforts.length > 0 && <EffortPicker efforts={efforts} value={settings.effort} onChange={(e) => changeSettings({ effort: e })} disabled={running} />}
          <StackItem size="fill" />
          {running ? (
            <Button label="Stop" variant="secondary" size="sm" icon={<Icon icon={Square} />} onClick={() => interruptThread(project, threadId)} />
          ) : (
            <Button label="Send" variant="primary" size="sm" isDisabled={!provider || !text.trim() || sending || (!thread && !newKind)} isLoading={sending} onClick={send} />
          )}
        </HStack>
      </div>
      <AlertDialog
        isOpen={confirmDelete}
        onOpenChange={(open) => !open && setConfirmDelete(false)}
        title="Delete this thread?"
        description="The conversation is removed for good. What the agent changed on the canvas stays, and Cmd-Z still undoes it."
        actionLabel="Delete thread"
        onAction={removeThread}
      />
    </aside>
  );
}
