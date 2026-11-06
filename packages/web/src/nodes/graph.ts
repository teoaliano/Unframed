import { kindOfShapeType, type NodeShapeProps, type WireShapeProps } from "@unframed/contracts";
import { downstreamOf, nodeCanvasOf, nodeFactsOf, nodeRequest, nodeStatus, readRef, refTokens, type CanvasShape, type NodeCanvas, type NodeRequest, type NodeStatus, type WireFacts } from "@unframed/domain";
import { computed, type Computed, type Editor, type TLShape, type TLShapeId } from "tldraw";
import { describe } from "../generate/facts.ts";
import { motionRenders } from "./facts.ts";
import { nodeFrames } from "./operations.ts";

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

interface Graph {
  readonly wires: Computed<ReadonlyArray<WireFacts>>;
  readonly nodes: Computed<ReadonlyArray<TLShape>>;
  readonly refs: Computed<ReadonlyMap<string, TLShapeId>>;
  readonly marks: Computed<ReadonlyArray<TLShapeId>>;
  readonly views: Map<string, Computed<NodeCanvas>>;
  readonly requests: Map<string, Computed<NodeRequest | undefined>>;
  readonly statuses: Map<string, Computed<NodeStatus | undefined>>;
}

const graphs = new WeakMap<Editor, Graph>();

const UNFRAMED = new Set(["text", "image", "video", "audio", "frame", "page", "motion", "component", "node", "wire"]);

const graphOf = (editor: Editor): Graph => {
  let graph = graphs.get(editor);
  if (graph) return graph;
  const wireQuery = editor.store.query.records("shape", () => ({ type: { eq: "wire" } }));
  const nodeQuery = editor.store.query.records("shape", () => ({ type: { eq: "node" } }));
  const allQuery = editor.store.query.records("shape");
  graph = {
    wires: computed(
      "node wires",
      () =>
        [...wireQuery.get()]
          .sort((a, b) => (a.index < b.index ? -1 : a.index > b.index ? 1 : 0))
          .map((shape, z): WireFacts => {
            const props = shape.props as WireShapeProps;
            return { id: shape.id, from: props.from, to: props.to, role: props.role, ...(props.files === undefined ? {} : { files: props.files }), chosen: (shape.meta.unframed as { chosen?: boolean } | undefined)?.chosen === true, z };
          }),
      { isEqual: same },
    ),
    nodes: computed<ReadonlyArray<TLShape>>("nodes", () => [...nodeQuery.get()], { isEqual: (a: ReadonlyArray<TLShape>, b: ReadonlyArray<TLShape>) => a.length === b.length && a.every((shape: TLShape, index: number) => shape === b[index]) }),
    refs: computed(
      "refs",
      () => {
        const found = new Map<string, TLShapeId>();
        for (const shape of allQuery.get()) {
          const ref = readRef(shape);
          if (ref !== undefined && !found.has(ref)) found.set(ref, shape.id);
        }
        return found;
      },
      { isEqual: (a, b) => same([...a], [...b]) },
    ),
    marks: computed("marks", () => allQuery.get().filter((shape) => !UNFRAMED.has(shape.type)).map((shape) => shape.id), { isEqual: same }),
    views: new Map(),
    requests: new Map(),
    statuses: new Map(),
  };
  graphs.set(editor, graph);
  return graph;
};

export const graphWires = (editor: Editor): ReadonlyArray<WireFacts> => graphOf(editor).wires.get();

const pathKey = (editor: Editor, shape: TLShape): string => {
  const parts: string[] = [shape.index];
  let parent = editor.getShape(shape.parentId as TLShapeId);
  for (let depth = 0; parent && depth < 8; depth++) {
    parts.unshift(parent.index);
    parent = editor.getShape(parent.parentId as TLShapeId);
  }
  return parts.join("/");
};

const collect = (editor: Editor, graph: Graph, nodeId: string): Set<TLShapeId> => {
  const ids = new Set<TLShapeId>([nodeId as TLShapeId]);
  const texts: string[] = [];
  const node = editor.getShape(nodeId as TLShapeId);
  if (node) texts.push((node.props as NodeShapeProps).instruction);
  const add = (id: TLShapeId, depth: number) => {
    if (ids.has(id) && depth > 0) return;
    const shape = editor.getShape(id);
    if (!shape) return;
    ids.add(id);
    if (shape.type === "text") texts.push(JSON.stringify(shape.props));
    if (shape.type === "frame" && depth < 4) for (const child of editor.getSortedChildIdsForParent(id)) add(child, depth + 1);
    let parent = editor.getShape(shape.parentId as TLShapeId);
    while (parent) {
      ids.add(parent.id);
      parent = editor.getShape(parent.parentId as TLShapeId);
    }
  };
  for (const wire of graph.wires.get()) {
    if (wire.to !== nodeId) continue;
    ids.add(wire.id as TLShapeId);
    add(wire.from as TLShapeId, 0);
  }
  for (let round = 0; round < 4 && texts.length > 0; round++) {
    const pending = texts.splice(0);
    for (const text of pending) for (const token of refTokens(text)) {
      const id = graph.refs.get().get(token);
      if (id !== undefined && !ids.has(id)) add(id, 0);
    }
  }
  if ([...ids].some((id) => editor.getShape(id)?.type === "image")) for (const mark of graph.marks.get()) ids.add(mark);
  return ids;
};

export const nodeView = (editor: Editor, nodeId: string): NodeCanvas => {
  const graph = graphOf(editor);
  let view = graph.views.get(nodeId);
  if (!view) {
    view = computed(`node view ${nodeId}`, () => {
      const shapes = [...collect(editor, graph, nodeId)].flatMap((id) => editor.getShape(id) ?? []);
      const ordered = shapes.map((shape) => ({ shape, key: pathKey(editor, shape) })).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
      const facts = ordered.flatMap(({ shape }, z): CanvasShape[] => {
        const described = describe(editor, shape, z);
        return described ? [described] : [{ id: shape.id, kind: kindOfShapeType(shape.type), bounds: { x: 0, y: 0, w: 0, h: 0 }, z }];
      });
      return nodeCanvasOf(shapes, facts, motionRenders(editor).get());
    });
    graph.views.set(nodeId, view);
  }
  return view.get();
};

export const nodeRequestOf = (editor: Editor, nodeId: string): NodeRequest | undefined => {
  const graph = graphOf(editor);
  let request = graph.requests.get(nodeId);
  if (!request) {
    request = computed(
      `node request ${nodeId}`,
      () => {
        const canvas = nodeView(editor, nodeId);
        const node = canvas.nodes.get(nodeId);
        return node ? nodeRequest({ node, canvas, frames: nodeFrames(node) }) : undefined;
      },
      { isEqual: same },
    );
    graph.requests.set(nodeId, request);
  }
  return request.get();
};

export const nodeStatusOf = (editor: Editor, nodeId: string): NodeStatus | undefined => {
  const graph = graphOf(editor);
  let status = graph.statuses.get(nodeId);
  if (!status) {
    status = computed(
      `node status ${nodeId}`,
      () => {
        const canvas = nodeView(editor, nodeId);
        const node = canvas.nodes.get(nodeId);
        return node ? nodeStatus({ node, canvas, frames: nodeFrames(node) }) : undefined;
      },
      { isEqual: same },
    );
    graph.statuses.set(nodeId, status);
  }
  return status.get();
};

export const graphCanvas = (editor: Editor): NodeCanvas => {
  const graph = graphOf(editor);
  return { shapes: [], nodes: new Map(graph.nodes.get().map((shape) => [shape.id, nodeFactsOf(shape, readRef(shape))])), wires: graph.wires.get(), renders: new Map() };
};

export const inputOrder = (editor: Editor, wireId: string, nodeId: string): { readonly at: number; readonly of: number } => {
  const into = graphOf(editor).wires.get().filter((wire) => wire.to === nodeId);
  return { at: Math.max(0, into.findIndex((wire) => wire.id === wireId)), of: into.length };
};

const PENDING = new Set(["failed", "waiting", "out_of_date", "not_run"]);

export const selectionNodes = (editor: Editor, ids: ReadonlyArray<string>): string[] => {
  const found: string[] = [];
  const visit = (id: TLShapeId, depth: number) => {
    const shape = editor.getShape(id);
    if (!shape) return;
    if (shape.type === "node") {
      if (!found.includes(id)) found.push(id);
    } else if (shape.type === "frame" && depth < 8) for (const child of editor.getSortedChildIdsForParent(id)) visit(child, depth + 1);
  };
  for (const id of ids) visit(id as TLShapeId, 0);
  return found;
};

export const downstreamCounts = (editor: Editor, nodeId: string): { readonly pending: number; readonly all: number } => {
  const below = downstreamOf(graphCanvas(editor), nodeId);
  return { all: below.length + 1, pending: below.filter((id) => PENDING.has(nodeStatusOf(editor, id)?.state ?? "")).length + 1 };
};
