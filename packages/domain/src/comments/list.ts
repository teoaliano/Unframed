import { authorLabel, type CommentThread, type Point } from "./model.ts";

export type SeenTimes = Readonly<Record<string, number>>;

export const lastActivity = (thread: CommentThread): number => thread.messages.reduce((latest, message) => Math.max(latest, message.createdAt, message.editedAt ?? 0), thread.createdAt);

export const isUnread = (thread: CommentThread, seen: SeenTimes): boolean => {
  const since = seen[thread.id] ?? 0;
  return thread.messages.some((message) => message.author.kind !== "person" && Math.max(message.createdAt, message.editedAt ?? 0) > since);
};

export const unreadCount = (threads: ReadonlyArray<CommentThread>, seen: SeenTimes): number =>
  threads.filter((thread) => thread.resolved === null && isUnread(thread, seen)).length;

export const personTookPart = (thread: CommentThread): boolean => thread.messages.some((message) => message.author.kind === "person");

export interface CommentFilter {
  readonly query: string;
  readonly showResolved: boolean;
  readonly onlyMine: boolean;
  readonly sort: "date" | "unread";
}

export const DEFAULT_COMMENT_FILTER: CommentFilter = { query: "", showResolved: false, onlyMine: false, sort: "date" };

export const matchesQuery = (thread: CommentThread, query: string): boolean => {
  const words = query.trim().toLowerCase().split(/\s+/).filter((word) => word !== "");
  if (words.length === 0) return true;
  const haystack = [`#${thread.number}`, ...thread.messages.flatMap((message) => [message.text, authorLabel(message.author)])].join("\n").toLowerCase();
  return words.every((word) => haystack.includes(word));
};

export const visibleThreads = (threads: ReadonlyArray<CommentThread>, filter: CommentFilter, seen: SeenTimes): CommentThread[] => {
  const kept = threads.filter(
    (thread) => (filter.showResolved || thread.resolved === null) && (!filter.onlyMine || personTookPart(thread)) && matchesQuery(thread, filter.query),
  );
  return kept.sort((a, b) => {
    if (filter.sort === "unread") {
      const unread = Number(isUnread(b, seen)) - Number(isUnread(a, seen));
      if (unread !== 0) return unread;
    }
    return lastActivity(b) - lastActivity(a) || b.number - a.number;
  });
};

export const participants = (thread: CommentThread): CommentThread["messages"][number]["author"][] => {
  const seen = new Set<string>();
  const out: CommentThread["messages"][number]["author"][] = [];
  for (const message of thread.messages) {
    const key = message.author.kind === "person" ? "person" : message.author.chatId;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(message.author);
  }
  return out;
};

export const replyCountLabel = (thread: CommentThread): string | null => {
  const replies = thread.messages.length - 1;
  return replies <= 0 ? null : replies === 1 ? "1 reply" : `${replies} replies`;
};

export const relativeTime = (at: number, now: number): string => {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return minutes === 1 ? "1 minute ago" : `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return days === 1 ? "1 day ago" : `${days} days ago`;
  const weeks = Math.round(days / 7);
  if (days < 30) return weeks === 1 ? "1 week ago" : `${weeks} weeks ago`;
  const months = Math.round(days / 30);
  if (days < 365) return months === 1 ? "1 month ago" : `${months} months ago`;
  const years = Math.round(days / 365);
  return years === 1 ? "1 year ago" : `${years} years ago`;
};

export interface ScreenPin extends Point {
  readonly id: string;
}

export interface PinCluster extends Point {
  readonly ids: ReadonlyArray<string>;
}

export const PIN_SIZE = 32;

export const clusterPins = (pins: ReadonlyArray<ScreenPin>, size: number = PIN_SIZE): PinCluster[] => {
  const clusters: Array<{ ids: string[]; sx: number; sy: number }> = [];
  const centre = (pin: Point): Point => ({ x: pin.x + size / 2, y: pin.y - size / 2 });
  for (const pin of pins) {
    const c = centre(pin);
    const near = clusters.find((cluster) => {
      const n = cluster.ids.length;
      return Math.abs(cluster.sx / n - c.x) < size && Math.abs(cluster.sy / n - c.y) < size;
    });
    if (near) {
      near.ids.push(pin.id);
      near.sx += c.x;
      near.sy += c.y;
    } else {
      clusters.push({ ids: [pin.id], sx: c.x, sy: c.y });
    }
  }
  return clusters.map((cluster) => ({ ids: cluster.ids, x: cluster.sx / cluster.ids.length, y: cluster.sy / cluster.ids.length }));
};
