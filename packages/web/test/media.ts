/** Browser-seam helpers for media shapes: put empty ones on the board through the engine. */
import type { TestEngine } from "../../engine/test/engineProcess.ts";

export const emptyMedia = (id: string, type: "image" | "video", ref: string, at: { x: number; y: number }, size?: { w: number; h: number }) => ({
  id,
  typeName: "shape",
  type,
  x: at.x,
  y: at.y,
  rotation: 0,
  index: `a${Math.floor(Math.random() * 8) + 2}`,
  parentId: "page:page",
  isLocked: false,
  opacity: 1,
  props:
    type === "image"
      ? { w: size?.w ?? 240, h: size?.h ?? 140, playing: true, url: "", assetId: null, crop: null, flipX: false, flipY: false, altText: "" }
      : { w: size?.w ?? 240, h: size?.h ?? 180, time: 0, playing: false, autoplay: false, url: "", assetId: null, altText: "" },
  meta: { ref },
});

/** Uploads bytes through the engine's route and answers the saved file's name. */
export const uploadToEngine = async (engine: TestEngine, name: string, bytes: Buffer, mime: string, project = "default"): Promise<string> =>
  (
    await engine.request(`/api/projects/${project}/files?name=${encodeURIComponent(name)}`, {
      method: "POST",
      body: bytes,
      headers: { "content-type": mime },
    })
  ).json().file;

/** A filled image or video: the file uploaded, its asset and a shape showing it. */
export const filledMedia = async (
  engine: TestEngine,
  options: { id: string; type: "image" | "video"; ref: string; at: { x: number; y: number }; bytes: Buffer; name: string; mime: string; natural: { w: number; h: number }; width?: number },
) => {
  const file = await uploadToEngine(engine, options.name, options.bytes, options.mime);
  const width = options.width ?? 240;
  const assetId = `asset:${options.id.slice("shape:".length)}`;
  const shape = emptyMedia(options.id, options.type, options.ref, options.at, { w: width, h: (width * options.natural.h) / options.natural.w });
  const asset = {
    id: assetId,
    typeName: "asset",
    type: options.type,
    props: { w: options.natural.w, h: options.natural.h, name: options.name, isAnimated: options.type === "video", mimeType: options.mime, src: `project-file:${file}` },
    meta: {},
  };
  await putRecords(engine, [asset, { ...shape, props: { ...shape.props, assetId } }]);
  return { file, assetId };
};

/** Puts records on the board as an engine-side write, as a run would. */
export const putRecords = async (engine: TestEngine, records: unknown[], project = "default") =>
  (await engine.rpc()).call("testCanvas.apply", { project, change: { put: records, remove: [] }, origin: { kind: "server", id: "test" } });
