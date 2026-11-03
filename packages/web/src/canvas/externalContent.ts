import { parseAssetMarker, projectFileMarker, UnframedError } from "@unframed/contracts";
import { isVideoLink, META_REF_TYPES, pastedFileName, readRef, refOnPaste, rewriteRichTextTokens, VIDEO_FILE_LIMIT, VIDEO_TOO_LARGE_MESSAGE } from "@unframed/domain";
import {
  AssetRecordType,
  createShapeId,
  toRichText,
  type Editor,
  type TLAsset,
  type TLContent,
  type TLExternalContent,
  type TLShape,
  type TLShapeId,
  type TldrawOptions,
  type VecLike,
} from "tldraw";
import type { EngineConnection } from "../rpc/engine.ts";
import { showError } from "../toasts.tsx";
import { fileUrl, uploadFile } from "./assetStore.ts";
import { fillShape, linkAsset, MEDIA_DEFAULT_SIZE, MediaRefused, sizeForAsset, type MediaKind, type MediaShape } from "./media.ts";
import type { RefMinter } from "./refs.ts";
import { ARTIFACT_DEFAULT_SIZE } from "./shapes/artifact.tsx";
import { setProblem } from "../artifacts/state.ts";

export interface ContentContext {
  readonly project: string;
  readonly engine: EngineConnection;
  readonly minter: RefMinter;
}

type UnframedContent = TLContent & { unframedProject?: string };

const MULTI_DROP_OFFSET = 24;

const messageOf = (error: unknown) => (error instanceof UnframedError || error instanceof Error ? error.message : String(error));

type DroppedKind = MediaKind | "page";

const kindOf = (file: File): DroppedKind | undefined => {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type === "text/html" || /\.html?$/i.test(file.name)) return "page";
  return undefined;
};

const withoutExtension = (name: string) => name.replace(/\.[^.]*$/, "");

const uploadMediaFile = async (editor: Editor, kind: MediaKind, file: File): Promise<TLAsset> => {
  if (kind === "video" && file.size > VIDEO_FILE_LIMIT) throw new MediaRefused(VIDEO_TOO_LARGE_MESSAGE);
  const util = editor.getAssetUtilForMimeType(file.type);
  if (!util) throw new Error(`${file.type || "this type"} is not a picture or clip the canvas can show`);
  const asset = await util.getAssetFromFile(file, AssetRecordType.createId());
  if (!asset) throw new Error("the file could not be read");
  const uploaded = await editor.uploadAsset(asset, file);
  const done = { ...asset, props: { ...asset.props, src: uploaded.src }, meta: { ...asset.meta, ...uploaded.meta } } as TLAsset;
  editor.createAssets([done]);
  return done;
};

const centred = (point: VecLike, size: { w: number; h: number }) => ({ x: point.x - size.w / 2, y: point.y - size.h / 2 });

const createMediaShape = (editor: Editor, kind: MediaKind, asset: TLAsset, point: VecLike): TLShapeId => {
  const id = createShapeId();
  const size = sizeForAsset(MEDIA_DEFAULT_SIZE[kind].w, asset);
  editor.createShape({ id, type: kind, ...centred(point, size), props: { assetId: asset.id, ...size } } as TLShape);
  return id;
};

const createPage = (editor: Editor, file: string, fileName: string, point: VecLike): TLShapeId => {
  const id = createShapeId();
  editor.createShape({
    id,
    type: "page",
    ...centred(point, ARTIFACT_DEFAULT_SIZE),
    props: { ...ARTIFACT_DEFAULT_SIZE, file, fileName, title: withoutExtension(fileName) },
  } as TLShape);
  return id;
};

const addFile = async (editor: Editor, ctx: ContentContext, file: File, kind: DroppedKind, point: VecLike, failure: string) => {
  try {
    if (kind === "page") {
      const saved = await uploadFile(ctx.project, file, file.name || "page.html");
      editor.markHistoryStoppingPoint("add page");
      return createPage(editor, saved.file, file.name, point);
    }
    const asset = await uploadMediaFile(editor, kind, file);
    editor.markHistoryStoppingPoint("add media");
    return createMediaShape(editor, kind, asset, point);
  } catch (error) {
    if (error instanceof MediaRefused) showError(error.message);
    else showError(`${failure} ${file.name || `that ${kind}`}: ${messageOf(error)}`);
    return undefined;
  }
};

const replaceArtifactFile = async (editor: Editor, ctx: ContentContext, target: TLShape, file: File) => {
  setProblem(editor, target.id, undefined);
  try {
    const saved =
      target.type === "motion"
        ? await ctx.engine.call("motion.upload", { project: ctx.project, fileName: file.name, html: await file.text() })
        : await uploadFile(ctx.project, file, file.name || "page.html");
    const shape = editor.getShape(target.id);
    if (!shape) return;
    const props = shape.props as { title: string };
    editor.markHistoryStoppingPoint(`replace ${shape.type}`);
    editor.updateShape({
      id: shape.id,
      type: shape.type,
      props: { file: saved.file, fileName: saved.fileName, title: props.title !== "" ? props.title : withoutExtension(saved.fileName) },
    } as TLShape);
  } catch (error) {
    setProblem(editor, target.id, `Could not add ${file.name || "that file"}: ${messageOf(error)}`);
  }
};

const handleDrop = async (editor: Editor, ctx: ContentContext, files: ReadonlyArray<File>, point: VecLike) => {
  const [only] = files;
  if (files.length === 1 && only) {
    const target = editor.getShapeAtPoint(point, { hitInside: true, hitFrameInside: false });
    const kind = kindOf(only);
    if (target && (target.type === "page" || target.type === "motion") && kind === "page") return replaceArtifactFile(editor, ctx, target, only);
    if (target && (target.type === "image" || target.type === "video") && kind === target.type) {
      try {
        const asset = await uploadMediaFile(editor, kind, only);
        editor.markHistoryStoppingPoint("replace media");
        fillShape(editor, target.id, asset);
      } catch (error) {
        showError(error instanceof MediaRefused ? error.message : `Could not add ${only.name}: ${messageOf(error)}`);
      }
      return;
    }
  }
  let placed = 0;
  await Promise.all(
    files.map((file) => {
      const kind = kindOf(file);
      if (!kind) return undefined;
      const at = { x: point.x + placed * MULTI_DROP_OFFSET, y: point.y + placed * MULTI_DROP_OFFSET };
      placed++;
      if (kind === "video" && file.size > VIDEO_FILE_LIMIT) {
        showError(VIDEO_TOO_LARGE_MESSAGE);
        return undefined;
      }
      return addFile(editor, ctx, file, kind, at, "Could not add");
    }),
  );
};

const named = (file: File, kind: MediaKind): File =>
  file.name === "" || file.name === "tldrawFile" ? new File([file], pastedFileName(kind, file.type), { type: file.type }) : file;

const selectedOfKind = (editor: Editor, kind: MediaKind) =>
  editor.getSelectedShapes().filter((shape): shape is MediaShape => shape.type === kind);

const pasteFiles = async (editor: Editor, ctx: ContentContext, files: ReadonlyArray<File>, point: VecLike = editor.inputs.getCurrentPagePoint()) => {
  let placed = 0;
  for (const pastedFile of files) {
    const kind = kindOf(pastedFile);
    if (kind !== "image" && kind !== "video") continue;
    const file = named(pastedFile, kind);
    const targets = selectedOfKind(editor, kind);
    if (targets.length === 0) {
      const at = { x: point.x + placed * MULTI_DROP_OFFSET, y: point.y + placed * MULTI_DROP_OFFSET };
      placed++;
      const id = await addFile(editor, ctx, file, kind, at, "Could not paste");
      if (id) editor.select(id);
      continue;
    }
    try {
      const asset = await uploadMediaFile(editor, kind, file);
      editor.markHistoryStoppingPoint("paste media");
      for (const target of targets) fillShape(editor, target.id, asset);
    } catch (error) {
      showError(error instanceof MediaRefused ? error.message : `Could not paste ${file.name || `that ${kind}`}: ${messageOf(error)}`);
    }
  }
};

const handleText = async (editor: Editor, text: string, point: VecLike) => {
  const trimmed = text.trim();
  if (trimmed === "") return;
  if (isVideoLink(trimmed)) {
    try {
      const asset = await linkAsset(editor, trimmed);
      const targets = selectedOfKind(editor, "video");
      editor.markHistoryStoppingPoint("paste link");
      if (targets.length > 0) for (const target of targets) fillShape(editor, target.id, asset);
      else editor.select(createMediaShape(editor, "video", asset, point));
    } catch (error) {
      showError(`Could not paste ${trimmed}: ${messageOf(error)}`);
    }
    return;
  }
  const id = createShapeId();
  editor.markHistoryStoppingPoint("paste text");
  editor.createShape({ id, type: "text", x: point.x, y: point.y, props: { richText: toRichText(trimmed) } } as TLShape);
  editor.select(id);
};

const fixUpPastedShapes = async (editor: Editor, ctx: ContentContext, pasted: UnframedContent): Promise<TLContent> => {
  const content = structuredClone(pasted) as UnframedContent;
  const source = content.unframedProject ?? ctx.project;
  delete content.unframedProject;

  const copy = async (file: string) => (await ctx.engine.call("files.copy", { project: ctx.project, file, from: source })).file;

  const failedComponents = new Set<TLShape>();
  for (const shape of content.shapes) {
    if (shape.type === "component") {
      const props = shape.props as { file: string; tag: string };
      try {
        const copied = await ctx.engine.call("component.copy", { project: ctx.project, file: props.file, from: source });
        props.file = copied.file;
        props.tag = copied.tag;
      } catch (error) {
        failedComponents.add(shape as TLShape);
        showError(`Could not copy the component's file: ${messageOf(error)}`);
      }
      continue;
    }
    if (shape.type !== "page" && shape.type !== "motion") continue;
    const props = shape.props as { file: string };
    if (props.file === "") continue;
    try {
      props.file = await copy(props.file);
    } catch (error) {
      props.file = "";
      showError(`Could not copy the ${shape.type}'s file: ${messageOf(error)}`);
    }
  }
  if (failedComponents.size > 0) content.shapes = content.shapes.filter((shape) => !failedComponents.has(shape as TLShape));

  if (source !== ctx.project) {
    const kept: TLAsset[] = [];
    for (const asset of content.assets) {
      const marker = parseAssetMarker(String((asset.props as { src?: string | null }).src ?? ""));
      if (marker?.kind !== "project-file") {
        kept.push(asset);
        continue;
      }
      try {
        kept.push({ ...asset, id: AssetRecordType.createId(), props: { ...asset.props, src: projectFileMarker(await copy(marker.file)) } } as TLAsset);
      } catch (error) {
        showError(`Could not copy the ${asset.type}'s file: ${messageOf(error)}`);
        kept.push({ ...asset, id: AssetRecordType.createId(), props: { ...asset.props, src: null } } as TLAsset);
      }
    }
    const renamed = new Map(content.assets.map((asset, index) => [asset.id, kept[index]!]));
    for (const shape of content.shapes) {
      const props = shape.props as { assetId?: string | null };
      const next = props.assetId ? renamed.get(props.assetId as TLAsset["id"]) : undefined;
      if (!next) continue;
      props.assetId = (next.props as { src?: string | null }).src ? next.id : null;
    }
    content.assets = kept.filter((asset) => (asset.props as { src?: string | null }).src);
    await copyRecipes(ctx, source, content);
  }

  const ids = new Map<string, string>();
  const taken = new Set(editor.getCurrentPageShapes().flatMap((shape) => readRef(shape) ?? []));
  const mint = () => ctx.minter.mint();
  for (const shape of content.shapes) {
    if (META_REF_TYPES.has(shape.type)) {
      const meta = shape.meta as { ref?: string };
      const ref = typeof meta.ref === "string" ? meta.ref : undefined;
      const fresh = refOnPaste(ref, taken, mint);
      taken.add(fresh);
      if (ref !== undefined) ids.set(ref, fresh);
      shape.meta = { ...shape.meta, ref: fresh };
    } else if (shape.type === "frame") {
      const props = shape.props as { name: string };
      const fresh = refOnPaste(props.name, taken, mint);
      taken.add(fresh);
      if (props.name !== "") ids.set(props.name, fresh);
      props.name = fresh;
    }
  }
  for (const shape of content.shapes) {
    if (shape.type !== "text") continue;
    const props = shape.props as { richText: unknown };
    props.richText = rewriteRichTextTokens(props.richText, ids);
  }
  return content;
};

const copyRecipes = async (ctx: ContentContext, source: string, content: TLContent) => {
  const byId = new Map(content.assets.map((asset) => [asset.id as string, asset]));
  for (const shape of content.shapes) {
    const meta = shape.meta as { unframed?: { result?: { sidecar?: unknown } } };
    const result = meta.unframed?.result;
    if (!result || typeof result.sidecar !== "string") continue;
    const assetId = (shape.props as { assetId?: string | null }).assetId;
    const marker = parseAssetMarker(String((assetId ? byId.get(assetId)?.props as { src?: string | null } | undefined : undefined)?.src ?? ""));
    try {
      const file = shape.type === "text" ? result.sidecar : marker?.kind === "project-file" ? marker.file : undefined;
      if (file === undefined) throw new Error("the result has no picture here");
      const copied = await ctx.engine.call("recipe.copy", { project: ctx.project, from: source, sidecar: result.sidecar, file });
      shape.meta = { ...shape.meta, unframed: { ...meta.unframed, result: { ...result, sidecar: copied.sidecar } } };
    } catch (error) {
      const { result: _result, ...rest } = meta.unframed ?? {};
      shape.meta = { ...shape.meta, unframed: rest };
      showError(`Could not copy the result's recipe: ${messageOf(error)}`);
    }
  }
};

export const installExternalContent = (editor: Editor, ctx: ContentContext): void => {
  editor.registerExternalContentHandler("files", async ({ files, point }) =>
    handleDrop(editor, ctx, files, point ?? editor.getViewportPageBounds().center),
  );
  editor.registerExternalContentHandler("file-replace", async ({ file, shapeId }) => {
    const shape = editor.getShape(shapeId);
    const kind = kindOf(file);
    if (!shape || (kind !== "image" && kind !== "video") || shape.type !== kind) return;
    try {
      fillShape(editor, shape.id, await uploadMediaFile(editor, kind, file));
    } catch (error) {
      showError(error instanceof MediaRefused ? error.message : `Could not add ${file.name}: ${messageOf(error)}`);
    }
  });
  editor.registerExternalContentHandler("text", async ({ text, point }) => handleText(editor, text, point ?? editor.inputs.getCurrentPagePoint()));
  editor.registerExternalContentHandler("url", async ({ url, point }) => handleText(editor, url, point ?? editor.inputs.getCurrentPagePoint()));
  editor.registerExternalContentHandler("embed", () => undefined);
};

export const clipboardOptions = (ctx: Pick<ContentContext, "project"> & { readonly context: () => ContentContext | undefined }): Partial<TldrawOptions> => ({
  onBeforePasteFromClipboard: async ({ editor, content }: { editor: Editor; content: TLExternalContent<unknown> }) => {
    const current = ctx.context();
    if (!current) return undefined;
    switch (content.type) {
      case "files": {
        const shapes = content.sources?.find((source) => source.type === "tldraw");
        if (shapes?.type === "tldraw") {
          return { type: "tldraw", content: await fixUpPastedShapes(editor, current, shapes.data as UnframedContent) };
        }
        await pasteFiles(editor, current, content.files, content.point);
        return false;
      }
      case "text":
        await handleText(editor, content.text, content.point ?? editor.inputs.getCurrentPagePoint());
        return false;
      case "url":
        await handleText(editor, content.url, content.point ?? editor.inputs.getCurrentPagePoint());
        return false;
      case "embed":
        return false;
      case "tldraw":
        return { ...content, content: await fixUpPastedShapes(editor, current, content.content) };
      default:
        return undefined;
    }
  },
  onBeforeCopyToClipboard: ({ editor, content }: { editor: Editor; content: TLContent }) => {
    const assets = content.assets.map((asset) => {
      const stored = editor.getAsset(asset.id);
      return stored ? ({ ...asset, props: { ...asset.props, src: (stored.props as { src?: string | null }).src ?? null } } as TLAsset) : asset;
    });
    const images = content.shapes.filter((shape) => shape.type === "image" && (shape.props as { assetId?: string | null }).assetId);
    const [image] = images;
    if (images.length === 1 && image) {
      const png = imagePng(editor, ctx.project, image);
      if (png) addPngToNextClipboardWrite(png);
    }
    return { ...content, assets, unframedProject: ctx.project } as TLContent;
  },
});

export const imagePng = (editor: Editor, project: string, shape: TLShape): Promise<Blob> | undefined => {
  const assetId = (shape.props as { assetId?: TLAsset["id"] | null }).assetId;
  const asset = assetId ? editor.getAsset(assetId) : undefined;
  const marker = parseAssetMarker(String((asset?.props as { src?: string | null } | undefined)?.src ?? ""));
  if (marker?.kind !== "project-file") return undefined;
  return (async () => {
    const response = await fetch(fileUrl(project, marker.file));
    if (!response.ok) throw new Error(`the file answered ${response.status}`);
    const bitmap = await createImageBitmap(await response.blob());
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
    bitmap.close();
    return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("no PNG"))), "image/png"));
  })();
};

const addPngToNextClipboardWrite = (png: Promise<Blob>) => {
  const clipboard = navigator.clipboard as Clipboard & { write: Clipboard["write"] };
  if (!clipboard?.write) return;
  const original = clipboard.write;
  const restore = () => {
    if (clipboard.write !== original) clipboard.write = original;
  };
  clipboard.write = (items: ClipboardItems) => {
    restore();
    const [first, ...rest] = items;
    if (!first) return original.call(clipboard, items);
    const parts: Record<string, Promise<Blob>> = {};
    for (const type of first.types) parts[type] = first.getType(type);
    parts["image/png"] = png;
    return original.call(clipboard, [new ClipboardItem(parts), ...rest]);
  };
  setTimeout(restore, 2000);
};
