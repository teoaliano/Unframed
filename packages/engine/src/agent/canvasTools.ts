import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { isBareFileName, resultMetaOf } from "@unframed/contracts";
import {
  canvasView,
  CANVAS_READ_DESCRIPTION,
  CANVAS_WRITE_DESCRIPTION,
  CANVAS_WRITE_OPS_ARGUMENT,
  imageDimensions,
  PLAN_NO_WRITES_MESSAGE,
  prepareBatch,
  type CanvasRecord,
  type FileFacts,
  type InteractionMode,
} from "@unframed/domain";
import type { TLRecord } from "@tldraw/tlschema";
import { getIndexAbove, type IndexKey } from "@tldraw/utils";
import type { Applied, CanvasChange, ChangeOrigin } from "../canvas/rooms.ts";
import { readResultSidecar } from "../runs/sidecars.ts";
import { shapeBoxes } from "../runs/shapeBounds.ts";
import type { McpBinding, McpTool, ToolAnswer } from "./mcp.ts";
import type { TurnChanges } from "./turnChanges.ts";

const PAGE_ID = "page:page";

/** What the canvas tool service needs from the rest of the engine. */
export interface CanvasToolDeps {
  readonly read: (project: string) => Promise<ReadonlyArray<TLRecord>>;
  readonly apply: (project: string, change: CanvasChange, origin: ChangeOrigin) => Promise<Applied>;
  readonly folder: (project: string) => Promise<string>;
  readonly turnChanges: (project: string) => Promise<TurnChanges>;
  /** The chat's running turn and the selection its latest message was sent with. */
  readonly chatTurn: (project: string, chatId: string) => { turnCount: number | undefined; interactionMode: InteractionMode; selection: ReadonlyArray<string> };
  /** Tags the chat with artifacts a write touched (the tag reactor). */
  readonly tag: (project: string, chatId: string, ids: ReadonlyArray<string>) => void;
}

const error = (message: string): ToolAnswer => ({ value: { error: message }, isError: true });

/** A project file's facts: its original name, type and natural size, from its sidecar and header. */
export const fileFacts = async (folder: string, name: string): Promise<FileFacts | undefined> => {
  if (!isBareFileName(name) || name.endsWith(".json") || name.startsWith("unframed.sqlite")) return undefined;
  const path = join(folder, name);
  const info = await stat(path).catch(() => undefined);
  if (!info?.isFile()) return undefined;
  let fileName = name;
  let mime: string | undefined;
  const sidecar = await readFile(join(folder, `${name.replace(/\.[^.]+$/, "")}.json`), "utf8").then(
    (text) => JSON.parse(text) as Record<string, unknown>,
    () => undefined,
  );
  if (typeof sidecar?.fileName === "string" && sidecar.fileName !== "") fileName = sidecar.fileName;
  if (typeof sidecar?.mime === "string") mime = sidecar.mime;
  let size: { w: number; h: number } | undefined;
  if (/\.(png|jpe?g|gif|webp)$/i.test(name)) {
    const head = await readFile(path).then((bytes) => bytes.subarray(0, 256 * 1024), () => undefined);
    size = head ? imageDimensions(new Uint8Array(head)) : undefined;
    mime ??= /\.png$/i.test(name) ? "image/png" : /\.gif$/i.test(name) ? "image/gif" : /\.webp$/i.test(name) ? "image/webp" : "image/jpeg";
  }
  return { fileName, ...(mime === undefined ? {} : { mime }), ...(size ? { w: size.w, h: size.h } : {}), bytes: info.size };
};

const collectFiles = (ops: unknown): string[] => {
  if (!Array.isArray(ops)) return [];
  const files: string[] = [];
  for (const op of ops) {
    const file = (op as { props?: { file?: unknown } } | null)?.props?.file;
    if (typeof file === "string") files.push(file);
  }
  return files;
};

/**
 * The canvas tool service (spec 07): `canvas_read` and `canvas_write` over the project's
 * sync room. A write is one batch and one room change with origin `chat:<chatId>`, and
 * records its turn changes; every artifact it touches tags the chat.
 */
export class CanvasTools {
  private readonly deps: CanvasToolDeps;

  constructor(deps: CanvasToolDeps) {
    this.deps = deps;
  }

  async read(binding: McpBinding): Promise<ToolAnswer> {
    const records = await this.deps.read(binding.project);
    const folder = await this.deps.folder(binding.project);
    const recipes = new Map<string, unknown>();
    for (const record of records) {
      if (record.typeName !== "shape") continue;
      const result = resultMetaOf(record);
      if (!result) continue;
      if (result.recipe) {
        recipes.set(record.id, result.recipe);
        continue;
      }
      if (typeof result.sidecar !== "string") continue;
      const sidecar = await readResultSidecar(folder, result.sidecar);
      if (sidecar) recipes.set(record.id, sidecar.recipe);
    }
    const { selection } = this.deps.chatTurn(binding.project, binding.chatId);
    const view = canvasView({
      records: records as unknown as CanvasRecord[],
      boxes: shapeBoxes(records),
      recipes,
      selection,
    });
    return { value: view };
  }

  async write(binding: McpBinding, args: Record<string, unknown>): Promise<ToolAnswer> {
    const turn = this.deps.chatTurn(binding.project, binding.chatId);
    if (turn.interactionMode === "plan") return error(PLAN_NO_WRITES_MESSAGE);
    const records = await this.deps.read(binding.project);
    const folder = await this.deps.folder(binding.project);
    const facts = new Map<string, FileFacts | undefined>();
    for (const file of collectFiles(args.ops)) if (!facts.has(file)) facts.set(file, await fileFacts(folder, file));
    const prepared = prepareBatch(args.ops, {
      records: records as unknown as CanvasRecord[],
      file: (name) => facts.get(name),
      newShapeId: () => `shape:${randomUUID().replace(/-/g, "").slice(0, 16)}`,
      newAssetId: () => `asset:${randomUUID()}`,
      indexAbove: (below) => getIndexAbove((below ?? null) as IndexKey | null),
      pageId: records.find((record) => record.typeName === "page")?.id ?? PAGE_ID,
      boxes: shapeBoxes(records),
    });
    if (!prepared.ok) return error(prepared.error);
    const before = new Map<string, TLRecord | undefined>();
    const byId = new Map(records.map((record) => [record.id as string, record]));
    for (const id of prepared.touched) before.set(id, byId.get(id));
    let applied: Applied;
    try {
      applied = await this.deps.apply(
        binding.project,
        { put: prepared.put as unknown as TLRecord[], remove: prepared.remove },
        { kind: "server", id: `chat:${binding.chatId}` },
      );
    } catch (failure) {
      return error(failure instanceof Error ? failure.message : String(failure));
    }
    const after = new Map<string, TLRecord | undefined>();
    const put = new Map((prepared.put as unknown as TLRecord[]).map((record) => [record.id as string, record]));
    for (const id of prepared.touched) after.set(id, put.get(id));
    if (turn.turnCount !== undefined) {
      (await this.deps.turnChanges(binding.project)).record(binding.chatId, turn.turnCount, before, after, applied.clock);
    }
    const artifacts = prepared.touched.filter((id) => {
      const type = ((after.get(id) ?? before.get(id)) as { type?: string } | undefined)?.type;
      return type === "page" || type === "motion";
    });
    if (artifacts.length > 0) this.deps.tag(binding.project, binding.chatId, artifacts);
    return { value: { ok: true, ids: prepared.ids, clock: applied.clock } };
  }

  /** The two canvas tools, as the MCP server registers them. */
  tools(): McpTool[] {
    return [
      {
        name: "canvas_read",
        description: CANVAS_READ_DESCRIPTION,
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        call: (binding) => this.read(binding),
      },
      {
        name: "canvas_write",
        description: CANVAS_WRITE_DESCRIPTION,
        inputSchema: {
          type: "object",
          properties: { ops: { type: "array", description: CANVAS_WRITE_OPS_ARGUMENT, items: { type: "object" } } },
          required: ["ops"],
        },
        call: (binding, args) => this.write(binding, args),
      },
    ];
  }
}
