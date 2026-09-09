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
import { X, Plus, RefreshCw, Sparkles, Square, Trash2, Crosshair, ExternalLink, ChevronRight } from 'lucide-react';
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
import { visibleThreads, nextActive, tabLabel, nodeLabel, touchedArtifacts } from './tabs.js';
import { NODE_ICONS } from '../nodes/nodeIcons.jsx';
import ChatMarkdown from './Markdown.jsx';

// The agent panel: a right-hand panel over the project's chats, one tab each. The
// design's states 1, 8 and 10 (docs/superpowers/specs/2026-09-04-agent-canvas-slice-1-design.md),
// the tab strip of the slice-3 design, and the chats-and-tags design
// (2026-09-06-chats-and-tags-design.md): the selection filters which tabs show (tabs.js),
// the active tab is always one of them, and the composer sends to the active tab --
// starting a chat when none is visible, tagged with whichever artifacts are selected.
// Every artifact the active chat has touched is reported up through `onFocus` so App.jsx
// can mark them on the canvas.
//
// THIS is where a reply lives. There used to be a second place -- a card anchored on the
// node the agent worked on -- and it could not survive the selection being several
// artifacts at once: a card has one anchor. The toolbar now only starts a chat, and Send
// opens the panel on it.
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

// One artifact, listed: its own node icon, what it is called, and the two things you can
// do with it. Used by BOTH a change line's expansion and the recap card at the foot --
// they are the same row, and writing it twice is how the two would drift apart. The icon
// slot is reserved even when there is no icon to put in it, so a deleted row's name still
// lines up with the rest.
function ArtifactRow({ row, onOpen, onLocate, embedded }) {
  const icon = row.type ? NODE_ICONS[row.type] : null;
  return (
    <HStack gap={1} align="center" className="agent-artifact-row">
      <span className="agent-artifact-icon">{icon && <Icon icon={icon} size="sm" />}</span>
      <Text type="supporting" color={row.stale ? 'secondary' : undefined} className={row.stale ? 'agent-artifact-gone' : undefined}>
        {row.label}
      </Text>
      <StackItem size="fill" />
      {row.stale ? (
        <Text type="supporting" color="secondary">
          deleted
        </Text>
      ) : (
        <>
          {onOpen && <Button size="sm" variant="ghost" label="Open" icon={<Icon icon={ExternalLink} />} onClick={() => onOpen(row.id)} />}
          {!embedded && <IconButton variant="ghost" size="sm" label="Locate on canvas" icon={<Icon icon={Crosshair} />} onClick={() => onLocate?.(row.id)} />}
        </>
      )}
    </HStack>
  );
}

// `initialThreadId` opens the panel on a particular chat -- what the toolbar's Send
// does. `refreshKey` changes when something outside the panel (the toolbar's composer)
// started a chat, so the strip re-reads the list. `onFocus` receives the active chat's
// tags, as an array of node ids.
// `onLocate(nodeId)` pans and zooms the canvas to a node; `onOpenEditor(nodeId)` opens
// the editor on an artifact -- both absent when `embedded`.
// `embedded` is the editor's column (editor/Editor.jsx): the panel is the page's left
// third rather than a card floating over the canvas, so it has no Close of its own (the
// editor's Back is the way out) and no Locate (there is no canvas to pan).
export default function AgentPanel({ project, nodes, providers, onCheckProviders, checking, onClose, initialThreadId = null, refreshKey = 0, onFocus, onLocate, onOpenEditor, embedded = false }) {
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
  // Every artifact the active chat has touched wears the mark, not just one: a chat can
  // be about two motions, and marking only the first would say something false about the
  // second. Joined for the dependency list so a re-read that returns the same tags in the
  // same order does not re-fire it.
  const tags = thread?.tags ?? [];
  const tagKey = tags.join(',');
  useEffect(() => {
    onFocus?.(tagKey ? tagKey.split(',') : []);
  }, [tagKey, onFocus]);
  useEffect(() => () => onFocus?.([]), [onFocus]);
  const [messages, setMessages] = useState([]);
  // Every artifact this chat has touched, in first-touch order, accumulated from the same
  // event stream the transcript comes from (`touchedArtifacts`). It feeds the recap card
  // at the foot, and it is NOT the record's `tags`: tags answer which chats the strip
  // shows for a selection, this answers what this conversation involved.
  const [touched, setTouched] = useState([]);
  const [recapOpen, setRecapOpen] = useState(true);
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
      setTouched([]);
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
        setTouched([]);
        setStatus(s.status ?? 'idle');
        setError(s.error ?? null);
        draftText = '';
        setDraft('');
        setActivity(null);
      },
      onEvent: (e) => {
        // The recap is derived from the events themselves, so the replay of a reopened
        // chat rebuilds it exactly as the live turn built it. Folded one event at a time
        // rather than over a growing array, so the order is first-touch and stays stable.
        setTouched((prev) => {
          const next = touchedArtifacts([e]).filter((id) => !prev.includes(id));
          return next.length ? [...prev, ...next] : prev;
        });
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
            // The chat picks up a tag for whatever the agent just wrote to; the strip
            // learns it here rather than waiting for the next list read.
            if (e.page?.nodeId) {
              setThreads((ts) => ts.map((t) => (t.id === threadId && !(t.tags ?? []).includes(e.page.nodeId) ? { ...t, tags: [...(t.tags ?? []), e.page.nodeId] } : t)));
            }
            break;
          case 'titled':
            // The agent named the chat after its first turn; the tab says so at once
            // rather than on the next list read.
            setThreads((ts) => ts.map((t) => (t.id === threadId ? { ...t, title: e.title, titledBy: 'agent' } : t)));
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

  // A chat can ALWAYS be started -- there is no shape it has to have first. It used to
  // need exactly one artifact selected, or none, and several selected disabled Send with
  // "select one to start a thread about it". That was the mode picker in disguise: the
  // selection is context, so any selection is a fine thing to start a chat about.
  const selectedArtifacts = nodes.filter((n) => n.selected && isArtifact(n));
  const selectedArtifactIds = selectedArtifacts.map((n) => n.id);

  async function startThread() {
    const t = await createThread(project, { provider: provider.kind, model: pending.model, effort: pending.effort, tags: selectedArtifactIds });
    setThreads((ts) => [t, ...ts]);
    setChosenId(t.id);
    return t;
  }

  async function send() {
    const body = text.trim();
    if (!body || !provider || sending || status === 'running') return;
    setSending(true);
    setError(null);
    try {
      const t = thread ?? (await startThread());
      // Optimistic: the user message shows at once; the stream's `turn` event confirms.
      setMessages((ms) => [...ms, { role: 'user', text: body, at: Date.now(), selection }]);
      setText('');
      await sendThreadMessage(project, t.id, { text: body, selection });
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  async function newThread() {
    if (!provider) return;
    try {
      await startThread();
    } catch (err) {
      setError(err.message);
    }
  }

  const running = status === 'running';
  // The row above the composer is the LIVE SELECTION -- the conventional "what is
  // attached to this message" row. It used to list the chat's accumulated tags, which
  // wore the same shape while answering a different question, and the two read as noise.
  // What the chat has touched now lives in the recap card at the foot of the transcript.
  const selectionChips = selectedArtifactIds.map((id) => nodeLabel(id, nodes));
  const otherSelected = selection.length - selectedArtifactIds.length;
  // First-touch order, with what each is called now; a deleted one is greyed and has no
  // Locate, since there is nowhere to locate it to.
  const recap = touched.map((id) => nodeLabel(id, nodes));
  // The transcript is the messages, and only the messages. Each change the agent made
  // used to get a block of its own here -- what changed, expandable to the artifacts it
  // touched, with Undo. It went, on 2026-09-06: with the recap card at the foot listing
  // the same files, a block per message said the same thing over and over up the
  // transcript, and what a chat is FOR is what was said in it. The agent still gets told
  // what changed (the preamble); the person still has Cmd-Z, which walks the same
  // server-side journal and is what the button called anyway.
  const lines = messages;

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
            label="New chat"
            tooltip={selectedArtifactIds.length ? 'New chat about the selected artifacts' : 'New chat'}
            icon={<Icon icon={Plus} />}
            onClick={newThread}
            isDisabled={!provider}
          />
          <IconButton variant="ghost" size="sm" label="Delete chat" tooltip="Delete this chat" icon={<Icon icon={Trash2} />} onClick={() => setConfirmDelete(true)} isDisabled={!thread || running} />
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
                      placeholder={tabLabel({ ...t, title: '' })}
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
                    label={tabLabel(t)}
                    className={(t.tags ?? []).length ? 'agent-tab--artifact' : undefined}
                    // A tab can be narrower than its name, so the tooltip carries the
                    // name in full, and what the conversation opened with after it.
                    title={[tabLabel(t), t.preview].filter(Boolean).join(' — ')}
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
                    label: tabLabel(t),
                    // A menu option has no end slot, so a running thread's dot leads it.
                    icon: t.status === 'running' ? <span className="agent-dot agent-dot--live" /> : undefined,
                  }))}
                />
              )}
            </TabList>
          )}
          {visible.length === 0 && (
            <Text type="supporting" color="secondary" className="agent-tabs-empty">
              {selectedArtifacts.length ? 'Nothing said about this yet — your first message starts a chat' : 'No chats yet'}
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
            Ask about what is on the canvas, or say what should change or be made — whatever is selected comes with the message as context.
          </Text>
        )}
        {lines.map((m, i) => (
          <div key={`${m.at}-${i}`} className={`agent-msg agent-msg-${m.role}`}>
            <Text type="supporting" className="agent-msg-role">
              {m.role === 'user' ? 'You' : provider?.name ?? 'Agent'}
              {m.role === 'user' && m.selection?.length ? ` · ${m.selection.length} selected` : ''}
            </Text>
            {/* The agent writes markdown, so its replies are rendered as markdown. What
                the PERSON typed is not: they typed prose, and running it through a parser
                would eat their asterisks and turn a line starting with "#" into a heading.
                Their own words are shown exactly as they wrote them. */}
            {m.role === 'user' ? <div className="agent-msg-text">{m.text}</div> : <ChatMarkdown text={m.text} />}
          </div>
        ))}
        {draft && (
          <div className="agent-msg agent-msg-assistant">
            <Text type="supporting" className="agent-msg-role">
              {provider?.name ?? 'Agent'}
            </Text>
            {/* Rendered by the same component while it streams, so formatting appears as
                it arrives rather than snapping in when the turn ends. */}
            <ChatMarkdown text={draft} />
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
        {/* What this conversation involved, after the last message: every artifact it
            read or changed, named once, in the order it first touched them. Reads and
            writes are deliberately NOT distinguished -- the question is what the chat was
            about, and splitting a small card into changed-versus-merely-read made it an
            argument. The per-change blocks above already say what each change did; this
            says what the whole chat came to. */}
        {recap.length > 0 && !running && (
          <div className="agent-recap">
            <button type="button" className="agent-recap-head" aria-expanded={recapOpen} onClick={() => setRecapOpen((v) => !v)}>
              <Icon icon={ChevronRight} size="sm" />
              <Text type="supporting" weight="medium">
                {recap.length} {recap.length === 1 ? 'file' : 'files'}
              </Text>
              <StackItem size="fill" />
              <Text type="supporting" color="secondary">
                {recapOpen ? 'Hide' : 'Show'}
              </Text>
            </button>
            {recapOpen && (
              <VStack gap={0} className="agent-recap-list">
                {recap.map((row) => (
                  <ArtifactRow key={row.id} row={row} onOpen={onOpenEditor} onLocate={onLocate} embedded={embedded} />
                ))}
              </VStack>
            )}
          </div>
        )}
        {error && <div className="agent-error">{error}</div>}
      </div>

      <div className="agent-panel-composer">
        {/* What the next message carries: the live selection, named. Absent when nothing
            is selected -- an empty selection IS the whole canvas, so a chip saying so was
            a label on the default. Each artifact wears its own node icon, so the chip and
            the thing on the canvas look like the same thing; whatever else is selected is
            counted rather than named, the same rule the toolbar's chip follows. There is
            no Locate here: a selected node is one you have just pointed at. */}
        {selection.length > 0 && (
          <HStack gap={1} align="center" wrap>
            {selectionChips.map((chip) => (
              <span key={chip.id} className="agent-chip">
                {chip.type && NODE_ICONS[chip.type] && <Icon icon={NODE_ICONS[chip.type]} size="sm" />}
                {chip.label}
              </span>
            ))}
            {otherSelected > 0 && (
              <span className="agent-chip">
                {otherSelected} {otherSelected === 1 ? 'input' : 'inputs'}
              </span>
            )}
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
            placeholder={provider ? 'Ask, or say what should change… (↵ to send, ⇧↵ for a new line)' : 'Connect Claude or Codex to start'}
            isDisabled={!provider}
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
            <Button label="Send" variant="primary" size="sm" isDisabled={!provider || !text.trim() || sending} isLoading={sending} onClick={send} />
          )}
        </HStack>
      </div>
      <AlertDialog
        isOpen={confirmDelete}
        onOpenChange={(open) => !open && setConfirmDelete(false)}
        title="Delete this chat?"
        description="The conversation is removed for good. What the agent changed on the canvas stays, and Cmd-Z still undoes it."
        actionLabel="Delete chat"
        onAction={removeThread}
      />
    </aside>
  );
}
