import type { WireRole } from "@unframed/contracts";
import { membersOf, type CanvasShape, type Crop } from "../canvasShapes.ts";
import { markOwners, UNUSED_ROLE, type Slot, type SlotSource } from "../composition.ts";
import type { Box } from "../grouping.ts";
import { createResolver } from "../references.ts";
import { currentVersion, nodeName, shapeName, shapeOf, wiresInto, type NodeCanvas, type NodeFacts, type WireFacts } from "./model.ts";
import { sourceOf } from "./wires.ts";

export type PromptPart =
  | { readonly type: "text"; readonly text: string; readonly wireId: string }
  | { readonly type: "page"; readonly file: string; readonly files: "entry" | "linked"; readonly wireId: string };

export interface NodeFrame {
  readonly role: "first" | "last";
  readonly wireId: string;
  readonly slot: Slot;
}

export type NodeRequest =
  | {
      readonly ok: true;
      readonly parts: ReadonlyArray<PromptPart>;
      readonly instruction: string;
      readonly references: ReadonlyArray<Slot>;
      readonly frames: ReadonlyArray<NodeFrame>;
      readonly sources: ReadonlyArray<string>;
      readonly roles: Readonly<Record<string, string>>;
      readonly unsent: ReadonlyArray<string>;
    }
  | {
      readonly ok: false;
      readonly kind: "waiting" | "refused";
      readonly message: string;
      /** The status line a waiting node shows. */
      readonly status?: string | undefined;
      readonly roles: Readonly<Record<string, string>>;
    };

export interface NodeRequestInput {
  readonly node: NodeFacts;
  readonly canvas: NodeCanvas;
  /** The model's frame images (spec 04's `supported_frame_images`), for a video node. */
  readonly frames?: ReadonlyArray<string> | undefined;
  /** How many references the model takes, when it says. */
  readonly referenceCap?: number | undefined;
  readonly model?: string | undefined;
  /** Nodes whose result a chain makes before this step: they count as having one. */
  readonly assume?: ReadonlySet<string> | undefined;
}

export const NODE_EMPTY_PROMPT = "Prompt is empty. Wire a prompt, or type an instruction.";
export const PAGE_SEND_REFUSAL = "Choose what this page sends: its HTML, a picture of it, or both.";
export const PAGE_FILES_REFUSAL = "Choose whether this page sends its linked files too.";

export const noResultMessage = (name: string): string => `${name} has no result yet. Run it first, or use Run downstream from it.`;
export const noResultStatus = (name: string): string => `Waiting for ${name}, which has no result yet.`;
export const noRenderMessage = (name: string): string => `Render ${name} first. A motion is an input once it has a render.`;
export const referenceCapMessage = (name: string, count: number, model: string, max: number): string =>
  `${name} has ${count} references, and ${model} takes at most ${max}. Remove a wire, or pick another model.`;
export const frameRoleMessage = (model: string, role: "first" | "last"): string => `${model} takes no ${role} frame. Change that wire's role.`;

const isCropped = (crop: Crop | null | undefined): crop is Crop =>
  crop !== null &&
  crop !== undefined &&
  (crop.isCircle === true || crop.topLeft.x > 0 || crop.topLeft.y > 0 || crop.bottomRight.x < 1 || crop.bottomRight.y < 1);

const union = (boxes: ReadonlyArray<Box>): Box => {
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.w));
  const bottom = Math.max(...boxes.map((box) => box.y + box.h));
  return { x: left, y: top, w: right - left, h: bottom - top };
};

interface Blocked {
  readonly kind: "waiting" | "refused";
  readonly message: string;
  readonly status?: string;
}

const blocked = (kind: Blocked["kind"], message: string, status?: string): Blocked => ({ kind, message, ...(status === undefined ? {} : { status }) });

const pageSendOf = (role: WireRole): { html: boolean; picture: boolean } => ({ html: role === "prompt" || role === "both", picture: role === "reference" || role === "both" });

/**
 * What a node's run sends (spec 16, The node request): its wires' prompt text in wire order,
 * its references numbered in input-list order, its frames, its instruction, and the shapes
 * that fed it. Roles and request come from this one function, so they cannot disagree.
 */
export const nodeRequest = (input: NodeRequestInput): NodeRequest => {
  const { node, canvas } = input;
  const frames = input.frames ?? [];
  const assume = input.assume ?? new Set<string>();
  const shapes = canvas.shapes;
  const owners = markOwners(shapes);
  const ownedBy = new Map<string, string[]>();
  for (const shape of [...shapes].sort((a, b) => a.z - b.z)) {
    const owner = owners.get(shape.id);
    if (owner !== undefined) ownedBy.set(owner, [...(ownedBy.get(owner) ?? []), shape.id]);
  }
  const wires = wiresInto(canvas, node.id);
  const roles: Record<string, string> = {};
  const references: Slot[] = [];
  const nodeFrames: NodeFrame[] = [];
  const sources: string[] = [];
  const unsent: string[] = [];
  const slots = new Map<string, Slot>();
  const pending: Array<{ wire: WireFacts; part: { kind: "prompt"; shape: CanvasShape } | { kind: "group"; shape: CanvasShape } | { kind: "text"; text: string } | { kind: "page"; file: string; files: "entry" | "linked" } }> = [];
  let images = 0;
  let videos = 0;
  let firstBlock: Blocked | undefined;
  const block = (blocked: Blocked) => {
    firstBlock ??= blocked;
  };

  const numbered = (kind: "image" | "video", shapeId: string, source: SlotSource): Slot => {
    const number = kind === "image" ? ++images : ++videos;
    const slot: Slot = { kind, number, shapeId, source };
    references.push(slot);
    return slot;
  };

  const imageSource = (shape: CanvasShape): SlotSource => {
    const marks = ownedBy.get(shape.id) ?? [];
    const crop = isCropped(shape.crop) ? shape.crop : null;
    return marks.length > 0 || crop ? { type: "composite", image: shape.id, file: shape.file!, marks, crop } : { type: "file", file: shape.file! };
  };

  const label = (slot: Slot) => `${slot.kind} ${slot.number}`;

  const mediaSlot = (shape: CanvasShape): Slot | undefined => {
    const known = slots.get(shape.id);
    if (known) return known;
    let slot: Slot | undefined;
    if (shape.kind === "image" && shape.file !== undefined) slot = numbered("image", shape.id, imageSource(shape));
    else if (shape.kind === "video" && (shape.file !== undefined || shape.link !== undefined)) {
      slot = numbered("video", shape.id, shape.file !== undefined ? { type: "file", file: shape.file } : { type: "link", url: shape.link! });
    }
    if (slot) {
      slots.set(shape.id, slot);
      sources.push(shape.id, ...(shape.kind === "image" ? (ownedBy.get(shape.id) ?? []) : []));
    }
    return slot;
  };

  const nodeOutput = (wire: WireFacts): { kind: "image" | "video" | "text" | "page"; file?: string; text?: string } | undefined => {
    const source = canvas.nodes.get(wire.from)!;
    const version = currentVersion(source);
    const kind = source.medium === "image" || source.medium === "video" || source.medium === "page" ? source.medium : "text";
    if (version) return { kind, ...(version.file === undefined ? {} : { file: version.file }), ...(version.text === undefined ? {} : { text: version.text }) };
    if (assume.has(wire.from)) return { kind, file: `pending:${wire.from}`, text: `[the result of ${nodeName(canvas, wire.from)}]` };
    const name = nodeName(canvas, wire.from);
    block(blocked("waiting", noResultMessage(name), noResultStatus(name)));
    return undefined;
  };

  for (const wire of wires) {
    const kind = sourceOf(canvas, wire.from);
    const shape = shapeOf(canvas, wire.from);
    if (kind === undefined || shape === undefined) continue;
    const frameRole = wire.role === "first" || wire.role === "last" ? wire.role : undefined;

    if (frameRole !== undefined) {
      if (node.medium !== "video" || !frames.includes(frameRole === "first" ? "first_frame" : "last_frame")) {
        roles[wire.id] = UNUSED_ROLE;
        unsent.push(wire.id);
        block(blocked("refused", frameRoleMessage(input.model ?? node.model, frameRole)));
        continue;
      }
      let file: string | undefined;
      let source: SlotSource | undefined;
      if (kind === "image" && shape.file !== undefined) source = imageSource(shape);
      else if (kind === "node-image") {
        file = nodeOutput(wire)?.file;
        if (file !== undefined) source = { type: "file", file };
      }
      roles[wire.id] = frameRole;
      if (source) {
        nodeFrames.push({ role: frameRole, wireId: wire.id, slot: { kind: "image", number: 0, shapeId: shape.id, source } });
        sources.push(shape.id);
      }
      continue;
    }

    switch (kind) {
      case "prompt":
        if (wire.role !== "prompt") break;
        roles[wire.id] = "prompt";
        pending.push({ wire, part: { kind: "prompt", shape } });
        sources.push(shape.id);
        break;
      case "image":
      case "video": {
        if (wire.role !== "reference") break;
        const slot = mediaSlot(shape);
        roles[wire.id] = slot ? label(slot) : UNUSED_ROLE;
        if (!slot) unsent.push(wire.id);
        break;
      }
      case "mark": {
        if (wire.role !== "reference") break;
        const slot = numbered("image", wire.id, { type: "sketch", marks: [shape.id], bounds: shape.bounds });
        roles[wire.id] = label(slot);
        sources.push(shape.id);
        break;
      }
      case "motion": {
        if (wire.role !== "reference") break;
        const render = shape.file === undefined ? undefined : canvas.renders.get(shape.file);
        if (render === undefined) {
          roles[wire.id] = "reference";
          block(blocked("waiting", noRenderMessage(shapeName(canvas, shape.id)), noRenderMessage(shapeName(canvas, shape.id))));
          break;
        }
        const slot = numbered("video", shape.id, { type: "file", file: render });
        roles[wire.id] = label(slot);
        sources.push(shape.id);
        break;
      }
      case "page":
      case "node-page": {
        if (!wire.chosen) {
          roles[wire.id] = "choose";
          block(blocked("refused", PAGE_SEND_REFUSAL));
          break;
        }
        if (wire.files === undefined) {
          roles[wire.id] = wire.role === "prompt" ? "HTML" : wire.role === "both" ? "Both" : "Picture";
          block(blocked("refused", PAGE_FILES_REFUSAL));
          break;
        }
        const file = kind === "page" ? shape.file : nodeOutput(wire)?.file;
        const send = pageSendOf(wire.role);
        const words = wire.role === "prompt" ? "HTML" : wire.role === "both" ? "Both" : "Picture";
        if (file === undefined) {
          roles[wire.id] = words;
          break;
        }
        if (send.html) pending.push({ wire, part: { kind: "page", file, files: wire.files } });
        if (send.picture) {
          const slot = numbered("image", wire.id, { type: "page", file, files: wire.files });
          roles[wire.id] = `${words} · ${label(slot)}`;
        } else roles[wire.id] = words;
        sources.push(shape.id);
        break;
      }
      case "group": {
        const members = membersOf(shapes, shape.id);
        if (wire.role === "prompt") {
          roles[wire.id] = "prompt";
          pending.push({ wire, part: { kind: "group", shape } });
          sources.push(...members.filter((member) => member.kind === "prompt").map((member) => member.id));
          break;
        }
        if (wire.role !== "reference") break;
        const made: Slot[] = [];
        const memberIds = new Set(members.map((member) => member.id));
        const loose = members.filter((member) => member.kind === "mark" && !(owners.has(member.id) && memberIds.has(owners.get(member.id)!)));
        for (const member of members) {
          if (member.kind === "image" || member.kind === "video") {
            const slot = mediaSlot(member);
            if (slot) made.push(slot);
          } else if (member.kind === "mark" && member === loose[0]) {
            made.push(numbered("image", wire.id, { type: "sketch", marks: loose.map((mark) => mark.id), bounds: union(loose.map((mark) => mark.bounds)) }));
            sources.push(...loose.map((mark) => mark.id));
          }
        }
        roles[wire.id] = made.length === 0 ? UNUSED_ROLE : made.map(label).join(", ");
        if (made.length === 0) unsent.push(wire.id);
        break;
      }
      case "node-image":
      case "node-video": {
        if (wire.role !== "reference") break;
        const output = nodeOutput(wire);
        if (!output?.file) {
          roles[wire.id] = "reference";
          break;
        }
        const slot = numbered(kind === "node-image" ? "image" : "video", wire.from, { type: "file", file: output.file });
        roles[wire.id] = label(slot);
        sources.push(wire.from);
        break;
      }
      case "node-text": {
        if (wire.role !== "prompt") break;
        roles[wire.id] = "prompt";
        const output = nodeOutput(wire);
        if (output) pending.push({ wire, part: { kind: "text", text: output.text ?? "" } });
        sources.push(wire.from);
        break;
      }
      default:
        break;
    }
  }

  const named: string[] = [];
  const resolver = createResolver(shapes, (shape) => {
    const wired = slots.has(shape.id);
    const slot = mediaSlot(shape);
    if (!slot) return undefined;
    if (!wired) named.push(shape.id);
    return label(slot);
  });
  let cycle: string | undefined;
  const resolve = (text: string, self?: string): string => {
    const resolved = resolver.resolve(text, self);
    if (resolved.ok) return resolved.text;
    cycle ??= resolved.error;
    return "";
  };

  const parts: PromptPart[] = [];
  for (const { wire, part } of pending) {
    if (part.kind === "page") {
      parts.push({ type: "page", file: part.file, files: part.files, wireId: wire.id });
      continue;
    }
    const text =
      part.kind === "text"
        ? part.text
        : part.kind === "group"
          ? part.shape.ref === undefined
            ? ""
            : resolve(`@${part.shape.ref}`)
          : part.shape.textResult
            ? (part.shape.text ?? "")
            : resolve(part.shape.text ?? "", part.shape.ref);
    if (text.trim() !== "") parts.push({ type: "text", text: text.trim(), wireId: wire.id });
  }
  const instruction = resolve(node.instruction).trim();

  if (firstBlock !== undefined) return { ok: false, kind: firstBlock.kind, message: firstBlock.message, ...(firstBlock.status === undefined ? {} : { status: firstBlock.status }), roles };
  if (cycle !== undefined) return { ok: false, kind: "refused", message: cycle, roles };
  if (parts.length === 0 && instruction === "") return { ok: false, kind: "refused", message: NODE_EMPTY_PROMPT, roles };
  const cap = input.referenceCap;
  if (cap !== undefined && references.length > cap) {
    return { ok: false, kind: "refused", message: referenceCapMessage(nodeName(canvas, node.id), references.length, input.model ?? node.model, cap), roles };
  }
  return { ok: true, parts, instruction, references, frames: nodeFrames, sources: [...new Set(sources)], roles, unsent };
};

/** The text a request sends, with each page part's HTML from `pageText`. */
export const nodePromptText = (parts: ReadonlyArray<PromptPart>, instruction: string, pageText: (part: Extract<PromptPart, { type: "page" }>) => string): string =>
  [...parts.map((part) => (part.type === "text" ? part.text : pageText(part))), instruction]
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .join("\n\n");
