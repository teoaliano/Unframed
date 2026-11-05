import { canvasSchema } from "@unframed/contracts";
import { flowFrom, presetFromSelection, type ContentAsset, type ContentShape, type PresetContent } from "@unframed/domain";
import type { TLRecord } from "@tldraw/tlschema";
import { shapeBoxes } from "../runs/shapeBounds.ts";

type AnyRecord = TLRecord & { type?: string; parentId?: string; props?: Record<string, unknown> };

export const flowContent = (project: string, records: ReadonlyArray<TLRecord>, ids: ReadonlyArray<string>, name: string): { content: PresetContent; droppedWires: number } | { error: string } => {
  const shapes = (records as AnyRecord[]).filter((record) => record.typeName === "shape");
  const byId = new Map<string, AnyRecord>(shapes.map((shape) => [shape.id as string, shape]));
  const roots = ids.filter((id) => byId.has(id) && byId.get(id)!.type !== "wire");
  const kept = new Set(roots);
  for (let grew = true; grew; ) {
    grew = false;
    for (const shape of shapes) if (!kept.has(shape.id) && shape.parentId !== undefined && kept.has(shape.parentId) && shape.type !== "wire") (kept.add(shape.id), (grew = true));
  }
  const captured = shapes.filter((shape) => kept.has(shape.id)) as unknown as ContentShape[];
  const assets = (records as AnyRecord[]).filter((record) => record.typeName === "asset") as unknown as ContentAsset[];
  const boxes = shapeBoxes(records as TLRecord[]);
  const bounds = Object.fromEntries(roots.map((id) => [id, boxes.get(id)?.page ?? { x: 0, y: 0, w: 0, h: 0 }]));
  const made = presetFromSelection({ project, content: { schema: canvasSchema().serialize(), shapes: captured, rootShapeIds: roots, assets }, bounds }, { name });
  if (!made.ok) return { error: made.error };
  const groupId = made.content.rootShapeIds[0]!;
  const inSet = new Set(made.content.shapes.map((shape) => shape.id));
  const wires = shapes
    .filter((shape) => shape.type === "wire" && (inSet.has(String(shape.props?.from)) || inSet.has(String(shape.props?.to))))
    .map((wire) => ({ ...wire, parentId: groupId, x: 0, y: 0 }) as unknown as ContentShape);
  return flowFrom({ ...made.content, shapes: [...made.content.shapes, ...wires] });
};
