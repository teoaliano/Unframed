import type { Box } from "../grouping.ts";
import { plainText } from "../refs.ts";
import { richTextOf } from "../agent/canvasTools.ts";

export const commentBody = (text: string) => richTextOf(text.replace(/\r\n?/g, "\n"));

export const PERSON_AUTHOR = "person";

export type CommentAgentKind = "claude" | "codex" | "outside";

export type CommentAuthor =
  | { readonly kind: "person" }
  | { readonly kind: "agent"; readonly chatId: string; readonly name: string; readonly provider: CommentAgentKind };

export type CommentAnchor =
  | { readonly type: "shape"; readonly shapeId: string; readonly x: number; readonly y: number; readonly isPrecise: boolean }
  | { readonly type: "point"; readonly x: number; readonly y: number }
  | { readonly type: "region"; readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly pinX?: number; readonly pinY?: number }
  | { readonly type: "page" };

export interface CommentRecordLike {
  readonly id: string;
  readonly typeName: string;
  readonly [key: string]: unknown;
}

export interface CommentMessage {
  readonly id: string;
  readonly threadId: string;
  readonly author: CommentAuthor;
  readonly createdAt: number;
  readonly editedAt: number | null;
  readonly text: string;
  readonly body: unknown;
}

export interface CommentThread {
  readonly id: string;
  readonly number: number;
  readonly pageId: string;
  readonly anchor: CommentAnchor;
  readonly createdBy: CommentAuthor;
  readonly createdAt: number;
  readonly resolved: { readonly at: number; readonly by: string } | null;
  readonly messages: ReadonlyArray<CommentMessage>;
}

const obj = (value: unknown): Record<string, unknown> => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {});

export const agentAuthorId = (chatId: string): string => `chat:${chatId}`;

export const agentName = (provider: CommentAgentKind, connection?: string): string =>
  provider === "claude" ? "Claude" : provider === "codex" ? "Codex" : connection !== undefined && connection.trim() !== "" ? connection.trim() : "Agent";

export const authorMeta = (author: CommentAuthor): Record<string, unknown> =>
  author.kind === "person" ? {} : { author: { name: author.name, provider: author.provider } };

export const authorIdOf = (author: CommentAuthor): string => (author.kind === "person" ? PERSON_AUTHOR : agentAuthorId(author.chatId));

export const readAuthor = (authorId: unknown, meta: unknown): CommentAuthor => {
  const id = typeof authorId === "string" ? authorId : PERSON_AUTHOR;
  const chat = /^chat:(.+)$/.exec(id);
  if (chat === null) return { kind: "person" };
  const stamped = obj(obj(meta).author);
  const provider: CommentAgentKind = stamped.provider === "claude" || stamped.provider === "codex" ? stamped.provider : "outside";
  const name = typeof stamped.name === "string" && stamped.name !== "" ? stamped.name : agentName(provider);
  return { kind: "agent", chatId: chat[1]!, name, provider };
};

export const authorLabel = (author: CommentAuthor): string => (author.kind === "person" ? "You" : author.name);

export const sameAuthor = (a: CommentAuthor, b: CommentAuthor): boolean =>
  a.kind === "person" ? b.kind === "person" : b.kind === "agent" && a.chatId === b.chatId;

export const commentText = (body: unknown): string => plainText(body);

const readAnchor = (value: unknown): CommentAnchor => {
  const anchor = obj(value);
  const num = (key: string) => (typeof anchor[key] === "number" ? (anchor[key] as number) : 0);
  switch (anchor.type) {
    case "shape":
      return { type: "shape", shapeId: String(anchor.shapeId ?? ""), x: num("x"), y: num("y"), isPrecise: anchor.isPrecise === true };
    case "point":
      return { type: "point", x: num("x"), y: num("y") };
    case "region":
      return {
        type: "region",
        x: num("x"),
        y: num("y"),
        w: num("w"),
        h: num("h"),
        ...(typeof anchor.pinX === "number" ? { pinX: anchor.pinX } : {}),
        ...(typeof anchor.pinY === "number" ? { pinY: anchor.pinY } : {}),
      };
    default:
      return { type: "page" };
  }
};

export const threadNumberOf = (record: CommentRecordLike): number | undefined => {
  const number = obj(record.meta).number;
  return typeof number === "number" && Number.isInteger(number) && number > 0 ? number : undefined;
};

export const commentThreads = (records: ReadonlyArray<CommentRecordLike>): CommentThread[] => {
  const messages = new Map<string, CommentMessage[]>();
  for (const record of records) {
    if (record.typeName !== "comment" || record.isDeleted === true) continue;
    const threadId = String(record.threadId ?? "");
    const message: CommentMessage = {
      id: record.id,
      threadId,
      author: readAuthor(record.authorId, record.meta),
      createdAt: typeof record.createdAt === "number" ? record.createdAt : 0,
      editedAt: typeof record.editedAt === "number" ? record.editedAt : null,
      text: commentText(record.body),
      body: record.body,
    };
    messages.set(threadId, [...(messages.get(threadId) ?? []), message]);
  }
  const raw = records.filter((record) => record.typeName === "comment-thread" && record.isDeleted !== true);
  raw.sort((a, b) => Number(a.createdAt ?? 0) - Number(b.createdAt ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const taken = new Set(raw.map(threadNumberOf).filter((n): n is number => n !== undefined));
  let next = 1;
  const threads: CommentThread[] = [];
  for (const record of raw) {
    const list = (messages.get(record.id) ?? []).sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
    if (list.length === 0) continue;
    let number = threadNumberOf(record);
    if (number === undefined) {
      while (taken.has(next)) next++;
      number = next;
      taken.add(number);
    }
    const resolved = obj(record.resolved);
    threads.push({
      id: record.id,
      number,
      pageId: String(record.pageId ?? ""),
      anchor: readAnchor(record.anchor),
      createdBy: readAuthor(record.createdBy, record.meta),
      createdAt: typeof record.createdAt === "number" ? record.createdAt : 0,
      resolved: typeof resolved.at === "number" ? { at: resolved.at, by: String(resolved.by ?? PERSON_AUTHOR) } : null,
      messages: list,
    });
  }
  return threads;
};

export const nextThreadNumber = (records: ReadonlyArray<CommentRecordLike>): number => {
  let largest = 0;
  for (const record of records) {
    if (record.typeName !== "comment-thread") continue;
    largest = Math.max(largest, threadNumberOf(record) ?? 0);
  }
  for (const thread of commentThreads(records)) largest = Math.max(largest, thread.number);
  return largest + 1;
};

export interface Point {
  readonly x: number;
  readonly y: number;
}

export const pinPoint = (anchor: CommentAnchor, boxOf: (shapeId: string) => Box | undefined): Point | null => {
  switch (anchor.type) {
    case "point":
      return { x: anchor.x, y: anchor.y };
    case "region":
      return { x: anchor.x + (anchor.pinX ?? 1) * anchor.w, y: anchor.y + (anchor.pinY ?? 1) * anchor.h };
    case "shape": {
      const box = boxOf(anchor.shapeId);
      if (box === undefined) return null;
      return anchor.isPrecise ? { x: box.x + anchor.x * box.w, y: box.y + anchor.y * box.h } : { x: box.x + box.w, y: box.y };
    }
    default:
      return null;
  }
};

export interface AnchorCandidate {
  readonly id: string;
  readonly box: Box;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export const anchorAt = (point: Point, candidates: ReadonlyArray<AnchorCandidate>): CommentAnchor => {
  for (let i = candidates.length - 1; i >= 0; i--) {
    const { id, box } = candidates[i]!;
    if (point.x < box.x || point.y < box.y || point.x > box.x + box.w || point.y > box.y + box.h) continue;
    return {
      type: "shape",
      shapeId: id,
      x: box.w === 0 ? 0 : clamp01((point.x - box.x) / box.w),
      y: box.h === 0 ? 0 : clamp01((point.y - box.y) / box.h),
      isPrecise: true,
    };
  }
  return { type: "point", x: point.x, y: point.y };
};

export const regionAnchor = (start: Point, end: Point): CommentAnchor => {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  return {
    type: "region",
    x,
    y,
    w: Math.abs(end.x - start.x),
    h: Math.abs(end.y - start.y),
    pinX: end.x >= start.x ? 1 : 0,
    pinY: end.y >= start.y ? 1 : 0,
  };
};

export const AGENT_MENTION = /(^|[^\w@])@(claude|codex)\b/i;

export const agentMention = (text: string): "claude" | "codex" | null => {
  const found = AGENT_MENTION.exec(text);
  return found === null ? null : (found[2]!.toLowerCase() as "claude" | "codex");
};
