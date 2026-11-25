import { randomUUID } from "node:crypto";
import {
  commentsView,
  COMMENT_WRITE_DESCRIPTION,
  COMMENTS_READ_DESCRIPTION,
  PLAN_NO_WRITES_MESSAGE,
  prepareCommentBatch,
  type CommentAuthor,
  type CommentRecordLike,
  type InteractionMode,
} from "@unframed/domain";
import type { TLRecord } from "@tldraw/tlschema";
import type { Applied, CanvasChange, ChangeOrigin } from "../canvas/rooms.ts";
import { shapeBoxes } from "../runs/shapeBounds.ts";
import type { McpBinding, McpTool, ToolAnswer } from "./mcp.ts";
import type { TurnChanges } from "./turnChanges.ts";

const PAGE_ID = "page:page";

export interface CommentToolDeps {
  readonly read: (project: string) => Promise<ReadonlyArray<TLRecord>>;
  readonly apply: (project: string, change: CanvasChange, origin: ChangeOrigin) => Promise<Applied>;
  readonly turnChanges: (project: string) => Promise<TurnChanges>;
  readonly chatTurn: (project: string, chatId: string) => { turnCount: number | undefined; interactionMode: InteractionMode };
  readonly author: (project: string, chatId: string) => CommentAuthor;
}

const error = (message: string): ToolAnswer => ({ value: { error: message }, isError: true });

const boxLookup = (records: ReadonlyArray<TLRecord>) => {
  const boxes = shapeBoxes(records);
  return (shapeId: string) => boxes.get(shapeId)?.page;
};

export class CommentTools {
  private readonly deps: CommentToolDeps;

  constructor(deps: CommentToolDeps) {
    this.deps = deps;
  }

  async read(binding: McpBinding, args: Record<string, unknown>): Promise<ToolAnswer> {
    const records = await this.deps.read(binding.project);
    if (args.thread !== undefined && typeof args.thread !== "string") return error('thread must be a thread number, as "#4".');
    const view = commentsView({
      records: records as unknown as CommentRecordLike[],
      boxOf: boxLookup(records),
      includeResolved: args.includeResolved === true,
      ...(typeof args.thread === "string" ? { thread: args.thread } : {}),
    });
    if (typeof args.thread === "string" && view.threads.length === 0) return error(`No comment thread ${args.thread}.`);
    return { value: view.resolvedHidden > 0 ? view : { threads: view.threads } };
  }

  async write(binding: McpBinding, args: Record<string, unknown>): Promise<ToolAnswer> {
    const turn = this.deps.chatTurn(binding.project, binding.chatId);
    if (turn.interactionMode === "plan") return error(PLAN_NO_WRITES_MESSAGE);
    const records = await this.deps.read(binding.project);
    const batch = prepareCommentBatch(args.ops, {
      records: records as unknown as CommentRecordLike[],
      boxOf: boxLookup(records),
      author: this.deps.author(binding.project, binding.chatId),
      pageId: records.find((record) => record.typeName === "page")?.id ?? PAGE_ID,
      now: Date.now(),
      newId: () => randomUUID().replace(/-/g, "").slice(0, 16),
    });
    if (!batch.ok) return error(batch.error);
    const byId = new Map(records.map((record) => [record.id as string, record]));
    const before = new Map<string, TLRecord | undefined>(batch.touched.map((id) => [id, byId.get(id)]));
    let applied: Applied;
    try {
      applied = await this.deps.apply(binding.project, { put: batch.put as unknown as TLRecord[], remove: batch.remove }, { kind: "server", id: `chat:${binding.chatId}` });
    } catch (failure) {
      return error(failure instanceof Error ? failure.message : String(failure));
    }
    const put = new Map((batch.put as unknown as TLRecord[]).map((record) => [record.id as string, record]));
    const after = new Map<string, TLRecord | undefined>(batch.touched.map((id) => [id, put.get(id)]));
    if (turn.turnCount !== undefined) (await this.deps.turnChanges(binding.project)).record(binding.chatId, turn.turnCount, before, after, applied.clock);
    return { value: { ok: true, ...(batch.threads.length === 0 ? {} : { started: batch.threads }), clock: applied.clock } };
  }

  tools(): McpTool[] {
    return [
      {
        name: "comments_read",
        description: COMMENTS_READ_DESCRIPTION,
        inputSchema: {
          type: "object",
          properties: {
            thread: { type: "string", description: 'Read only this thread, by its number, as "#4".' },
            includeResolved: { type: "boolean", description: "Also list resolved threads." },
          },
          additionalProperties: false,
        },
        call: (binding, args) => this.read(binding, args),
      },
      {
        name: "comment_write",
        description: COMMENT_WRITE_DESCRIPTION,
        inputSchema: {
          type: "object",
          properties: { ops: { type: "array", description: "The operations, in order.", items: { type: "object" } } },
          required: ["ops"],
        },
        call: (binding, args) => this.write(binding, args),
      },
    ];
  }
}
