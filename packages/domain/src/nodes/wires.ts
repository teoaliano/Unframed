import type { NodeMedium, WireRole } from "@unframed/contracts";
import { currentVersion, nodeName, shapeOf, type NodeCanvas } from "./model.ts";

export type FrameImage = "first_frame" | "last_frame";

/** What a wire's source is, for the roles it may take: a node is read by the medium of what it makes. */
export type WireSource =
  | "prompt"
  | "image"
  | "video"
  | "page"
  | "motion"
  | "group"
  | "mark"
  | "audio"
  | "component"
  | "node-image"
  | "node-video"
  | "node-text"
  | "node-page"
  | "node-audio"
  | "node"
  | "wire";

export const WIRE_TARGET_REFUSAL = "A wire ends at a node. Drop it on a node.";
export const AUDIO_SOURCE_REFUSAL = "An audio shape is never an input yet, so this wire is refused.";
export const COMPONENT_SOURCE_REFUSAL = "A component is never an input yet, so this wire is refused.";
export const GROUP_FRAME_REFUSAL = "A group cannot fill a frame. Wire one picture instead.";
export const WIRE_SELF_REFUSAL = "A node cannot feed itself.";

export const loopRefusal = (name: string): string => `That wire would loop back into ${name}. A node cannot feed itself through other nodes.`;
export const secondFrameRefusal = (name: string, role: WireRole): string => `${name} already has a ${role} wire. Change that wire first.`;
export const mediumRoleRefusal = (medium: NodeMedium, role: WireRole): string => `${medium[0]!.toUpperCase()}${medium.slice(1)} nodes take no ${role}.`;
export const sourceRoleRefusal = (source: string, role: WireRole): string => `A ${source} sends no ${role}. Pick another role for this wire.`;

const isFrame = (role: WireRole): role is "first" | "last" => role === "first" || role === "last";

export const sourceOf = (canvas: NodeCanvas, id: string): WireSource | undefined => {
  const node = canvas.nodes.get(id);
  if (node) return node.medium === "image" || node.medium === "video" || node.medium === "text" || node.medium === "page" || node.medium === "audio" ? `node-${node.medium}` : "node";
  const shape = shapeOf(canvas, id);
  if (!shape) return undefined;
  return shape.kind as WireSource;
};

const PAGE_ROLES: ReadonlyArray<WireRole> = ["prompt", "reference", "both"];

/**
 * The roles a wire from `source` may take into a node of `medium`, in the order the role
 * menu lists them. On a video node, `first` and `last` need the model's frame images.
 */
export const rolesFor = (medium: NodeMedium, frames: ReadonlyArray<string>, source: WireSource): WireRole[] => {
  const takesFrame = (role: "first" | "last") => medium === "video" && frames.includes(role === "first" ? "first_frame" : "last_frame");
  const media = (frame: boolean): WireRole[] =>
    medium === "audio" ? [] : ["reference", ...(frame && takesFrame("first") ? (["first"] as const) : []), ...(frame && takesFrame("last") ? (["last"] as const) : [])];
  switch (source) {
    case "prompt":
    case "node-text":
      return ["prompt"];
    case "image":
    case "node-image":
      return media(true);
    case "video":
    case "node-video":
    case "motion":
    case "mark":
      return media(false);
    case "page":
    case "node-page":
      return medium === "audio" ? ["prompt"] : [...PAGE_ROLES];
    case "group":
      return medium === "audio" ? ["prompt"] : ["prompt", "reference"];
    default:
      return [];
  }
};

/** The roles a medium takes at all. */
const mediumTakes = (medium: NodeMedium, role: WireRole): boolean => {
  if (role === "prompt") return true;
  if (medium === "audio") return false;
  if (role === "first" || role === "last") return medium === "video";
  return true;
};

const SOURCE_WORDS: Partial<Record<WireSource, string>> = {
  prompt: "prompt",
  image: "picture",
  video: "clip",
  page: "page",
  motion: "motion",
  group: "group",
  mark: "mark",
  "node-image": "node's picture",
  "node-video": "node's clip",
  "node-text": "node's text",
  "node-page": "node's page",
};

/** Whether `to` is upstream of `from` through node wires: a wire from `from` into `to` would close a loop. */
const reaches = (canvas: NodeCanvas, start: string, goal: string): boolean => {
  const seen = new Set<string>();
  const stack = [start];
  while (stack.length > 0) {
    const at = stack.pop()!;
    if (at === goal) return true;
    if (seen.has(at)) continue;
    seen.add(at);
    for (const wire of canvas.wires) if (wire.from === at && canvas.nodes.has(wire.to)) stack.push(wire.to);
  }
  return false;
};

export interface WireRefusalInput {
  readonly canvas: NodeCanvas;
  readonly from: string;
  readonly to: string;
  readonly role: WireRole;
  /** The wire being changed, which does not count against itself. */
  readonly wireId?: string | undefined;
}

/** The sentence that refuses a wire, or null when the wire may be made. */
export const wireRefusal = ({ canvas, from, to, role, wireId }: WireRefusalInput): string | null => {
  const target = canvas.nodes.get(to);
  if (!target) return WIRE_TARGET_REFUSAL;
  const source = sourceOf(canvas, from);
  if (source === "audio" || source === "node-audio") return AUDIO_SOURCE_REFUSAL;
  if (source === "component") return COMPONENT_SOURCE_REFUSAL;
  if (source === undefined || source === "wire") return WIRE_TARGET_REFUSAL;
  if (from === to) return WIRE_SELF_REFUSAL;
  if (canvas.nodes.has(from) && reaches(canvas, to, from)) return loopRefusal(nodeName(canvas, from));
  if (source === "group" && isFrame(role)) return GROUP_FRAME_REFUSAL;
  if (!mediumTakes(target.medium, role)) return mediumRoleRefusal(target.medium, role);
  const offered = rolesFor(target.medium, ["first_frame", "last_frame"], source);
  if (!offered.includes(role)) return sourceRoleRefusal(SOURCE_WORDS[source] ?? "shape", role);
  if (isFrame(role)) {
    const taken = canvas.wires.some((wire) => wire.id !== wireId && wire.to === to && wire.role === role);
    if (taken) return secondFrameRefusal(nodeName(canvas, to), role);
  }
  return null;
};

/** The role a new wire from `source` starts with: the first one offered. */
export const defaultRole = (medium: NodeMedium, frames: ReadonlyArray<string>, source: WireSource): WireRole | undefined => rolesFor(medium, frames, source)[0];

/** Whether a node has a result it can send downstream. */
export const hasResult = (canvas: NodeCanvas, id: string): boolean => {
  const node = canvas.nodes.get(id);
  return node !== undefined && currentVersion(node) !== undefined;
};
