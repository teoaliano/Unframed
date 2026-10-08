/**
 * The four artifact tools (spec 09): `page_write`, `page_read`, `motion_write` and
 * `motion_read`, on spec 07's Unframed MCP server. Both kinds are built from one definition,
 * so the new-file rule, placement, result and event cannot drift between them.
 */
import { randomUUID } from "node:crypto";
import {
  AGENT_ARTIFACT_SIZE,
  agentShapeId,
  ARTIFACT_PERFORMANCE,
  ARTIFACT_SIZE_LIMIT,
  ARTIFACT_TITLE_MAX,
  artifactUrl,
  DIALS_CONTRACT,
  DIALS_TIMELINE,
  injectTags,
  isMintedRef,
  MOTION_READ_SHAPE_ID,
  MOTION_READ_TEXT,
  MOTION_WRITE_ARGUMENTS,
  MOTION_WRITE_TEXT,
  nextRef,
  PAGE_READ_SHAPE_ID,
  PAGE_READ_TEXT,
  PAGE_WRITE_ARGUMENTS,
  PAGE_WRITE_TEXT,
  placeBesideSelection,
  PLAN_NO_WRITES_MESSAGE,
  projectSlug,
  readRef,
  roomShapeId,
  shapeKind,
  type ActivityInput,
  type ArtifactKind,
  type InteractionMode,
} from "@unframed/domain";
import type { TLRecord } from "@tldraw/tlschema";
import type { Applied, CanvasChange, ChangeOrigin } from "../canvas/rooms.ts";
import { refusal as refuse, type McpBinding, type McpTool, type ToolAnswer } from "../agent/mcp.ts";
import type { TurnChanges } from "../agent/turnChanges.ts";
import { indexOnTop } from "../runs/placeholders.ts";
import { shapeBoxes } from "../runs/shapeBounds.ts";
import { ensureBridge, ensureLibrary, readArtifact, writeAgentArtifact } from "./artifactStore.ts";

const PAGE_ID = "page:page";

/** What the agent's tools reach of the rest of the engine; the agent runtime supplies it. */
export interface AgentToolContext {
  readonly read: (project: string) => Promise<ReadonlyArray<TLRecord>>;
  readonly apply: (project: string, change: CanvasChange, origin: ChangeOrigin) => Promise<Applied>;
  readonly folder: (project: string) => Promise<string>;
  readonly turnChanges: (project: string) => Promise<TurnChanges>;
  /** The chat's running turn and the selection its latest message was sent with. */
  readonly chatTurn: (
    project: string,
    chatId: string,
  ) => { turnCount: number | undefined; turnId: string | undefined; interactionMode: InteractionMode; selection: ReadonlyArray<string> };
  /** Tags the chat with artifacts a write touched (the tag reactor). */
  readonly tag: (project: string, chatId: string, ids: ReadonlyArray<string>) => void;
  readonly activity: (project: string, chatId: string, activity: ActivityInput) => void;
}

type Shape = TLRecord & { type: string; props: Record<string, unknown>; meta: Record<string, unknown> };

const isShape = (record: TLRecord | undefined): record is Shape => record?.typeName === "shape";


/** Finds the shape an argument names, as the agent names it, and refuses the wrong kind. */
const findArtifact = (records: ReadonlyArray<TLRecord>, shapeId: string, kind: ArtifactKind): { shape: Shape } | { error: string } => {
  const shape = records.find((record) => record.id === roomShapeId(shapeId));
  if (!isShape(shape)) return { error: `no shape ${shapeId}` };
  const its = shapeKind(shape.type);
  if (its !== kind) return { error: `shape ${shapeId} is a ${its}, not a ${kind}` };
  return { shape };
};

export class ArtifactTools {
  private readonly context: AgentToolContext;
  private readonly previewPort: () => number;

  constructor(context: AgentToolContext, previewPort: () => number) {
    this.context = context;
    this.previewPort = previewPort;
  }

  async write(kind: ArtifactKind, binding: McpBinding, args: Record<string, unknown>): Promise<ToolAnswer> {
    const { context } = this;
    const turn = context.chatTurn(binding.project, binding.chatId);
    if (turn.interactionMode === "plan") return refuse(PLAN_NO_WRITES_MESSAGE);
    if (typeof args.html !== "string" || args.html.trim() === "") return refuse("html must be a non-empty string");
    const html = injectTags(args.html, kind);
    const size = Buffer.byteLength(html, "utf8");
    if (size > ARTIFACT_SIZE_LIMIT) return refuse(`the ${kind} is too large (${size} bytes; the limit is ${ARTIFACT_SIZE_LIMIT})`);

    const records = await context.read(binding.project);
    const shapeId = typeof args.shapeId === "string" && args.shapeId.trim() !== "" ? args.shapeId.trim() : undefined;
    let target: Shape | undefined;
    if (shapeId !== undefined) {
      const found = findArtifact(records, shapeId, kind);
      if ("error" in found) return refuse(found.error);
      target = found.shape;
    }
    const current = typeof target?.props.title === "string" ? target.props.title : "";
    // A page or motion the person named keeps their name: its title is that name (spec 09).
    const named = target !== undefined && !isMintedRef(readRef(target) ?? "0");
    const given = typeof args.title === "string" && !named ? args.title.slice(0, ARTIFACT_TITLE_MAX) : undefined;
    const title = (given ?? current).trim();

    const folder = await context.folder(binding.project);
    let written: { file: string; bytes: number };
    try {
      await (kind === "motion" ? ensureLibrary(folder) : ensureBridge(folder));
      written = await writeAgentArtifact(folder, {
        kind,
        html,
        title,
        chatId: binding.chatId,
        turn: turn.turnCount ?? 0,
        shapeId: target === undefined ? null : agentShapeId(target.id),
      });
    } catch (error) {
      return refuse(`the ${kind} could not be written: ${error instanceof Error ? error.message : String(error)}`);
    }

    const pageId = records.find((record) => record.typeName === "page")?.id ?? PAGE_ID;
    let next: Shape;
    if (target !== undefined) {
      next = { ...target, props: { ...target.props, file: written.file, ...(given !== undefined && title !== target.props.title ? { title } : {}) } } as Shape;
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
        type: kind,
        x: at.x,
        y: at.y,
        rotation: 0,
        index: indexOnTop(records, pageId),
        parentId: pageId,
        isLocked: false,
        opacity: 1,
        props: { ...AGENT_ARTIFACT_SIZE[kind], file: written.file, title, fileName: "" },
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
    context.tag(binding.project, binding.chatId, [next.id]);
    const created = target === undefined;
    context.activity(binding.project, binding.chatId, {
      id: `artifact:${randomUUID()}`,
      tone: "tool",
      kind: "artifact.written",
      summary: `${created ? "Created" : "Updated"} ${kind}${title === "" ? "" : ` · ${title}`}`,
      payload: { artifact: { shapeId: agentShapeId(next.id), file: written.file, title, kind, created } },
      turnId: turn.turnId ?? null,
      createdAt: new Date().toISOString(),
    });
    return {
      value: {
        ok: true,
        shapeId: agentShapeId(next.id),
        file: written.file,
        title,
        previewUrl: artifactUrl({ appHostname: "localhost", previewPort: this.previewPort(), project: projectSlug(binding.project), file: written.file, kind }),
        clock: applied.clock,
      },
    };
  }

  async read(kind: ArtifactKind, binding: McpBinding, args: Record<string, unknown>): Promise<ToolAnswer> {
    const shapeId = typeof args.shapeId === "string" ? args.shapeId.trim() : "";
    const found = findArtifact(await this.context.read(binding.project), shapeId, kind);
    if ("error" in found) return refuse(found.error);
    const file = typeof found.shape.props.file === "string" ? found.shape.props.file : "";
    if (file === "") return refuse(`${kind} ${shapeId} has no file yet`);
    const title = typeof found.shape.props.title === "string" ? found.shape.props.title : "";
    try {
      const html = await readArtifact(await this.context.folder(binding.project), file);
      return { value: { shapeId: agentShapeId(found.shape.id), title, file, html } };
    } catch {
      return refuse(`the file ${file} could not be read`);
    }
  }

  /** The four tools, as the MCP server registers them. */
  tools(): McpTool[] {
    const writeSchema = (args: Readonly<Record<"html" | "shapeId" | "title", string>>) => ({
      type: "object",
      properties: {
        html: { type: "string", description: args.html },
        shapeId: { type: "string", description: args.shapeId },
        title: { type: "string", maxLength: ARTIFACT_TITLE_MAX, description: args.title },
      },
      required: ["html"],
    });
    const readSchema = (description: string) => ({
      type: "object",
      properties: { shapeId: { type: "string", description } },
      required: ["shapeId"],
    });
    return [
      {
        name: "page_write",
        description: `${PAGE_WRITE_TEXT} ${DIALS_CONTRACT} ${ARTIFACT_PERFORMANCE}`,
        inputSchema: writeSchema(PAGE_WRITE_ARGUMENTS),
        call: (binding, args) => this.write("page", binding, args),
      },
      {
        name: "page_read",
        description: PAGE_READ_TEXT,
        inputSchema: readSchema(PAGE_READ_SHAPE_ID),
        call: (binding, args) => this.read("page", binding, args),
      },
      {
        name: "motion_write",
        description: `${MOTION_WRITE_TEXT} ${DIALS_CONTRACT} ${DIALS_TIMELINE} ${ARTIFACT_PERFORMANCE}`,
        inputSchema: writeSchema(MOTION_WRITE_ARGUMENTS),
        call: (binding, args) => this.write("motion", binding, args),
      },
      {
        name: "motion_read",
        description: MOTION_READ_TEXT,
        inputSchema: readSchema(MOTION_READ_SHAPE_ID),
        call: (binding, args) => this.read("motion", binding, args),
      },
    ];
  }
}
