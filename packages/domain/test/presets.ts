/** tldraw content for the preset rules' tests, shaped the way tldraw's own copy produces it. */
import type { ContentAsset, ContentShape, PresetContent } from "../src/index.ts";

const base = (id: string, type: string, at: { x: number; y: number }, parentId: string) => ({
  id,
  typeName: "shape" as const,
  type,
  x: at.x,
  y: at.y,
  rotation: 0,
  index: "a1",
  parentId,
  isLocked: false,
  opacity: 1,
});

export const richText = (text: string) => ({
  type: "doc",
  content: text.split("\n").map((line) => (line === "" ? { type: "paragraph" } : { type: "paragraph", content: [{ type: "text", text: line }] })),
});

export const promptShape = (id: string, ref: string, text: string, at = { x: 0, y: 0 }, parentId = "page:page", meta: Record<string, unknown> = {}): ContentShape => ({
  ...base(id, "text", at, parentId),
  props: { color: "black", size: "s", w: 320, font: "sans", textAlign: "start", autoSize: false, scale: 1, richText: richText(text) },
  meta: { ref, ...meta },
});

export const imageShape = (id: string, ref: string, assetId: string | null, at = { x: 0, y: 0 }, parentId = "page:page", meta: Record<string, unknown> = {}): ContentShape => ({
  ...base(id, "image", at, parentId),
  props: { w: 240, h: 140, playing: true, url: "", assetId, crop: null, flipX: false, flipY: false, altText: "" },
  meta: { ref, ...meta },
});

export const groupShape = (id: string, name: string, at = { x: 0, y: 0 }, meta: Record<string, unknown> = {}, size = { w: 420, h: 280 }): ContentShape => ({
  ...base(id, "frame", at, "page:page"),
  props: { ...size, name, color: "black" },
  meta,
});

export const pageShape = (id: string, ref: string, at = { x: 0, y: 0 }): ContentShape => ({
  ...base(id, "page", at, "page:page"),
  props: { w: 480, h: 320, file: "", title: "", fileName: "" },
  meta: { ref },
});

export const markShape = (id: string, at = { x: 0, y: 0 }, parentId = "page:page"): ContentShape => ({
  ...base(id, "geo", at, parentId),
  props: { geo: "rectangle", w: 100, h: 100 },
  meta: {},
});

export const imageAsset = (id: string, src: string | null): ContentAsset => ({
  id,
  typeName: "asset",
  type: "image",
  props: { w: 64, h: 64, name: "fox.png", isAnimated: false, mimeType: "image/png", src },
  meta: {},
});

export const SCHEMA = { schemaVersion: 2, sequences: { "com.tldraw.shape.text": 3 } };

export const content = (shapes: ContentShape[], assets: ContentAsset[] = [], extra: Partial<PresetContent> = {}): PresetContent => ({
  schema: SCHEMA,
  shapes,
  rootShapeIds: shapes.filter((shape) => shape.parentId === "page:page").map((shape) => shape.id),
  assets,
  bindings: [],
  ...extra,
});

/** The plain text of a content shape, paragraphs joined by `\n`. */
export const textOf = (shape: ContentShape | undefined): string =>
  ((shape?.props.richText as { content: Array<{ content?: Array<{ text: string }> }> } | undefined)?.content ?? [])
    .map((paragraph) => (paragraph.content ?? []).map((node) => node.text).join(""))
    .join("\n");
