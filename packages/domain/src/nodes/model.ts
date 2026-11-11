import type { GenerationProvider, NodeMedium, NodeRunMarker, NodeVersion, WireRole } from "@unframed/contracts";
import { providerField } from "../generationProviders.ts";
import { readingOrder, type CanvasShape } from "../canvasShapes.ts";
import { plainText } from "../refs.ts";
import { storedPageBoxes } from "../storedBoxes.ts";

export interface NodeFacts {
  readonly id: string;
  readonly ref?: string | undefined;
  readonly medium: NodeMedium;
  readonly model: string;
  readonly provider?: GenerationProvider | undefined;
  readonly params: Readonly<Record<string, string | number | boolean>>;
  readonly runs?: number | undefined;
  readonly instruction: string;
  readonly versions: ReadonlyArray<NodeVersion>;
  readonly currentVersionId: string | null;
  readonly run?: NodeRunMarker | undefined;
  readonly error?: string | undefined;
}

export interface WireFacts {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly role: WireRole;
  readonly files?: "entry" | "linked" | undefined;
  readonly chosen: boolean;
  readonly z: number;
}

export interface NodeCanvas {
  readonly shapes: ReadonlyArray<CanvasShape>;
  readonly nodes: ReadonlyMap<string, NodeFacts>;
  readonly wires: ReadonlyArray<WireFacts>;
  readonly renders: ReadonlyMap<string, string>;
  readonly stored?: ReadonlyArray<CanvasShape> | undefined;
  readonly markProps?: ReadonlyMap<string, string> | undefined;
}

interface RecordLike {
  readonly id: string;
  readonly typeName: string;
  readonly type?: string | undefined;
  readonly x?: number | undefined;
  readonly y?: number | undefined;
  readonly parentId?: string | undefined;
  readonly props?: unknown;
  readonly meta?: unknown;
}

const obj = (value: unknown): Record<string, unknown> => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {});

export const nodeFactsOf = (record: RecordLike, ref?: string): NodeFacts => {
  const props = obj(record.props);
  return {
    id: record.id,
    ...(ref === undefined ? {} : { ref }),
    medium: (props.medium as NodeMedium) ?? "image",
    model: typeof props.model === "string" ? props.model : "",
    ...providerField(props.provider as GenerationProvider | undefined),
    params: obj(props.params) as Record<string, string | number | boolean>,
    ...(typeof props.runs === "number" ? { runs: props.runs } : {}),
    instruction: typeof props.instruction === "string" ? props.instruction : "",
    versions: Array.isArray(props.versions) ? (props.versions as NodeVersion[]) : [],
    currentVersionId: typeof props.currentVersionId === "string" ? props.currentVersionId : null,
    ...(props.run === undefined ? {} : { run: props.run as NodeRunMarker }),
    ...(typeof props.error === "string" ? { error: props.error } : {}),
  };
};

export const nodeCanvasOf = (records: Iterable<RecordLike>, shapes: ReadonlyArray<CanvasShape>, renders: ReadonlyMap<string, string> = new Map()): NodeCanvas => {
  const byId = new Map(shapes.map((shape) => [shape.id, shape]));
  const nodes = new Map<string, NodeFacts>();
  const wires: WireFacts[] = [];
  const list = [...records];
  const boxes = new Map(storedPageBoxes(list as never).map((entry) => [entry.id, entry.box]));
  const stored = shapes.map((shape) => ({ ...shape, bounds: boxes.get(shape.id) ?? shape.bounds }));
  const markProps = new Map<string, string>();
  for (const record of list) {
    if (record.typeName === "shape" && byId.get(record.id)?.kind === "mark") markProps.set(record.id, JSON.stringify([record.x ?? 0, record.y ?? 0, record.parentId ?? "", record.props ?? null]));
  }
  for (const record of list) {
    if (record.typeName !== "shape") continue;
    if (record.type === "node") nodes.set(record.id, nodeFactsOf(record, byId.get(record.id)?.ref));
    else if (record.type === "wire") {
      const props = obj(record.props);
      wires.push({
        id: record.id,
        from: String(props.from ?? ""),
        to: String(props.to ?? ""),
        role: (props.role as WireRole) ?? "prompt",
        ...(props.files === "entry" || props.files === "linked" ? { files: props.files } : {}),
        chosen: obj(obj(record.meta).unframed).chosen === true,
        z: byId.get(record.id)?.z ?? 0,
      });
    }
  }
  wires.sort((a, b) => a.z - b.z);
  return { shapes, nodes, wires, renders, stored, markProps };
};

export const currentVersion = (node: NodeFacts): NodeVersion | undefined => {
  if (node.currentVersionId === null) return undefined;
  const version = node.versions.find((each) => each.id === node.currentVersionId);
  return version?.status === "done" && version.error === undefined ? version : undefined;
};

export const wiresInto = (canvas: NodeCanvas, nodeId: string): WireFacts[] => canvas.wires.filter((wire) => wire.to === nodeId);

export const nodeName = (canvas: NodeCanvas, id: string): string => {
  const shape = canvas.shapes.find((each) => each.id === id);
  return shape?.ref === undefined ? "node" : `@${shape.ref}`;
};

export const shapeName = (canvas: NodeCanvas, id: string): string => {
  const shape = canvas.shapes.find((each) => each.id === id);
  return shape?.ref === undefined ? "that shape" : `@${shape.ref}`;
};

export const shapeOf = (canvas: NodeCanvas, id: string): CanvasShape | undefined => canvas.shapes.find((each) => each.id === id);

export const nodesInCanvasOrder = (canvas: NodeCanvas, ids: Iterable<string>): string[] => {
  const wanted = new Set(ids);
  return canvas.shapes.filter((shape) => wanted.has(shape.id)).sort(readingOrder).map((shape) => shape.id);
};

export const textOfRecord = (record: RecordLike): string => plainText(obj(record.props).richText);
