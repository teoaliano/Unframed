import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { isBareFileName, resultMetaOf } from "@unframed/contracts";
import {
  canvasView,
  canvasReadDescription,
  canvasWriteDescription,
  CANVAS_WRITE_OPS_ARGUMENT,
  imageDimensions,
  PLAN_NO_WRITES_MESSAGE,
  prepareBatch,
  readComponentSheet,
  readPins,
  type CanvasRecord,
  type Features,
  type ComponentDeclaration,
  type Pin,
  type FileFacts,
  type InteractionMode,
} from "@unframed/domain";
import type { TLRecord } from "@tldraw/tlschema";
import { getIndexAbove, type IndexKey } from "@tldraw/utils";
import { lockRefusal, sourceTreeOf } from "@unframed/domain/html";
import { readArtifact } from "../artifacts/artifactStore.ts";
import type { Applied, CanvasChange, ChangeOrigin } from "../canvas/rooms.ts";
import { readResultSidecar } from "../runs/sidecars.ts";
import { shapeBoxes } from "../runs/shapeBounds.ts";
import type { McpBinding, McpTool, ToolAnswer } from "./mcp.ts";
import type { TurnChanges } from "./turnChanges.ts";
import { kitOf } from "../kits/tokensFile.ts";

const PAGE_ID = "page:page";

interface CanvasToolDeps {
  readonly read: (project: string) => Promise<ReadonlyArray<TLRecord>>;
  readonly apply: (project: string, change: CanvasChange, origin: ChangeOrigin) => Promise<Applied>;
  readonly folder: (project: string) => Promise<string>;
  readonly turnChanges: (project: string) => Promise<TurnChanges>;
  readonly chatTurn: (project: string, chatId: string) => { turnCount: number | undefined; interactionMode: InteractionMode; selection: ReadonlyArray<string> };
  readonly isOutside: (project: string, chatId: string) => boolean;
  readonly liveSelection: (project: string) => { shapeIds: string[]; note?: string };
  readonly tag: (project: string, chatId: string, ids: ReadonlyArray<string>) => void;
}

const error = (message: string): ToolAnswer => ({ value: { error: message }, isError: true });

const fileFacts = async (folder: string, name: string): Promise<FileFacts | undefined> => {
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

const componentFacts = async (folder: string, records: ReadonlyArray<TLRecord>) => {
  const declarations = new Map<string, ComponentDeclaration>();
  const pins = new Map<string, Pin[]>();
  for (const record of records) {
    if (record.typeName !== "shape") continue;
    const file = (record.props as { file?: unknown }).file;
    if (typeof file !== "string" || file === "") continue;
    if (record.type !== "component" && record.type !== "page" && record.type !== "motion") continue;
    const html = await readFile(join(folder, basename(file)), "utf8").catch(() => undefined);
    if (html === undefined) continue;
    if (record.type === "component") {
      const read = readComponentSheet(html);
      if (read.ok) declarations.set(record.id, read.sheet.declaration);
    } else {
      const found = readPins(html);
      if (found.length > 0) pins.set(record.id, found);
    }
  }
  return { declarations, pins };
};

const lockedOf = (record: TLRecord | undefined): string[] => {
  const locked = (record as { props?: { lockedElements?: unknown } } | undefined)?.props?.lockedElements;
  return Array.isArray(locked) ? locked.filter((id): id is string => typeof id === "string") : [];
};

const fileLockRefusal = async (folder: string, put: ReadonlyArray<TLRecord>, before: ReadonlyMap<string, TLRecord | undefined>): Promise<string | undefined> => {
  for (const record of put) {
    const old = before.get(record.id as string);
    const kind = (record as { type?: string }).type;
    if (old === undefined || (kind !== "page" && kind !== "motion")) continue;
    const from = (old as { props?: { file?: unknown } }).props?.file;
    const to = (record as { props?: { file?: unknown } }).props?.file;
    const locked = lockedOf(old);
    if (typeof from !== "string" || from === "" || from === to || locked.length === 0) continue;
    const current = await readArtifact(folder, from).catch(() => undefined);
    if (current === undefined) continue;
    const next = typeof to === "string" && to !== "" ? await readArtifact(folder, to).catch(() => "") : "";
    const refusal = lockRefusal({ current, next, locked, tree: sourceTreeOf(current), kind });
    if (refusal !== null) return refusal;
  }
  return undefined;
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

export class CanvasTools {
  private readonly deps: CanvasToolDeps;
  private readonly features: Features;

  constructor(deps: CanvasToolDeps, features: Features) {
    this.deps = deps;
    this.features = features;
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
    const { declarations, pins } = await componentFacts(folder, records);
    const outside = this.deps.isOutside(binding.project, binding.chatId);
    const live = outside ? this.deps.liveSelection(binding.project) : undefined;
    const selection = live ? live.shapeIds : this.deps.chatTurn(binding.project, binding.chatId).selection;
    const view = canvasView({
      records: records as unknown as CanvasRecord[],
      boxes: shapeBoxes(records),
      recipes,
      selection,
      declarations,
      pins,
    });
    const kit = kitOf(records);
    const withKit = { ...view, kit: kit === null ? null : { name: kit.name, tokens: kit.tokens.length, modes: kit.modes } };
    return { value: live?.note === undefined ? withKit : { ...withKit, selectionNote: live.note } };
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
      modes: kitOf(records)?.modes ?? [],
      features: this.features,
    });
    if (!prepared.ok) return error(prepared.error);
    const before = new Map<string, TLRecord | undefined>();
    const byId = new Map(records.map((record) => [record.id as string, record]));
    for (const id of prepared.touched) before.set(id, byId.get(id));
    const locked = await fileLockRefusal(folder, prepared.put as unknown as TLRecord[], before);
    if (locked !== undefined) return error(locked);
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

  tools(): McpTool[] {
    return [
      {
        name: "canvas_read",
        description: canvasReadDescription(this.features),
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        call: (binding) => this.read(binding),
      },
      {
        name: "canvas_write",
        description: canvasWriteDescription(this.features),
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
