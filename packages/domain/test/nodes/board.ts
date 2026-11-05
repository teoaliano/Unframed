import type { NodeMedium, NodeVersion, WireRole } from "@unframed/contracts";
import type { CanvasShape, NodeCanvas, NodeFacts, WireFacts } from "../../src/index.ts";

type At = { x?: number; y?: number; z?: number; parent?: string };

let rank = 1000;

export const nodeShape = (id: string, at: At = {}): CanvasShape => ({
  id,
  kind: "node",
  ref: id,
  bounds: { x: at.x ?? 0, y: at.y ?? 0, w: 380, h: 360 },
  z: at.z ?? ++rank,
  ...(at.parent === undefined ? {} : { parent: at.parent }),
});

export const version = (id: string, extra: Partial<NodeVersion> = {}): NodeVersion => ({
  id,
  runId: `run-${id}`,
  chainId: null,
  batchId: `b-${id}`,
  runIndex: 1,
  status: "done",
  fingerprint: "",
  createdAt: "2026-11-05T00:00:00.000Z",
  ...extra,
});

export const node = (id: string, medium: NodeMedium, extra: Partial<NodeFacts> = {}): NodeFacts => ({
  id,
  ref: id,
  medium,
  model: "m",
  params: {},
  instruction: "",
  versions: [],
  currentVersionId: null,
  ...extra,
});

export const wire = (id: string, from: string, to: string, role: WireRole, extra: Partial<WireFacts> = {}): WireFacts => ({
  id,
  from,
  to,
  role,
  chosen: true,
  z: ++rank,
  ...extra,
});

export const board = (input: {
  shapes?: CanvasShape[];
  nodes?: Array<{ facts: NodeFacts; at?: At }>;
  wires?: WireFacts[];
  renders?: Record<string, string>;
}): NodeCanvas => {
  const nodes = input.nodes ?? [];
  const wires = [...(input.wires ?? [])].sort((a, b) => a.z - b.z);
  return {
    shapes: [
      ...(input.shapes ?? []),
      ...nodes.map(({ facts, at }) => nodeShape(facts.id, at)),
      ...wires.map((each): CanvasShape => ({ id: each.id, kind: "wire", bounds: { x: 0, y: 0, w: 1, h: 1 }, z: each.z })),
    ],
    nodes: new Map(nodes.map(({ facts }) => [facts.id, facts])),
    wires,
    renders: new Map(Object.entries(input.renders ?? {})),
  };
};
