import { isHttpsLink, linkedVideoName, VIDEO_FILE_LIMIT, VIDEO_LINK_MESSAGE, VIDEO_TOO_LARGE_MESSAGE } from "@unframed/domain";
import { AssetRecordType, type Editor, type TLAsset, type TLImageShape, type TLShapeId, type TLVideoAsset, type TLVideoShape } from "tldraw";

export type MediaKind = "image" | "video";
export type MediaShape = TLImageShape | TLVideoShape;

export const MEDIA_DEFAULT_SIZE: Record<MediaKind, { w: number; h: number }> = {
  image: { w: 240, h: 140 },
  video: { w: 240, h: 180 },
};
export const MEDIA_MIN_WIDTH = 140;
export const MEDIA_MAX_WIDTH = 900;
export const MEDIA_MIN_HEIGHT = 100;

/** A file or link Unframed refuses, with the sentence the person sees. */
export class MediaRefused extends Error {}

export const kindOfFile = (file: File): MediaKind | undefined =>
  file.type.startsWith("image/") ? "image" : file.type.startsWith("video/") ? "video" : undefined;

/** Refuses a clip over 25 MB before anything is uploaded. */
export const checkMediaFile = (kind: MediaKind, file: File): void => {
  if (kind === "video" && file.size > VIDEO_FILE_LIMIT) throw new MediaRefused(VIDEO_TOO_LARGE_MESSAGE);
};

/** Uploads a file through the asset store and answers its asset, created in the store. */
export const uploadMedia = async (editor: Editor, kind: MediaKind, file: File): Promise<TLAsset> => {
  checkMediaFile(kind, file);
  const asset = await editor.getAssetForExternalContent({ type: "file", file });
  if (!asset) throw new Error("that file is not an image or a video");
  if (!editor.getAsset(asset.id)) editor.createAssets([asset]);
  else editor.updateAssets([asset]);
  return asset;
};

/** The size of a media shape filled with `asset`: the width it had, the height of the asset's aspect. */
export const sizeForAsset = (width: number, asset: TLAsset): { w: number; h: number } => {
  const props = asset.props as { w?: number; h?: number };
  const ratio = props.w && props.h ? props.h / props.w : MEDIA_DEFAULT_SIZE.video.h / MEDIA_DEFAULT_SIZE.video.w;
  return { w: width, h: Math.max(1, width * ratio) };
};

/** Puts `asset` into the shape: its width stays, its height takes the new aspect. */
export const fillShape = (editor: Editor, shapeId: TLShapeId, asset: TLAsset): void => {
  const shape = editor.getShape<MediaShape>(shapeId);
  if (!shape) return;
  const size = sizeForAsset(shape.props.w, asset);
  editor.updateShape({
    id: shape.id,
    type: shape.type,
    props: { assetId: asset.id, ...size, ...(shape.type === "image" ? { crop: null } : {}) },
  } as MediaShape);
};

/** Empties a filled shape: it goes back to its empty state at the same width. The file stays on disk. */
export const emptyShape = (editor: Editor, shapeId: TLShapeId): void => {
  const shape = editor.getShape<MediaShape>(shapeId);
  if (!shape) return;
  const kind = shape.type as MediaKind;
  editor.updateShape({
    id: shape.id,
    type: shape.type,
    props: { assetId: null, h: MEDIA_DEFAULT_SIZE[kind].h, ...(kind === "image" ? { crop: null } : {}) },
  } as MediaShape);
};

const videoSize = (url: string): Promise<{ w: number; h: number } | undefined> =>
  new Promise((resolve) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    const done = (size: { w: number; h: number } | undefined) => {
      video.removeAttribute("src");
      video.load();
      resolve(size);
    };
    video.onloadedmetadata = () => done(video.videoWidth && video.videoHeight ? { w: video.videoWidth, h: video.videoHeight } : undefined);
    video.onerror = () => done(undefined);
    setTimeout(() => done(undefined), 5000);
    video.src = url;
  });

/** A video asset for an `https://` link, named by its last path segment. */
export const linkAsset = async (editor: Editor, url: string): Promise<TLVideoAsset> => {
  if (!isHttpsLink(url)) throw new MediaRefused(VIDEO_LINK_MESSAGE);
  const size = (await videoSize(url)) ?? { w: 1280, h: 720 };
  const asset = AssetRecordType.create({
    id: AssetRecordType.createId(),
    type: "video",
    props: { name: linkedVideoName(url), src: url, w: size.w, h: size.h, mimeType: null, isAnimated: true },
    meta: {},
  }) as TLVideoAsset;
  editor.createAssets([asset]);
  return asset;
};
