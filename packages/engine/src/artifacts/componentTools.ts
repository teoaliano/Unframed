/**
 * The component tools (spec 20): `component_write` and `component_read`, on spec 07's Unframed
 * MCP server. A write checks the sheet, tags it, writes it with its compiled file, and moves a
 * component shape to the new version, through the same canvas change, turn record and activity
 * the artifact tools use.
 */
import { randomUUID } from "node:crypto";
import {
  AGENT_ARTIFACT_SIZE,
  agentShapeId,
  ARTIFACT_SIZE_LIMIT,
  ARTIFACT_TITLE_MAX,
  artifactUrl,
  BRIDGE_TAG,
  COMPONENT_HELPER_TAG,
  COMPONENT_READ_SHAPE_ID,
  COMPONENT_READ_TEXT,
  COMPONENT_WRITE_ARGUMENTS,
  COMPONENT_WRITE_TEXT,
  componentTitleFromTag,
  isMintedRef,
  nextRef,
  PLAN_NO_WRITES_MESSAGE,
  placeBesideSelection,
  projectSlug,
  readComponentSheet,
  readPins,
  readRef,
  roomShapeId,
  sheetRefusal,
  shapeKind,
  type ComponentCanvasShape,
} from "@unframed/domain";
import type { TLRecord } from "@tldraw/tlschema";
import type { Applied } from "../canvas/rooms.ts";
import { refusal as refuse, type McpBinding, type McpTool, type ToolAnswer } from "../agent/mcp.ts";
import { indexOnTop } from "../runs/placeholders.ts";
import { shapeBoxes } from "../runs/shapeBounds.ts";
import type { AgentToolContext } from "./artifactTools.ts";
import { ensureComponentLibrary, readArtifact, writeComponentSheet } from "./artifactStore.ts";

type Shape = TLRecord & { type: string; props: Record<string, unknown>; meta: Record<string, unknown> };

const isShape = (record: TLRecord | undefined): record is Shape => record?.typeName === "shape";

const PAGE_ID = "page:page";

/** The bridge and the sheet helper go in a sheet's head, after the head's own open tag (spec 20). */
const injectSheetTags = (html: string): string => {
  const tags = [BRIDGE_TAG, COMPONENT_HELPER_TAG].filter((tag) => !html.includes(tag));
  if (tags.length === 0) return html;
  const block = tags.join("\n");
  return /<head\b[^>]*>/i.test(html) ? html.replace(/<head\b[^>]*>/i, (open) => `${open}\n${block}`) : `${block}\n${html}`;
};

/** Finds the component shape an argument names, refusing another kind. */
const findComponent = (records: ReadonlyArray<TLRecord>, shapeId: string): { shape: Shape } | { error: string } => {
  const shape = records.find((record) => record.id === roomShapeId(shapeId));
  if (!isShape(shape)) return { error: `no shape ${shapeId}` };
  const its = shapeKind(shape.type);
  if (its !== "component") return { error: `shape ${shapeId} is a ${its}, not a component` };
  return { shape };
};

export class ComponentTools {
  private readonly context: AgentToolContext;
  private readonly previewPort: () => number;

  constructor(context: AgentToolContext, previewPort: () => number) {
    this.context = context;
    this.previewPort = previewPort;
  }

  async write(binding: McpBinding, args: Record<string, unknown>): Promise<ToolAnswer> {
    const { context } = this;
    const turn = context.chatTurn(binding.project, binding.chatId);
    if (turn.interactionMode === "plan") return refuse(PLAN_NO_WRITES_MESSAGE);
    if (typeof args.html !== "string" || args.html.trim() === "") return refuse("html must be a non-empty string");

    const records = await context.read(binding.project);
    const shapeId = typeof args.shapeId === "string" && args.shapeId.trim() !== "" ? args.shapeId.trim() : undefined;
    let target: Shape | undefined;
    if (shapeId !== undefined) {
      const found = findComponent(records, shapeId);
      if ("error" in found) return refuse(found.error);
      target = found.shape;
    }

    const html = injectSheetTags(args.html);
    const read = readComponentSheet(html);
    if (!read.ok) return refuse(read.refusal);
    const { tag } = read.sheet.declaration;
    const canvas: ComponentCanvasShape[] = records.flatMap((record) =>
      isShape(record) && shapeKind(record.type) === "component" && typeof record.props.tag === "string" ? [{ id: agentShapeId(record.id), tag: record.props.tag }] : [],
    );
    const canvasRefusal = sheetRefusal(read.sheet, canvas, target === undefined ? undefined : agentShapeId(target.id));
    if (canvasRefusal !== undefined) return refuse(canvasRefusal);
    const size = Buffer.byteLength(html, "utf8");
    if (size > ARTIFACT_SIZE_LIMIT) return refuse(`the component is too large (${size} bytes; the limit is ${ARTIFACT_SIZE_LIMIT})`);

    // A component the person named keeps its name, as a page does (spec 09).
    const current = typeof target?.props.title === "string" ? target.props.title : "";
    const named = target !== undefined && !isMintedRef(readRef(target) ?? "0");
    const given = typeof args.title === "string" && !named ? args.title.slice(0, ARTIFACT_TITLE_MAX) : undefined;
    const title = (given ?? (target === undefined ? componentTitleFromTag(tag) : current)).trim();

    const folder = await context.folder(binding.project);
    let written: { file: string; compiled: string; bytes: number };
    try {
      await ensureComponentLibrary(folder);
      written = await writeComponentSheet(folder, {
        html,
        tag,
        title,
        chatId: binding.chatId,
        turn: turn.turnCount ?? 0,
        shapeId: target === undefined ? null : agentShapeId(target.id),
      });
    } catch (error) {
      return refuse(`the component could not be written: ${error instanceof Error ? error.message : String(error)}`);
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
        type: "component",
        x: at.x,
        y: at.y,
        rotation: 0,
        index: indexOnTop(records, pageId),
        parentId: pageId,
        isLocked: false,
        opacity: 1,
        props: { ...AGENT_ARTIFACT_SIZE.page, file: written.file, title, fileName: "", tag },
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
      id: `component:${randomUUID()}`,
      tone: "tool",
      kind: "component.written",
      summary: `${created ? "Created" : "Updated"} component${title === "" ? "" : ` · ${title}`}`,
      payload: { component: { shapeId: agentShapeId(next.id), file: written.file, title, tag, created } },
      turnId: turn.turnId ?? null,
      createdAt: new Date().toISOString(),
    });

    return {
      value: {
        ok: true,
        shapeId: agentShapeId(next.id),
        file: written.file,
        tag,
        title,
        previewUrl: artifactUrl({ appHostname: "localhost", previewPort: this.previewPort(), project: projectSlug(binding.project), file: written.file, kind: "page" }),
        clock: applied.clock,
        usedBy: await this.usedBy(binding.project, records, tag, written.file),
      },
    };
  }

  /** The page and motion shapes that pin any version of the tag, and whether each pins the current one. */
  private async usedBy(project: string, records: ReadonlyArray<TLRecord>, tag: string, current: string): Promise<Array<{ shapeId: string; title: string; current: boolean }>> {
    const folder = await this.context.folder(project);
    const found: Array<{ shapeId: string; title: string; current: boolean }> = [];
    for (const record of records) {
      if (!isShape(record) || (record.type !== "page" && record.type !== "motion") || typeof record.props.file !== "string" || record.props.file === "") continue;
      const html = await readArtifact(folder, record.props.file).catch(() => undefined);
      if (html === undefined) continue;
      const pin = readPins(html).find((candidate) => candidate.tag === tag);
      if (pin === undefined) continue;
      found.push({ shapeId: agentShapeId(record.id), title: typeof record.props.title === "string" ? record.props.title : "", current: pin.sheet === current });
    }
    return found;
  }

  async read(binding: McpBinding, args: Record<string, unknown>): Promise<ToolAnswer> {
    const shapeId = typeof args.shapeId === "string" ? args.shapeId.trim() : "";
    const found = findComponent(await this.context.read(binding.project), shapeId);
    if ("error" in found) return refuse(found.error);
    const file = typeof found.shape.props.file === "string" ? found.shape.props.file : "";
    if (file === "") return refuse(`component ${shapeId} has no file yet`);
    const title = typeof found.shape.props.title === "string" ? found.shape.props.title : "";
    try {
      const html = await readArtifact(await this.context.folder(binding.project), file);
      return { value: { shapeId: agentShapeId(found.shape.id), title, file, html } };
    } catch {
      return refuse(`the file ${file} could not be read`);
    }
  }

  /** The two tools, as the MCP server registers them. */
  tools(): McpTool[] {
    return [
      {
        name: "component_write",
        description: COMPONENT_WRITE_TEXT,
        inputSchema: {
          type: "object",
          properties: {
            html: { type: "string", description: COMPONENT_WRITE_ARGUMENTS.html },
            shapeId: { type: "string", description: COMPONENT_WRITE_ARGUMENTS.shapeId },
            title: { type: "string", maxLength: ARTIFACT_TITLE_MAX, description: COMPONENT_WRITE_ARGUMENTS.title },
          },
          required: ["html"],
        },
        call: (binding, args) => this.write(binding, args),
      },
      {
        name: "component_read",
        description: COMPONENT_READ_TEXT,
        inputSchema: {
          type: "object",
          properties: { shapeId: { type: "string", description: COMPONENT_READ_SHAPE_ID } },
          required: ["shapeId"],
        },
        call: (binding, args) => this.read(binding, args),
      },
    ];
  }
}


