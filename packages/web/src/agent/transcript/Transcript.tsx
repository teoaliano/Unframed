import type { ChatMessage } from "@unframed/domain";
import { useState } from "react";
import { providerName } from "../providers.ts";
import { useWatchedThread, type ChatClient } from "../store.ts";
import { ChatMarkdown } from "./ChatMarkdown.tsx";

export const EMPTY_CHAT = "Ask about what is on the canvas, or say what should change or be made. Whatever is selected comes with the message as context.";

const COLLAPSE_CHARACTERS = 600;
const COLLAPSE_LINES = 8;

/** The person's message exactly as typed: never parsed as markdown. Long ones collapse. */
const UserMessage = ({ message }: { readonly message: ChatMessage }) => {
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
    </article>
  );
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
  if (!chat) return <div className="unframed-agent-transcript" />;
  const author = providerName(chat.modelSelection.provider);
  return (
    <div className="unframed-agent-transcript" data-scrolls="true" data-testid="transcript">
      {chat.messages.map((message) =>
        message.role === "user" ? (
          <UserMessage key={message.id} message={message} />
        ) : message.role === "assistant" ? (
          <article key={message.id} className="unframed-agent-message" data-role="assistant" data-message-id={message.id} data-streaming={message.streaming ? "" : undefined}>
            <header className="unframed-agent-message__author">{author}</header>
            {message.text === "" && !message.streaming ? <p className="unframed-agent-muted">(empty response)</p> : <ChatMarkdown text={message.text} />}
          </article>
        ) : null,
      )}
      {chat.messages.length === 0 && <p className="unframed-agent-empty">{EMPTY_CHAT}</p>}
    </div>
  );
};
