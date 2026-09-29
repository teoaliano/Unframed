import type { ChatAttachment } from "@unframed/contracts";
import { ATTACHMENT_LIMITS, attachmentLimitError, classifyAttachment } from "@unframed/domain";
import { useCallback, useMemo, useRef, useState } from "react";
import type { EngineConnection } from "../../rpc/engine.ts";

const MIB = 1024 * 1024;
const HEIC_SOURCE_LIMIT = 50 * MIB;
const HEIC_PIXEL_LIMIT = 64_000_000;

/** A file staged in the composer: it uploads as soon as it is staged, so Send only carries ids. */
export interface Staged {
  readonly key: string;
  readonly name: string;
  readonly kind: "image" | "file";
  readonly size: number;
  readonly file: File;
  readonly status: "uploading" | "ready" | "failed";
  readonly progress: number;
  readonly attachment?: ChatAttachment;
  readonly preview?: string;
}

export const tooLargeAfterCompression = (name: string) => `'${name}' is too large to attach, even after compression.`;

const isHeic = (file: File) => /\.(heic|heif)$/i.test(file.name) || /^image\/hei[cf]/i.test(file.type);

const renamed = (name: string, extension: string) => `${name.replace(/\.[^.]+$/, "")}${extension}`;

const decodedSize = async (blob: Blob): Promise<{ width: number; height: number } | undefined> => {
  try {
    const bitmap = await createImageBitmap(blob);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return undefined;
  }
};

/** Re-encodes an image smaller and smaller until it fits the per-image limit, or gives up. */
const downscale = async (file: File): Promise<File | undefined> => {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return undefined;
  }
  let scale = Math.min(1, Math.sqrt(ATTACHMENT_LIMITS.imageBytes / file.size));
  for (let attempt = 0; attempt < 8; attempt++, scale *= 0.8) {
    const canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)));
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.86 });
    if (blob.size <= ATTACHMENT_LIMITS.imageBytes) {
      bitmap.close();
      return new File([blob], renamed(file.name, ".jpg"), { type: "image/jpeg" });
    }
  }
  bitmap.close();
  return undefined;
};

/**
 * What the browser does to a file before it uploads (spec 08): HEIC and HEIF become JPEG
 * (a source over 50 MiB or 64 megapixels is too large), and an image over 10 MiB is
 * downscaled. Throws the sentence the rail shows when it cannot.
 */
export const prepareFile = async (file: File): Promise<File> => {
  let prepared = file;
  if (isHeic(file)) {
    if (file.size > HEIC_SOURCE_LIMIT) throw new Error(tooLargeAfterCompression(file.name));
    const { heicTo } = await import("heic-to");
    const jpeg = await heicTo({ blob: file, type: "image/jpeg", quality: 0.92 });
    const size = await decodedSize(jpeg);
    if (size && size.width * size.height > HEIC_PIXEL_LIMIT) throw new Error(tooLargeAfterCompression(file.name));
    prepared = new File([jpeg], renamed(file.name, ".jpg"), { type: "image/jpeg" });
  }
  const { kind } = classifyAttachment({ name: prepared.name, mimeType: prepared.type });
  if (kind === "image" && prepared.size > ATTACHMENT_LIMITS.imageBytes) {
    const smaller = await downscale(prepared);
    if (!smaller) throw new Error(tooLargeAfterCompression(file.name));
    prepared = smaller;
  }
  return prepared;
};

/** Uploads one file through spec 07's signed one-use path, reporting progress. */
const uploadFile = async (engine: EngineConnection, file: File, onProgress: (percent: number) => void): Promise<ChatAttachment> => {
  const { relativeUrl } = await engine.call("attachments.createUploadUrl", { name: file.name, mimeType: file.type, sizeBytes: file.size });
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", relativeUrl);
    request.setRequestHeader("content-type", file.type === "" ? "application/octet-stream" : file.type);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    request.onload = () => {
      try {
        const body = JSON.parse(request.responseText) as { attachment?: ChatAttachment; error?: unknown };
        if (request.status === 200 && body.attachment) resolve(body.attachment);
        else reject(new Error(typeof body.error === "string" ? body.error : `The upload failed (${request.status}).`));
      } catch {
        reject(new Error(`The upload failed (${request.status}).`));
      }
    };
    request.onerror = () => reject(new Error("The upload failed."));
    request.send(file);
  });
};

let counter = 0;

/**
 * The composer's staged attachments: limits checked before anything uploads (spec 07's
 * sentences, shown by `onError`), each file prepared and uploaded as it is staged, retry
 * and remove.
 */
export const useAttachments = (engine: EngineConnection, onError: (message: string) => void) => {
  const [staged, setStaged] = useState<ReadonlyArray<Staged>>([]);
  const current = useRef(staged);
  current.current = staged;
  const uploads = useRef(new Map<string, Promise<void>>());

  const update = useCallback((key: string, patch: Partial<Staged>) => setStaged((all) => all.map((item) => (item.key === key ? { ...item, ...patch } : item))), []);

  const start = useCallback(
    (item: Staged) => {
      const run = uploadFile(engine, item.file, (progress) => update(item.key, { progress }))
        .then((attachment) => update(item.key, { status: "ready", progress: 100, attachment }))
        .catch((error: unknown) => {
          update(item.key, { status: "failed" });
          onError(error instanceof Error ? error.message : String(error));
        })
        .finally(() => uploads.current.delete(item.key));
      uploads.current.set(item.key, run);
    },
    [engine, update, onError],
  );

  const add = useCallback(
    async (files: ReadonlyArray<File>) => {
      const prepared: File[] = [];
      for (const file of files) {
        try {
          prepared.push(await prepareFile(file));
        } catch (error) {
          onError(error instanceof Error ? error.message : String(error));
          return;
        }
      }
      const incoming = prepared.map((file): Staged => {
        const { kind } = classifyAttachment({ name: file.name, mimeType: file.type });
        return {
          key: `staged-${++counter}`,
          name: file.name,
          kind,
          size: file.size,
          file,
          status: "uploading",
          progress: 0,
          ...(kind === "image" ? { preview: URL.createObjectURL(file) } : {}),
        };
      });
      const refusal = attachmentLimitError([...current.current, ...incoming]);
      if (refusal) {
        for (const item of incoming) if (item.preview) URL.revokeObjectURL(item.preview);
        onError(refusal);
        return;
      }
      setStaged((all) => [...all, ...incoming]);
      for (const item of incoming) start(item);
    },
    [onError, start],
  );

  const remove = useCallback((key: string) => {
    setStaged((all) => {
      const gone = all.find((item) => item.key === key);
      if (gone?.preview) URL.revokeObjectURL(gone.preview);
      return all.filter((item) => item.key !== key);
    });
  }, []);

  const retry = useCallback(
    (key: string) => {
      const item = current.current.find((known) => known.key === key);
      if (!item) return;
      update(key, { status: "uploading", progress: 0 });
      start(item);
    },
    [start, update],
  );

  /** Waits for every upload in flight; answers the attachments that made it. */
  const settle = useCallback(async (): Promise<ChatAttachment[]> => {
    await Promise.all(uploads.current.values());
    return current.current.flatMap((item) => (item.attachment ? [item.attachment] : []));
  }, []);

  const clear = useCallback(() => setStaged([]), []);
  /** Puts attachments that were already uploaded back (Edit from here, a stash). */
  const restore = useCallback((attachments: ReadonlyArray<ChatAttachment>) => {
    setStaged(
      attachments.map((attachment) => ({
        key: `staged-${++counter}`,
        name: attachment.name,
        kind: attachment.kind,
        size: attachment.size,
        file: new File([], attachment.name),
        status: "ready",
        progress: 100,
        attachment,
      })),
    );
  }, []);

  return useMemo(() => ({ staged, add, remove, retry, settle, clear, restore }), [staged, add, remove, retry, settle, clear, restore]);
};

export const formatSize = (bytes: number): string =>
  bytes < 1024 ? `${bytes} B` : bytes < MIB ? `${(bytes / 1024).toFixed(1).replace(/\.0$/, "")} KB` : `${(bytes / MIB).toFixed(1).replace(/\.0$/, "")} MB`;
