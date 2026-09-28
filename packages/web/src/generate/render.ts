/**
 * Composites and sketches: rendered at send time with tldraw's own export, so they match
 * the canvas, and uploaded as project files with their sidecars. The canvas image stays
 * clean and the marks stay editable shapes.
 */
import type { RecipeRef } from "@unframed/contracts";
import type { RenderedSidecar, Slot, SlotSource } from "@unframed/domain";
import { Box, type Editor, type TLShapeId } from "tldraw";
import { uploadFile, type Uploaded } from "../canvas/assetStore.ts";
import { assetOf } from "./facts.ts";

const SKETCH_PADDING = 16;
const SKETCH_LONGEST = 1024;
const SKETCH_CAP = 2048;

/** Uploads a rendered picture through spec 02's upload path, with its composite or sketch sidecar. */
const uploadRendered = (project: string, blob: Blob, name: string, sidecar: RenderedSidecar): Promise<Uploaded> =>
  uploadFile(project, new Blob([blob], { type: "image/png" }), name, undefined, {
    source: sidecar.source,
    marks: JSON.stringify(sidecar.marks ?? []),
    crop: JSON.stringify(sidecar.crop ?? null),
    ...(sidecar.of === undefined ? {} : { of: sidecar.of }),
  });

const withoutExtension = (file: string) => file.replace(/\.[^.]*$/, "");

/** The image's visible crop plus its owned marks, clipped to its frame, at the file's own resolution. */
const renderComposite = async (editor: Editor, source: Extract<SlotSource, { type: "composite" }>): Promise<Blob> => {
  const image = editor.getShape(source.image as TLShapeId);
  const bounds = image ? editor.getShapePageBounds(image.id) : undefined;
  const asset = image ? assetOf(editor, image) : undefined;
  if (!image || !bounds || !asset) throw new Error("the image is no longer on the canvas");
  const natural = asset.props as { w?: number };
  const crop = source.crop;
  const visible = crop ? crop.bottomRight.x - crop.topLeft.x : 1;
  const scale = Math.max(0.01, ((natural.w ?? bounds.w) * visible) / bounds.w);
  const { blob } = await editor.toImage([image.id, ...(source.marks as TLShapeId[])], {
    format: "png",
    bounds: new Box(bounds.x, bounds.y, bounds.w, bounds.h),
    scale,
    pixelRatio: 1,
    background: false,
    padding: 0,
  });
  return blob;
};

/** The loose marks on white with 16 canvas units of padding, its longer side 1024 pixels. */
const renderSketch = async (editor: Editor, source: Extract<SlotSource, { type: "sketch" }>): Promise<Blob> => {
  const box = new Box(
    source.bounds.x - SKETCH_PADDING,
    source.bounds.y - SKETCH_PADDING,
    source.bounds.w + SKETCH_PADDING * 2,
    source.bounds.h + SKETCH_PADDING * 2,
  );
  const scale = Math.min(SKETCH_LONGEST / Math.max(box.w, box.h), SKETCH_CAP / Math.max(box.w, box.h));
  const { blob } = await editor.toImage(source.marks as TLShapeId[], { format: "png", bounds: box, scale, pixelRatio: 1, background: false, padding: 0, darkMode: false });
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  return new Promise((resolve, reject) => canvas.toBlob((png) => (png ? resolve(png) : reject(new Error("the sketch could not be encoded"))), "image/png"));
};

/**
 * The references a run sends, in slot order: files and links as they are, each composite
 * and the sketch rendered and uploaded once.
 */
export const referencesFor = async (editor: Editor, project: string, slots: ReadonlyArray<Slot>): Promise<RecipeRef[]> => {
  const refs: RecipeRef[] = [];
  for (const slot of slots) {
    const { source } = slot;
    switch (source.type) {
      case "file":
        refs.push({ kind: slot.kind, file: source.file });
        break;
      case "link":
        refs.push({ kind: "video", url: source.url });
        break;
      case "composite": {
        const saved = await uploadRendered(project, await renderComposite(editor, source), `composite-${withoutExtension(source.file)}.png`, {
          source: "composite",
          of: source.file,
          marks: source.marks,
          crop: source.crop,
        });
        refs.push({ kind: "image", file: saved.file, original: source.file });
        break;
      }
      case "sketch": {
        const saved = await uploadRendered(project, await renderSketch(editor, source), "sketch.png", { source: "sketch", marks: source.marks, crop: null });
        refs.push({ kind: "image", file: saved.file });
        break;
      }
    }
  }
  return refs;
};
