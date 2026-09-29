import type { ChatSummary, ThreadSearchMatch } from "@unframed/contracts";
import { tabLabel } from "@unframed/domain";
import { X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ChatClient } from "../store.ts";

const MIN = 2;
const MAX = 200;
const PAUSE_MS = 200;

/** The text with every case-insensitive occurrence of the query in bold. */
const bolden = (text: string, query: string): ReactNode[] => {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [text];
  const parts: ReactNode[] = [];
  const lower = text.toLowerCase();
  let at = 0;
  for (let found = lower.indexOf(needle); found !== -1; found = lower.indexOf(needle, at)) {
    if (found > at) parts.push(text.slice(at, found));
    parts.push(<b key={found}>{text.slice(found, found + needle.length)}</b>);
    at = found + needle.length;
  }
  if (at < text.length) parts.push(text.slice(at));
  return parts;
};

interface Row {
  readonly threadId: string;
  readonly match?: ThreadSearchMatch;
}

/**
 * Thread search (t3code's): a field over the tab strip that finds chats by what was said in
 * them, from two characters and after a short pause, with chat titles matched here as a
 * fallback. Choosing a result makes it the active chat.
 */
export const ThreadSearch = ({ client, chats, onClose }: { readonly client: ChatClient; readonly chats: ReadonlyArray<ChatSummary>; readonly onClose: () => void }) => {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<ReadonlyArray<ThreadSearchMatch>>();
  const [highlight, setHighlight] = useState(0);
  const field = useRef<HTMLInputElement>(null);
  const trimmed = query.trim();
  const searchable = trimmed.length >= MIN && trimmed.length <= MAX;

  useEffect(() => field.current?.focus(), []);

  useEffect(() => {
    if (!searchable) {
      setMatches(undefined);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      client.engine.call("orchestration.searchThreads", { projectId: client.project, query: trimmed, limit: 50 }).then(
        (answer) => {
          if (live) setMatches(answer.matches);
        },
        () => {
          if (live) setMatches([]);
        },
      );
    }, PAUSE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [client, trimmed, searchable]);

  const byId = new Map(chats.map((chat) => [chat.id, chat]));
  const rows: Row[] = [];
  if (matches) {
    for (const match of matches) if (byId.has(match.threadId)) rows.push({ threadId: match.threadId, match });
    const needle = trimmed.toLowerCase();
    for (const chat of chats) {
      if (chat.title.toLowerCase().includes(needle) && !rows.some((row) => row.threadId === chat.id)) rows.push({ threadId: chat.id });
    }
  }

  const choose = (threadId: string) => {
    client.setUi({ chosen: threadId, pinned: threadId, searchOpen: false });
    onClose();
  };

  return (
    <div className="unframed-agent-search" role="search">
      <input
        ref={field}
        className="unframed-agent-search__field"
        aria-label="Search chats"
        placeholder="Search chats"
        value={query}
        maxLength={MAX}
        onChange={(event) => {
          setQuery(event.currentTarget.value);
          setHighlight(0);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          } else if (event.key === "ArrowDown" && rows.length > 0) {
            event.preventDefault();
            setHighlight((highlight + 1) % rows.length);
          } else if (event.key === "ArrowUp" && rows.length > 0) {
            event.preventDefault();
            setHighlight((highlight - 1 + rows.length) % rows.length);
          } else if (event.key === "Enter" && rows[highlight]) {
            event.preventDefault();
            choose(rows[highlight]!.threadId);
          }
        }}
      />
      <button type="button" className="unframed-agent-search__close" aria-label="Close search" onClick={onClose}>
        <X size={14} aria-hidden />
      </button>
      {matches !== undefined && searchable && (
        <div className="unframed-agent-search__results" role="listbox" aria-label="Search results">
          {rows.length === 0 ? (
            <p className="unframed-agent-search__empty">No chats match.</p>
          ) : (
            rows.map((row, index) => {
              const chat = byId.get(row.threadId)!;
              return (
                <button
                  key={row.threadId}
                  type="button"
                  role="option"
                  aria-selected={index === highlight}
                  className="unframed-agent-search__row"
                  onMouseEnter={() => setHighlight(index)}
                  onClick={() => choose(row.threadId)}
                >
                  <span className="unframed-agent-search__label">{row.match ? tabLabel(chat) : bolden(tabLabel(chat), trimmed)}</span>
                  {row.match && (
                    <span className="unframed-agent-search__snippet">
                      {row.match.source === "user" ? "You: " : "Agent: "}
                      {bolden(row.match.snippet, trimmed)}
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};
