/**
 * The canvas tools' pure half (spec 07): what `canvas_read` shows the agent, and how a
 * `canvas_write` batch becomes one room change: every refusal, provisional ids, the
 * canvas's own `@id` counter, run markers stripped, group rules and rename.
 */
import type { Box } from "../grouping.ts";
import { boxesOverlap, clampGroupSize, mayBeGroupMember } from "../grouping.ts";
import { planRename } from "../groupRules.ts";
import { nextRef, plainText, readRef, rewriteRichTextTokens } from "../refs.ts";
import { readingOrder, type CanvasShape, type ShapeKind } from "../canvasShapes.ts";
import { slugName, uniqueName } from "../groupRules.ts";
import { agentShapeId, roomShapeId } from "./turnText.ts";

/** A canvas record as these rules read it: tldraw's fields, loosely typed. */
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
    case "page":
    case "motion":
      return type;
    case "frame":
      return "group";
    default:
      return "mark";
  }
};

const isShape = (record: CanvasRecord): boolean => record.typeName === "shape";

/** Every shape in paint order: the page's children by index, a group's children right after it. */
export const paintOrder = (records: ReadonlyArray<CanvasRecord>): CanvasRecord[] => {
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

/** A media shape's file (a project file name) or clip link, from its asset. */
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

export interface ShapeBoxes {
  /** The box in the shape's parent's space (its `x, y` as the document holds them). */
  readonly local: Box;
  /** The box on the page. */
  readonly page: Box;
}

export interface CanvasViewInput {
  readonly records: ReadonlyArray<CanvasRecord>;
  readonly boxes: ReadonlyMap<string, ShapeBoxes>;
  /** Each result's recipe, read from its sidecar, by room id. */
  readonly recipes: ReadonlyMap<string, unknown>;
  /** The room ids the person had selected with the latest message. */
  readonly selection: ReadonlyArray<string>;
}

export interface CanvasView {
  readonly shapes: ReadonlyArray<Record<string, unknown>>;
  readonly selection: ReadonlyArray<string>;
}

/** The facts the generation rules read, for the mark rule, reading order and rename. */
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
    };
  });
};

/** The image each mark sits on: the topmost image with a file that it overlaps and sits above (spec 03's rule). */
export const markOwner = (shapes: ReadonlyArray<CanvasShape>): Map<string, string> => {
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

/**
 * What `canvas_read` answers: every shape in z-order with its id, kind, position, size and
 * its kind's fields, and the latest message's selection filtered to shapes that exist. No
 * byte of media: files are named, never read.
 */
export const canvasView = (input: CanvasViewInput): CanvasView => {
  const byId = new Map(input.records.map((record) => [record.id, record]));
  const shapes = canvasShapesOf(input.records, input.boxes);
  const facts = new Map(shapes.map((shape) => [shape.id, shape]));
  const owners = markOwner(shapes);
  const out: Record<string, unknown>[] = [];
  for (const record of paintOrder(input.records)) {
    const fact = facts.get(record.id)!;
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
      case "group": {
        entry.members = shapes
          .filter((shape) => shape.parent === record.id)
          .sort(readingOrder)
          .map((shape) => agentShapeId(shape.id));
        if (unframed.recipe !== undefined) entry.recipe = unframed.recipe;
        break;
      }
      case "page":
      case "motion":
        entry.file = typeof props.file === "string" ? props.file : "";
        entry.title = typeof props.title === "string" ? props.title : "";
        if (props.dials !== undefined && Object.keys(obj(props.dials)).length > 0) entry.dials = props.dials;
        break;
      case "mark": {
        entry.type = record.type;
        const text = plainText(props.richText).trim();
        if (text !== "") entry.text = text;
        const on = owners.get(record.id);
        if (on !== undefined) entry.on = agentShapeId(on);
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

// ---------------------------------------------------------------------------------------
// canvas_write

export const MAX_OPS = 200;

const OP_TYPES = new Set(["create", "update", "move", "resize", "delete", "reparent", "rename"]);
const CREATE_KINDS = new Set(["prompt", "image", "video", "group", "mark"]);
const MARK_TYPES = new Set(["geo", "note", "arrow", "line"]);

/** What the engine knows about a project file: its original name, type and natural size. */
export interface FileFacts {
  readonly fileName: string;
  readonly mime?: string;
  readonly w?: number;
  readonly h?: number;
  readonly bytes?: number;
}

export interface BatchContext {
  readonly records: ReadonlyArray<CanvasRecord>;
  /** The facts of a bare file name in the project folder; `undefined` when there is none. */
  readonly file: (name: string) => FileFacts | undefined;
  readonly newShapeId: () => string;
  readonly newAssetId: () => string;
  /** A fractional index above `below` (tldraw's `getIndexAbove`). */
  readonly indexAbove: (below: string | undefined) => string;
  readonly pageId: string;
  readonly boxes: ReadonlyMap<string, ShapeBoxes>;
}

export type PreparedBatch =
  | {
      readonly ok: true;
      readonly put: ReadonlyArray<CanvasRecord>;
      readonly remove: ReadonlyArray<string>;
      /** Each provisional id, mapped to the id the agent reads. */
      readonly ids: Readonly<Record<string, string>>;
      /** Every shape the batch created, changed or removed, as room ids. */
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

/** The run marker and run error belong to the engine: never taken from what the agent sends. */
const stripEngineKeys = (props: Record<string, unknown>): Record<string, unknown> => {
  const { meta: _meta, unframed: _unframed, ...rest } = props;
  return rest;
};

/** tldraw rich text for plain text: one paragraph per line. */
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
    fontSizeAdjustment: 0,
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

/** Applies a batch to a working copy of the canvas, all or nothing. */
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

  /** A group's page position, for keeping a member where it is on screen. */
  groupOrigin(group: CanvasRecord): { x: number; y: number } {
    return { x: group.x ?? 0, y: group.y ?? 0 };
  }
}

const numeric = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

const fileOf = (op: string, ctx: BatchContext, props: Record<string, unknown>): FileFacts | undefined => {
  if (!("file" in props) || props.file === null) return undefined;
  const file = props.file;
  const facts = typeof file === "string" ? ctx.file(file) : undefined;
  if (facts === undefined) refuse(`${op}: no file named "${String(file)}" in the project folder`);
  return facts;
};

/** The first refusal a batch meets before the canvas sees it, in op order. */
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
      if (typeof kind !== "string" || !CREATE_KINDS.has(kind)) refuse(`create: unknown kind "${String(kind)}"`);
      const id = record.id;
      if (typeof id !== "string" || id === "") refuse('create: id must be a string (use "new:<name>" for a fresh id)');
      const key = id as string;
      if ((!key.startsWith("new:") && existing.has(roomShapeId(key))) || created.has(key)) refuse(`create: shape ${key} already exists`);
      created.add(key);
      if (!numeric(record.x) || !numeric(record.y)) refuse("create: x and y must be numbers");
    }
    const props = obj(record.props);
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

/** A media shape's new asset from `props.file` or, for a video, `props.url`. */
const mediaAsset = (op: string, batch: Batch, ctx: BatchContext, kind: "image" | "video", props: Record<string, unknown>): CanvasRecord | undefined => {
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
      const asset = mediaAsset("create", batch, ctx, kind, props);
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

/** Renames any shape with an `@id` exactly as the canvas does (spec 06). */
const renameShape = (batch: Batch, ctx: BatchContext, shape: CanvasRecord, typed: unknown, op: string): void => {
  if (readRef(shape) === undefined) refuse(`${op}: ${agentShapeId(shape.id)} has no @id to rename`);
  if (typeof typed !== "string") refuse(`${op}: name must be a string`);
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
  if (kind === "group" && "name" in patch) {
    const { name, ...rest } = patch;
    renameShape(batch, ctx, shape, name, "update");
    const renamed = batch.working.get(shape.id)!;
    return applyPatch(batch, renamed, { ...obj(renamed.props) }, rest);
  }
  if (kind === "image" || kind === "video") {
    const asset = mediaAsset("update", batch, ctx, kind, patch);
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
  if (!numeric(op.x) || !numeric(op.y)) refuse("move: x and y must be numbers");
  batch.put({ ...shape, x: op.x as number, y: op.y as number });
};

const resize = (batch: Batch, op: Record<string, unknown>): void => {
  const shape = batch.shape("resize", op.id);
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
    case "frame": {
      const size = clampGroupSize({ w: w as number, h: h as number });
      batch.put({ ...shape, props: { ...props, ...size } });
      return;
    }
    case "text":
      batch.put({ ...shape, props: { ...props, w }, meta: { ...obj(shape.meta), sized: true } });
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
  if (shape.type === "frame") {
    for (const record of batch.records()) if (record.typeName === "shape" && record.parentId === shape.id) batch.remove(record.id);
  }
  batch.remove(shape.id);
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

/**
 * Prepares one `canvas_write` batch: the refusals first, in op order, then each op on a
 * working copy. Answers the whole change to put and remove, or the first error; nothing
 * is applied on an error.
 */
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
