import {
  anchorAt,
  commentBody,
  commentThreads,
  DEFAULT_COMMENT_FILTER,
  nextThreadNumber,
  pinPoint,
  PERSON_AUTHOR,
  type CommentAnchor,
  type CommentFilter,
  type CommentRecordLike,
  type CommentThread,
  type Point,
  type SeenTimes,
} from "@unframed/domain";
import { atom, computed, uniqueId, type Atom, type Computed, type Editor, type TLRecord, type TLShape } from "tldraw";

export const COMMENT_TOOL = "comments";

export type CommentOpen = { readonly kind: "thread"; readonly id: string } | { readonly kind: "draft"; readonly anchor: CommentAnchor } | null;

export interface PlacedThread {
  readonly thread: CommentThread;
  readonly at: Point;
}

const SKIPPED_TYPES = new Set(["wire", "arrow", "line", "draw", "highlight"]);

const seenKey = (project: string) => `unframed.comments.seen.${project}`;

const loadSeen = (project: string): SeenTimes => {
  try {
    const raw = window.localStorage.getItem(seenKey(project));
    const parsed: unknown = raw === null ? {} : JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, value]) => typeof value === "number")) as SeenTimes;
  } catch {
    return {};
  }
};

const saveSeen = (project: string, seen: SeenTimes) => {
  try {
    window.localStorage.setItem(seenKey(project), JSON.stringify(seen));
  } catch {
    return;
  }
};

type RecordQuery = (typeName: string) => Computed<CommentRecordLike[]>;

export class CommentsUi {
  readonly editor: Editor;
  readonly open: Atom<CommentOpen> = atom("comments open", null);
  readonly hovered: Atom<string | null> = atom("comments hovered", null);
  readonly hidden: Atom<boolean> = atom("comments hidden", false);
  readonly filter: Atom<CommentFilter> = atom("comments filter", DEFAULT_COMMENT_FILTER);
  readonly seen: Atom<SeenTimes> = atom("comments seen", {});
  readonly region: Atom<{ start: Point; end: Point } | null> = atom("comments region", null);
  readonly dragging: Atom<{ id: string; at: Point } | null> = atom("comments dragging", null);
  readonly threads: Computed<CommentThread[]>;
  readonly placed: Computed<PlacedThread[]>;
  private project = "";
  private readonly threadRecords: Computed<CommentRecordLike[]>;
  private readonly commentRecords: Computed<CommentRecordLike[]>;

  constructor(editor: Editor) {
    this.editor = editor;
    const query = editor.store.query.records.bind(editor.store.query) as unknown as RecordQuery;
    this.threadRecords = query("comment-thread");
    this.commentRecords = query("comment");
    this.threads = computed("comment threads", () => commentThreads([...this.threadRecords.get(), ...this.commentRecords.get()]));
    this.placed = computed("placed comment threads", () => {
      const pageId = editor.getCurrentPageId();
      const out: PlacedThread[] = [];
      for (const thread of this.threads.get()) {
        if (thread.pageId !== pageId) continue;
        const at = pinPoint(thread.anchor, (id) => {
          const bounds = editor.getShapePageBounds(id as TLShape["id"]);
          return bounds === undefined ? undefined : { x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h };
        });
        if (at !== null) out.push({ thread, at });
      }
      return out;
    });
  }

  setProject(project: string) {
    if (project === this.project) return;
    this.project = project;
    this.seen.set(loadSeen(project));
  }

  thread(id: string): CommentThread | undefined {
    return this.threads.get().find((thread) => thread.id === id);
  }

  placedThread(id: string): PlacedThread | undefined {
    return this.placed.get().find((placed) => placed.thread.id === id);
  }

  markSeen(id: string, at: number = Date.now()) {
    const next = { ...this.seen.get(), [id]: at };
    this.seen.set(next);
    saveSeen(this.project, next);
  }

  markUnread(id: string) {
    const { [id]: _dropped, ...rest } = this.seen.get();
    this.seen.set(rest);
    saveSeen(this.project, rest);
  }

  markAllSeen() {
    const now = Date.now();
    const next: Record<string, number> = { ...this.seen.get() };
    for (const thread of this.threads.get()) next[thread.id] = now;
    this.seen.set(next);
    saveSeen(this.project, next);
  }

  openThread(id: string) {
    this.open.set({ kind: "thread", id });
    this.markSeen(id);
  }

  close() {
    this.open.set(null);
  }

  anchorFor(point: Point): CommentAnchor {
    const editor = this.editor;
    const candidates = editor
      .getCurrentPageShapesSorted()
      .filter((shape) => shape.parentId === editor.getCurrentPageId() && !SKIPPED_TYPES.has(shape.type))
      .flatMap((shape) => {
        const bounds = editor.getShapePageBounds(shape.id);
        return bounds === undefined ? [] : [{ id: shape.id as string, box: { x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h } }];
      });
    return anchorAt(point, candidates);
  }

  private records(): CommentRecordLike[] {
    return [...this.threadRecords.get(), ...this.commentRecords.get()];
  }

  private write(put: CommentRecordLike[], remove: string[] = []) {
    const store = this.editor.store;
    this.editor.run(
      () => {
        if (remove.length > 0) store.remove(remove as TLRecord["id"][]);
        if (put.length > 0) store.put(put as unknown as TLRecord[]);
      },
      { history: "ignore" },
    );
  }

  private message(threadId: string, text: string, now: number): CommentRecordLike {
    return {
      id: `comment:${uniqueId()}`,
      typeName: "comment",
      threadId,
      pageId: this.editor.getCurrentPageId(),
      authorId: PERSON_AUTHOR,
      createdAt: now,
      editedAt: null,
      body: commentBody(text),
      isDeleted: false,
      meta: {},
    };
  }

  startThread(anchor: CommentAnchor, text: string): string {
    const now = Date.now();
    const id = `comment-thread:${uniqueId()}`;
    this.write([
      {
        id,
        typeName: "comment-thread",
        pageId: this.editor.getCurrentPageId(),
        anchor,
        createdBy: PERSON_AUTHOR,
        createdAt: now,
        resolved: null,
        isDeleted: false,
        meta: { number: nextThreadNumber(this.records()) },
      },
      this.message(id, text, now),
    ]);
    this.markSeen(id, now);
    return id;
  }

  reply(threadId: string, text: string) {
    const now = Date.now();
    this.write([this.message(threadId, text, now)]);
    this.markSeen(threadId, now);
  }

  edit(commentId: string, text: string) {
    const record = this.commentRecords.get().find((item) => item.id === commentId);
    if (record === undefined) return;
    this.write([{ ...record, body: commentBody(text), editedAt: Date.now() }]);
  }

  deleteComment(commentId: string) {
    const record = this.commentRecords.get().find((item) => item.id === commentId);
    if (record === undefined) return;
    const threadId = String(record.threadId);
    const left = this.commentRecords.get().filter((item) => item.threadId === threadId && item.id !== commentId && item.isDeleted !== true);
    if (left.length === 0) {
      this.deleteThread(threadId);
      return;
    }
    this.write([], [commentId]);
  }

  deleteThread(threadId: string) {
    const ids = this.commentRecords.get().filter((item) => item.threadId === threadId).map((item) => item.id);
    if (this.open.get()?.kind === "thread" && (this.open.get() as { id: string }).id === threadId) this.close();
    this.write([], [...ids, threadId]);
  }

  setResolved(threadId: string, resolved: boolean) {
    const record = this.threadRecords.get().find((item) => item.id === threadId);
    if (record === undefined) return;
    this.write([{ ...record, resolved: resolved ? { at: Date.now(), by: PERSON_AUTHOR } : null }]);
  }

  moveThread(threadId: string, anchor: CommentAnchor) {
    const record = this.threadRecords.get().find((item) => item.id === threadId);
    if (record === undefined) return;
    this.write([{ ...record, anchor }]);
  }
}

const uis = new WeakMap<Editor, CommentsUi>();

export const commentsUi = (editor: Editor): CommentsUi => {
  let ui = uis.get(editor);
  if (ui === undefined) {
    ui = new CommentsUi(editor);
    uis.set(editor, ui);
  }
  return ui;
};
