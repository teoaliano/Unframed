import { parseAssetMarker, projectFileMarker } from "@unframed/contracts";
import { pastedFileName } from "@unframed/domain";
import type { TLAsset, TLAssetContext, TLAssetStore } from "tldraw";
import type { PreviewRequest, PreviewResult } from "./previews.worker.ts";

export const fileUrl = (project: string, file: string): string =>
  `/api/file/${encodeURIComponent(project)}/${encodeURIComponent(file)}`;

export const previewUrl = (project: string, file: string, size: number): string => `${fileUrl(project, file)}?preview=${size}`;

/**
 * The asset URL check tldraw hands every asset URL to: exactly the three asset markers
 * (a project file, an https link, a preset pointer) and nothing else.
 */
export const isAssetMarker = (url: string): boolean => parseAssetMarker(url) !== undefined;

const PREVIEW_SIZES = [512, 2048] as const;
/** Raster types a worker can decode and scale. Animated and vector images keep their original. */
const PREVIEWABLE = new Set(["image/png", "image/jpeg", "image/webp", "image/avif"]);

export class UploadFailed extends Error {}

/** What an upload answered. */
export interface Uploaded {
  readonly file: string;
  readonly fileName: string;
  readonly bytes: number;
  readonly mime: string;
}

/** Sends bytes to the engine's upload route. Rejects with the route's own message. */
export const uploadFile = async (project: string, file: Blob, name: string, signal?: AbortSignal): Promise<Uploaded> => {
  const response = await fetch(`/api/projects/${encodeURIComponent(project)}/files?name=${encodeURIComponent(name)}`, {
    method: "POST",
    body: file,
    headers: { "content-type": file.type || "application/octet-stream" },
    ...(signal === undefined ? {} : { signal }),
  });
  const answer = (await response.json().catch(() => ({}))) as Partial<Uploaded> & { error?: string };
  if (!response.ok || typeof answer.file !== "string") {
    throw new UploadFailed(answer.error ?? `The engine answered ${response.status}.`);
  }
  return answer as Uploaded;
};

/**
 * Display previews of the project's images, made off the main thread. The first time an
 * image is shown the store learns which previews exist, and makes them when none do.
 */
export class Previews {
  private readonly known = new Map<string, Promise<ReadonlySet<number>>>();
  private worker: Worker | undefined;
  private nextId = 0;
  private readonly waiting = new Map<number, (result: PreviewResult) => void>();
  private readonly project: string;

  constructor(project: string) {
    this.project = project;
  }

  private post(file: string): Promise<PreviewResult> {
    this.worker ??= this.startWorker();
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.waiting.set(id, resolve);
      this.worker!.postMessage({ id, project: this.project, file, sizes: [...PREVIEW_SIZES] } satisfies PreviewRequest);
    });
  }

  private startWorker(): Worker {
    const worker = new Worker(new URL("./previews.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<PreviewResult>) => {
      this.waiting.get(event.data.id)?.(event.data);
      this.waiting.delete(event.data.id);
    };
    return worker;
  }

  /** Makes the previews of an image. Until they exist, the image shows its original. */
  make(file: string): Promise<ReadonlySet<number>> {
    this.known.set(file, Promise.resolve(new Set<number>()));
    const made = this.post(file).then((result) => new Set(result.made) as ReadonlySet<number>);
    void made.then((sizes) => this.known.set(file, Promise.resolve(sizes)));
    return made;
  }

  /**
   * The preview sizes that exist for `file`. When none do, they are made in the background
   * and this answers none, so the image shows its original until they exist.
   */
  available(file: string): Promise<ReadonlySet<number>> {
    const cached = this.known.get(file);
    if (cached) return cached;
    const found = (async () => {
      const present = new Set<number>();
      await Promise.all(
        PREVIEW_SIZES.map(async (size) => {
          const response = await fetch(previewUrl(this.project, file, size), { method: "HEAD" }).catch(() => undefined);
          if (response?.ok) present.add(size);
        }),
      );
      if (present.size === 0) void this.make(file);
      return present;
    })();
    this.known.set(file, found);
    return found;
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = undefined;
  }
}

const longestSide = (asset: TLAsset): number => {
  const props = asset.props as { w?: number; h?: number };
  return Math.max(props.w ?? 0, props.h ?? 0);
};

/**
 * The asset store over project files. Upload sends the bytes to the engine and answers the
 * file marker; resolve turns a marker into a URL of the active project, picking the
 * smallest display preview that covers the shape's size on screen, and the original for
 * copies and exports.
 */
export const createAssetStore = (project: string, previews: Previews): TLAssetStore => ({
  async upload(asset, file, abortSignal) {
    const kind = asset.type === "video" ? "video" : "image";
    const name = file.name || pastedFileName(kind, file.type);
    const saved = await uploadFile(project, file, name, abortSignal);
    if (kind === "image" && PREVIEWABLE.has(saved.mime)) void previews.make(saved.file);
    return { src: projectFileMarker(saved.file) };
  },

  async resolve(asset: TLAsset, ctx: TLAssetContext) {
    const src = (asset.props as { src?: string | null }).src;
    if (!src) return null;
    if (src.startsWith("data:") || src.startsWith("blob:")) return src;
    const marker = parseAssetMarker(src);
    if (!marker) return null;
    if (marker.kind === "link") return marker.url;
    if (marker.kind === "preset-file") return null;
    const original = fileUrl(project, marker.file);
    const mime = (asset.props as { mimeType?: string | null }).mimeType ?? "";
    if (asset.type !== "image" || ctx.shouldResolveToOriginal || !PREVIEWABLE.has(mime)) return original;
    const needed = longestSide(asset) * ctx.screenScale * ctx.dpr;
    if (needed > 2048) return original;
    const available = await previews.available(marker.file);
    const target = PREVIEW_SIZES.find((size) => size >= needed && available.has(size));
    return target === undefined ? original : previewUrl(project, marker.file, target);
  },
});
