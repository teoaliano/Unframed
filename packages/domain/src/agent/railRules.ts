/**
 * The chat rail's rules (spec 08): which chats the tab strip shows, which one is active,
 * what a tab reads, which chat a message from the toolbar continues, and the recap card's
 * rows. The strip's filter is any-of and the continue rule is all-of: they answer
 * different questions and must not be merged.
 */
import type { ChatActivity, TurnFile } from "./chatModel.ts";
import { agentShapeId, roomShapeId as shapeId } from "./turnText.ts";

/** What the rules read of a chat: its summary. */
export interface RailChat {
  readonly id: string;
  readonly title: string;
  /** The first message, at most 80 characters. */
  readonly preview: string;
  readonly tags: ReadonlyArray<string>;
  readonly status: "running" | "failed" | "idle";
  readonly createdAt: string;
}

const newestFirst = <C extends RailChat>(chats: ReadonlyArray<C>): C[] =>
  [...chats].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? 1 : -1));

/**
 * The chats the strip shows, newest first: every chat with no artifact selected, else the
 * chats tagged with any selected artifact. A chat whose artifacts are all gone still
 * shows with nothing selected.
 */
export const visibleChats = <C extends RailChat>(chats: ReadonlyArray<C>, selectedArtifactIds: ReadonlyArray<string>): C[] => {
  const ordered = newestFirst(chats);
  if (selectedArtifactIds.length === 0) return ordered;
  const selected = new Set(selectedArtifactIds);
  return ordered.filter((chat) => chat.tags.some((tag) => selected.has(tag)));
};

/** The active tab: the one last chosen while it is still visible, else the newest visible one, else none. */
export const nextActive = (activeId: string | null | undefined, visible: ReadonlyArray<{ readonly id: string }>): string | null => {
  if (activeId && visible.some((chat) => chat.id === activeId)) return activeId;
  return visible[0]?.id ?? null;
};

const LABEL_PREVIEW = 32;

const openingWords = (chat: Pick<RailChat, "preview">): string => chat.preview.replace(/\s+/g, " ").trim();

/** A tab's text: its name (the person's or the agent's), else the first 32 characters of its first message, else "Chat". */
export const tabLabel = (chat: Pick<RailChat, "title" | "preview">): string => {
  const title = chat.title.trim();
  if (title !== "") return title;
  const words = openingWords(chat);
  if (words === "") return "Chat";
  return words.length > LABEL_PREVIEW ? `${words.slice(0, LABEL_PREVIEW).trimEnd()}…` : words;
};

/** A tab's tooltip: its label, then " · " and the opening words when they differ from it. */
export const tabTooltip = (chat: Pick<RailChat, "title" | "preview">): string => {
  const label = tabLabel(chat);
  const words = openingWords(chat);
  if (chat.title.trim() === "") return words === "" ? label : words;
  return words === "" || words === label ? label : `${label} · ${words}`;
};

/**
 * The chat a message about `artifactIds` continues: the newest chat not running whose tags
 * include every one of them; with none selected, the newest chat not running that has no
 * tags. All-of on purpose: a chat that never saw B must not answer a message about A and B.
 */
export const continuableChat = <C extends RailChat>(chats: ReadonlyArray<C>, artifactIds: ReadonlyArray<string>): C | undefined =>
  newestFirst(chats).find(
    (chat) => chat.status !== "running" && (artifactIds.length === 0 ? chat.tags.length === 0 : artifactIds.every((id) => chat.tags.includes(id))),
  );

// ---------------------------------------------------------------------------------------
// The recap card.

/** What the recap reads of a shape on the canvas now. */
export interface RecapShape {
  readonly id: string;
  readonly kind: string;
  readonly title?: string;
  readonly fileName?: string;
}

export interface RecapRow {
  readonly shapeId: string;
  readonly kind: string;
  readonly label: string;
  /** The shape is no longer on the canvas. */
  readonly deleted: boolean;
  /** A page or motion whose file the turn wrote: the row offers View diff. */
  readonly rewritten: boolean;
}

const ARTIFACT_TOOLS = new Set(["page_write", "page_read", "motion_write", "motion_read"]);

const record = (value: unknown): Record<string, unknown> => (typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {});


const toolName = (activity: ChatActivity): string => {
  const data = record(record(activity.payload).data);
  const name = typeof data.toolName === "string" ? data.toolName : "";
  return name.replace(/^mcp__unframed__/, "");
};

/**
 * The recap card's rows for one turn, in first-touch order: the shapes its page and motion
 * tool calls named, the shapes its `canvas_write` ops named (created ones by the id the
 * result gave them), then its turn changes. `canvas_read` contributes nothing. A shape no
 * longer on the canvas is marked deleted.
 */
export const recapRows = (
  activities: ReadonlyArray<ChatActivity>,
  turnChanges: ReadonlyArray<TurnFile>,
  shapes: ReadonlyArray<RecapShape>,
): RecapRow[] => {
  const order: string[] = [];
  const kinds = new Map<string, string>();
  const titles = new Map<string, string>();
  const touch = (id: unknown, kind?: string, title?: unknown) => {
    if (typeof id !== "string" || id === "" || id.startsWith("new:")) return;
    const key = shapeId(id);
    if (!order.includes(key)) order.push(key);
    if (kind !== undefined && !kinds.has(key)) kinds.set(key, kind);
    if (typeof title === "string" && title !== "") titles.set(key, title);
  };
  // A provider may send a call's input only when it starts: take it from any of the call's activities.
  const inputs = new Map<unknown, unknown>();
  for (const activity of activities) {
    const payload = record(activity.payload);
    const given = record(payload.data).input;
    if (activity.kind.startsWith("tool.") && given !== undefined && !inputs.has(payload.itemId)) inputs.set(payload.itemId, given);
  }
  const completed = [...activities].filter((activity) => activity.kind === "tool.completed").sort((a, b) => a.sequence - b.sequence);
  for (const activity of completed) {
    const tool = toolName(activity);
    const data = record(record(activity.payload).data);
    const input = record(data.input ?? inputs.get(record(activity.payload).itemId));
    const result = record(data.result);
    if (ARTIFACT_TOOLS.has(tool)) {
      const kind = tool.startsWith("page") ? "page" : "motion";
      touch(input.shapeId ?? result.shapeId ?? result.id, kind, input.title);
    } else if (tool === "canvas_write") {
      const ids = record(result.ids);
      for (const op of Array.isArray(input.ops) ? input.ops : []) {
        const fields = record(op);
        const id = typeof fields.id === "string" && fields.id.startsWith("new:") ? ids[fields.id] : fields.id;
        touch(id, fields.type === "create" ? kindOfCreate(fields) : undefined);
      }
    }
  }
  const rewritten = new Set<string>();
  for (const change of turnChanges) {
    touch(change.shapeId, change.kind);
    if ((change.kind === "page" || change.kind === "motion") && change.file !== undefined && (change.previousFile !== undefined || change.change === "created")) {
      rewritten.add(shapeId(change.shapeId));
    }
  }
  const byId = new Map(shapes.map((shape) => [shapeId(shape.id), shape]));
  return order.map((id) => {
    const shape = byId.get(id);
    const label =
      (shape?.title !== undefined && shape.title.trim() !== "" ? shape.title : undefined) ??
      (shape?.fileName !== undefined && shape.fileName !== "" ? shape.fileName.replace(/\.html$/i, "") : undefined) ??
      titles.get(id) ??
      agentShapeId(id);
    return { shapeId: id, kind: shape?.kind ?? kinds.get(id) ?? "", label, deleted: shape === undefined, rewritten: rewritten.has(id) };
  });
};

const kindOfCreate = (op: Record<string, unknown>): string | undefined => (typeof op.kind === "string" ? op.kind : undefined);

/** What a revert that left shapes alone says, naming each and who changed it since. */
export const revertSkipLine = (skipped: ReadonlyArray<{ readonly label: string; readonly by: "person" | "another chat" | "a later turn" }>, restored: number): string | undefined => {
  if (skipped.length === 0) return undefined;
  if (restored === 0) return "Nothing to revert: everything this turn changed has changed since.";
  const names = skipped.map((shape) => `${shape.label} (by ${shape.by === "person" ? "the person" : shape.by})`).join(", ");
  return `Left ${skipped.length} shape${skipped.length === 1 ? "" : "s"} alone because they changed since: ${names}.`;
};
