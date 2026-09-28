/** Canvas descriptions for the generation rules' tests, written the way the web describes a board. */
import type { CanvasShape, Crop } from "../src/index.ts";

type At = { x?: number; y?: number; w?: number; h?: number; z?: number; parent?: string };

let rank = 0;
const place = (at: At) => ({
  bounds: { x: at.x ?? 0, y: at.y ?? 0, w: at.w ?? 100, h: at.h ?? 100 },
  z: at.z ?? ++rank,
  ...(at.parent === undefined ? {} : { parent: at.parent }),
});

export const prompt = (id: string, text: string, at: At = {}, ref = id): CanvasShape => ({ id, kind: "prompt", ref, text, ...place(at) });

export const textResult = (id: string, text: string, at: At = {}, ref = id): CanvasShape => ({
  id,
  kind: "prompt",
  ref,
  text,
  textResult: true,
  ...place(at),
});

export const group = (id: string, at: At = {}, name = id): CanvasShape => ({ id, kind: "group", ref: name, ...place({ w: 400, h: 300, ...at }) });

export const image = (id: string, file: string | undefined, at: At = {}, crop: Crop | null = null): CanvasShape => ({
  id,
  kind: "image",
  ref: id,
  ...(file === undefined ? {} : { file }),
  crop,
  ...place(at),
});

export const video = (id: string, source: { file?: string; link?: string } = {}, at: At = {}): CanvasShape => ({
  id,
  kind: "video",
  ref: id,
  ...source,
  ...place(at),
});

export const artifact = (id: string, kind: "page" | "motion", at: At = {}, file = "page.html"): CanvasShape => ({
  id,
  kind,
  ref: id,
  file,
  ...place(at),
});

export const mark = (id: string, at: At = {}): CanvasShape => ({ id, kind: "mark", ...place({ w: 20, h: 20, ...at }) });
