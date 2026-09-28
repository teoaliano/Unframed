/**
 * Makes an image's display previews off the main thread: WebP at longest side 512 and
 * 2048, never larger than the original, uploaded into the project's cache folder.
 */
export interface PreviewRequest {
  readonly id: number;
  readonly project: string;
  readonly file: string;
  readonly sizes: ReadonlyArray<number>;
}

export interface PreviewResult {
  readonly id: number;
  /** The sizes now in the cache. */
  readonly made: number[];
  /** The original's longest side, when it could be decoded. */
  readonly longest?: number;
  readonly error?: string;
}

const fileUrl = (project: string, file: string) => `/api/file/${encodeURIComponent(project)}/${encodeURIComponent(file)}`;

const make = async ({ id, project, file, sizes }: PreviewRequest): Promise<PreviewResult> => {
  const response = await fetch(fileUrl(project, file));
  if (!response.ok) return { id, made: [], error: `the original answered ${response.status}` };
  const blob = await response.blob();
  const original = await createImageBitmap(blob);
  const longest = Math.max(original.width, original.height);
  const made: number[] = [];
  for (const size of sizes) {
    if (longest <= size) continue;
    const scale = size / longest;
    const width = Math.max(1, Math.round(original.width * scale));
    const height = Math.max(1, Math.round(original.height * scale));
    const bitmap = await createImageBitmap(original, { resizeWidth: width, resizeHeight: height, resizeQuality: "high" });
    const canvas = new OffscreenCanvas(width, height);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
    bitmap.close();
    const webp = await canvas.convertToBlob({ type: "image/webp", quality: 0.86 });
    const upload = await fetch(
      `/api/projects/${encodeURIComponent(project)}/files?name=${encodeURIComponent(file)}&preview=${size}`,
      { method: "POST", body: webp, headers: { "content-type": "image/webp" } },
    );
    if (upload.ok) made.push(size);
  }
  original.close();
  return { id, made, longest };
};

// One image at a time: a board of large originals would otherwise decode them all at once.
let queue: Promise<unknown> = Promise.resolve();

self.onmessage = (event: MessageEvent<PreviewRequest>) => {
  queue = queue.then(() =>
    make(event.data).then(
      (result) => self.postMessage(result),
      (error: unknown) => self.postMessage({ id: event.data.id, made: [], error: String(error) } satisfies PreviewResult),
    ),
  );
};
