/**
 * The old app's project graph (spec 11): nodes wired by edges, as `graph.json` and each
 * `graph.log` op leave it. Only the reader builds these; the normaliser and the mapper
 * read them.
 */
export interface LegacyNode {
  readonly id: string;
  readonly type: string;
  /** Top-left; relative to the group when `parentId` is set. */
  readonly position: { readonly x: number; readonly y: number };
  readonly width?: number;
  readonly height?: number;
  readonly parentId?: string;
  readonly data: Readonly<Record<string, unknown>>;
}

export interface LegacyEdge {
  readonly id: string;
  readonly source: string;
  /** Always an output node. */
  readonly target: string;
  readonly animated?: boolean;
}

export interface LegacyGraph {
  readonly nodes: ReadonlyArray<LegacyNode>;
  readonly edges: ReadonlyArray<LegacyEdge>;
}

/** The node types that are outputs: the three current ones and the two legacy names. */
export const LEGACY_OUTPUT_TYPES: ReadonlySet<string> = new Set(["imageOutput", "videoOutput", "textOutput", "output", "text"]);

/** The name pattern of an old id that can become an `@id`. */
export const LEGACY_ID = /^[\w-]+$/;

export const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

export const finite = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) ? value : undefined);

const point = (value: unknown): { x: number; y: number } | undefined => {
  const at = record(value);
  const x = finite(at?.x);
  const y = finite(at?.y);
  return x === undefined || y === undefined ? undefined : { x, y };
};

/**
 * A node as the old app kept it: its seven keys and nothing else. Selection, drag and
 * measurement state and any other key are transient and dropped.
 */
export const keptNode = (value: unknown): LegacyNode | undefined => {
  const node = record(value);
  if (!node) return undefined;
  const id = typeof node.id === "number" ? String(node.id) : node.id;
  if (typeof id !== "string" || typeof node.type !== "string") return undefined;
  const width = finite(node.width);
  const height = finite(node.height);
  return {
    id,
    type: node.type,
    position: point(node.position) ?? { x: 0, y: 0 },
    ...(width === undefined ? {} : { width }),
    ...(height === undefined ? {} : { height }),
    ...(typeof node.parentId === "string" ? { parentId: node.parentId } : {}),
    data: { ...record(node.data) },
  };
};

export const keptEdge = (value: unknown): LegacyEdge | undefined => {
  const edge = record(value);
  if (!edge || typeof edge.id !== "string" || typeof edge.source !== "string" || typeof edge.target !== "string") return undefined;
  return { id: edge.id, source: edge.source, target: edge.target, ...(typeof edge.animated === "boolean" ? { animated: edge.animated } : {}) };
};

interface Working {
  nodes: LegacyNode[];
  edges: LegacyEdge[];
}

const mayHoldMembers = (graph: Working, parentId: unknown, node: LegacyNode): boolean => {
  if (typeof parentId !== "string") return false;
  const parent = graph.nodes.find((each) => each.id === parentId);
  return parent?.type === "group" && node.type !== "group" && !LEGACY_OUTPUT_TYPES.has(node.type);
};

/** Moves members that stand ahead of their group to just after it, keeping everything else in place. */
const membersBehindGroups = (nodes: LegacyNode[]): LegacyNode[] => {
  const result = [...nodes];
  for (let at = 0; at < result.length; at++) {
    const node = result[at]!;
    if (node.parentId === undefined) continue;
    const parentAt = result.findIndex((each) => each.id === node.parentId);
    if (parentAt > at) {
      result.splice(at, 1);
      result.splice(parentAt, 0, node);
      at--;
    }
  }
  return result;
};

const insertAt = <T>(list: T[], item: T, index: unknown): T[] => {
  const at = finite(index);
  const copy = [...list];
  if (at === undefined || at < 0 || at > copy.length) copy.push(item);
  else copy.splice(Math.floor(at), 0, item);
  return copy;
};

const touching = (edge: LegacyEdge, ids: ReadonlySet<string>) => ids.has(edge.source) || ids.has(edge.target);

/** One op applied as the old app applied it: the graph after it, or `undefined` when it is rejected. */
export const applyLegacyOp = (graph: Working, value: unknown): Working | undefined => {
  const op = record(value);
  if (!op) return undefined;
  const find = (id: unknown) => graph.nodes.find((node) => node.id === id);
  switch (op.type) {
    case "addNode": {
      const node = keptNode(op.node);
      if (!node || find(node.id)) return undefined;
      if (node.parentId !== undefined && !mayHoldMembers(graph, node.parentId, node)) return undefined;
      return { nodes: membersBehindGroups(insertAt(graph.nodes, node, op.index)), edges: graph.edges };
    }
    case "updateNode": {
      const node = find(op.id);
      const patch = record(op.patch);
      if (!node || !patch) return undefined;
      const data: Record<string, unknown> = { ...node.data };
      for (const [key, each] of Object.entries(patch)) {
        if (each === null) delete data[key];
        else data[key] = each;
      }
      return { nodes: graph.nodes.map((each) => (each === node ? { ...node, data } : each)), edges: graph.edges };
    }
    case "moveNode": {
      const position = point(op.position);
      if (!position) return undefined;
      return { nodes: graph.nodes.map((each) => (each.id === op.id ? { ...each, position } : each)), edges: graph.edges };
    }
    case "resizeNode": {
      const resize = (node: LegacyNode): LegacyNode => {
        const { width: _width, height: _height, ...rest } = node;
        const width = finite(op.width);
        const height = finite(op.height);
        return { ...rest, ...(width === undefined ? {} : { width }), ...(height === undefined ? {} : { height }) };
      };
      return { nodes: graph.nodes.map((each) => (each.id === op.id ? resize(each) : each)), edges: graph.edges };
    }
    case "reparentNode": {
      const node = find(op.id);
      const position = point(op.position);
      if (!node || !position || op.parentId === op.id) return undefined;
      if (op.parentId !== null && !mayHoldMembers(graph, op.parentId, node)) return undefined;
      const { parentId: _parentId, ...rest } = node;
      const moved: LegacyNode = { ...rest, position, ...(op.parentId === null ? {} : { parentId: op.parentId as string }) };
      const without = graph.nodes.filter((each) => each !== node);
      const nodes = op.index === undefined ? graph.nodes.map((each) => (each === node ? moved : each)) : insertAt(without, moved, op.index);
      const edges = op.parentId === null ? graph.edges : graph.edges.filter((edge) => !touching(edge, new Set([node.id])));
      return { nodes: membersBehindGroups(nodes), edges };
    }
    case "renameNode": {
      const node = find(op.id);
      const to = op.to;
      if (!node || typeof to !== "string" || !LEGACY_ID.test(to) || to === node.id || find(to)) return undefined;
      const from = node.id;
      const nodes = graph.nodes.map((each) => {
        if (each === node) return { ...each, id: to };
        return each.parentId === from ? { ...each, parentId: to } : each;
      });
      const edges = graph.edges.map((edge) => ({
        ...edge,
        source: edge.source === from ? to : edge.source,
        target: edge.target === from ? to : edge.target,
      }));
      return { nodes, edges };
    }
    case "removeNode": {
      const node = find(op.id);
      if (!node) return graph;
      const gone = new Set([node.id, ...(node.type === "group" ? graph.nodes.filter((each) => each.parentId === node.id).map((each) => each.id) : [])]);
      return { nodes: graph.nodes.filter((each) => !gone.has(each.id)), edges: graph.edges.filter((edge) => !touching(edge, gone)) };
    }
    case "addEdge": {
      const edge = keptEdge(op.edge);
      if (!edge || graph.edges.some((each) => each.id === edge.id) || !find(edge.source) || !find(edge.target)) return undefined;
      return { nodes: graph.nodes, edges: insertAt(graph.edges, edge, op.index) };
    }
    case "removeEdge":
      return { nodes: graph.nodes, edges: graph.edges.filter((edge) => edge.id !== op.id) };
    case "batch": {
      if (!Array.isArray(op.ops)) return undefined;
      let next: Working | undefined = graph;
      for (const inner of op.ops) {
        next = applyLegacyOp(next, inner);
        if (!next) return undefined;
      }
      return next;
    }
    default:
      return undefined;
  }
};

