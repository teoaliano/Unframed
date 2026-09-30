import { membersOf, readingOrder, type CanvasShape, type Crop } from "./canvasShapes.ts";
import { boxesOverlap, type Box } from "./grouping.ts";
import { createResolver } from "./references.ts";

export type Medium = "image" | "video" | "text";

/** What a reference slot sends: a project file, a link, or a picture the web renders at send time. */
export type SlotSource =
  | { readonly type: "file"; readonly file: string }
  | { readonly type: "link"; readonly url: string }
  /** An image with its owned marks and crop, rendered at the image's native resolution. */
  | { readonly type: "composite"; readonly image: string; readonly file: string; readonly marks: ReadonlyArray<string>; readonly crop: Crop | null }
  /** Every loose selected mark, rendered on white as one picture. */
  | { readonly type: "sketch"; readonly marks: ReadonlyArray<string>; readonly bounds: Box };

export interface Slot {
  readonly kind: "image" | "video";
  /** 1-based, per kind. */
  readonly number: number;
  /** The shape the slot comes from; `SKETCH_ROLE` for the sketch. */
  readonly shapeId: string;
  readonly source: SlotSource;
}

/** The key the sketch's badge has in `roles`: it belongs to no one shape. */
export const SKETCH_ROLE = "sketch";

/** The badge of a selected shape that sends nothing: U+2014. */
export const UNUSED_ROLE = "\u2014";

export interface CompositionInput {
  /** Every shape on the canvas: references and mark ownership read all of them. */
  readonly shapes: ReadonlyArray<CanvasShape>;
  readonly selected: ReadonlyArray<string>;
  readonly instruction: string;
  readonly medium: Medium;
  /** The model's `input_references` maximum, for the over-cap warning. */
  readonly referenceCap?: number | undefined;
}

export interface Composition {
  /** The resolved text of each contributing shape, in order. */
  readonly promptParts: ReadonlyArray<string>;
  /** The parts, then the instruction, joined with a blank line. */
  readonly prompt: string;
  /** The instruction, resolved and trimmed. */
  readonly instruction: string;
  readonly references: ReadonlyArray<Slot>;
  /** Badge text by shape id (and `SKETCH_ROLE`). */
  readonly roles: Readonly<Record<string, string>>;
  readonly usable: boolean;
  /** Every shape that contributed, in order: for the recipe and the tether. */
  readonly sources: ReadonlyArray<string>;
  readonly warnings: ReadonlyArray<string>;
  readonly error?: string;
}

/** A crop that leaves the whole picture visible is no crop. */
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

/**
 * The image each mark belongs to: the topmost image with a file that it overlaps and sits
 * above. Computed against every image on the canvas, not only the selection.
 */
const markOwners = (shapes: ReadonlyArray<CanvasShape>): Map<string, string> => {
  const images = shapes.filter((shape) => shape.kind === "image" && shape.file !== undefined);
  const owners = new Map<string, string>();
  for (const mark of shapes) {
    if (mark.kind !== "mark") continue;
    let owner: CanvasShape | undefined;
    for (const image of images) {
      if (image.z >= mark.z || !boxesOverlap(image.bounds, mark.bounds)) continue;
      if (owner === undefined || image.z > owner.z) owner = image;
    }
    if (owner) owners.set(mark.id, owner.id);
  }
  return owners;
};

/**
 * Every selected shape in the one order: by top edge, then left edge, then z rank. A
 * selected group takes one place and its members fill it in their own order; a member
 * selected with its group counts in the group's place only.
 */
export const selectionOrder = (shapes: ReadonlyArray<CanvasShape>, selected: ReadonlyArray<string>): CanvasShape[] => {
  const byId = new Map(shapes.map((shape) => [shape.id, shape]));
  const chosen = new Set(selected.filter((id) => byId.has(id)));
  const top = [...chosen]
    .map((id) => byId.get(id)!)
    .filter((shape) => !(shape.parent !== undefined && chosen.has(shape.parent)))
    .sort(readingOrder);
  return top.flatMap((shape) => (shape.kind === "group" ? membersOf(shapes, shape.id) : [shape]));
};

/** Prompt parts as a run sends them: each trimmed, empties dropped, joined with one blank line. */
export const joinPromptParts = (...parts: ReadonlyArray<string>): string =>
  parts
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .join("\n\n");

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

const imageWarnings = (videos: number, images: number, cap: number | undefined): string[] => {
  const warnings: string[] = [];
  if (videos === 1) warnings.push("A video is selected, but image models do not take video input. It will be sent and probably ignored.");
  else if (videos > 1) warnings.push(`${videos} videos are selected, but image models do not take video input. They will be sent and probably ignored.`);
  if (cap !== undefined && images > cap) {
    const takes = cap === 1 ? "only one" : `at most ${cap}`;
    warnings.push(
      `${images} ${plural(images, "image is", "images are")} selected, but this model takes ${takes}. Deselect the rest, or pick a model that takes more.`,
    );
  }
  return warnings;
};

/**
 * The selection to request rule: the one path from what is selected to what a run sends.
 * The composer, the role badges and the send path all call it, so a badge always says what
 * is sent. It never renders, never touches the network and never throws: a circular
 * reference comes back as `error`.
 */
export const composeSelection = (input: CompositionInput): Composition => {
  const { shapes, medium } = input;
  const resolver = createResolver(shapes);
  const owners = markOwners(shapes);
  const list = selectionOrder(shapes, input.selected);
  const inList = new Set(list.map((shape) => shape.id));

  let error: string | undefined;
  const resolve = (text: string, self?: string): string => {
    const resolved = resolver.resolve(text, self);
    if (resolved.ok) return resolved.text;
    error ??= resolved.error;
    return "";
  };

  const promptParts: string[] = [];
  const references: Slot[] = [];
  const roles: Record<string, string> = {};
  const sources: string[] = [];
  const ownedBy = new Map<string, string[]>();
  for (const shape of [...shapes].sort((a, b) => a.z - b.z)) {
    const owner = owners.get(shape.id);
    if (owner !== undefined) ownedBy.set(owner, [...(ownedBy.get(owner) ?? []), shape.id]);
  }
  const loose = list.filter((shape) => {
    if (shape.kind !== "mark") return false;
    const owner = owners.get(shape.id);
    return owner === undefined || !inList.has(owner);
  });

  let images = 0;
  let videos = 0;
  let hadText = false;
  for (const shape of list) {
    switch (shape.kind) {
      case "prompt": {
        const raw = shape.text ?? "";
        if (raw.trim() !== "") hadText = true;
        const part = (shape.textResult ? raw : resolve(raw, shape.ref)).trim();
        if (part === "") break;
        promptParts.push(part);
        sources.push(shape.id);
        break;
      }
      case "image": {
        if (shape.file === undefined) {
          roles[shape.id] = UNUSED_ROLE;
          break;
        }
        const marks = ownedBy.get(shape.id) ?? [];
        const crop = isCropped(shape.crop) ? shape.crop : null;
        images++;
        references.push({
          kind: "image",
          number: images,
          shapeId: shape.id,
          source: marks.length > 0 || crop ? { type: "composite", image: shape.id, file: shape.file, marks, crop } : { type: "file", file: shape.file },
        });
        roles[shape.id] = `image ${images}`;
        sources.push(shape.id, ...marks);
        break;
      }
      case "video": {
        const source: SlotSource | undefined =
          shape.file !== undefined ? { type: "file", file: shape.file } : shape.link !== undefined ? { type: "link", url: shape.link } : undefined;
        if (!source) {
          roles[shape.id] = UNUSED_ROLE;
          break;
        }
        videos++;
        references.push({ kind: "video", number: videos, shapeId: shape.id, source });
        roles[shape.id] = `video ${videos}`;
        sources.push(shape.id);
        break;
      }
      case "page":
      case "motion":
        roles[shape.id] = UNUSED_ROLE;
        break;
      case "mark": {
        if (shape !== loose[0]) break;
        images++;
        references.push({
          kind: "image",
          number: images,
          shapeId: SKETCH_ROLE,
          source: { type: "sketch", marks: loose.map((mark) => mark.id), bounds: union(loose.map((mark) => mark.bounds)) },
        });
        roles[SKETCH_ROLE] = `image ${images}`;
        sources.push(...loose.map((mark) => mark.id));
        break;
      }
      case "group":
        break;
    }
  }

  const instruction = resolve(input.instruction).trim();
  const prompt = joinPromptParts(...promptParts, instruction);
  return {
    promptParts,
    prompt,
    instruction,
    references,
    roles,
    usable: promptParts.length > 0 || references.length > 0 || (error !== undefined && hadText),
    sources,
    warnings: medium === "image" ? imageWarnings(videos, images, input.referenceCap) : [],
    ...(error === undefined ? {} : { error }),
  };
};
