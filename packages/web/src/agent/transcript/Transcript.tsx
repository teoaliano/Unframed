import { agentShapeId, revertSkipLine, type ChatMessage } from "@unframed/domain";
import { useEffect, useRef, useState } from "react";
import { useMaybeEditor } from "tldraw";
import { describeShape } from "../composer/chips.tsx";
import { ConfirmDialog } from "../ConfirmDialog.tsx";
import { messageOf } from "../send.ts";
import { providerName } from "../providers.ts";
import { Clock, Undo2, X } from "lucide-react";
import { Tip } from "../../chrome/ui.tsx";
import { returnQueued, sendQueued } from "../queue.tsx";
import { useQueue, useWatchedThread, type ChatClient } from "../store.ts";
import { ChatMarkdown } from "./ChatMarkdown.tsx";

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
export const Transcript = ({ client, chatId }: TranscriptProps) => {
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
      .catch((error: unknown) => client.setUi({ error: messageOf(error) }));
  };
  if (!chat) return <div className="unframed-agent-transcript" />;
  const author = providerName(chat.modelSelection.provider);
  return (
    <div className="unframed-agent-transcript" data-scrolls="true" data-testid="transcript">
      {chat.messages.map((message) =>
        message.role === "user" ? (
          <UserMessage key={message.id} message={message} running={running} onEdit={(restoreCanvas) => edit(message, restoreCanvas)} />
        ) : message.role === "assistant" ? (
          <article key={message.id} className="unframed-agent-message" data-role="assistant" data-message-id={message.id} data-streaming={message.streaming ? "" : undefined}>
            <header className="unframed-agent-message__author">{author}</header>
            {message.text === "" && !message.streaming ? <p className="unframed-agent-muted">(empty response)</p> : <ChatMarkdown text={message.text} />}
          </article>
        ) : null,
      )}
      <QueuedMessages client={client} chatId={chatId} />
      {chat.messages.length === 0 && <p className="unframed-agent-empty">{EMPTY_CHAT}</p>}
    </div>
  );
};
