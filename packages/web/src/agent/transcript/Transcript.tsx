import { activityLabel, agentShapeId, formatWorkDuration, revertSkipLine, type Chat, type ChatMessage, type ChatTurn } from "@unframed/domain";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { buildTimeline, type Block } from "./timeline.ts";
import { WorkEntries } from "./WorkLog.tsx";
import { useMaybeEditor } from "tldraw";
import { describeShape } from "../composer/chips.tsx";
import { ConfirmDialog } from "../ConfirmDialog.tsx";
import { providerName } from "../providers.ts";
import { ChevronRight, Clock, Undo2, X } from "lucide-react";
import { Tip } from "../../chrome/ui.tsx";
import { returnQueued, sendQueued } from "../queue.tsx";
import { useQueue, useWatchedThread, type ChatClient } from "../store.ts";
import { ChatMarkdown } from "./ChatMarkdown.tsx";
import { PlanCard } from "./PlanCard.tsx";
import { RecapCard } from "./RecapCard.tsx";
import { record } from "../record.ts";

export const EMPTY_CHAT = "Ask about what is on the canvas, or say what should change or be made. Whatever is selected comes with the message as context.";

const COLLAPSE_CHARACTERS = 600;
const COLLAPSE_LINES = 8;

/** The person's message exactly as typed: never parsed as markdown. Long ones collapse. */
const UserMessage = ({ message, running, onEdit }: { readonly message: ChatMessage; readonly running: boolean; readonly onEdit: (restoreCanvas: boolean) => void }) => {
  const [confirming, setConfirming] = useState(false);
  const long = message.text.length > COLLAPSE_CHARACTERS || message.text.split("\n").length > COLLAPSE_LINES;
  const [open, setOpen] = useState(false);
  const selected = message.context?.selection.length ?? 0;
  return (
    <article className="unframed-agent-message" data-role="user" data-message-id={message.id}>
      <header className="unframed-agent-message__author">
        You{selected > 0 && <span className="unframed-agent-message__context">{` · ${selected} selected`}</span>}
      </header>
      <div className="unframed-agent-message__text" data-collapsed={long && !open ? "" : undefined}>
        {message.text}
      </div>
      {(message.attachments?.length ?? 0) > 0 && (
        <div className="unframed-agent-message__attachments" role="list" aria-label="Attachments">
          {message.attachments!.map((attachment) => (
            <span key={attachment.id} role="listitem" className="unframed-agent-chip" data-chip={attachment.kind}>
              <span className="unframed-agent-chip__label">{attachment.name}</span>
            </span>
          ))}
        </div>
      )}
      {long && (
        <button type="button" className="unframed-agent-link" onClick={() => setOpen(!open)}>
          {open ? "Show less" : "Show full message"}
        </button>
      )}
      <div className="unframed-agent-message__actions">
        <button type="button" className="unframed-agent-button unframed-agent-button--ghost" disabled={running || message.turnId === null} onClick={() => setConfirming(true)}>
          <Undo2 size={13} aria-hidden />
          Edit from here
        </button>
      </div>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Edit from here?"
        description="Rewind chat to before this message. Your prompt and attachments return to the composer."
        actions={[
          { label: "Revert canvas changes too", destructive: true, onClick: () => onEdit(true) },
          { label: "Revert and keep changes", onClick: () => onEdit(false) },
        ]}
      />
    </article>
  );
};

/** Messages waiting for the running turn: right-aligned, dashed, with Send now and a way back to the composer. */
const QueuedMessages = ({ client, chatId }: { readonly client: ChatClient; readonly chatId: string }) => {
  const queue = useQueue(client, chatId);
  return queue.map((item, index) => (
    <div key={item.id} className="unframed-agent-queued" data-testid="queued-message" data-state={item.state}>
      <Tip label={index === 0 ? "Sends after the next tool call or when the turn ends" : "Sends after the messages above it"} side="left">
        <span className="unframed-agent-queued__status">
          <Clock size={12} aria-hidden />
          Queued
        </span>
      </Tip>
      <div className="unframed-agent-queued__text">{item.message.text}</div>
      <div className="unframed-agent-queued__actions">
        <button type="button" className="unframed-agent-button unframed-agent-button--ghost" disabled={item.state === "sending"} onClick={() => void sendQueued(client, chatId, item.id)}>
          Send now
        </button>
        <Tip label="Cancel and return to the composer" side="top">
          <button type="button" className="unframed-agent-control unframed-agent-control--icon" aria-label="Cancel and return to the composer" onClick={() => returnQueued(client, chatId, item.id)}>
            <X size={13} aria-hidden />
          </button>
        </Tip>
      </div>
    </div>
  ));
};

export interface TranscriptProps {
  readonly client: ChatClient;
  readonly chatId: string;
  readonly embedded: boolean;
  readonly onLocate?: (shapeId: string) => void;
  readonly onOpenEditor?: (shapeId: string) => void;
}

/** One chat's messages, work log, recap cards and activity line (t3code's timeline). */
export const Transcript = ({ client, chatId, embedded, onLocate, onOpenEditor }: TranscriptProps) => {
  const chat = useWatchedThread(client, chatId);
  const editor = useMaybeEditor();
  const running = chat?.latestTurn?.state === "running";

  // A rewind that left shapes alone says which in the rail's error line, as the recap card does.
  const seenRewinds = useRef<Set<string> | undefined>(undefined);
  useEffect(() => {
    if (!chat) return;
    const rewinds = chat.activities.filter((activity) => activity.kind === "checkpoint.reverted");
    if (!seenRewinds.current) {
      seenRewinds.current = new Set(rewinds.map((activity) => activity.id));
      return;
    }
    for (const activity of rewinds) {
      if (seenRewinds.current.has(activity.id)) continue;
      seenRewinds.current.add(activity.id);
      const payload = activity.payload as { restored?: string[]; skipped?: Array<{ id: string; by: "person" | "another chat" | "a later turn" }> };
      const line = revertSkipLine(
        (payload.skipped ?? []).map((shape) => ({ label: (editor && describeShape(editor, shape.id)?.label) ?? agentShapeId(shape.id), by: shape.by })),
        payload.restored?.length ?? 0,
      );
      if (line) client.setUi({ error: line });
    }
  }, [chat, client, editor]);

  const edit = (message: ChatMessage, restoreCanvas: boolean) => {
    const turn = chat?.turns.find((known) => known.turnId === message.turnId);
    if (!chat || !turn) return;
    client.setUi({ error: undefined });
    client
      .dispatch({ type: "thread.checkpoint.revert", threadId: chat.id, turnCount: turn.turnCount - 1, restoreCanvas })
      .then(() => client.handOff(chat.id, { text: message.text, selection: message.context?.selection ?? [], attachments: message.attachments ?? [] }))
      .catch((error: unknown) => client.reportError(error));
  };
  const scroller = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const [pill, setPill] = useState(false);
  const lastUser = [...(chat?.messages ?? [])].reverse().find((message) => message.role === "user")?.id;
  const anchored = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element || !chat) return;
    if (anchored.current !== undefined && lastUser !== anchored.current) {
      // A message just sent sits near the top, so the reply streams in under it.
      const sent = element.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(lastUser ?? "")}"]`);
      if (sent) element.scrollTop = Math.max(0, sent.offsetTop - 12);
      following.current = true;
    } else if (following.current) {
      element.scrollTop = element.scrollHeight;
    }
    anchored.current = lastUser;
  });
  const onScroll = () => {
    const element = scroller.current;
    if (!element) return;
    following.current = element.scrollHeight - element.scrollTop - element.clientHeight <= 40;
    setPill(!following.current);
  };

  if (!chat) return <div className="unframed-agent-transcript" />;
  const author = providerName(chat.modelSelection.provider);
  const timeline = buildTimeline(chat);
  const latest = chat.latestTurn;
  const streaming = chat.messages.some((message) => message.streaming && message.role === "assistant" && message.turnId === latest?.turnId);
  const assistant = (message: ChatMessage) => (
    <article key={message.id} className="unframed-agent-message" data-role="assistant" data-message-id={message.id} data-streaming={message.streaming ? "" : undefined}>
      <header className="unframed-agent-message__author">{author}</header>
      {message.text === "" && !message.streaming ? <p className="unframed-agent-muted">(empty response)</p> : <ChatMarkdown text={message.text} />}
    </article>
  );
  const labelOf = (id: string) => (editor && describeShape(editor, id)?.label) ?? agentShapeId(id);
  const newestChanged = Math.max(-1, ...chat.turns.filter((turn) => (turn.files?.length ?? 0) > 0).map((turn) => turn.turnCount));
  const recap = (turn: ChatTurn) => (
    <RecapCard
      key={`recap:${turn.turnId}`}
      editor={editor}
      turn={turn}
      activities={chat.activities.filter((activity) => activity.turnId === turn.turnId)}
      running={running}
      newest={turn.turnCount === newestChanged}
      labelOf={labelOf}
      onRevert={() => {
        client.setUi({ error: undefined });
        void client.dispatch({ type: "thread.turn.revert", threadId: chat.id, turnCount: turn.turnCount }).catch((error: unknown) => client.reportError(error));
      }}
      onDiff={(shapeId) => client.setUi({ diff: { threadId: chat.id, turnCount: turn.turnCount, ...(shapeId ? { shapeId } : {}) } })}
      onDiffAll={() => client.setUi({ diff: { threadId: chat.id, turnCount: "all" } })}
      onLocate={embedded ? undefined : onLocate}
      onOpenEditor={onOpenEditor}
    />
  );
  const block = (item: Block) => {
    if (item.kind === "work") return <WorkEntries key={item.id} entries={item.entries} />;
    if (item.kind === "retry") return <RetryLine key={item.activity.id} payload={item.activity.payload} />;
    if (item.kind === "plan") return <PlanCard key={item.plan.id} plan={item.plan.planMarkdown} />;
    const { message } = item;
    if (message.role === "user") return <UserMessage key={message.id} message={message} running={running} onEdit={(restoreCanvas) => edit(message, restoreCanvas)} />;
    if (message.role === "reasoning") return <Reasoning key={message.id} message={message} />;
    return assistant(message);
  };
  return (
    <div className="unframed-agent-transcript-frame">
      <div ref={scroller} className="unframed-agent-transcript" data-scrolls="true" data-testid="transcript" onScroll={onScroll}>
        {timeline.map((turn) => {
          if (!turn.settled)
            return (
              <div key={turn.key} className="unframed-agent-turn">
                {turn.blocks.map(block)}
                {turn.turn && recap(turn.turn)}
              </div>
            );
          // A settled turn folds its work and thinking behind "Worked for"; what was said stays.
          const users = turn.blocks.filter((item) => item.kind === "message" && item.message.role === "user");
          const folded = turn.blocks.filter((item) => item.kind === "work" || (item.kind === "message" && item.message.role === "reasoning"));
          const said = turn.blocks.filter((item) => (item.kind === "message" && item.message.role === "assistant") || item.kind === "retry" || item.kind === "plan");
          return (
            <div key={turn.key} className="unframed-agent-turn">
              {users.map(block)}
              {folded.length > 0 && turn.turn && <WorkedFor turn={turn.turn}>{folded.map(block)}</WorkedFor>}
              {said.map(block)}
              {turn.turn && recap(turn.turn)}
            </div>
          );
        })}
        <LimitLine chat={chat} />
        <QueuedMessages client={client} chatId={chatId} />
        {running && !streaming && latest && <ActivityLine label={activityLabel(chat.activities, latest.turnId)} since={latest.startedAt ?? latest.requestedAt} />}
        {chat.messages.length === 0 && <p className="unframed-agent-empty">{EMPTY_CHAT}</p>}
      </div>
      {pill && (
        <button
          type="button"
          className="unframed-agent-scroll-pill"
          onClick={() => {
            const element = scroller.current;
            if (element) element.scrollTop = element.scrollHeight;
            following.current = true;
            setPill(false);
          }}
        >
          Scroll to end
        </button>
      )}
    </div>
  );
};

/** Reasoning: "Thinking" while it streams, then "Thought", folded. */
const Reasoning = ({ message }: { readonly message: ChatMessage }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="unframed-agent-reasoning" data-testid="reasoning">
      <button type="button" className="unframed-agent-work-group__head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <ChevronRight size={12} aria-hidden className="unframed-agent-chevron" />
        {message.streaming ? "Thinking" : "Thought"}
      </button>
      {open && <p className="unframed-agent-reasoning__text">{message.text}</p>}
    </div>
  );
};

/** A settled turn's work, behind how long it took ("You stopped after" when interrupted). */
const WorkedFor = ({ turn, children }: { readonly turn: ChatTurn; readonly children: ReactNode }) => {
  const [open, setOpen] = useState(false);
  const started = Date.parse(turn.startedAt ?? turn.requestedAt);
  const ended = Date.parse(turn.completedAt ?? turn.startedAt ?? turn.requestedAt);
  const took = formatWorkDuration(Math.max(0, ended - started));
  return (
    <div className="unframed-agent-worked" data-testid="worked-for">
      <button type="button" className="unframed-agent-work-group__head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <ChevronRight size={12} aria-hidden className="unframed-agent-chevron" />
        {turn.state === "interrupted" ? `You stopped after ${took}` : `Worked for ${took}`}
      </button>
      {open && <div className="unframed-agent-worked__body">{children}</div>}
    </div>
  );
};

/** A provider retry, said in words. */
export const retrySentence = (payload: unknown): string => {
  const p = record(payload);
  const status = typeof p.status === "number" || (typeof p.status === "string" && p.status !== "") ? ` (${String(p.status)})` : "";
  const wait = typeof p.delayMs === "number" && p.delayMs > 0 ? ` in ${Math.round(p.delayMs / 1000)}s` : "";
  const of = typeof p.maxRetries === "number" ? ` of ${p.maxRetries}` : "";
  return `The API is busy${status}, retrying${wait}. Attempt ${String(p.attempt ?? 1)}${of}…`;
};

const RetryLine = ({ payload }: { readonly payload: unknown }) => (
  <p className="unframed-agent-notice" data-testid="retry-line">
    {retrySentence(payload)}
  </p>
);

const resetTime = (resetsAt: unknown): string | undefined => {
  if (typeof resetsAt !== "string" || Number.isNaN(Date.parse(resetsAt))) return undefined;
  return new Date(resetsAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
};

/**
 * A usage limit: hit, or close. Shown for the chat's latest turn only, so the next turn
 * clears it; a later "allowed" notice clears it too.
 */
const LimitLine = ({ chat }: { readonly chat: Chat }) => {
  const latest = chat.latestTurn;
  const notice = [...chat.activities].reverse().find((activity) => activity.kind === "rate-limit");
  if (!notice || !latest || notice.turnId !== latest.turnId) return null;
  const p = record(notice.payload);
  const time = resetTime(p.resetsAt);
  if (p.status === "rejected") {
    return (
      <p className="unframed-agent-notice" data-kind="limit" data-testid="limit-line">
        {time === undefined ? "You have hit a usage limit." : `You have hit a usage limit. It resets at ${time}.`}
      </p>
    );
  }
  if (p.status === "allowed_warning") {
    return (
      <p className="unframed-agent-notice" data-testid="limit-line">
        {time === undefined ? "Close to your usage limit." : `Close to your usage limit, which resets at ${time}.`}
      </p>
    );
  }
  return null;
};

/** What the agent is doing, with the time since the turn began once it passes ten seconds. */
const ActivityLine = ({ label, since }: { readonly label: string; readonly since: string }) => (
  <p className="unframed-agent-activity" data-testid="activity-line">
    {label}
    <Elapsed since={since} />
  </p>
);

/** Its own component, so its tick never re-renders the transcript. */
const Elapsed = ({ since }: { readonly since: string }) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.floor((now - Date.parse(since)) / 1000);
  if (!(seconds >= 10)) return null;
  return <span className="unframed-agent-activity__clock">{` ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`}</span>;
};
