import type { Box } from "../grouping.ts";
import { boxesOverlap, clampGroupSize, mayBeGroupMember } from "../grouping.ts";
import { planRename } from "../groupRules.ts";
import { nextRef, plainText, readRef, rewriteRichTextTokens } from "../refs.ts";
import { readingOrder, type CanvasShape, type ShapeKind } from "../canvasShapes.ts";
import { compiledFileName } from "../components/compile.ts";
import type { ComponentDeclaration } from "../components/sheet.ts";
import type { Pin } from "../components/pins.ts";
import { nameRefusal, slugName, uniqueName } from "../groupRules.ts";
import { agentShapeId, roomShapeId } from "./turnText.ts";
import { ARTIFACT_SCALE_MAX, ARTIFACT_SCALE_MIN, isArtifactScale } from "@unframed/contracts";
import { cappedArtifactScale, scaledArtifactProps } from "../artifacts/artifactRules.ts";
import { currentVersion, nodeCanvasOf } from "../nodes/model.ts";
import { nodeStatus } from "../nodes/status.ts";
import { wireRefusal } from "../nodes/wires.ts";
import { GENERATION_PROVIDERS, isGenerationProvider, providerField, providerServesMessage } from "../generationProviders.ts";
import { VERCEL_BAD_PROVIDER } from "../vercel.ts";
import { NODE_DEFAULT_SIZE, NODE_MEDIA, NODE_MIN_HEIGHT, NODE_WIDTH, WIRE_ROLES } from "@unframed/contracts";

export interface CanvasRecord {
  readonly id: string;
  readonly typeName: string;
  readonly type?: string;
  readonly x?: number;
  readonly y?: number;
  readonly rotation?: number;
  readonly index?: string;
  readonly parentId?: string;
  readonly isLocked?: boolean;
  readonly opacity?: number;
  readonly props?: Readonly<Record<string, unknown>>;
  readonly meta?: Readonly<Record<string, unknown>>;
}

const obj = (value: unknown): Record<string, unknown> => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {});

export const shapeKind = (type: string | undefined): ShapeKind => {
  switch (type) {
    case "text":
      return "prompt";
    case "image":
    case "video":
    case "audio":
    case "page":
    case "motion":
    case "component":
    case "node":
    case "wire":
      return type;
    case "frame":
      return "group";
    default:
      return "mark";
  }
};

const isShape = (record: CanvasRecord): boolean => record.typeName === "shape";

const paintOrder = (records: ReadonlyArray<CanvasRecord>): CanvasRecord[] => {
  const shapes = records.filter(isShape);
  const children = new Map<string, CanvasRecord[]>();
  for (const shape of shapes) {
    const parent = shape.parentId ?? "";
    children.set(parent, [...(children.get(parent) ?? []), shape]);
  }
  for (const list of children.values()) list.sort((a, b) => ((a.index ?? "") < (b.index ?? "") ? -1 : (a.index ?? "") > (b.index ?? "") ? 1 : 0));
  const ids = new Set(shapes.map((shape) => shape.id));
  const ordered: CanvasRecord[] = [];
  const visit = (parent: string, depth: number) => {
    for (const shape of children.get(parent) ?? []) {
      ordered.push(shape);
      if (depth < 8) visit(shape.id, depth + 1);
    }
  };
  for (const [parent] of children) if (!ids.has(parent)) visit(parent, 0);
  return ordered;
};

const assetOf = (records: ReadonlyMap<string, CanvasRecord>, shape: CanvasRecord): CanvasRecord | undefined => {
  const assetId = obj(shape.props).assetId;
  return typeof assetId === "string" ? records.get(assetId) : undefined;
};

const PROJECT_FILE = "project-file:";

export const mediaSource = (asset: CanvasRecord | undefined): { file?: string; url?: string } => {
  const src = obj(asset?.props).src;
  if (typeof src !== "string") return {};
  if (src.startsWith(PROJECT_FILE)) return { file: src.slice(PROJECT_FILE.length) };
  if (src.startsWith("https://")) return { url: src };
  return {};
};

const isDefaultCrop = (crop: unknown): boolean => {
  const value = obj(crop);
  if (Object.keys(value).length === 0) return true;
  const topLeft = obj(value.topLeft);
  const bottomRight = obj(value.bottomRight);
  return value.isCircle !== true && topLeft.x === 0 && topLeft.y === 0 && bottomRight.x === 1 && bottomRight.y === 1;
};

interface ShapeBoxes {
  readonly local: Box;
  readonly page: Box;
}

interface CanvasViewInput {
  readonly records: ReadonlyArray<CanvasRecord>;
  readonly boxes: ReadonlyMap<string, ShapeBoxes>;
  readonly recipes: ReadonlyMap<string, unknown>;
  readonly selection: ReadonlyArray<string>;
  readonly declarations?: ReadonlyMap<string, ComponentDeclaration>;
  readonly pins?: ReadonlyMap<string, ReadonlyArray<Pin>>;
  readonly renders?: ReadonlyMap<string, string>;
}

interface CanvasView {
  readonly shapes: ReadonlyArray<Record<string, unknown>>;
  readonly selection: ReadonlyArray<string>;
}

export const canvasShapesOf = (records: ReadonlyArray<CanvasRecord>, boxes: ReadonlyMap<string, ShapeBoxes>): CanvasShape[] => {
  const byId = new Map(records.map((record) => [record.id, record]));
  return paintOrder(records).map((shape, z) => {
    const kind = shapeKind(shape.type);
    const ref = readRef(shape);
    const media = kind === "image" || kind === "video" ? mediaSource(assetOf(byId, shape)) : {};
    const parent = shape.parentId !== undefined && byId.get(shape.parentId)?.typeName === "shape" ? shape.parentId : undefined;
    const unframed = obj(obj(shape.meta).unframed);
    return {
      id: shape.id,
      kind,
      bounds: boxes.get(shape.id)?.page ?? { x: shape.x ?? 0, y: shape.y ?? 0, w: 1, h: 1 },
      z,
      ...(parent === undefined ? {} : { parent }),
      ...(ref === undefined ? {} : { ref }),
      ...(kind === "prompt" ? { text: plainText(obj(shape.props).richText) } : {}),
      ...(kind === "prompt" && obj(unframed.result).medium === "text" ? { textResult: true } : {}),
      ...(media.file === undefined ? {} : { file: media.file }),
      ...(media.url === undefined ? {} : { link: media.url }),
      ...((kind === "page" || kind === "motion") && typeof obj(shape.props).file === "string" && obj(shape.props).file !== "" ? { file: obj(shape.props).file as string } : {}),
    };
  });
};

const markOwner = (shapes: ReadonlyArray<CanvasShape>): Map<string, string> => {
  const images = shapes.filter((shape) => shape.kind === "image" && shape.file !== undefined);
  const owners = new Map<string, string>();
  for (const mark of shapes) {
    if (mark.kind !== "mark") continue;
    let owner: CanvasShape | undefined;
    for (const image of images) {
      if (image.z >= mark.z || !boxesOverlap(image.bounds, mark.bounds)) continue;
      if (owner === undefined || image.z > owner.z) owner = image;
    }
    if (owner) owners.set(mark.id, owner.id);
  }
  return owners;
};

const NEAR_GAP = 160;

const gapBetween = (a: Box, b: Box): number => {
  const dx = Math.max(0, a.x - (b.x + b.w), b.x - (a.x + a.w));
  const dy = Math.max(0, a.y - (b.y + b.h), b.y - (a.y + a.h));
  return Math.hypot(dx, dy);
};

const markNear = (shapes: ReadonlyArray<CanvasShape>, owners: ReadonlyMap<string, string>): Map<string, string> => {
  const images = shapes.filter((shape) => shape.kind === "image" && shape.file !== undefined);
  const near = new Map<string, string>();
  for (const mark of shapes) {
    if (mark.kind !== "mark" || owners.has(mark.id)) continue;
    let best: { id: string; gap: number } | undefined;
    for (const image of images) {
      const gap = gapBetween(mark.bounds, image.bounds);
      if (gap <= NEAR_GAP && (best === undefined || gap < best.gap)) best = { id: image.id, gap };
    }
    if (best !== undefined) near.set(mark.id, best.id);
  }
  return near;
};

const arrowEnds = (records: ReadonlyArray<CanvasRecord>): Map<string, { from?: string; to?: string }> => {
  const ends = new Map<string, { from?: string; to?: string }>();
  for (const record of records) {
    if (record.typeName !== "binding" || record.type !== "arrow") continue;
    const binding = record as unknown as { fromId?: unknown; toId?: unknown };
    if (typeof binding.fromId !== "string" || typeof binding.toId !== "string") continue;
    const terminal = obj(record.props).terminal;
    const current = ends.get(binding.fromId) ?? {};
    ends.set(binding.fromId, terminal === "start" ? { ...current, from: binding.toId } : terminal === "end" ? { ...current, to: binding.toId } : current);
  }
  return ends;
};

export const canvasView = (input: CanvasViewInput): CanvasView => {
  const byId = new Map(input.records.map((record) => [record.id, record]));
  const shapes = canvasShapesOf(input.records, input.boxes);
  const facts = new Map(shapes.map((shape) => [shape.id, shape]));
  const owners = markOwner(shapes);
  const nearby = markNear(shapes, owners);
  const ends = arrowEnds(input.records);
  const currentSheets = new Map<string, string>();
  for (const record of input.records) {
    if (record.type === "component" && typeof record.props?.tag === "string" && typeof record.props.file === "string") currentSheets.set(record.props.tag, record.props.file);
  }
  const out: Record<string, unknown>[] = [];
  const nodeCanvas = nodeCanvasOf(input.records, shapes, input.renders ?? new Map());
  for (const record of paintOrder(input.records)) {
    const fact = facts.get(record.id)!;
    if (fact.kind === "wire") {
      const wire = obj(record.props);
      out.push({
        id: agentShapeId(record.id),
        kind: "wire",
        from: agentShapeId(String(wire.from ?? "")),
        to: agentShapeId(String(wire.to ?? "")),
        role: wire.role,
        ...(wire.files === undefined ? {} : { files: wire.files }),
      });
      continue;
    }
    const props = obj(record.props);
    const unframed = obj(obj(record.meta).unframed);
    const local = input.boxes.get(record.id)?.local ?? { x: record.x ?? 0, y: record.y ?? 0, w: 0, h: 0 };
    const entry: Record<string, unknown> = {
      id: agentShapeId(record.id),
      kind: fact.kind,
      x: record.x ?? 0,
      y: record.y ?? 0,
      w: round(local.w),
      h: round(local.h),
      ...(fact.parent === undefined ? {} : { parent: agentShapeId(fact.parent) }),
      ...(fact.ref === undefined ? {} : { ref: fact.ref }),
    };
    switch (fact.kind) {
      case "prompt":
        entry.text = fact.text ?? "";
        break;
      case "image":
      case "video": {
        const asset = assetOf(byId, record);
        const source = mediaSource(asset);
        if (source.url !== undefined) entry.url = source.url;
        else if (source.file !== undefined) entry.file = source.file;
        const assetProps = obj(asset?.props);
        if (typeof assetProps.name === "string") entry.fileName = assetProps.name;
        const w = typeof assetProps.w === "number" && assetProps.w > 0 ? assetProps.w : Number(props.w);
        const h = typeof assetProps.h === "number" && assetProps.h > 0 ? assetProps.h : Number(props.h);
        if (w > 0 && h > 0) entry.aspect = round(w / h, 4);
        if (fact.kind === "image" && !isDefaultCrop(props.crop)) entry.crop = props.crop;
        break;
      }
      case "audio": {
        if (typeof props.file === "string" && props.file !== "") entry.file = props.file;
        entry.fileName = typeof props.fileName === "string" ? props.fileName : "";
        break;
      }
      case "group": {
        entry.members = shapes
          .filter((shape) => shape.parent === record.id)
          .sort(readingOrder)
          .map((shape) => agentShapeId(shape.id));
        if (unframed.recipe !== undefined) entry.recipe = unframed.recipe;
        break;
      }
      case "page":
      case "motion": {
        entry.file = typeof props.file === "string" ? props.file : "";
        entry.title = typeof props.title === "string" ? props.title : "";
        if (props.dials !== undefined && Object.keys(obj(props.dials)).length > 0) entry.dials = props.dials;
        const pinned = input.pins?.get(record.id) ?? [];
        if (pinned.length > 0) entry.components = pinned.map((pin) => ({ tag: pin.tag, sheet: pin.sheet, current: currentSheets.get(pin.tag) === undefined || currentSheets.get(pin.tag) === pin.sheet }));
        if (typeof props.mode === "string") entry.mode = props.mode;
        if (isArtifactScale(props.scale) && props.scale !== 1) entry.scale = props.scale;
        if (Array.isArray(props.lockedElements) && props.lockedElements.length > 0) entry.lockedElements = props.lockedElements;
        break;
      }
      case "component": {
        const file = typeof props.file === "string" ? props.file : "";
        const declaration = input.declarations?.get(record.id);
        entry.title = typeof props.title === "string" ? props.title : "";
        entry.tag = typeof props.tag === "string" ? props.tag : "";
        entry.file = file;
        entry.compiled = file === "" ? "" : compiledFileName(file);
        entry.variants = declaration?.variants ?? {};
        entry.props = declaration?.props ?? {};
        entry.slots = declaration?.slots ?? [];
        break;
      }
      case "node": {
        const node = nodeCanvas.nodes.get(record.id)!;
        const status = nodeStatus({ node, canvas: nodeCanvas });
        entry.medium = node.medium;
        entry.model = node.model;
        if (node.provider !== undefined) entry.provider = node.provider;
        entry.params = node.params;
        if (node.runs !== undefined) entry.runs = node.runs;
        entry.instruction = node.instruction;
        entry.status = status.state;
        if (status.line !== "") entry.statusLine = status.line;
        entry.versions = node.versions.length;
        const current = currentVersion(node);
        if (current) entry.current = { ...(current.file === undefined ? {} : { file: current.file }), ...(current.fileName === undefined ? {} : { fileName: current.fileName }), ...(current.text === undefined ? {} : { text: current.text }) };
        if (node.error !== undefined) entry.error = node.error;
        break;
      }
      case "mark": {
        entry.type = record.type;
        const text = plainText(props.richText).trim();
        if (text !== "") entry.text = text;
        const on = owners.get(record.id);
        if (on !== undefined) entry.on = agentShapeId(on);
        const near = nearby.get(record.id);
        if (near !== undefined) entry.near = agentShapeId(near);
        const end = ends.get(record.id);
        if (end?.from !== undefined) entry.from = agentShapeId(end.from);
        if (end?.to !== undefined) entry.to = agentShapeId(end.to);
        break;
      }
    }
    const recipe = input.recipes.get(record.id);
    if (recipe !== undefined) entry.recipe = recipe;
    if (typeof obj(unframed.run).runId === "string") entry.running = true;
    out.push(entry);
  }
  const existing = new Set(input.records.filter(isShape).map((record) => record.id));
  return { shapes: out, selection: input.selection.filter((id) => existing.has(id)).map(agentShapeId) };
};

const round = (value: number, places = 2): number => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

const MAX_OPS = 200;

const OP_TYPES = new Set(["create", "update", "move", "resize", "delete", "reparent", "rename"]);
const CREATE_KINDS = new Set(["prompt", "image", "video", "audio", "group", "mark", "node", "wire"]);
const RUN_FIELDS = ["versions", "currentVersionId", "run", "status", "error"];
const MARK_TYPES = new Set(["geo", "note", "arrow", "line"]);

export interface FileFacts {
  readonly fileName: string;
  readonly mime?: string;
  readonly w?: number;
  readonly h?: number;
  readonly bytes?: number;
}

export interface BatchContext {
  readonly records: ReadonlyArray<CanvasRecord>;
  readonly file: (name: string) => FileFacts | undefined;
  readonly newShapeId: () => string;
  readonly newAssetId: () => string;
  readonly indexAbove: (below: string | undefined) => string;
  readonly pageId: string;
  readonly boxes: ReadonlyMap<string, ShapeBoxes>;
  readonly modes?: ReadonlyArray<string>;
}

type PreparedBatch =
  | {
      readonly ok: true;
      readonly put: ReadonlyArray<CanvasRecord>;
      readonly remove: ReadonlyArray<string>;
      readonly ids: Readonly<Record<string, string>>;
      readonly touched: ReadonlyArray<string>;
    }
  | { readonly ok: false; readonly error: string };

class Refusal extends Error {}

const refuse = (message: string): never => {
  throw new Refusal(message);
};

const hasDataUrl = (value: unknown): boolean => {
  if (typeof value === "string") return /^data:/i.test(value);
  if (Array.isArray(value)) return value.some(hasDataUrl);
  if (typeof value === "object" && value !== null) return Object.values(value).some(hasDataUrl);
  return false;
};

const stripEngineKeys = (props: Record<string, unknown>): Record<string, unknown> => {
  const { meta: _meta, unframed: _unframed, ...rest } = props;
  return rest;
};

export const richTextOf = (text: string) => ({
  type: "doc",
  content: text.split("\n").map((line) => (line === "" ? { type: "paragraph" } : { type: "paragraph", content: [{ type: "text", text: line }] })),
});

const shapeBase = (id: string, type: string, x: number, y: number, parentId: string, index: string) => ({
  id,
  typeName: "shape",
  type,
  x,
  y,
  rotation: 0,
  index,
  parentId,
  isLocked: false,
  opacity: 1,
});

const MARK_DEFAULTS: Record<string, (w: number, h: number) => Record<string, unknown>> = {
  geo: (w, h) => ({
    geo: "rectangle",
    dash: "draw",
    url: "",
    w,
    h,
    growY: 0,
    scale: 1,
    flipX: false,
    flipY: false,
    labelColor: "black",
    color: "black",
    fill: "none",
    size: "m",
    font: "draw",
    align: "middle",
    verticalAlign: "middle",
    richText: richTextOf(""),
  }),
  note: () => ({
    color: "yellow",
    labelColor: "black",
    size: "m",
    font: "draw",
    fontSizeAdjustment: 1,
    align: "middle",
    verticalAlign: "middle",
    growY: 0,
    url: "",
    richText: richTextOf(""),
    scale: 1,
    textLastEditedBy: null,
  }),
  arrow: (w, h) => ({
    kind: "arc",
    labelColor: "black",
    color: "black",
    fill: "none",
    dash: "draw",
    size: "m",
    arrowheadStart: "none",
    arrowheadEnd: "arrow",
    font: "draw",
    start: { x: 0, y: 0 },
    end: { x: w, y: h },
    bend: 0,
    richText: richTextOf(""),
    labelPosition: 0.5,
    scale: 1,
    elbowMidPoint: 0.5,
  }),
  line: (w, h) => ({
    color: "black",
    dash: "draw",
    size: "m",
    spline: "line",
    points: { a1: { id: "a1", index: "a1", x: 0, y: 0 }, a2: { id: "a2", index: "a2", x: w, y: h } },
    scale: 1,
  }),
};

const TEXT_LABEL_TYPES = new Set(["geo", "note", "arrow", "text"]);

class Batch {
  readonly working: Map<string, CanvasRecord>;
  readonly original: ReadonlyMap<string, CanvasRecord>;
  readonly provisional = new Map<string, string>();
  readonly touched = new Set<string>();
  private readonly lastIndex = new Map<string, string | undefined>();
  private readonly ctx: BatchContext;

  constructor(ctx: BatchContext) {
    this.ctx = ctx;
    this.original = new Map(ctx.records.map((record) => [record.id, record]));
    this.working = new Map(this.original);
  }

  shape(op: string, raw: unknown): CanvasRecord {
    if (typeof raw !== "string" || raw === "") return refuse(`${op}: id must be a string`);
    const id = raw.startsWith("new:") ? this.provisional.get(raw) : roomShapeId(raw);
    const found = id === undefined ? undefined : this.working.get(id);
    if (!found || found.typeName !== "shape") return refuse(`${op}: there is no shape ${raw}`);
    return found;
  }

  put(record: CanvasRecord): void {
    this.working.set(record.id, record);
    if (record.typeName === "shape") this.touched.add(record.id);
  }

  remove(id: string): void {
    this.working.delete(id);
    this.touched.add(id);
  }

  indexFor(parentId: string): string {
    if (!this.lastIndex.has(parentId)) {
      let highest: string | undefined;
      for (const record of this.working.values()) {
        if (record.typeName !== "shape" || record.parentId !== parentId || record.index === undefined) continue;
        if (highest === undefined || record.index > highest) highest = record.index;
      }
      this.lastIndex.set(parentId, highest);
    }
    const next = this.ctx.indexAbove(this.lastIndex.get(parentId));
    this.lastIndex.set(parentId, next);
    return next;
  }

  records(): CanvasRecord[] {
    return [...this.working.values()];
  }

  groupOrigin(group: CanvasRecord): { x: number; y: number } {
    return { x: group.x ?? 0, y: group.y ?? 0 };
  }
}

const AUDIO_HEIGHT = 64;
const AUDIO_DEFAULT_SIZE = { w: 320 };
const AUDIO_EMPTY_SIZE = { w: 240 };
const clampAudioWidth = (w: number): number => Math.min(640, Math.max(200, w));

const numeric = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

const fileOf = (op: string, ctx: BatchContext, props: Record<string, unknown>): FileFacts | undefined => {
  if (!("file" in props) || props.file === null) return undefined;
  const file = props.file;
  const facts = typeof file === "string" ? ctx.file(file) : undefined;
  if (facts === undefined) refuse(`${op}: no file named "${String(file)}" in the project folder`);
  return facts;
};

const precheck = (ops: ReadonlyArray<unknown>, ctx: BatchContext): void => {
  const existing = new Set(ctx.records.map((record) => record.id));
  const created = new Set<string>();
  for (const op of ops) {
    if (typeof op !== "object" || op === null || Array.isArray(op)) refuse("every op must be an object");
    const record = op as Record<string, unknown>;
    const type = record.type;
    if (type === "batch") refuse("a call is already one batch; pass the ops flat");
    if (typeof type !== "string" || !OP_TYPES.has(type)) refuse(`unknown op type "${String(type)}"`);
    if (type === "create") {
      const kind = record.kind;
      if (kind === "page" || kind === "motion") refuse("create: make pages and motions with page_write and motion_write");
      if (kind === "component") refuse("create: make components with component_write");
      if (typeof kind !== "string" || !CREATE_KINDS.has(kind)) refuse(`create: unknown kind "${String(kind)}"`);
      const id = record.id;
      if (typeof id !== "string" || id === "") refuse('create: id must be a string (use "new:<name>" for a fresh id)');
      const key = id as string;
      if ((!key.startsWith("new:") && existing.has(roomShapeId(key))) || created.has(key)) refuse(`create: shape ${key} already exists`);
      created.add(key);
      if (!numeric(record.x) || !numeric(record.y)) refuse("create: x and y must be numbers");
    }
    const props = obj(record.props);
    if (type === "update" && "lockedElements" in props) refuse("update: lockedElements is set by the person in the editor's Layers tab");
    if (type === "update" || (type === "create" && record.kind === "node")) {
      for (const field of RUN_FIELDS) if (field in props) refuse(`${String(type)}: ${field} is written by runs`);
    }
    if (hasDataUrl(props)) refuse(`${String(type)}: bytes cannot travel in shape props; name a file in the project folder instead`);
    if (type === "create" || type === "update") fileOf(String(type), ctx, props);
  }
};

const assetRecord = (id: string, type: "image" | "video", src: string, facts: FileFacts | undefined, name: string): CanvasRecord => ({
  id,
  typeName: "asset",
  type,
  props: {
    w: facts?.w ?? 0,
    h: facts?.h ?? 0,
    name,
    isAnimated: type === "video" || facts?.mime === "image/gif",
    mimeType: facts?.mime ?? (type === "video" ? "video/mp4" : "image/png"),
    src,
    ...(facts?.bytes !== undefined && facts.bytes > 0 ? { fileSize: facts.bytes } : {}),
  },
  meta: {},
});

const HTTPS = /^https:\/\/.+/;

const mediaAsset = (op: string, ctx: BatchContext, kind: "image" | "video", props: Record<string, unknown>): CanvasRecord | undefined => {
  if (typeof props.file === "string") {
    const facts = ctx.file(props.file)!;
    return assetRecord(ctx.newAssetId(), kind, `${PROJECT_FILE}${props.file}`, facts, facts.fileName);
  }
  if (kind === "video" && props.url !== undefined && props.url !== null) {
    if (typeof props.url !== "string" || !HTTPS.test(props.url)) refuse(`${op}: a clip link must start with https://`);
    const url = props.url as string;
    return assetRecord(ctx.newAssetId(), "video", url, undefined, url.split("/").pop() || url);
  }
  if (kind === "image" && props.url !== undefined) refuse(`${op}: an image names a file with props.file`);
  return undefined;
};

const groupParent = (op: string, batch: Batch, raw: unknown): CanvasRecord | undefined => {
  if (raw === undefined || raw === null) return undefined;
  const group = batch.shape(op, raw);
  if (group.type !== "frame") refuse(`${op}: ${String(raw)} is not a group`);
  return group;
};

const create = (batch: Batch, ctx: BatchContext, op: Record<string, unknown>): void => {
  const kind = op.kind as string;
  const props = stripEngineKeys(obj(op.props));
  const parent = groupParent("create", batch, op.parent);
  const tlType = kind === "prompt" ? "text" : kind === "group" ? "frame" : kind === "mark" ? String(props.type) : kind;
  if (kind === "mark" && !MARK_TYPES.has(tlType)) refuse(`create: a mark's props.type is one of geo, note, arrow or line, not "${String(props.type)}"`);
  if (parent && !mayBeGroupMember(tlType)) refuse(`create: a ${kind} cannot be a member of a group`);
  const parentId = parent?.id ?? ctx.pageId;
  const provisional = op.id as string;
  const id = provisional.startsWith("new:") ? ctx.newShapeId() : roomShapeId(provisional);
  if (provisional.startsWith("new:")) batch.provisional.set(provisional, id);
  const base = shapeBase(id, tlType, op.x as number, op.y as number, parentId, batch.indexFor(parentId));
  const w = numeric(op.w) && op.w > 0 ? op.w : undefined;
  const h = numeric(op.h) && op.h > 0 ? op.h : undefined;
  const ref = () => nextRef(batch.records());
  let record: CanvasRecord;
  switch (kind) {
    case "prompt": {
      const { text, ...rest } = props;
      record = {
        ...base,
        props: {
          color: "black",
          size: "s",
          w: w ?? 320,
          font: "sans",
          textAlign: "start",
          autoSize: false,
          scale: 1,
          ...rest,
          richText: richTextOf(typeof text === "string" ? text : ""),
        },
        meta: { ref: ref(), ...(w === undefined ? {} : { sized: true }) },
      };
      break;
    }
    case "image":
    case "video": {
      const asset = mediaAsset("create", ctx, kind, props);
      const facts = typeof props.file === "string" ? ctx.file(props.file) : undefined;
      const naturalW = facts?.w && facts.w > 0 ? facts.w : undefined;
      const naturalH = facts?.h && facts.h > 0 ? facts.h : undefined;
      const width = w ?? (naturalW !== undefined ? Math.min(naturalW, 480) : kind === "video" ? 320 : 240);
      const height = h ?? (naturalW !== undefined && naturalH !== undefined ? (width * naturalH) / naturalW : kind === "video" ? 180 : 240);
      const { file: _file, url: _url, ...rest } = props;
      if (asset) batch.put(asset);
      record = {
        ...base,
        props:
          kind === "image"
            ? { w: width, h: height, playing: true, url: "", assetId: asset?.id ?? null, crop: null, flipX: false, flipY: false, altText: "", ...rest }
            : { w: width, h: height, time: 0, playing: false, autoplay: false, url: "", assetId: asset?.id ?? null, altText: "", ...rest },
        meta: { ref: ref() },
      };
      break;
    }
    case "audio": {
      if (props.url !== undefined) refuse("create: audio takes props.file, a file in the project folder");
      const facts = typeof props.file === "string" ? ctx.file(props.file) : undefined;
      const { file: _file, fileName: _fileName, ...rest } = props;
      record = {
        ...base,
        props: { ...rest, w: clampAudioWidth(w ?? (facts ? AUDIO_DEFAULT_SIZE.w : AUDIO_EMPTY_SIZE.w)), h: AUDIO_HEIGHT, file: facts ? (props.file as string) : "", fileName: facts?.fileName ?? "" },
        meta: { ref: ref() },
      };
      break;
    }
    case "group": {
      const taken = batch.records().flatMap((known) => {
        const known_ref = readRef(known);
        return known_ref === undefined ? [] : [known_ref];
      });
      const wanted = typeof props.name === "string" ? slugName(props.name) : "";
      const name = uniqueName(wanted === "" ? nextRef(batch.records()) : wanted, taken);
      const size = clampGroupSize({ w: w ?? 420, h: h ?? 280 });
      const { name: _name, ...rest } = props;
      record = { ...base, props: { w: size.w, h: size.h, name, color: "black", ...rest }, meta: {} };
      break;
    }
    case "node": {
      const medium = props.medium;
      if (typeof medium !== "string" || !(NODE_MEDIA as ReadonlyArray<string>).includes(medium)) refuse(`create: a node's props.medium is one of ${NODE_MEDIA.join(", ")}`);
      record = {
        ...base,
        props: {
          w: Math.min(NODE_WIDTH.max, Math.max(NODE_WIDTH.min, w ?? NODE_DEFAULT_SIZE.w)),
          h: Math.max(NODE_MIN_HEIGHT, h ?? NODE_DEFAULT_SIZE.h),
          ...nodeSettings("create", medium as string, props),
          versions: [],
          currentVersionId: null,
        },
        meta: { ref: ref() },
      };
      break;
    }
    case "wire": {
      if (parent) refuse("create: a wire cannot be a member of a group");
      const from = batch.shape("create", props.from);
      const to = batch.shape("create", props.to);
      const role = props.role;
      if (typeof role !== "string" || !(WIRE_ROLES as ReadonlyArray<string>).includes(role)) refuse(`create: a wire's props.role is one of ${WIRE_ROLES.join(", ")}`);
      const refusal = wireRefusal({ canvas: nodeCanvasOf(batch.records(), canvasShapesOf(batch.records(), ctx.boxes)), from: from.id, to: to.id, role: role as never });
      if (refusal !== null) refuse(`create: ${refusal}`);
      const files = props.files === "entry" || props.files === "linked" ? { files: props.files } : {};
      record = { ...shapeBase(id, "wire", 0, 0, ctx.pageId, batch.indexFor(ctx.pageId)), props: { from: from.id, to: to.id, role, ...files }, meta: { unframed: { chosen: true } } };
      break;
    }
    default: {
      const { type: _type, text, ...rest } = props;
      const defaults = MARK_DEFAULTS[tlType]!(w ?? 100, h ?? (tlType === "arrow" || tlType === "line" ? 0 : 100));
      record = {
        ...base,
        props: { ...defaults, ...rest, ...(typeof text === "string" && TEXT_LABEL_TYPES.has(tlType) ? { richText: richTextOf(text) } : {}) },
        meta: {},
      };
    }
  }
  batch.put(record);
};

export const PAGE_NODE_PROVIDER = "A page node runs through OpenRouter.";

const nodeSettings = (op: string, medium: string, props: Record<string, unknown>): Record<string, unknown> => {
  const settings: Record<string, unknown> = { medium, model: "", params: {}, instruction: "" };
  if (props.model !== undefined) {
    if (typeof props.model !== "string") refuse(`${op}: a node's props.model is a model id`);
    settings.model = props.model;
  }
  if (props.params !== undefined) {
    const params = obj(props.params);
    for (const [key, value] of Object.entries(params)) if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") refuse(`${op}: params.${key} must be a string, number or boolean`);
    settings.params = params;
  }
  if (props.instruction !== undefined) {
    if (typeof props.instruction !== "string") refuse(`${op}: a node's props.instruction is text`);
    settings.instruction = props.instruction;
  }
  if (props.runs !== undefined && props.runs !== null) {
    if (medium !== "image") refuse(`${op}: only an image node takes runs`);
    if (!Number.isInteger(props.runs) || (props.runs as number) < 1 || (props.runs as number) > 10) refuse(`${op}: runs is a whole number from 1 to 10`);
    settings.runs = props.runs;
  }
  if (props.provider !== undefined && props.provider !== null) {
    const provider = props.provider;
    if (!isGenerationProvider(provider)) return refuse(`${op}: ${VERCEL_BAD_PROVIDER}`);
    if (medium === "page" && provider !== "openrouter") refuse(`${op}: ${PAGE_NODE_PROVIDER}`);
    if (medium !== "page" && !GENERATION_PROVIDERS[provider].media.includes(medium as never)) refuse(`${op}: ${providerServesMessage(provider, medium as never)}`);
    Object.assign(settings, providerField(provider));
  }
  return settings;
};

const renameShape = (batch: Batch, ctx: BatchContext, shape: CanvasRecord, typed: unknown, op: string): void => {
  if (readRef(shape) === undefined) refuse(`${op}: ${agentShapeId(shape.id)} has no @id to rename`);
  if (typeof typed !== "string") refuse(`${op}: name must be a string`);
  const refusal = nameRefusal(typed as string, readRef(shape)!);
  if (refusal !== undefined) refuse(`${op}: ${refusal}`);
  const records = batch.records();
  const plan = planRename(canvasShapesOf(records, ctx.boxes), shape.id, typed as string);
  if (plan === undefined) return;
  batch.put(
    shape.type === "frame"
      ? { ...shape, props: { ...obj(shape.props), name: plan.to } }
      : {
          ...shape,
          meta: { ...obj(shape.meta), ref: plan.to },
          ...(plan.title === undefined ? {} : { props: { ...obj(shape.props), title: plan.title } }),
        },
  );
  for (const rewrite of plan.rewrites) {
    const prompt = batch.working.get(rewrite.id)!;
    const props = obj(prompt.props);
    batch.put({ ...prompt, props: { ...props, richText: rewriteRichTextTokens(props.richText, { [plan.from]: plan.to }) } });
  }
};

const update = (batch: Batch, ctx: BatchContext, op: Record<string, unknown>): void => {
  const shape = batch.shape("update", op.id);
  const patch = stripEngineKeys(obj(op.props));
  const props: Record<string, unknown> = { ...obj(shape.props) };
  const kind = shapeKind(shape.type);
  if (kind === "component") {
    for (const field of ["tag", "file"]) if (field in patch) refuse(`update: ${field} is written by component_write`);
  }
  if (kind === "node") {
    const allowed = new Set(["medium", "model", "params", "runs", "instruction", "provider", "w", "h"]);
    for (const key of Object.keys(patch)) if (!allowed.has(key)) refuse(`update: a node takes medium, model, provider, params, runs and instruction, not ${key}`);
    const medium = typeof patch.medium === "string" ? patch.medium : String(props.medium);
    if (!(NODE_MEDIA as ReadonlyArray<string>).includes(medium)) refuse(`update: a node's props.medium is one of ${NODE_MEDIA.join(", ")}`);
    const settings = nodeSettings("update", medium, { ...patch, ...(patch.runs === undefined && medium !== "image" ? {} : {}) });
    const next: Record<string, unknown> = { ...props, medium };
    for (const key of ["model", "params", "instruction", "runs"]) if (key in patch && patch[key] !== null) next[key] = settings[key];
    if (patch.runs === null || medium !== "image") delete next.runs;
    if ("provider" in patch) {
      delete next.provider;
      Object.assign(next, providerField(settings.provider as never));
    }
    if (medium !== "image" && medium !== "text") delete next.provider;
    if (numeric(patch.w)) next.w = Math.min(NODE_WIDTH.max, Math.max(NODE_WIDTH.min, patch.w));
    if (numeric(patch.h)) next.h = Math.max(NODE_MIN_HEIGHT, patch.h);
    delete next.error;
    batch.put({ ...shape, props: next });
    return;
  }
  if (kind === "wire") {
    for (const key of Object.keys(patch)) if (key !== "role" && key !== "files") refuse(`update: a wire takes role and files, not ${key}`);
    const role = patch.role ?? props.role;
    if (typeof role !== "string" || !(WIRE_ROLES as ReadonlyArray<string>).includes(role)) refuse(`update: a wire's props.role is one of ${WIRE_ROLES.join(", ")}`);
    const refusal = wireRefusal({ canvas: nodeCanvasOf(batch.records(), canvasShapesOf(batch.records(), ctx.boxes)), from: String(props.from), to: String(props.to), role: role as never, wireId: shape.id });
    if (refusal !== null) refuse(`update: ${refusal}`);
    const next: Record<string, unknown> = { ...props, role };
    if (patch.files === "entry" || patch.files === "linked") next.files = patch.files;
    else if (patch.files === null) delete next.files;
    batch.put({ ...shape, props: next, meta: { ...obj(shape.meta), unframed: { ...obj(obj(shape.meta).unframed), chosen: true } } });
    return;
  }
  if (kind === "group" && "name" in patch) {
    const { name, ...rest } = patch;
    renameShape(batch, ctx, shape, name, "update");
    const renamed = batch.working.get(shape.id)!;
    return applyPatch(batch, renamed, { ...obj(renamed.props) }, rest);
  }
  if (kind === "audio") {
    if (patch.url !== undefined) refuse("update: audio takes props.file, a file in the project folder");
    const { file, fileName: _fileName, w, h: _h, ...rest } = patch;
    if (typeof file === "string") {
      props.file = file;
      props.fileName = ctx.file(file)?.fileName ?? "";
    } else if (file === null) {
      props.file = "";
      props.fileName = "";
    }
    if (numeric(w) && w > 0) props.w = clampAudioWidth(w);
    return applyPatch(batch, shape, props, rest);
  }
  if (kind === "image" || kind === "video") {
    const asset = mediaAsset("update", ctx, kind, patch);
    const { file: _file, url: _url, ...rest } = patch;
    if (asset) {
      batch.put(asset);
      props.assetId = asset.id;
    } else if (patch.file === null || patch.url === null) {
      props.assetId = null;
    }
    return applyPatch(batch, shape, props, rest);
  }
  if (TEXT_LABEL_TYPES.has(shape.type ?? "") && "text" in patch) {
    const { text, ...rest } = patch;
    props.richText = richTextOf(typeof text === "string" ? text : "");
    return applyPatch(batch, shape, props, rest);
  }
  if ((kind === "page" || kind === "motion") && typeof patch.mode === "string" && !(ctx.modes ?? []).includes(patch.mode)) {
    refuse(`there is no mode ${patch.mode} in the kit`);
  }
  if ((kind === "page" || kind === "motion") && "scale" in patch) {
    const { scale, ...rest } = patch;
    const next = scale === null ? 1 : scale;
    if (!isArtifactScale(next)) refuse(`update: scale must be a number from ${ARTIFACT_SCALE_MIN} to ${ARTIFACT_SCALE_MAX}`);
    if (!numeric(props.w) || !numeric(props.h)) return applyPatch(batch, shape, props, patch);
    if (!("w" in rest) && !("h" in rest)) return applyPatch(batch, shape, {}, { ...scaledArtifactProps(props as { w: number; h: number }, next as number), ...rest });
    const sized = { ...props, ...rest } as { w: number; h: number };
    const capped = cappedArtifactScale({ ...sized, scale: next });
    return applyPatch(batch, shape, props, { ...rest, scale: capped === 1 ? null : capped });
  }
  applyPatch(batch, shape, props, patch);
};

const applyPatch = (batch: Batch, shape: CanvasRecord, props: Record<string, unknown>, patch: Record<string, unknown>): void => {
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete props[key];
    else props[key] = value;
  }
  batch.put({ ...shape, props });
};

const move = (batch: Batch, op: Record<string, unknown>): void => {
  const shape = batch.shape("move", op.id);
  if (shape.type === "wire") refuse("move: a wire follows its ends");
  if (!numeric(op.x) || !numeric(op.y)) refuse("move: x and y must be numbers");
  batch.put({ ...shape, x: op.x as number, y: op.y as number });
};

const resize = (batch: Batch, op: Record<string, unknown>): void => {
  const shape = batch.shape("resize", op.id);
  if (shape.type === "wire") refuse("resize: a wire has no size to set");
  const w = op.w;
  const h = op.h;
  if (!numeric(w) || !numeric(h) || w <= 0 || h <= 0) refuse("resize: w and h must be positive numbers");
  const props = obj(shape.props);
  switch (shape.type) {
    case "image":
    case "video": {
      const ratio = numeric(props.w) && numeric(props.h) && props.w > 0 ? props.h / props.w : (h as number) / (w as number);
      batch.put({ ...shape, props: { ...props, w, h: (w as number) * ratio } });
      return;
    }
    case "audio":
      batch.put({ ...shape, props: { ...props, w: clampAudioWidth(w as number), h: AUDIO_HEIGHT } });
      return;
    case "frame": {
      const size = clampGroupSize({ w: w as number, h: h as number });
      batch.put({ ...shape, props: { ...props, ...size } });
      return;
    }
    case "text":
      batch.put({ ...shape, props: { ...props, w }, meta: { ...obj(shape.meta), sized: true } });
      return;
    case "node":
      batch.put({ ...shape, props: { ...props, w: Math.min(NODE_WIDTH.max, Math.max(NODE_WIDTH.min, w as number)), h: Math.max(NODE_MIN_HEIGHT, h as number) } });
      return;
    case "arrow":
    case "line":
    case "note":
    case "draw":
    case "highlight":
      refuse(`resize: a ${shape.type} has no size to set`);
      return;
    default:
      batch.put({ ...shape, props: { ...props, w, h } });
  }
};

const remove = (batch: Batch, op: Record<string, unknown>): void => {
  const shape = batch.shape("delete", op.id);
  const gone = new Set([shape.id]);
  if (shape.type === "frame") {
    for (const record of batch.records()) {
      if (record.typeName === "shape" && record.parentId === shape.id) {
        batch.remove(record.id);
        gone.add(record.id);
      }
    }
  }
  batch.remove(shape.id);
  for (const record of batch.records()) {
    if (record.type !== "wire") continue;
    const ends = obj(record.props);
    if (gone.has(String(ends.from)) || gone.has(String(ends.to))) batch.remove(record.id);
  }
};

const reparent = (batch: Batch, ctx: BatchContext, op: Record<string, unknown>): void => {
  const shape = batch.shape("reparent", op.id);
  const current = shape.parentId !== undefined ? batch.working.get(shape.parentId) : undefined;
  const origin = current?.typeName === "shape" ? batch.groupOrigin(current) : { x: 0, y: 0 };
  const pageX = origin.x + (shape.x ?? 0);
  const pageY = origin.y + (shape.y ?? 0);
  if (op.parent === null || op.parent === undefined) {
    batch.put({ ...shape, parentId: ctx.pageId, x: pageX, y: pageY, index: batch.indexFor(ctx.pageId) });
    return;
  }
  const group = groupParent("reparent", batch, op.parent)!;
  if (!mayBeGroupMember(shape.type ?? "")) refuse(`reparent: a ${shapeKind(shape.type)} cannot be a member of a group`);
  const target = batch.groupOrigin(group);
  batch.put({ ...shape, parentId: group.id, x: pageX - target.x, y: pageY - target.y, index: batch.indexFor(group.id) });
};

export const prepareBatch = (ops: unknown, ctx: BatchContext): PreparedBatch => {
  try {
    if (!Array.isArray(ops) || ops.length === 0) refuse("ops must be a non-empty array");
    const list = ops as unknown[];
    if (list.length > MAX_OPS) refuse(`at most ${MAX_OPS} ops per call`);
    precheck(list, ctx);
    const batch = new Batch(ctx);
    for (const raw of list) {
      const op = raw as Record<string, unknown>;
      switch (op.type) {
        case "create":
          create(batch, ctx, op);
          break;
        case "update":
          update(batch, ctx, op);
          break;
        case "move":
          move(batch, op);
          break;
        case "resize":
          resize(batch, op);
          break;
        case "delete":
          remove(batch, op);
          break;
        case "reparent":
          reparent(batch, ctx, op);
          break;
        case "rename":
          renameShape(batch, ctx, batch.shape("rename", op.id), op.name, "rename");
          break;
      }
    }
    const put: CanvasRecord[] = [];
    for (const [id, record] of batch.working) if (batch.original.get(id) !== record) put.push(record);
    const removed = [...batch.original.keys()].filter((id) => !batch.working.has(id));
    const ids: Record<string, string> = {};
    for (const [provisional, id] of batch.provisional) if (batch.working.has(id)) ids[provisional] = agentShapeId(id);
    return { ok: true, put, remove: removed, ids, touched: [...batch.touched] };
  } catch (error) {
    if (error instanceof Refusal) return { ok: false, error: error.message };
    throw error;
  }
};
