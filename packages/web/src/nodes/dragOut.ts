import { nodeCatalogueOf } from "@unframed/domain";
import { AUDIO_DEFAULT_SIZE, projectFileMarker, type NodeVersion, type ResultMeta } from "@unframed/contracts";
import { AssetRecordType, createShapeId, toRichText, type Editor, type TLAssetId, type TLShapeId, type VecLike } from "tldraw";
import { fileUrl } from "../canvas/assetStore.ts";
import type { NodeShape } from "./facts.ts";

const MEDIA_WIDTH = 320;
const PAGE_SIZE = { w: 480, h: 320 };

const sidecarOf = (version: NodeVersion): string | undefined => (version.file === undefined ? undefined : version.file.endsWith(".json") ? version.file : version.file.replace(/\.[^.]+$/, ".json"));

const readSidecar = async (project: string, name: string | undefined): Promise<Record<string, unknown>> => {
  if (name === undefined) return {};
  try {
    const response = await fetch(fileUrl(project, name));
    return response.ok ? ((await response.json()) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

const naturalSize = (url: string, kind: "image" | "video"): Promise<{ w: number; h: number } | undefined> =>
  new Promise((resolve) => {
    if (kind === "image") {
      const image = new Image();
      image.onload = () => resolve({ w: image.naturalWidth, h: image.naturalHeight });
      image.onerror = () => resolve(undefined);
      image.src = url;
      return;
    }
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => resolve({ w: video.videoWidth, h: video.videoHeight });
    video.onerror = () => resolve(undefined);
    video.src = url;
  });

/**
 * A version dragged onto the board: an ordinary image, video, prompt, page or audio shape
 * naming the same project file, carrying its sidecar as its result, so it is a result with its
 * recipe. The node is unchanged.
 */
export const dragOutVersion = async (input: { readonly editor: Editor; readonly project: string; readonly node: NodeShape; readonly version: NodeVersion; readonly at: VecLike }): Promise<TLShapeId | undefined> => {
  const { editor, project, node, version, at } = input;
  const medium = node.props.medium;
  const sidecarName = sidecarOf(version);
  const sidecar = await readSidecar(project, sidecarName);
  const result: ResultMeta = {
    sidecar: sidecarName ?? null,
    medium: nodeCatalogueOf(medium),
    model: typeof sidecar.model === "string" ? sidecar.model : node.props.model,
    batchId: version.batchId,
    runIndex: version.runIndex,
    runCount: Math.max(1, node.props.versions.filter((each) => each.batchId === version.batchId).length),
    cost: typeof sidecar.cost === "number" ? sidecar.cost : null,
    sources: [],
    ...(medium === "audio" ? { credits: typeof sidecar.credits === "number" ? sidecar.credits : null } : {}),
  };
  const meta = { unframed: { result: JSON.parse(JSON.stringify(result)) as Record<string, never> } };
  const id = createShapeId();
  const page = editor.getCurrentPageId();
  editor.markHistoryStoppingPoint("drag out version");
  if (medium === "text") {
    editor.createShape({ id, type: "text", parentId: page, x: at.x, y: at.y, props: { richText: toRichText(version.text ?? ""), w: MEDIA_WIDTH, autoSize: false }, meta });
  } else if (medium === "page") {
    if (version.file === undefined) return undefined;
    editor.createShape({ id, type: "page", parentId: page, x: at.x, y: at.y, props: { ...PAGE_SIZE, file: version.file, title: version.fileName && version.fileName !== version.file ? version.fileName : (node.meta.ref as string | undefined) ?? "Page", fileName: "" } });
  } else if (medium === "audio") {
    if (version.file === undefined) return undefined;
    editor.createShape({ id, type: "audio", parentId: page, x: at.x, y: at.y, props: { ...AUDIO_DEFAULT_SIZE, file: version.file, fileName: version.file }, meta });
  } else {
    if (version.file === undefined) return undefined;
    const size = (await naturalSize(fileUrl(project, version.file), medium)) ?? { w: 16, h: 9 };
    const assetId: TLAssetId = AssetRecordType.createId();
    editor.createAssets([
      {
        id: assetId,
        typeName: "asset",
        type: medium,
        props: { w: size.w, h: size.h, name: version.file, isAnimated: medium === "video", mimeType: medium === "video" ? "video/mp4" : "image/png", src: projectFileMarker(version.file) },
        meta: {},
      } as never,
    ]);
    const h = (MEDIA_WIDTH * size.h) / Math.max(1, size.w);
    editor.createShape({ id, type: medium, parentId: page, x: at.x, y: at.y, props: { w: MEDIA_WIDTH, h, assetId }, meta });
  }
  editor.select(id);
  return id;
};
