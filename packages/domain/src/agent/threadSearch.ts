/**
 * Thread search (spec 08, t3code's `searchThreads`): which chats a query finds and the
 * snippet each shows. Only the person's messages and each turn's final agent reply are
 * searched: never titles, reasoning or text still streaming.
 */
import type { Chat, ChatMessage } from "./chatModel.ts";

export const SEARCH_QUERY_MIN = 2;
export const SEARCH_QUERY_MAX = 200;
export const SEARCH_LIMIT_MAX = 50;
export const SNIPPET_MAX = 240;

export interface ThreadSearchMatch {
  readonly threadId: string;
  readonly source: "user" | "assistant";
  readonly snippet: string;
  readonly messageCreatedAt: string;
}

/** Up to 240 characters around the match, whitespace runs folded, an ellipsis where it was cut. */
export const searchSnippet = (text: string, query: string): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= SNIPPET_MAX) return flat;
  const at = flat.toLowerCase().indexOf(query.replace(/\s+/g, " ").trim().toLowerCase());
  const body = SNIPPET_MAX - 4;
  const start = Math.max(0, Math.min(Math.max(0, at - 72), flat.length - body));
  const end = Math.min(flat.length, start + body);
  return `${start > 0 ? "…" : ""}${flat.slice(start, end)}${end < flat.length ? "…" : ""}`;
};

/** A turn's final agent reply: its last assistant message that has finished streaming. */
const finalReplies = (chat: Chat): ChatMessage[] => {
  const byTurn = new Map<string, ChatMessage>();
  for (const message of chat.messages) {
    if (message.role !== "assistant" || message.streaming || message.turnId === null) continue;
    byTurn.set(message.turnId, message);
  }
  return [...byTurn.values()];
};

const newest = (messages: ReadonlyArray<ChatMessage>): ChatMessage | undefined =>
  [...messages].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))[0];

/**
 * One row per chat that matches, case-insensitively: its newest matching message of the
 * person's, else its newest matching final reply. The person's matches come first, then
 * the most recently active chat first.
 */
export const searchChats = (chats: ReadonlyArray<Chat>, query: string, limit: number): ThreadSearchMatch[] => {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [];
  const found: Array<ThreadSearchMatch & { readonly rank: number; readonly updatedAt: string }> = [];
  for (const chat of chats) {
    if (chat.deletedAt !== null) continue;
    const matches = (message: ChatMessage) => message.text.toLowerCase().includes(needle);
    const user = newest(chat.messages.filter((message) => message.role === "user" && matches(message)));
    const reply = user === undefined ? newest(finalReplies(chat).filter(matches)) : undefined;
    const message = user ?? reply;
    if (!message) continue;
    found.push({
      threadId: chat.id,
      source: user ? "user" : "assistant",
      snippet: searchSnippet(message.text, query),
      messageCreatedAt: message.createdAt,
      rank: user ? 0 : 1,
      updatedAt: chat.updatedAt,
    });
  }
  found.sort((a, b) => a.rank - b.rank || (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : a.threadId < b.threadId ? -1 : 1));
  return found.slice(0, limit).map(({ threadId, source, snippet, messageCreatedAt }) => ({ threadId, source, snippet, messageCreatedAt }));
};
