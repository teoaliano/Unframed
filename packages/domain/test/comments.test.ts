import { describe, expect, it } from "vitest";
import {
  agentMention,
  anchorAt,
  clusterPins,
  commentBody,
  commentThreads,
  commentsView,
  DEFAULT_COMMENT_FILTER,
  isUnread,
  pinPoint,
  prepareCommentBatch,
  regionAnchor,
  relativeTime,
  unreadCount,
  visibleThreads,
  type CommentAuthor,
  type CommentBatchContext,
  type CommentRecordLike,
} from "../src/index.ts";

const PAGE = "page:page";

const thread = (id: string, at: number, extra: Record<string, unknown> = {}): CommentRecordLike => ({
  id: `comment-thread:${id}`,
  typeName: "comment-thread",
  pageId: PAGE,
  anchor: { type: "point", x: 10, y: 20 },
  createdBy: "person",
  createdAt: at,
  resolved: null,
  isDeleted: false,
  meta: {},
  ...extra,
});

const message = (id: string, threadId: string, at: number, text: string, authorId = "person", meta: Record<string, unknown> = {}): CommentRecordLike => ({
  id: `comment:${id}`,
  typeName: "comment",
  threadId: `comment-thread:${threadId}`,
  pageId: PAGE,
  authorId,
  createdAt: at,
  editedAt: null,
  body: commentBody(text),
  isDeleted: false,
  meta,
});

const merged = (records: CommentRecordLike[], put: CommentRecordLike[]) => [...new Map([...records, ...put].map((r) => [r.id, r])).values()];

const claude: CommentAuthor = { kind: "agent", chatId: "c1", name: "Claude", provider: "claude" };

const box = { x: 100, y: 100, w: 200, h: 100 };

const context = (records: CommentRecordLike[], author: CommentAuthor = claude): CommentBatchContext => {
  let n = 0;
  return { records, boxOf: (id) => (id === "shape:img" ? box : undefined), author, pageId: PAGE, now: 5000, newId: () => `n${++n}` };
};

describe("comment threads", () => {
  it("reads threads in creation order with numbers, authors and plain text", () => {
    const records = [
      thread("b", 200, { meta: { number: 7 } }),
      thread("a", 100),
      message("m2", "a", 150, "Agreed", "chat:c1", { author: { name: "Claude", provider: "claude" } }),
      message("m1", "a", 110, "Tighter\nspacing"),
      message("m3", "b", 210, "Second"),
      thread("empty", 50),
    ];
    const threads = commentThreads(records);
    expect(threads.map((t) => [t.id, t.number])).toEqual([
      ["comment-thread:a", 1],
      ["comment-thread:b", 7],
    ]);
    expect(threads[0]!.messages.map((m) => [m.text, m.author.kind === "agent" ? m.author.name : "you"])).toEqual([
      ["Tighter\nspacing", "you"],
      ["Agreed", "Claude"],
    ]);
  });

  it("puts the pin on a point, a region corner, or a spot inside the shape it follows", () => {
    const boxOf = (id: string) => (id === "shape:img" ? box : undefined);
    expect(pinPoint({ type: "point", x: 3, y: 4 }, boxOf)).toEqual({ x: 3, y: 4 });
    expect(pinPoint({ type: "region", x: 0, y: 0, w: 10, h: 20, pinX: 1, pinY: 1 }, boxOf)).toEqual({ x: 10, y: 20 });
    expect(pinPoint({ type: "shape", shapeId: "shape:img", x: 0.5, y: 0.5, isPrecise: true }, boxOf)).toEqual({ x: 200, y: 150 });
    expect(pinPoint({ type: "shape", shapeId: "shape:img", x: 0.5, y: 0.5, isPrecise: false }, boxOf)).toEqual({ x: 300, y: 100 });
    expect(pinPoint({ type: "shape", shapeId: "shape:gone", x: 0, y: 0, isPrecise: true }, boxOf)).toBeNull();
  });

  it("anchors a click to the topmost shape under it, or to the page", () => {
    const candidates = [
      { id: "shape:under", box: { x: 0, y: 0, w: 1000, h: 1000 } },
      { id: "shape:img", box },
    ];
    expect(anchorAt({ x: 150, y: 125 }, candidates)).toEqual({ type: "shape", shapeId: "shape:img", x: 0.25, y: 0.25, isPrecise: true });
    expect(anchorAt({ x: 2000, y: 0 }, candidates)).toEqual({ type: "point", x: 2000, y: 0 });
    expect(regionAnchor({ x: 50, y: 60 }, { x: 10, y: 20 })).toEqual({ type: "region", x: 10, y: 20, w: 40, h: 40, pinX: 0, pinY: 0 });
  });

  it("finds an @Claude or @Codex mention, but not inside an email or a shape ref", () => {
    expect(agentMention("@Claude tighten this")).toBe("claude");
    expect(agentMention("hey @codex, look")).toBe("codex");
    expect(agentMention("me@claude.ai")).toBeNull();
    expect(agentMention("see @12")).toBeNull();
  });
});

describe("the comments list", () => {
  const records = [
    thread("a", 100),
    message("a1", "a", 100, "Make the sky darker"),
    message("a2", "a", 300, "Done", "chat:c1", { author: { name: "Claude", provider: "claude" } }),
    thread("b", 200, { resolved: { at: 250, by: "person" } }),
    message("b1", "b", 200, "Old note"),
    thread("c", 400, { createdBy: "chat:c1" }),
    message("c1", "c", 400, "Consider a wider crop", "chat:c1", { author: { name: "Claude", provider: "claude" } }),
  ];
  const threads = commentThreads(records);

  it("counts a thread unread when an agent wrote in it after the person last looked", () => {
    expect(isUnread(threads[0]!, {})).toBe(true);
    expect(isUnread(threads[0]!, { "comment-thread:a": 300 })).toBe(false);
    expect(unreadCount(threads, {})).toBe(2);
  });

  it("hides resolved threads, filters to the person's own, searches, and sorts by latest activity", () => {
    expect(visibleThreads(threads, DEFAULT_COMMENT_FILTER, {}).map((t) => t.number)).toEqual([3, 1]);
    expect(visibleThreads(threads, { ...DEFAULT_COMMENT_FILTER, showResolved: true }, {}).map((t) => t.number)).toEqual([3, 1, 2]);
    expect(visibleThreads(threads, { ...DEFAULT_COMMENT_FILTER, onlyMine: true }, {}).map((t) => t.number)).toEqual([1]);
    expect(visibleThreads(threads, { ...DEFAULT_COMMENT_FILTER, query: "sky" }, {}).map((t) => t.number)).toEqual([1]);
    expect(visibleThreads(threads, { ...DEFAULT_COMMENT_FILTER, query: "claude" }, {}).map((t) => t.number)).toEqual([3, 1]);
    expect(visibleThreads(threads, { ...DEFAULT_COMMENT_FILTER, sort: "unread" }, { "comment-thread:c": 500 }).map((t) => t.number)).toEqual([1, 3]);
  });

  it("says how long ago in Figma's words", () => {
    expect(relativeTime(0, 30_000)).toBe("just now");
    expect(relativeTime(0, 6 * 3_600_000)).toBe("6 hours ago");
    expect(relativeTime(0, 86_400_000)).toBe("1 day ago");
  });

  it("merges pins whose 32 px boxes overlap on screen", () => {
    const clusters = clusterPins([
      { id: "a", x: 0, y: 100 },
      { id: "b", x: 20, y: 90 },
      { id: "c", x: 200, y: 100 },
    ]);
    expect(clusters.map((cluster) => cluster.ids)).toEqual([["a", "b"], ["c"]]);
  });
});

describe("agent comment ops", () => {
  it("starts a thread on a shape, replies, and resolves it in one batch", () => {
    const records = [thread("a", 100, { meta: { number: 4 } }), message("a1", "a", 100, "Too bright")];
    const batch = prepareCommentBatch(
      [
        { op: "start", on: "img", at: { x: 150, y: 125 }, text: "Crop tighter here" },
        { op: "reply", thread: "#4", text: "Darkened it" },
        { op: "resolve", thread: "#4" },
      ],
      context(records),
    );
    if (!batch.ok) throw new Error(batch.error);
    expect(batch.threads).toEqual(["#5"]);
    const view = commentsView({ records: merged(records, batch.put), boxOf: context([]).boxOf, includeResolved: true });
    expect(view.threads).toEqual([
      expect.objectContaining({ thread: "#4", resolved: true, messages: [expect.objectContaining({ text: "Too bright", author: "You" }), expect.objectContaining({ text: "Darkened it", author: "Claude", agent: true })] }),
      expect.objectContaining({ thread: "#5", on: "img", at: { x: 150, y: 125 }, resolved: false }),
    ]);
    expect(commentsView({ records: merged(records, batch.put), boxOf: context([]).boxOf, includeResolved: false }).resolvedHidden).toBe(1);
  });

  it("refuses to edit or delete someone else's comment, and an unknown shape or thread", () => {
    const records = [thread("a", 100), message("a1", "a", 100, "Mine")];
    expect(prepareCommentBatch([{ op: "edit", comment: "a1", text: "x" }], context(records))).toEqual({ ok: false, error: "Op 0: you can edit only your own comments." });
    expect(prepareCommentBatch([{ op: "start", on: "nope", text: "x" }], context(records)).ok).toBe(false);
    expect(prepareCommentBatch([{ op: "reply", thread: "#9", text: "x" }], context(records)).ok).toBe(false);
    expect(prepareCommentBatch([{ op: "start", text: "x" }], context(records)).ok).toBe(false);
  });

  it("removes the thread with its last message", () => {
    const records = [thread("a", 100, { createdBy: "chat:c1" }), message("a1", "a", 100, "Mine", "chat:c1")];
    const batch = prepareCommentBatch([{ op: "delete", comment: "a1" }], context(records));
    if (!batch.ok) throw new Error(batch.error);
    expect(batch.remove.sort()).toEqual(["comment-thread:a", "comment:a1"]);
    expect(batch.put).toEqual([]);
  });
});
