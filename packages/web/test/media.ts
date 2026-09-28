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

/** A file to drop: its bytes, or just a size for a large blank one made in the page. */
export interface DroppedFile {
  readonly name: string;
  readonly mime: string;
  readonly bytes?: Buffer;
  readonly size?: number;
}

/**
 * Drops files on the page at a screen point. A browser gives a test no way to drag real
 * files from the OS, so this builds the drop's DataTransfer the way the OS would.
 */
export const dropFiles = async (page: import("@playwright/test").Page, point: { x: number; y: number }, files: ReadonlyArray<DroppedFile>) => {
  await page.evaluate(
    ({ point, files }) => {
      const transfer = new DataTransfer();
      for (const file of files) {
        const bytes = file.size !== undefined ? new Uint8Array(file.size) : Uint8Array.from(atob(file.base64), (char) => char.charCodeAt(0));
        transfer.items.add(new File([bytes], file.name, { type: file.mime }));
      }
      const target = document.elementFromPoint(point.x, point.y)!;
      const init = { bubbles: true, cancelable: true, clientX: point.x, clientY: point.y, dataTransfer: transfer };
      target.dispatchEvent(new DragEvent("dragenter", init));
      target.dispatchEvent(new DragEvent("dragover", init));
      target.dispatchEvent(new DragEvent("drop", init));
    },
    {
      point,
      files: files.map((file) => ({ name: file.name, mime: file.mime, base64: file.bytes?.toString("base64") ?? "", size: file.size })),
    },
  );
};

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
