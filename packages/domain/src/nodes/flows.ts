import type { ContentShape, PresetContent } from "../presetRules.ts";

export interface Flow {
  readonly content: PresetContent;
  readonly droppedWires: number;
}

const obj = (value: unknown): Record<string, unknown> => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {});

export const blankNode = <S extends { readonly props: Readonly<Record<string, unknown>> }>(shape: S): S => {
  const { versions: _versions, currentVersionId: _current, run: _run, error: _error, ...props } = shape.props;
  return { ...shape, props: { ...props, versions: [], currentVersionId: null } };
};

export const flowFrom = (content: PresetContent): Flow => {
  const ids = new Set(content.shapes.filter((shape) => shape.type !== "wire").map((shape) => shape.id));
  let droppedWires = 0;
  const shapes: ContentShape[] = [];
  for (const shape of content.shapes) {
    if (shape.type === "wire") {
      const props = obj(shape.props);
      if (ids.has(String(props.from)) && ids.has(String(props.to))) shapes.push(shape);
      else droppedWires++;
      continue;
    }
    shapes.push(shape.type === "node" ? blankNode(shape) : shape);
  }
  return { content: { ...content, shapes }, droppedWires };
};

export const isFlowContent = (content: PresetContent): boolean => content.shapes.some((shape) => shape.type === "node");

export const flowInsert = (content: PresetContent, mint: () => string): PresetContent => {
  const ids = new Map<string, string>();
  for (const shape of content.shapes) ids.set(shape.id, mint());
  const swap = (id: unknown) => (typeof id === "string" ? (ids.get(id) ?? id) : id);
  const shapes = content.shapes.map((shape): ContentShape => {
    const moved = { ...shape, id: ids.get(shape.id)!, parentId: String(swap(shape.parentId)) };
    if (shape.type === "wire") return { ...moved, props: { ...shape.props, from: swap(shape.props.from), to: swap(shape.props.to) } };
    if (shape.type === "node") return blankNode(moved);
    return moved;
  });
  return { ...content, shapes, rootShapeIds: content.rootShapeIds.map((id) => String(swap(id))) };
};

export const droppedWiresNote = (count: number): string | undefined => (count > 0 ? `Saved. ${count} ${count === 1 ? "wire" : "wires"} from outside the set ${count === 1 ? "was" : "were"} left out.` : undefined);
