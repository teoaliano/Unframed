import type { ChatSummary, ThreadSearchMatch } from "@unframed/contracts";
import { tabLabel } from "@unframed/domain";
import { X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { cn } from "~/lib/utils";
import { listboxPopupClass, listboxRowClass } from "../../chrome/listbox.ts";
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
    parts.push(
      <b key={found} className="font-semibold text-foreground">
        {text.slice(found, found + needle.length)}
      </b>,
    );
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
    <div className="absolute inset-0 z-[2] flex items-center gap-1 border-b bg-background px-2" role="search">
      <Input
        ref={field}
        size="compact"
        className="min-w-0 flex-1"
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
      <Button variant="ghost-muted" size="icon-xs" aria-label="Close search" onClick={onClose}>
        <X aria-hidden />
      </Button>
      {matches !== undefined && searchable && (
        // Focus stays in the field, which moves the highlight: the rows are options, not buttons.
        <div className={`${listboxPopupClass} absolute top-full right-2 left-2 max-h-80`} role="listbox" aria-label="Search results">
          {rows.length === 0 ? (
            <p className="m-0 px-2 py-1.5 text-sm text-muted-foreground">No chats match.</p>
          ) : (
            rows.map((row, index) => {
              const chat = byId.get(row.threadId)!;
              return (
                <div
                  key={row.threadId}
                  role="option"
                  aria-selected={index === highlight}
                  data-highlighted={index === highlight ? "" : undefined}
                  className={cn(listboxRowClass, "flex-col items-start gap-0.5")}
                  onMouseEnter={() => setHighlight(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(row.threadId)}
                >
                  <span className="max-w-full truncate font-medium">{row.match ? tabLabel(chat) : bolden(tabLabel(chat), trimmed)}</span>
                  {row.match && (
                    <span className="text-xs text-muted-foreground">
                      <span className={row.match.source === "user" ? "text-info-foreground" : "text-success-foreground"}>{row.match.source === "user" ? "You: " : "Agent: "}</span>
                      {bolden(row.match.snippet, trimmed)}
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};
