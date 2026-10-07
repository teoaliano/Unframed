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

/** How many of a kind go with a run: those selected (the sketch counts as selected) and those named by `@`. */
interface Counted {
  readonly selected: number;
  readonly named: number;
}

/**
 * What the warnings say goes with the run: "selected" when nothing was named by `@`, "named
 * with @" when everything was, and both counts when the run mixes them.
 */
const whatGoes = ({ selected, named }: Counted, one: string, many: string): string => {
  const total = selected + named;
  if (named === 0) return total === 1 ? `${one} is selected` : `${total} ${many} are selected`;
  if (selected === 0) return total === 1 ? `${one} is named with @` : `${total} ${many} are named with @`;
  return `${total} ${many} go with this run (${selected} selected, ${named} named with @)`;
};

const imageWarnings = (videos: Counted, images: Counted, cap: number | undefined): string[] => {
  const warnings: string[] = [];
  const videoCount = videos.selected + videos.named;
  if (videoCount > 0) {
    warnings.push(`${whatGoes(videos, "A video", "videos")}, but image models do not take video input. ${plural(videoCount, "It", "They")} will be sent and probably ignored.`);
  }
  const imageCount = images.selected + images.named;
  if (cap !== undefined && imageCount > cap) {
    const takes = cap === 1 ? "only one" : `at most ${cap}`;
    const fix = images.named === 0 ? "Deselect the rest" : images.selected === 0 ? "Take out an @ name" : "Deselect some, take out an @ name";
    warnings.push(`${whatGoes(images, "1 image", "images")}, but this model takes ${takes}. ${fix}, or pick a model that takes more.`);
  }
  return warnings;
};

/**
 * The selection to request rule: the one path from what is selected to what a run sends.
 * The composer, the role badges and the send path all call it, so a badge always says what
 * is sent. It never renders, never touches the network and never throws: a circular
 * reference comes back as `error`.
 *
 * Selected media and the sketch take their slots first, in list order, so naming a picture
 * by `@` never renumbers the badges of what is selected. A picture named by `@` and not
 * selected takes the next slot of its kind, and its token reads as that slot.
 */
export const composeSelection = (input: CompositionInput): Composition => {
  const { shapes, medium } = input;
  const owners = markOwners(shapes);
  const list = selectionOrder(shapes, input.selected);
  const inList = new Set(list.map((shape) => shape.id));

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
  const slots = new Map<string, Slot>();
  /** What each slot's shape adds to the sources: an image brings the marks composited into it. */
  const contributes = new Map<string, ReadonlyArray<string>>();
  const take = (shape: CanvasShape, slot: Slot, from: ReadonlyArray<string>) => {
    references.push(slot);
    slots.set(shape.id, slot);
    roles[slot.shapeId] = `${slot.kind} ${slot.number}`;
    contributes.set(shape.id, from);
    return slot;
  };
  /** The slot of a filled image or video, made on first use; an empty one has none. */
  const mediaSlot = (shape: CanvasShape): Slot | undefined => {
    const known = slots.get(shape.id);
    if (known) return known;
    if (shape.kind === "image" && shape.file !== undefined) {
      const marks = ownedBy.get(shape.id) ?? [];
      const crop = isCropped(shape.crop) ? shape.crop : null;
      images++;
      const source: SlotSource = marks.length > 0 || crop ? { type: "composite", image: shape.id, file: shape.file, marks, crop } : { type: "file", file: shape.file };
      return take(shape, { kind: "image", number: images, shapeId: shape.id, source }, [shape.id, ...marks]);
    }
    if (shape.kind === "video") {
      const source: SlotSource | undefined =
        shape.file !== undefined ? { type: "file", file: shape.file } : shape.link !== undefined ? { type: "link", url: shape.link } : undefined;
      if (!source) return undefined;
      videos++;
      return take(shape, { kind: "video", number: videos, shapeId: shape.id, source }, [shape.id]);
    }
    return undefined;
  };

  for (const shape of list) {
    switch (shape.kind) {
      case "image":
      case "video":
        if (!mediaSlot(shape)) roles[shape.id] = UNUSED_ROLE;
        break;
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
        contributes.set(shape.id, loose.map((mark) => mark.id));
        break;
      }
      case "prompt":
      case "group":
        break;
    }
  }

  /** Pictures named by `@` that were not selected, in the order they were first named. */
  const named: string[] = [];
  const resolver = createResolver(shapes, (shape) => {
    const selected = slots.has(shape.id);
    const slot = mediaSlot(shape);
    if (!slot) return undefined;
    if (!selected) named.push(shape.id);
    return `${slot.kind} ${slot.number}`;
  });
  let error: string | undefined;
  const resolve = (text: string, self?: string): string => {
    const resolved = resolver.resolve(text, self);
    if (resolved.ok) return resolved.text;
    error ??= resolved.error;
    return "";
  };

  let hadText = false;
  for (const shape of list) {
    if (shape.kind !== "prompt") {
      sources.push(...(contributes.get(shape.id) ?? []));
      continue;
    }
    const raw = shape.text ?? "";
    if (raw.trim() !== "") hadText = true;
    const part = (shape.textResult ? raw : resolve(raw, shape.ref)).trim();
    if (part === "") continue;
    promptParts.push(part);
    sources.push(shape.id);
  }

  const instruction = resolve(input.instruction).trim();
  for (const id of named) sources.push(...(contributes.get(id) ?? []));
  const namedOf = (kind: Slot["kind"]) => named.filter((id) => slots.get(id)?.kind === kind).length;
  const namedImages = namedOf("image");
  const namedVideos = namedOf("video");
  const prompt = joinPromptParts(...promptParts, instruction);
  return {
    promptParts,
    prompt,
    instruction,
    references,
    roles,
    usable: promptParts.length > 0 || references.length > 0 || (error !== undefined && hadText),
    sources,
    warnings:
      medium === "image"
        ? imageWarnings({ selected: videos - namedVideos, named: namedVideos }, { selected: images - namedImages, named: namedImages }, input.referenceCap)
        : [],
    ...(error === undefined ? {} : { error }),
  };
};
