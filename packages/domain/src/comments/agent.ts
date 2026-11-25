import type { Box } from "../grouping.ts";
import { agentShapeId, roomShapeId } from "../agent/turnText.ts";
import { COMMENT_MENTION_PROMPT } from "../agent/prompts.ts";
import {
  authorIdOf,
  authorLabel,
  authorMeta,
  commentThreads,
  nextThreadNumber,
  pinPoint,
  readAuthor,
  commentBody,
  sameAuthor,
  type CommentAnchor,
  type CommentAuthor,
  type CommentRecordLike,
  type CommentThread,
} from "./model.ts";

const MAX_OPS = 50;
const MAX_TEXT = 4000;

const round = (n: number) => Math.round(n * 100) / 100;

const describeAnchor = (thread: CommentThread, boxOf: (id: string) => Box | undefined): Record<string, unknown> => {
  const anchor = thread.anchor;
  const at = pinPoint(anchor, boxOf);
  const point = at === null ? {} : { at: { x: round(at.x), y: round(at.y) } };
  switch (anchor.type) {
    case "shape":
      return boxOf(anchor.shapeId) === undefined ? { on: agentShapeId(anchor.shapeId), shapeGone: true } : { on: agentShapeId(anchor.shapeId), ...point };
    case "region":
      return { region: { x: round(anchor.x), y: round(anchor.y), w: round(anchor.w), h: round(anchor.h) }, ...point };
    default:
      return point;
  }
};

export interface CommentsViewInput {
  readonly records: ReadonlyArray<CommentRecordLike>;
  readonly boxOf: (shapeId: string) => Box | undefined;
  readonly includeResolved: boolean;
  readonly thread?: string;
}

export const commentId = (id: string): string => (id.startsWith("comment:") ? id.slice("comment:".length) : id);

export const commentsView = (input: CommentsViewInput): { threads: Record<string, unknown>[]; resolvedHidden: number } => {
  const all = commentThreads(input.records);
  const wanted = input.thread === undefined ? undefined : findThread(all, input.thread);
  const chosen = input.thread !== undefined ? (wanted === undefined ? [] : [wanted]) : all.filter((thread) => input.includeResolved || thread.resolved === null);
  return {
    threads: chosen.map((thread) => ({
      thread: `#${thread.number}`,
      ...describeAnchor(thread, input.boxOf),
      resolved: thread.resolved !== null,
      messages: thread.messages.map((message) => ({
        id: commentId(message.id),
        author: authorLabel(message.author),
        ...(message.author.kind === "agent" ? { agent: true } : {}),
        at: new Date(message.createdAt).toISOString(),
        ...(message.editedAt === null ? {} : { edited: true }),
        text: message.text,
      })),
    })),
    resolvedHidden: input.thread !== undefined || input.includeResolved ? 0 : all.length - chosen.length,
  };
};

export const findThread = (threads: ReadonlyArray<CommentThread>, ref: string): CommentThread | undefined => {
  const trimmed = ref.trim();
  const number = /^#?(\d+)$/.exec(trimmed);
  if (number !== null) return threads.find((thread) => thread.number === Number(number[1]));
  const id = trimmed.startsWith("comment-thread:") ? trimmed : `comment-thread:${trimmed}`;
  return threads.find((thread) => thread.id === id);
};

export interface CommentBatchContext {
  readonly records: ReadonlyArray<CommentRecordLike>;
  readonly boxOf: (shapeId: string) => Box | undefined;
  readonly author: CommentAuthor;
  readonly pageId: string;
  readonly now: number;
  readonly newId: () => string;
}

export type CommentBatch =
  | { readonly ok: true; readonly put: CommentRecordLike[]; readonly remove: string[]; readonly touched: string[]; readonly threads: string[] }
  | { readonly ok: false; readonly error: string };

const obj = (value: unknown): Record<string, unknown> => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {});

const point = (value: unknown): { x: number; y: number } | undefined => {
  const p = obj(value);
  return typeof p.x === "number" && typeof p.y === "number" && Number.isFinite(p.x) && Number.isFinite(p.y) ? { x: p.x, y: p.y } : undefined;
};

const textOf = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

export const prepareCommentBatch = (ops: unknown, context: CommentBatchContext): CommentBatch => {
  if (!Array.isArray(ops) || ops.length === 0) return { ok: false, error: "ops must be a non-empty array." };
  if (ops.length > MAX_OPS) return { ok: false, error: `At most ${MAX_OPS} ops per call.` };
  const records = new Map<string, CommentRecordLike>(context.records.map((record) => [record.id, record]));
  const removed = new Set<string>();
  const touched: string[] = [];
  const threadsOut: string[] = [];
  const touch = (record: CommentRecordLike) => {
    records.set(record.id, record);
    removed.delete(record.id);
    if (!touched.includes(record.id)) touched.push(record.id);
  };
  const drop = (id: string) => {
    records.delete(id);
    removed.add(id);
    if (!touched.includes(id)) touched.push(id);
  };
  const current = () => [...records.values()];
  const own = (authorId: unknown, meta: unknown) => sameAuthor(context.author, readAuthor(authorId, meta));
  const comment = (threadId: string, text: string): CommentRecordLike => ({
    id: `comment:${context.newId()}`,
    typeName: "comment",
    threadId,
    pageId: context.pageId,
    authorId: authorIdOf(context.author),
    createdAt: context.now,
    editedAt: null,
    body: commentBody(text),
    isDeleted: false,
    meta: authorMeta(context.author),
  });
  const needText = (op: Record<string, unknown>, index: number): string | { error: string } => {
    const text = textOf(op.text);
    if (text === "") return { error: `Op ${index}: text is required.` };
    if (text.length > MAX_TEXT) return { error: `Op ${index}: text is longer than ${MAX_TEXT} characters.` };
    return text;
  };
  const threadFor = (op: Record<string, unknown>, index: number): CommentRecordLike | { error: string } => {
    if (typeof op.thread !== "string") return { error: `Op ${index}: thread is required, as "#<number>".` };
    const found = findThread(commentThreads(current()), op.thread);
    if (found === undefined) return { error: `Op ${index}: no comment thread ${op.thread}. Call comments_read for the threads.` };
    return records.get(found.id)!;
  };

  for (const [index, raw] of ops.entries()) {
    const op = obj(raw);
    switch (op.op) {
      case "start": {
        const text = needText(op, index);
        if (typeof text !== "string") return { ok: false, error: text.error };
        let anchor: CommentAnchor;
        const at = op.at === undefined ? undefined : point(op.at);
        if (op.at !== undefined && at === undefined) return { ok: false, error: `Op ${index}: at must be {x, y} in canvas coordinates.` };
        if (op.region !== undefined) {
          const region = obj(op.region);
          const ok = ["x", "y", "w", "h"].every((key) => typeof region[key] === "number" && Number.isFinite(region[key]));
          if (!ok || (region.w as number) <= 0 || (region.h as number) <= 0) return { ok: false, error: `Op ${index}: region must be {x, y, w, h} with w and h above 0.` };
          anchor = { type: "region", x: region.x as number, y: region.y as number, w: region.w as number, h: region.h as number, pinX: 1, pinY: 0 };
        } else if (typeof op.on === "string") {
          const shapeId = roomShapeId(op.on.replace(/^@/, ""));
          const box = context.boxOf(shapeId);
          if (box === undefined) return { ok: false, error: `Op ${index}: no shape ${op.on} on the canvas. Use the id canvas_read reports.` };
          anchor =
            at === undefined
              ? { type: "shape", shapeId, x: 1, y: 0, isPrecise: false }
              : {
                  type: "shape",
                  shapeId,
                  x: box.w === 0 ? 0 : Math.min(1, Math.max(0, (at.x - box.x) / box.w)),
                  y: box.h === 0 ? 0 : Math.min(1, Math.max(0, (at.y - box.y) / box.h)),
                  isPrecise: true,
                };
        } else if (at !== undefined) {
          anchor = { type: "point", x: at.x, y: at.y };
        } else {
          return { ok: false, error: `Op ${index}: say where the comment goes with on (a shape id), at ({x, y}) or region ({x, y, w, h}).` };
        }
        const threadId = `comment-thread:${context.newId()}`;
        const number = nextThreadNumber(current());
        touch({
          id: threadId,
          typeName: "comment-thread",
          pageId: context.pageId,
          anchor,
          createdBy: authorIdOf(context.author),
          createdAt: context.now,
          resolved: null,
          isDeleted: false,
          meta: { ...authorMeta(context.author), number },
        });
        touch(comment(threadId, text));
        threadsOut.push(`#${number}`);
        break;
      }
      case "reply": {
        const thread = threadFor(op, index);
        if ("error" in thread) return { ok: false, error: String(thread.error) };
        const text = needText(op, index);
        if (typeof text !== "string") return { ok: false, error: text.error };
        touch(comment(thread.id, text));
        break;
      }
      case "resolve":
      case "reopen": {
        const thread = threadFor(op, index);
        if ("error" in thread) return { ok: false, error: String(thread.error) };
        touch({ ...thread, resolved: op.op === "resolve" ? { at: context.now, by: authorIdOf(context.author) } : null });
        break;
      }
      case "edit":
      case "delete": {
        if (op.op === "delete" && typeof op.thread === "string") {
          const thread = threadFor(op, index);
          if ("error" in thread) return { ok: false, error: String(thread.error) };
          if (!own(thread.createdBy, thread.meta)) return { ok: false, error: `Op ${index}: you can delete only threads you started.` };
          for (const record of current()) if (record.typeName === "comment" && record.threadId === thread.id) drop(record.id);
          drop(thread.id);
          break;
        }
        if (typeof op.comment !== "string") return { ok: false, error: `Op ${index}: comment is required (a message id from comments_read).` };
        const id = op.comment.startsWith("comment:") ? op.comment : `comment:${op.comment}`;
        const message = records.get(id);
        if (message === undefined || message.typeName !== "comment" || message.isDeleted === true) return { ok: false, error: `Op ${index}: no comment ${op.comment}.` };
        if (!own(message.authorId, message.meta)) return { ok: false, error: `Op ${index}: you can ${op.op} only your own comments.` };
        if (op.op === "edit") {
          const text = needText(op, index);
          if (typeof text !== "string") return { ok: false, error: text.error };
          touch({ ...message, body: commentBody(text), editedAt: context.now });
          break;
        }
        const threadId = String(message.threadId);
        const left = current().filter((record) => record.typeName === "comment" && record.threadId === threadId && record.id !== id);
        drop(id);
        if (left.length === 0 && records.has(threadId)) drop(threadId);
        break;
      }
      default:
        return { ok: false, error: `Op ${index}: unknown op ${JSON.stringify(op.op)}. Use start, reply, resolve, reopen, edit or delete.` };
    }
  }
  return {
    ok: true,
    put: touched.filter((id) => !removed.has(id)).map((id) => records.get(id)!),
    remove: [...removed].filter((id) => context.records.some((record) => record.id === id)),
    touched,
    threads: threadsOut,
  };
};

const whereOf = (thread: CommentThread, boxOf: (id: string) => Box | undefined): string => {
  const anchor = thread.anchor;
  if (anchor.type === "shape") return `on the shape ${agentShapeId(anchor.shapeId)}`;
  if (anchor.type === "region") return `over the region ${round(anchor.x)}, ${round(anchor.y)}, ${round(anchor.w)} by ${round(anchor.h)}`;
  const at = pinPoint(anchor, boxOf);
  return at === null ? "on the canvas" : `at ${round(at.x)}, ${round(at.y)}`;
};

export const commentMentionMessage = (thread: CommentThread, boxOf: (id: string) => Box | undefined): string =>
  COMMENT_MENTION_PROMPT.replaceAll("<thread>", `#${thread.number}`)
    .replace("<where>", whereOf(thread, boxOf))
    .replace("<messages>", thread.messages.map((message) => `> ${authorLabel(message.author)}: ${message.text.replace(/\n/g, "\n> ")}`).join("\n"));
