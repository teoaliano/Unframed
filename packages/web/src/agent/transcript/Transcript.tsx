import { activityLabel, agentShapeId, buildTimeline, type TimelineBlock, formatWorkDuration, revertSkipLine, type Chat, type ChatMessage, type ChatTurn } from "@unframed/domain";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Brain, ChevronDown, ChevronRight, Clock, Undo2, X } from "lucide-react";
import { useMaybeEditor } from "tldraw";
import { Badge } from "~/components/ui/badge";
import { Button, InlineButton } from "~/components/ui/button";
import { Tip } from "../../chrome/ui.tsx";
import { describeShape } from "../composer/chips.tsx";
import { ConfirmDialog } from "../ConfirmDialog.tsx";
import { providerName } from "../providers.ts";
import { BODY_CLASS, Chevron, Disclosure, IconSlot, ROW_CLASS, WorkEntries } from "./WorkLog.tsx";
import { returnQueued, sendQueued } from "../queue.tsx";
import { useQueue, useWatchedThread, type ChatClient } from "../store.ts";
import { ChatMarkdown } from "./ChatMarkdown.tsx";
import { PlanCard } from "./PlanCard.tsx";
import { RecapCard } from "./RecapCard.tsx";
import { record } from "../record.ts";

export const EMPTY_CHAT = "Ask about what is on the canvas, or say what should change or be made. Whatever is selected comes with the message as context.";

/** The transcript's scroll area: the timeline's column, in t3code's type. */
const SCROLLER_CLASS = "flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-3.5 pt-3.5 pb-2.5 text-sm leading-relaxed";

const REASONING_BODY_CLASS = `${BODY_CLASS} max-h-96 overflow-auto text-sm whitespace-pre-wrap text-muted-foreground select-text`;

const COLLAPSE_CHARACTERS = 600;
const COLLAPSE_LINES = 8;

/** A message's author, as t3code names it for the outline: quiet, above the text. */
const AUTHOR_CLASS = "mb-1 text-xs font-medium text-muted-foreground";

/** The person's message exactly as typed, in t3code's message bubble: never parsed as markdown. Long ones collapse. */
const UserMessage = ({ message, running, onEdit }: { readonly message: ChatMessage; readonly running: boolean; readonly onEdit: (restoreCanvas: boolean) => void }) => {
  const [confirming, setConfirming] = useState(false);
  const long = message.text.length > COLLAPSE_CHARACTERS || message.text.split("\n").length > COLLAPSE_LINES;
  const [open, setOpen] = useState(false);
  const selected = message.context?.selection.length ?? 0;
  return (
    <article className="group flex flex-col items-end gap-1" data-role="user" data-message-id={message.id}>
      <div className="relative max-w-[80%] min-w-0 rounded-2xl bg-message p-3 text-message-foreground" data-testid="message-bubble">
        <header className={AUTHOR_CLASS}>
          You{selected > 0 && <span>{` · ${selected} selected`}</span>}
        </header>
        {(message.attachments?.length ?? 0) > 0 && (
          <div className="mb-2 flex flex-wrap gap-1" role="list" aria-label="Attachments">
            {message.attachments!.map((attachment) => (
              <Badge key={attachment.id} variant="outline" size="lg" className="max-w-full" role="listitem" data-chip={attachment.kind}>
                <span className="truncate">{attachment.name}</span>
              </Badge>
            ))}
          </div>
        )}
        <div className="text-sm leading-relaxed whitespace-pre-wrap break-words data-collapsed:line-clamp-8" data-testid="message-text" data-collapsed={long && !open ? "" : undefined}>
          {message.text}
        </div>
        {long && (
          <p className="m-0 mt-1.5 text-xs">
            <InlineButton tone="muted" onClick={() => setOpen(!open)}>
              {open ? "Show less" : "Show full message"}
            </InlineButton>
          </p>
        )}
      </div>
      <div className="flex max-w-[80%] items-center justify-end opacity-0 transition-opacity duration-200 group-hover:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100">
        <Button variant="ghost" size="xs" disabled={running || message.turnId === null} onClick={() => setConfirming(true)}>
          <Undo2 aria-hidden />
          Edit from here
        </Button>
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

/**
 * Messages waiting for the running turn (t3code's queued row): a dashed, dimmed bubble with
 * Send now and a way back to the composer. A press on either keeps the focus in the composer.
 */
const QueuedMessages = ({ client, chatId }: { readonly client: ChatClient; readonly chatId: string }) => {
  const queue = useQueue(client, chatId);
  return queue.map((item, index) => (
    <div key={item.id} className="max-w-[80%] self-end rounded-2xl border border-dashed p-3 text-message-foreground/80" data-testid="queued-message" data-state={item.state}>
      <div className="text-sm leading-relaxed whitespace-pre-wrap break-words">{item.message.text}</div>
      <div className="mt-2 flex items-center gap-4 text-xs text-secondary-label">
        <Tip label={index === 0 ? "Sends after the next tool call or when the turn ends" : "Sends after the messages above it"} side="bottom">
          <span className="inline-flex h-6 items-center gap-1">
            <Clock aria-hidden className="size-3.5" />
            Queued
          </span>
        </Tip>
        <div className="ml-auto flex items-center gap-0.5">
          <Button variant="ghost-muted" size="xs" disabled={item.state === "sending"} onPointerDown={(event) => event.preventDefault()} onClick={() => void sendQueued(client, chatId, item.id)}>
            Send now
          </Button>
          <Tip label="Cancel and return to the composer" side="bottom">
            <Button
              variant="ghost-muted"
              size="icon-xs"
              aria-label="Cancel and return to the composer"
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => returnQueued(client, chatId, item.id)}
            >
              <X aria-hidden />
            </Button>
          </Tip>
        </div>
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

  if (!chat) return <div className={SCROLLER_CLASS} data-testid="transcript" />;
  const author = providerName(chat.modelSelection.provider);
  const timeline = buildTimeline(chat);
  const latest = chat.latestTurn;
  const streaming = chat.messages.some((message) => message.streaming && message.role === "assistant" && message.turnId === latest?.turnId);
  const assistant = (message: ChatMessage) => (
    <article key={message.id} className="relative min-w-0 px-1 py-0.5" data-role="assistant" data-message-id={message.id} data-streaming={message.streaming ? "" : undefined}>
      <header className={AUTHOR_CLASS}>{author}</header>
      {message.text === "" && !message.streaming ? <p className="m-0 text-sm text-muted-foreground">(empty response)</p> : <ChatMarkdown text={message.text} />}
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
  const block = (item: TimelineBlock) => {
    if (item.kind === "work") return <WorkEntries key={item.id} entries={item.entries} />;
    if (item.kind === "retry") return <RetryLine key={item.activity.id} payload={item.activity.payload} />;
    if (item.kind === "plan") return <PlanCard key={item.plan.id} plan={item.plan.planMarkdown} />;
    const { message } = item;
    if (message.role === "user") return <UserMessage key={message.id} message={message} running={running} onEdit={(restoreCanvas) => edit(message, restoreCanvas)} />;
    if (message.role === "reasoning") return <Reasoning key={message.id} message={message} />;
    return assistant(message);
  };
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={scroller} className={SCROLLER_CLASS} data-scrolls="true" data-testid="transcript" onScroll={onScroll}>
        {timeline.map((turn) => {
          if (!turn.settled)
            return (
              <div key={turn.key} className="flex flex-col gap-2.5">
                {turn.blocks.map(block)}
                {turn.turn && recap(turn.turn)}
              </div>
            );
          // A settled turn folds its work and thinking behind "Worked for"; what was said stays.
          const users = turn.blocks.filter((item) => item.kind === "message" && item.message.role === "user");
          const folded = turn.blocks.filter((item) => item.kind === "work" || (item.kind === "message" && item.message.role === "reasoning"));
          const said = turn.blocks.filter((item) => (item.kind === "message" && item.message.role === "assistant") || item.kind === "retry" || item.kind === "plan");
          return (
            <div key={turn.key} className="flex flex-col gap-2.5">
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
        {chat.messages.length === 0 && <p className="m-0 mt-auto text-xs text-muted-foreground">{EMPTY_CHAT}</p>}
      </div>
      {pill && (
        <Button
          variant="glass"
          size="xs"
          className="absolute bottom-2 left-1/2 z-10 -translate-x-1/2"
          onClick={() => {
            const element = scroller.current;
            if (element) element.scrollTop = element.scrollHeight;
            following.current = true;
            setPill(false);
          }}
        >
          <ChevronDown aria-hidden />
          Scroll to end
        </Button>
      )}
    </div>
  );
};

/** Reasoning (t3code's row): "Thinking" while it streams, then "Thought", folded. */
const Reasoning = ({ message }: { readonly message: ChatMessage }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col" data-testid="reasoning">
      <Disclosure open={open} onToggle={() => setOpen(!open)}>
        <IconSlot>
          <Brain aria-hidden className="size-4 shrink-0 opacity-70" />
        </IconSlot>
        <span className="min-w-0 flex-1 truncate text-secondary-label">{message.streaming ? "Thinking" : "Thought"}</span>
        <Chevron open={open} />
      </Disclosure>
      {open && <p className={REASONING_BODY_CLASS}>{message.text}</p>}
    </div>
  );
};

/** A settled turn's work, behind how long it took ("You stopped after" when interrupted): t3code's turn fold. */
const WorkedFor = ({ turn, children }: { readonly turn: ChatTurn; readonly children: ReactNode }) => {
  const [open, setOpen] = useState(false);
  const started = Date.parse(turn.startedAt ?? turn.requestedAt);
  const ended = Date.parse(turn.completedAt ?? turn.startedAt ?? turn.requestedAt);
  const took = formatWorkDuration(Math.max(0, ended - started));
  return (
    <div className="flex flex-col" data-testid="worked-for">
      <div className="flex items-center gap-1 border-b border-border/60 pt-1 pb-2">
        <Disclosure
          open={open}
          onToggle={() => setOpen(!open)}
          className="flex cursor-pointer select-none items-center gap-1 rounded-md px-1 text-sm leading-relaxed text-muted-foreground tabular-nums transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70"
        >
          <span>{turn.state === "interrupted" ? `You stopped after ${took}` : `Worked for ${took}`}</span>
          {open ? <ChevronDown aria-hidden className="size-3.5" /> : <ChevronRight aria-hidden className="size-3.5" />}
        </Disclosure>
      </div>
      {open && <div className="flex flex-col gap-px pt-1">{children}</div>}
    </div>
  );
};

/** The quiet lines of the transcript: retries, limits, what the agent is doing. */
const NOTICE_CLASS = "m-0 px-1 text-sm leading-relaxed text-muted-foreground";

/** A provider retry, said in words. */
export const retrySentence = (payload: unknown): string => {
  const p = record(payload);
  const status = typeof p.status === "number" || (typeof p.status === "string" && p.status !== "") ? ` (${String(p.status)})` : "";
  const wait = typeof p.delayMs === "number" && p.delayMs > 0 ? ` in ${Math.round(p.delayMs / 1000)}s` : "";
  const of = typeof p.maxRetries === "number" ? ` of ${p.maxRetries}` : "";
  return `The API is busy${status}, retrying${wait}. Attempt ${String(p.attempt ?? 1)}${of}…`;
};

const RetryLine = ({ payload }: { readonly payload: unknown }) => (
  <p className={NOTICE_CLASS} data-testid="retry-line">
    {retrySentence(payload)}
  </p>
);

const resetTime = (resetsAt: unknown): string | undefined => {
  if (typeof resetsAt !== "string" || Number.isNaN(Date.parse(resetsAt))) return undefined;
  return new Date(resetsAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
};

/**
 * A usage limit that was hit, for the chat's latest turn only, so the next turn clears it; a
 * later "allowed" notice clears it too. Claude's "close to the limit" warnings show nothing.
 */
const LimitLine = ({ chat }: { readonly chat: Chat }) => {
  const latest = chat.latestTurn;
  const notice = [...chat.activities].reverse().find((activity) => activity.kind === "rate-limit");
  if (!notice || !latest || notice.turnId !== latest.turnId) return null;
  const p = record(notice.payload);
  const time = resetTime(p.resetsAt);
  if (p.status === "rejected") {
    return (
      <p className="m-0 px-1 text-sm leading-relaxed text-destructive-foreground" data-kind="limit" data-testid="limit-line">
        {time === undefined ? "You have hit a usage limit." : `You have hit a usage limit. It resets at ${time}.`}
      </p>
    );
  }
  return null;
};

/** What the agent is doing, with the time since the turn began once it passes ten seconds. */
const ActivityLine = ({ label, since }: { readonly label: string; readonly since: string }) => (
  <p className="m-0 px-1 text-sm leading-relaxed text-muted-foreground tabular-nums" data-testid="activity-line">
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
  return <span className="tabular-nums">{` ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`}</span>;
};
