import { membersOf, type CanvasShape } from "../canvasShapes.ts";
import { markOwners } from "../composition.ts";
import { resolveReferences } from "../references.ts";
import { currentVersion, wiresInto, type NodeCanvas, type NodeFacts } from "./model.ts";
import { nodeRequest } from "./request.ts";

/** A stable 53-bit hash of a string, as hex. Pure, so the engine and the web agree on it. */
export const stableHash = (text: string): string => {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
};

const sortedParams = (params: Readonly<Record<string, unknown>>) => Object.fromEntries(Object.entries(params).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

/**
 * A hash of everything a run sends: the medium, model, params, instruction, and for each
 * wire in order its role, its source and the source's content now.
 */
export const inputFingerprint = (node: NodeFacts, canvas: NodeCanvas): string => {
  const owners = markOwners(canvas.shapes);
  const byId = new Map(canvas.shapes.map((shape) => [shape.id, shape]));
  const marksOn = (id: string) => canvas.shapes.filter((shape) => owners.get(shape.id) === id).map((shape) => shape.id);
  const content = (shape: CanvasShape | undefined, depth = 0): unknown => {
    if (!shape) return null;
    const nodeFacts = canvas.nodes.get(shape.id);
    if (nodeFacts) return { node: nodeFacts.currentVersionId === null ? null : (currentVersion(nodeFacts)?.id ?? null) };
    switch (shape.kind) {
      case "prompt":
        return { text: shape.textResult ? shape.text : resolved(shape.text ?? "", shape.ref) };
      case "image":
        return { file: shape.file ?? null, marks: marksOn(shape.id), crop: shape.crop ?? null };
      case "video":
        return { file: shape.file ?? null, link: shape.link ?? null };
      case "page":
        return { file: shape.file ?? null };
      case "motion":
        return { render: shape.file === undefined ? null : (canvas.renders.get(shape.file) ?? null) };
      case "group":
        return depth > 4 ? null : membersOf(canvas.shapes, shape.id).map((member) => ({ id: member.id, content: content(member, depth + 1) }));
      default:
        return { id: shape.id, bounds: shape.bounds };
    }
  };
  const resolved = (text: string, self?: string) => {
    const result = resolveReferences(text, canvas.shapes, self);
    return result.ok ? result.text : text;
  };
  const wires = wiresInto(canvas, node.id).map((wire) => ({ role: wire.role, files: wire.files ?? null, from: wire.from, content: content(byId.get(wire.from)) }));
  return stableHash(
    JSON.stringify({ medium: node.medium, model: node.model, params: sortedParams(node.params), instruction: resolved(node.instruction), wires }),
  );
};

export type NodeState = "not_run" | "running" | "failed" | "waiting" | "out_of_date" | "ready";

export interface NodeStatus {
  readonly state: NodeState;
  /** The status line under the node; empty when ready. */
  readonly line: string;
}

export const NOT_RUN_LINE = "Not run yet.";
export const OUT_OF_DATE_LINE = "Out of date. An input changed since this ran.";
export const RUNNING_LINE = "Running…";
export const QUEUED_LINE = "Waiting for its step in the chain.";
export const RESTART_STOP = "Stopped: the engine restarted before this step ran.";
export const upstreamFailedLine = (name: string): string => `Waiting for ${name}, which failed.`;
export const failedLine = (message: string): string => (message.startsWith("Stopped:") ? message : `Failed: ${message}`);

/** `Rendering… (N min)`, spec 04's wording for a render under way. */
export const renderingLine = (startedAt: number, now: number): string => `Rendering… (${Math.max(0, Math.floor((now - startedAt) / 60_000))} min)`;

export interface NodeStatusInput {
  readonly node: NodeFacts;
  readonly canvas: NodeCanvas;
  readonly frames?: ReadonlyArray<string> | undefined;
  readonly now?: number | undefined;
}

/** The node's status: the first state that matches, in spec 16's order. Status never runs anything. */
export const nodeStatus = ({ node, canvas, frames, now }: NodeStatusInput): NodeStatus => {
  if (node.run !== undefined) {
    if (node.run.runId === "") return { state: "running", line: QUEUED_LINE };
    return { state: "running", line: node.medium === "video" ? renderingLine(node.run.startedAt, now ?? Date.now()) : RUNNING_LINE };
  }
  if (node.error !== undefined) {
    if (node.error.startsWith("Waiting for ")) return { state: "waiting", line: node.error };
    return { state: "failed", line: failedLine(node.error) };
  }
  const request = nodeRequest({ node, canvas, frames });
  if (!request.ok && request.kind === "waiting") return { state: "waiting", line: request.status ?? request.message };
  const current = currentVersion(node);
  if (!current) return { state: "not_run", line: NOT_RUN_LINE };
  if (current.fingerprint !== inputFingerprint(node, canvas)) return { state: "out_of_date", line: OUT_OF_DATE_LINE };
  return { state: "ready", line: "" };
};
