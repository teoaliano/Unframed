import { readingOrder } from "../canvasShapes.ts";
import { nodeName, shapeOf, type NodeCanvas } from "./model.ts";
import { noResultMessage } from "./request.ts";
import { nodeStatus } from "./status.ts";
import { hasResult } from "./wires.ts";

export type ChainPlan = { readonly ok: true; readonly steps: ReadonlyArray<string> } | { readonly ok: false; readonly message: string };

export const NO_NODES_MESSAGE = "There is no node to run in that selection.";
export const loopMessage = (names: ReadonlyArray<string>): string => `These nodes feed each other in a loop: ${names.join(", ")}. A chain needs an order.`;
export const stepMessage = (step: number, name: string, message: string): string => `Step ${step} (${name}): ${message}`;

const groupNodes = (canvas: NodeCanvas, groupId: string, depth = 0): string[] => {
  if (depth > 8) return [];
  return canvas.shapes
    .filter((shape) => shape.parent === groupId)
    .flatMap((shape) => (canvas.nodes.has(shape.id) ? [shape.id] : shape.kind === "group" ? groupNodes(canvas, shape.id, depth + 1) : []));
};

/** The nodes of a selection: every selected node, and every node a selected group holds. */
export const chainNodesOf = (canvas: NodeCanvas, selected: ReadonlyArray<string>): string[] => {
  const ids = new Set<string>();
  for (const id of selected) {
    if (canvas.nodes.has(id)) ids.add(id);
    else if (shapeOf(canvas, id)?.kind === "group") for (const member of groupNodes(canvas, id)) ids.add(member);
  }
  return [...ids];
};

/**
 * A chain's steps: a node runs after every chain node it takes input from, ties by canvas
 * order (top edge, then left edge, then z). A loop is refused, and so is an input from a
 * node outside the chain that has no result.
 */
export const planChain = (canvas: NodeCanvas, selected: ReadonlyArray<string>): ChainPlan => {
  const members = new Set(chainNodesOf(canvas, selected));
  if (members.size === 0) return { ok: false, message: NO_NODES_MESSAGE };
  const after = new Map<string, Set<string>>();
  for (const id of members) after.set(id, new Set());
  for (const wire of canvas.wires) {
    if (members.has(wire.to) && members.has(wire.from) && wire.from !== wire.to) after.get(wire.to)!.add(wire.from);
  }
  const order = (ids: Iterable<string>) => {
    const shapes = [...ids].map((id) => shapeOf(canvas, id)).filter((shape) => shape !== undefined);
    return shapes.sort(readingOrder).map((shape) => shape.id);
  };
  const steps: string[] = [];
  const done = new Set<string>();
  while (steps.length < members.size) {
    const ready = order([...members].filter((id) => !done.has(id) && [...after.get(id)!].every((dep) => done.has(dep))));
    if (ready.length === 0) {
      const stuck = order([...members].filter((id) => !done.has(id)));
      return { ok: false, message: loopMessage(stuck.map((id) => nodeName(canvas, id))) };
    }
    const next = ready[0]!;
    steps.push(next);
    done.add(next);
  }
  for (const [index, id] of steps.entries()) {
    for (const wire of canvas.wires) {
      if (wire.to !== id || members.has(wire.from) || !canvas.nodes.has(wire.from)) continue;
      if (hasResult(canvas, wire.from)) continue;
      const message = noResultMessage(nodeName(canvas, wire.from));
      return { ok: false, message: steps.length === 1 ? message : stepMessage(index + 1, nodeName(canvas, id), message) };
    }
  }
  return { ok: true, steps };
};

/** Every node that depends on `id`, directly or through others. */
export const downstreamOf = (canvas: NodeCanvas, id: string): string[] => {
  const found = new Set<string>();
  const stack = [id];
  while (stack.length > 0) {
    const at = stack.pop()!;
    for (const wire of canvas.wires) {
      if (wire.from !== at || !canvas.nodes.has(wire.to) || found.has(wire.to) || wire.to === id) continue;
      found.add(wire.to);
      stack.push(wire.to);
    }
  }
  return [...found];
};

export type DownstreamScope = "pending" | "all";

const PENDING = new Set(["failed", "waiting", "out_of_date", "not_run"]);

/**
 * The nodes Run downstream runs: the node itself always, then its downstream nodes, all of
 * them or only those that failed, are waiting, are out of date or never ran.
 */
export const downstreamRun = (canvas: NodeCanvas, id: string, scope: DownstreamScope, frames?: (nodeId: string) => ReadonlyArray<string>): string[] => {
  const below = downstreamOf(canvas, id).filter((each) => {
    if (scope === "all") return true;
    const node = canvas.nodes.get(each)!;
    return PENDING.has(nodeStatus({ node, canvas, frames: frames?.(each) }).state);
  });
  return [id, ...below];
};
