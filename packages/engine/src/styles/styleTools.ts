/**
 * The three style tools on the Unframed MCP server: `style_read`, `style_write` and
 * `style_edit`. A style is a markdown file the style shape names; every write and edit is
 * a new file, so tldraw's undo and a turn's Revert bring the old version back through the
 * shape's `file` prop, as they do for pages.
 */
import { randomUUID } from "node:crypto";
import {
  agentShapeId,
  applyStyleEdits,
  ARTIFACT_EDITS_MAX,
  ARTIFACT_TITLE_MAX,
  isMintedRef,
  nextRef,
  placeBesideSelection,
  PLAN_NO_WRITES_MESSAGE,
  readRef,
  roomShapeId,
  shapeKind,
  STYLE_DEFAULT_SIZE,
  STYLE_EDIT_ARGUMENTS,
  STYLE_EDIT_TEXT,
  STYLE_READ_ARGUMENTS,
  STYLE_READ_TEXT,
  STYLE_WRITE_ARGUMENTS,
  STYLE_WRITE_TEXT,
  styleCard,
  styleDocument,
  styleHeading,
} from "@unframed/domain";
import type { TLRecord } from "@tldraw/tlschema";
import type { Applied } from "../canvas/rooms.ts";
import { refusal as refuse, type McpBinding, type McpTool, type ToolAnswer } from "../agent/mcp.ts";
import type { AgentToolContext } from "../artifacts/artifactTools.ts";
import { readArtifact, writeAgentArtifact } from "../artifacts/artifactStore.ts";
import { indexOnTop } from "../runs/placeholders.ts";
import { shapeBoxes } from "../runs/shapeBounds.ts";

const PAGE_ID = "page:page";

type Shape = TLRecord & { type: string; props: Record<string, unknown>; meta: Record<string, unknown> };

const isShape = (record: TLRecord | undefined): record is Shape => record?.typeName === "shape";

const findStyle = (records: ReadonlyArray<TLRecord>, shapeId: string): { shape: Shape } | { error: string } => {
  const shape = records.find((record) => record.id === roomShapeId(shapeId));
  if (!isShape(shape)) return { error: `no shape ${shapeId}` };
  const kind = shapeKind(shape.type);
  if (kind !== "style") return { error: `shape ${shapeId} is a ${kind}, not a style` };
  return { shape };
};

const text = (value: unknown): string => (typeof value === "string" ? value : "");

export class StyleTools {
  private readonly context: AgentToolContext;

  constructor(context: AgentToolContext) {
    this.context = context;
  }

  async read(binding: McpBinding, args: Record<string, unknown>): Promise<ToolAnswer> {
    const found = findStyle(await this.context.read(binding.project), text(args.shapeId).trim());
    if ("error" in found) return refuse(found.error);
    const file = text(found.shape.props.file);
    if (file === "") return refuse(`style ${text(args.shapeId).trim()} has no file yet`);
    try {
      const markdown = await readArtifact(await this.context.folder(binding.project), file);
      return { value: { shapeId: agentShapeId(found.shape.id), title: text(found.shape.props.title), file, markdown } };
    } catch {
      return refuse(`the file ${file} could not be read`);
    }
  }

  async write(binding: McpBinding, args: Record<string, unknown>): Promise<ToolAnswer> {
    const turn = this.context.chatTurn(binding.project, binding.chatId);
    if (turn.interactionMode === "plan") return refuse(PLAN_NO_WRITES_MESSAGE);
    const document = styleDocument(args.markdown);
    if ("error" in document) return refuse(document.error);
    const records = await this.context.read(binding.project);
    const shapeId = text(args.shapeId).trim();
    let target: Shape | undefined;
    if (shapeId !== "") {
      const found = findStyle(records, shapeId);
      if ("error" in found) return refuse(found.error);
      target = found.shape;
    }
    return this.commit(binding, { turn, records, target, markdown: document.markdown, title: args.title });
  }

  async edit(binding: McpBinding, args: Record<string, unknown>): Promise<ToolAnswer> {
    const turn = this.context.chatTurn(binding.project, binding.chatId);
    if (turn.interactionMode === "plan") return refuse(PLAN_NO_WRITES_MESSAGE);
    const shapeId = text(args.shapeId).trim();
    if (shapeId === "") return refuse("shapeId must name the style to edit");
    const records = await this.context.read(binding.project);
    const found = findStyle(records, shapeId);
    if ("error" in found) return refuse(found.error);
    const file = text(found.shape.props.file);
    if (file === "") return refuse(`style ${shapeId} has no file yet; write it with style_write`);
    let before: string;
    try {
      before = await readArtifact(await this.context.folder(binding.project), file);
    } catch {
      return refuse(`the file ${file} could not be read`);
    }
    const edited = applyStyleEdits(before, args.edits);
    if ("error" in edited) return refuse(edited.error);
    const document = styleDocument(edited.markdown);
    if ("error" in document) return refuse(document.error);
    return this.commit(binding, { turn, records, target: found.shape, markdown: document.markdown, title: args.title });
  }

  /** Writes the markdown as a new file and points the shape at it, or puts a new style beside the selection. */
  private async commit(
    binding: McpBinding,
    input: { turn: ReturnType<AgentToolContext["chatTurn"]>; records: ReadonlyArray<TLRecord>; target: Shape | undefined; markdown: string; title: unknown },
  ): Promise<ToolAnswer> {
    const { context } = this;
    const { turn, records, target, markdown } = input;
    // A style the person named keeps their name, as a page does.
    const named = target !== undefined && !isMintedRef(readRef(target) ?? "0");
    const given = typeof input.title === "string" && input.title.trim() !== "" && !named ? input.title.trim().slice(0, ARTIFACT_TITLE_MAX) : undefined;
    const title = (given ?? (target === undefined ? (styleHeading(markdown) ?? "Style").slice(0, ARTIFACT_TITLE_MAX) : text(target.props.title))).trim();
    const card = styleCard(markdown);

    let written: { file: string; bytes: number };
    try {
      written = await writeAgentArtifact(await context.folder(binding.project), {
        kind: "style",
        html: markdown,
        title,
        chatId: binding.chatId,
        turn: turn.turnCount ?? 0,
        shapeId: target === undefined ? null : agentShapeId(target.id),
      });
    } catch (error) {
      return refuse(`the style could not be written: ${error instanceof Error ? error.message : String(error)}`);
    }

    const pageId = records.find((record) => record.typeName === "page")?.id ?? PAGE_ID;
    let next: Shape;
    if (target !== undefined) {
      next = { ...target, props: { ...target.props, file: written.file, ...card, ...(given !== undefined ? { title } : {}) } } as Shape;
    } else {
      const boxes = shapeBoxes(records);
      const selected = turn.selection.flatMap((id) => {
        const box = boxes.get(id)?.page;
        return box ? [box] : [];
      });
      const at = placeBesideSelection(selected);
      next = {
        id: `shape:${randomUUID().replace(/-/g, "").slice(0, 16)}`,
        typeName: "shape",
        type: "style",
        x: at.x,
        y: at.y,
        rotation: 0,
        index: indexOnTop(records, pageId),
        parentId: pageId,
        isLocked: false,
        opacity: 1,
        props: { ...STYLE_DEFAULT_SIZE, file: written.file, title, fileName: "", ...card, role: "style" },
        meta: { ref: nextRef(records as ReadonlyArray<{ typeName: string; type?: string; meta?: unknown }>) },
      } as unknown as Shape;
    }

    let applied: Applied;
    try {
      applied = await context.apply(binding.project, { put: [next], remove: [] }, { kind: "server", id: `chat:${binding.chatId}` });
    } catch (failure) {
      const reason = failure instanceof Error ? failure.message : "";
      return refuse(reason.trim() === "" ? "the change could not be applied" : reason);
    }
    if (turn.turnCount !== undefined) {
      (await context.turnChanges(binding.project)).record(binding.chatId, turn.turnCount, new Map([[next.id as string, target]]), new Map([[next.id as string, next]]), applied.clock);
    }
    const created = target === undefined;
    context.activity(binding.project, binding.chatId, {
      id: `artifact:${randomUUID()}`,
      tone: "tool",
      kind: "artifact.written",
      summary: `${created ? "Created" : "Updated"} style${title === "" ? "" : ` · ${title}`}`,
      payload: { artifact: { shapeId: agentShapeId(next.id), file: written.file, title, kind: "style", created } },
      turnId: turn.turnId ?? null,
      createdAt: new Date().toISOString(),
    });
    return { value: { ok: true, shapeId: agentShapeId(next.id), file: written.file, title, clock: applied.clock } };
  }

  /** The three tools, as the MCP server registers them. */
  tools(): McpTool[] {
    return [
      {
        name: "style_read",
        description: STYLE_READ_TEXT,
        inputSchema: { type: "object", properties: { shapeId: { type: "string", description: STYLE_READ_ARGUMENTS.shapeId } }, required: ["shapeId"] },
        call: (binding, args) => this.read(binding, args),
      },
      {
        name: "style_write",
        description: STYLE_WRITE_TEXT,
        inputSchema: {
          type: "object",
          properties: {
            markdown: { type: "string", description: STYLE_WRITE_ARGUMENTS.markdown },
            shapeId: { type: "string", description: STYLE_WRITE_ARGUMENTS.shapeId },
            title: { type: "string", maxLength: ARTIFACT_TITLE_MAX, description: STYLE_WRITE_ARGUMENTS.title },
          },
          required: ["markdown"],
        },
        call: (binding, args) => this.write(binding, args),
      },
      {
        name: "style_edit",
        description: STYLE_EDIT_TEXT,
        inputSchema: {
          type: "object",
          properties: {
            shapeId: { type: "string", description: STYLE_EDIT_ARGUMENTS.shapeId },
            edits: {
              type: "array",
              minItems: 1,
              maxItems: ARTIFACT_EDITS_MAX,
              description: STYLE_EDIT_ARGUMENTS.edits,
              items: {
                type: "object",
                properties: {
                  old_string: { type: "string", description: STYLE_EDIT_ARGUMENTS.old_string },
                  new_string: { type: "string", description: STYLE_EDIT_ARGUMENTS.new_string },
                },
                required: ["old_string", "new_string"],
              },
            },
            title: { type: "string", maxLength: ARTIFACT_TITLE_MAX, description: STYLE_EDIT_ARGUMENTS.title },
          },
          required: ["shapeId", "edits"],
        },
        call: (binding, args) => this.edit(binding, args),
      },
    ];
  }
}
