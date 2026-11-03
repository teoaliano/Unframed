import type { ChatAttachment } from "@unframed/contracts";
import { ATTACHMENT_LIMITS, attachmentLimitError, classifyAttachment, mergeRestored } from "@unframed/domain";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EngineConnection } from "../../rpc/engine.ts";
import type { CaretMark } from "./PromptEditor.tsx";

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
  /** The draft it was staged for: one switched away from while it uploads lands in that draft. */
  readonly owner?: string;
  /** Whether it goes into the text as a chip once uploaded (a paste or a drop into a prompt with text). */
  readonly chip?: boolean;
  /** Where that chip goes: the caret when it was pasted or dropped. */
  readonly at?: CaretMark;
}

export interface AttachmentEvents {
  /** An upload finished while the item is still staged here. */
  readonly onReady?: (item: Staged, attachment: ChatAttachment) => void;
  /** An upload finished after a switch took its draft away: it belongs to `owner`'s draft. */
  readonly onMoved?: (owner: string, attachment: ChatAttachment, chip: boolean) => void;
}

export interface AddOptions {
  readonly owner?: string;
  readonly chip?: boolean;
  readonly at?: CaretMark;
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

/** The engine serves a stored image back by id: a draft restored after a reload or from the stash has no file of its own to show. */
const storedPreview = (attachment: ChatAttachment) => (attachment.kind === "image" ? `/api/attachments/${encodeURIComponent(attachment.id)}` : undefined);

const stagedOf = (attachment: ChatAttachment, preview = storedPreview(attachment)): Staged => ({
  key: `staged-${++counter}`,
  name: attachment.name,
  kind: attachment.kind,
  size: attachment.size,
  file: new File([], attachment.name),
  status: "ready",
  progress: 100,
  attachment,
  ...(preview !== undefined ? { preview } : {}),
});

/**
 * The composer's staged attachments: limits checked before anything uploads (spec 07's
 * sentences, shown by `onError`), each file prepared and uploaded as it is staged, retry
 * and remove.
 */
export const useAttachments = (engine: EngineConnection, onError: (message: string) => void, events: AttachmentEvents = {}) => {
  const [staged, setStaged] = useState<ReadonlyArray<Staged>>([]);
  const current = useRef(staged);
  current.current = staged;
  const uploads = useRef(new Map<string, Promise<void>>());
  const latestEvents = useRef(events);
  latestEvents.current = events;
  /** Items a switch took away while they uploaded, by key, with the draft they belong to. */
  const moved = useRef(new Map<string, Staged>());
  /** Each uploaded image's thumbnail, by attachment id, kept while the tray is mounted so a chat switched back to still shows it. */
  const previews = useRef(new Map<string, string>());
  useEffect(
    () => () => {
      for (const url of previews.current.values()) URL.revokeObjectURL(url);
    },
    [],
  );
  const restored = useCallback((attachments: ReadonlyArray<ChatAttachment>) => attachments.map((attachment) => stagedOf(attachment, previews.current.get(attachment.id))), []);

  const setAll = useCallback((next: ReadonlyArray<Staged>) => {
    current.current = next;
    setStaged(next);
  }, []);
  const update = useCallback(
    (key: string, patch: Partial<Staged>) => setAll(current.current.map((item) => (item.key === key ? { ...item, ...patch } : item))),
    [setAll],
  );

  const start = useCallback(
    (item: Staged) => {
      const run = uploadFile(engine, item.file, (progress) => update(item.key, { progress }))
        .then((attachment) => {
          const away = moved.current.get(item.key);
          moved.current.delete(item.key);
          if (away?.owner !== undefined) {
            if (away.preview !== undefined) previews.current.set(attachment.id, away.preview);
            return latestEvents.current.onMoved?.(away.owner, attachment, away.chip === true);
          }
          const here = current.current.find((known) => known.key === item.key);
          if (!here) return;
          if (here.preview !== undefined) previews.current.set(attachment.id, here.preview);
          update(item.key, { status: "ready", progress: 100, attachment });
          latestEvents.current.onReady?.(here, attachment);
        })
        .catch((error: unknown) => {
          if (moved.current.delete(item.key)) return;
          update(item.key, { status: "failed" });
          onError(error instanceof Error ? error.message : String(error));
        })
        .finally(() => uploads.current.delete(item.key));
      uploads.current.set(item.key, run);
    },
    [engine, update, onError],
  );

  const add = useCallback(
    async (files: ReadonlyArray<File>, options: AddOptions = {}) => {
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
          ...(options.owner !== undefined ? { owner: options.owner } : {}),
          ...(options.chip === true ? { chip: true, ...(options.at !== undefined ? { at: options.at } : {}) } : {}),
        };
      });
      const refusal = attachmentLimitError([...current.current, ...incoming]);
      if (refusal) {
        for (const item of incoming) if (item.preview) URL.revokeObjectURL(item.preview);
        onError(refusal);
        return;
      }
      setAll([...current.current, ...incoming]);
      for (const item of incoming) start(item);
    },
    [onError, start, setAll],
  );

  const remove = useCallback(
    (key: string) => {
      const gone = current.current.find((item) => item.key === key);
      if (gone?.preview && gone.attachment === undefined) URL.revokeObjectURL(gone.preview);
      setAll(current.current.filter((item) => item.key !== key));
    },
    [setAll],
  );

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

  const clear = useCallback(() => setAll([]), [setAll]);
  /** The attachments uploaded so far, read now rather than at the last render. */
  const ready = useCallback(() => current.current.flatMap((item) => (item.attachment ? [item.attachment] : [])), []);
  /**
   * Adds attachments that were already uploaded back (Edit from here, a stash), after those
   * staged; one staged already, by name, size and kind, is not added twice.
   */
  const restore = useCallback(
    (attachments: ReadonlyArray<ChatAttachment>) => setAll(mergeRestored(current.current, restored(attachments), (item) => `${item.kind}\u0000${item.size}\u0000${item.name}`)),
    [setAll, restored],
  );
  /**
   * Shows another draft's attachments in place of these (a chat switch). One still uploading
   * lands in the draft it was staged for once it is done.
   */
  const replace = useCallback(
    (attachments: ReadonlyArray<ChatAttachment>) => {
      for (const item of current.current) {
        if (item.status === "uploading" && item.owner !== undefined) moved.current.set(item.key, item);
        else if (item.preview && item.attachment === undefined) URL.revokeObjectURL(item.preview);
      }
      setAll(restored(attachments));
    },
    [setAll, restored],
  );

  return useMemo(() => ({ staged, add, remove, retry, settle, clear, restore, replace, ready }), [staged, add, remove, retry, settle, clear, restore, replace, ready]);
};

export const formatSize = (bytes: number): string =>
  bytes < 1024 ? `${bytes} B` : bytes < MIB ? `${(bytes / 1024).toFixed(1).replace(/\.0$/, "")} KB` : `${(bytes / MIB).toFixed(1).replace(/\.0$/, "")} MB`;
