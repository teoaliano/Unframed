import type { TLRecord } from "@tldraw/tlschema";

export const PAGE_ID = "page:page";

const richText = (text: string) => ({
  type: "doc",
  content: text.split("\n").map((line) => (line === "" ? { type: "paragraph" } : { type: "paragraph", content: [{ type: "text", text: line }] })),
});

const base = (id: string, type: string, at: { x?: number; y?: number; index?: string; parentId?: string } = {}) => ({
  id: `shape:${id}`,
  typeName: "shape" as const,
  type,
  x: at.x ?? 0,
  y: at.y ?? 0,
  rotation: 0,
  index: at.index ?? "a5",
  parentId: at.parentId ?? PAGE_ID,
  isLocked: false,
  opacity: 1,
});

type At = { x?: number; y?: number; index?: string; parentId?: string };

export const promptShape = (id: string, ref: string, text: string, at: At = {}, meta: Record<string, unknown> = {}): TLRecord =>
  ({
    ...base(id, "text", at),
    props: { color: "black", size: "s", w: 320, font: "sans", textAlign: "start", autoSize: false, scale: 1, richText: richText(text) },
    meta: { ref, ...meta },
  }) as unknown as TLRecord;

export const imageShape = (id: string, ref: string, assetId: string | null, at: At = {}, props: Record<string, unknown> = {}): TLRecord =>
  ({
    ...base(id, "image", at),
    props: { w: 240, h: 140, playing: true, url: "", assetId, crop: null, flipX: false, flipY: false, altText: "", ...props },
    meta: { ref },
  }) as unknown as TLRecord;

export const videoShape = (id: string, ref: string, assetId: string | null, at: At = {}, props: Record<string, unknown> = {}): TLRecord =>
  ({
    ...base(id, "video", at),
    props: { w: 240, h: 180, time: 0, playing: false, autoplay: false, url: "", assetId, altText: "", ...props },
    meta: { ref },
  }) as unknown as TLRecord;

export const groupShape = (id: string, name: string, at: At = {}, size = { w: 420, h: 280 }): TLRecord =>
  ({
    ...base(id, "frame", at),
    props: { w: size.w, h: size.h, name, color: "black" },
    meta: {},
  }) as unknown as TLRecord;

export const pageShape = (id: string, ref: string, props: Record<string, unknown> = {}, at: At = {}): TLRecord =>
  ({
    ...base(id, "page", at),
    props: { w: 480, h: 320, file: "", title: "", fileName: "", ...props },
    meta: { ref },
  }) as unknown as TLRecord;

export const componentShape = (id: string, tag: string, props: Record<string, unknown> = {}, at: At = {}): TLRecord =>
  ({
    ...base(id, "component", at),
    props: { w: 480, h: 320, file: "", title: "", fileName: "", tag, ...props },
    meta: { ref: id },
  }) as unknown as TLRecord;

export const imageAsset = (id: string, src: string | null, props: Record<string, unknown> = {}): TLRecord =>
  ({
    id: `asset:${id}`,
    typeName: "asset",
    type: "image",
    props: { w: 1024, h: 1024, name: "fox.png", isAnimated: false, mimeType: "image/png", src, ...props },
    meta: {},
  }) as unknown as TLRecord;

export const videoAsset = (id: string, src: string | null, props: Record<string, unknown> = {}): TLRecord =>
  ({
    id: `asset:${id}`,
    typeName: "asset",
    type: "video",
    props: { w: 640, h: 360, name: "clip.mp4", isAnimated: true, mimeType: "video/mp4", src, ...props },
    meta: {},
  }) as unknown as TLRecord;

export const textOf = (record: TLRecord | undefined): string | undefined => {
  const doc = (record as { props?: { richText?: { content?: Array<{ content?: Array<{ text?: string }> }> } } } | undefined)?.props
    ?.richText;
  return doc?.content?.map((paragraph) => (paragraph.content ?? []).map((node) => node.text ?? "").join("")).join("\n");
};

export const refOf = (record: TLRecord | undefined): string | undefined =>
  (record as { meta?: { ref?: string } } | undefined)?.meta?.ref ?? (record as { props?: { name?: string } } | undefined)?.props?.name;

export const SAMPLE_SUBJECT = "lone red fox";
export const SAMPLE_SCENE = "A @100 on a windswept cliff at golden hour, cinematic, 35mm";

/** Two prompts many tests start from: the scene (@101) references the subject (@100). New projects start empty. */
export const samplePrompts = (): TLRecord[] => [
  promptShape("sample-scene", "101", SAMPLE_SCENE, { x: 40, y: 60, index: "a1" }),
  promptShape("sample-subject", "100", SAMPLE_SUBJECT, { x: 40, y: 320, index: "a2" }),
];

/** Puts the sample prompts on `project`'s canvas. The engine must run with `UNFRAMED_TEST_CANVAS=1`. */
export const seedSamplePrompts = async (rpc: { call: (method: "testCanvas.apply", payload: any) => Promise<unknown> }, project: string): Promise<void> => {
  await rpc.call("testCanvas.apply", { project, change: { put: samplePrompts(), remove: [] }, origin: { kind: "system", id: "test-seed" } });
};
