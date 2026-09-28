import { randomUUID } from "node:crypto";
import { existsSync, renameSync, writeFileSync } from "node:fs";
import { copyFile, mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { isBareFileName, projectFileMarker, UnframedError, unframedError } from "@unframed/contracts";
import {
  copyFileName,
  mediaFileName,
  projectSlug,
  sidecarFileName,
  sidecarText,
  UPLOAD_BODY_LIMIT,
  type MediaSidecar,
  type PreviewSize,
  type RenderedSidecar,
} from "@unframed/domain";
import type { TLAsset, TLRecord } from "@tldraw/tlschema";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { CanvasRooms, type CommittedChange } from "../canvas/rooms.ts";
import { errorText, logError } from "../log.ts";
import { SettingsStore } from "../settingsStore.ts";

/** What the upload route answers. */
export interface SavedFile {
  readonly file: string;
  readonly fileName: string;
  readonly bytes: number;
  readonly mime: string;
}

/** The only preview sizes: WebP at longest side 512 and 2048. */

export const PREVIEW_FOLDER = join(".cache", "previews");

/** A preview's name in the cache folder. */
export const previewFileName = (file: string, size: PreviewSize): string => `${file}-${size}.webp`;

/** Why a save was refused: the route maps each to its status. */
export class SaveRefused extends Error {
  readonly status: 400 | 404 | 413 | 500;
  constructor(status: 400 | 404 | 413 | 500, message: string) {
    super(message);
    this.status = status;
  }
}

export const EMPTY_BODY_MESSAGE = "No file bytes in the request body.";

/**
 * Project media files: saves uploaded bytes as a project file with a sidecar, copies a
 * file within or across projects, and rewrites any data URL that reaches a room into a
 * file (a blob URL, which cannot be recovered, loses its source).
 */
export class MediaStore extends Context.Service<
  MediaStore,
  {
    /** Streams `body` into a new project file and writes its sidecar. Rejects with `SaveRefused`. */
    readonly save: (
      project: string,
      input: { originalName: string; mime: string; body: AsyncIterable<Buffer>; rendered?: RenderedSidecar | undefined },
    ) => Promise<SavedFile>;
    /** Writes a regenerable display preview of `file` into the cache folder. No sidecar. */
    readonly savePreview: (project: string, file: string, size: PreviewSize, body: AsyncIterable<Buffer>) => Promise<{ bytes: number }>;
    readonly copy: (project: string, file: string, from?: string) => Effect.Effect<string, UnframedError>;
    /** The absolute project folder, when the project exists. */
    readonly folder: (project: string) => Promise<string | undefined>;
  }
>()("unframed/engine/MediaStore") {}

const isDirectory = (path: string) =>
  stat(path).then(
    (info) => info.isDirectory(),
    () => false,
  );

const DATA_URL = /^data:([^,]*?),(.*)$/s;

const decodeDataUrl = (url: string): { mime: string; bytes: Buffer } | undefined => {
  const match = DATA_URL.exec(url);
  if (!match) return undefined;
  const header = match[1] ?? "";
  const payload = match[2] ?? "";
  const base64 = /;base64$/i.test(header);
  const mime = (base64 ? header.slice(0, -";base64".length) : header).split(";")[0]?.trim() || "application/octet-stream";
  try {
    return { mime, bytes: base64 ? Buffer.from(payload, "base64") : Buffer.from(decodeURIComponent(payload), "utf8") };
  } catch {
    return undefined;
  }
};

async function* once(bytes: Buffer): AsyncIterable<Buffer> {
  yield bytes;
}

export const mediaStoreLayer = Layer.effect(
  MediaStore,
  Effect.gen(function* () {
    const settings = yield* SettingsStore;
    const rooms = yield* CanvasRooms;
    const context = yield* Effect.context<never>();
    const runPromise = Effect.runPromiseWith(context);

    const folder = async (project: string): Promise<string | undefined> => {
      const slug = projectSlug(project);
      if (slug === "") return undefined;
      const path = join(await runPromise(settings.outputDir), slug);
      return (await isDirectory(path)) ? path : undefined;
    };

    const taken = (dir: string) => (name: string) => existsSync(join(dir, name)) || existsSync(join(dir, sidecarFileName(name)));

    /**
     * Writes `body` to a temp file, then, in one synchronous step, picks a name that is free
     * (file and sidecar), moves the file there and writes its sidecar, so two uploads never
     * pick the same name.
     */
    const writeNew = async (
      dir: string,
      originalName: string,
      mime: string,
      body: AsyncIterable<Buffer>,
      sidecar: (bytes: number) => MediaSidecar,
    ) => {
      const temp = join(dir, `.upload-${randomUUID()}.tmp`);
      let bytes = 0;
      const handle = await open(temp, "wx");
      try {
        for await (const chunk of body) {
          bytes += chunk.length;
          if (bytes > UPLOAD_BODY_LIMIT) throw new SaveRefused(413, "That file is larger than the 500MB upload limit.");
          await handle.write(chunk);
        }
      } catch (error) {
        await handle.close().catch(() => {});
        await rm(temp, { force: true });
        throw error;
      }
      await handle.close();
      if (bytes === 0) {
        await rm(temp, { force: true });
        throw new SaveRefused(400, EMPTY_BODY_MESSAGE);
      }
      try {
        const file = mediaFileName({ originalName, mime, now: Date.now(), exists: taken(dir) });
        renameSync(temp, join(dir, file));
        writeFileSync(join(dir, sidecarFileName(file)), sidecarText(sidecar(bytes)));
        return { file, bytes };
      } catch (error) {
        await rm(temp, { force: true });
        throw error;
      }
    };

    const save = async (
      project: string,
      input: { originalName: string; mime: string; body: AsyncIterable<Buffer>; rendered?: RenderedSidecar | undefined },
    ) => {
      const dir = await folder(project);
      if (dir === undefined) throw new SaveRefused(404, `There is no project named "${projectSlug(project)}".`);
      const mime = input.mime || "application/octet-stream";
      try {
        const { file, bytes } = await writeNew(dir, input.originalName, mime, input.body, (bytes) => ({
          source: "upload",
          fileName: input.originalName,
          mime,
          bytes,
          at: new Date().toISOString(),
          ...input.rendered,
        }));
        return { file, fileName: input.originalName, bytes, mime };
      } catch (error) {
        if (error instanceof SaveRefused) throw error;
        throw new SaveRefused(500, `Could not save the file: ${errorText(error)}`);
      }
    };

    const savePreview = async (project: string, file: string, size: PreviewSize, body: AsyncIterable<Buffer>) => {
      const dir = await folder(project);
      if (dir === undefined) throw new SaveRefused(404, `There is no project named "${projectSlug(project)}".`);
      if (!isBareFileName(file) || !existsSync(join(dir, file))) throw new SaveRefused(404, "File not found.");
      const cache = join(dir, PREVIEW_FOLDER);
      try {
        await mkdir(cache, { recursive: true });
        const temp = join(cache, `.preview-${randomUUID()}.tmp`);
        let bytes = 0;
        const handle = await open(temp, "wx");
        try {
          for await (const chunk of body) {
            bytes += chunk.length;
            if (bytes > UPLOAD_BODY_LIMIT) throw new SaveRefused(413, "That file is larger than the 500MB upload limit.");
            await handle.write(chunk);
          }
        } finally {
          await handle.close();
        }
        if (bytes === 0) {
          await rm(temp, { force: true });
          throw new SaveRefused(400, EMPTY_BODY_MESSAGE);
        }
        await rename(temp, join(cache, previewFileName(file, size)));
        return { bytes };
      } catch (error) {
        if (error instanceof SaveRefused) throw error;
        throw new SaveRefused(500, `Could not save the file: ${errorText(error)}`);
      }
    };

    const copy = (project: string, file: string, from?: string) =>
      Effect.tryPromise({
        try: async () => {
          const sourceDir = await folder(from ?? project);
          const targetDir = await folder(project);
          if (!isBareFileName(file) || sourceDir === undefined) throw unframedError("bad_request", "That is not a file in this project.");
          if (targetDir === undefined) throw unframedError("not_found", `There is no project named "${projectSlug(project)}".`);
          const source = join(sourceDir, file);
          let info;
          try {
            info = await stat(source);
          } catch (error) {
            throw unframedError("not_found", `Could not copy the file: ${errorText(error)}`);
          }
          if (!info.isFile()) throw unframedError("bad_request", "That is not a file in this project.");
          let mime = "application/octet-stream";
          try {
            const sidecar = JSON.parse(await readFile(join(sourceDir, sidecarFileName(file)), "utf8")) as { mime?: unknown };
            if (typeof sidecar.mime === "string" && sidecar.mime !== "") mime = sidecar.mime;
          } catch {
            // no sidecar: the copy's type is unknown
          }
          const fileName = copyFileName(file);
          const temp = join(targetDir, `.copy-${randomUUID()}.tmp`);
          await copyFile(source, temp);
          try {
            const target = mediaFileName({ originalName: fileName, mime, now: Date.now(), exists: taken(targetDir) });
            renameSync(temp, join(targetDir, target));
            writeFileSync(
              join(targetDir, sidecarFileName(target)),
              sidecarText({ source: "copy", fileName, mime, bytes: info.size, at: new Date().toISOString(), of: file }),
            );
            return target;
          } catch (error) {
            await rm(temp, { force: true });
            throw error;
          }
        },
        catch: (error) =>
          error instanceof UnframedError ? error : unframedError("internal", `Could not copy the file: ${errorText(error)}`),
      });

    /** Saves a data URL that reached a room, and answers the marker that replaces it. */
    const saveDataUrl = async (project: string, url: string, name: string) => {
      const decoded = decodeDataUrl(url);
      if (!decoded) return undefined;
      const saved = await save(project, { originalName: name, mime: decoded.mime, body: once(decoded.bytes) });
      return { marker: projectFileMarker(saved.file), mime: decoded.mime, file: saved.file };
    };

    const rewrite = async (
      project: string,
      change: CommittedChange,
      room: { get: (id: string) => TLRecord | undefined; apply: (put: TLRecord[]) => void },
    ) => {
      const put: TLRecord[] = [];
      for (const record of change.records.values()) {
        if (record.typeName === "asset" && (record.type === "image" || record.type === "video")) {
          const src = record.props.src;
          if (typeof src !== "string") continue;
          if (src.startsWith("blob:")) {
            const current = room.get(record.id) as TLAsset | undefined;
            if (current && current.props.src === src) put.push({ ...current, props: { ...current.props, src: null } } as TLAsset);
          } else if (src.startsWith("data:")) {
            const saved = await saveDataUrl(project, src, record.props.name || "upload");
            const current = room.get(record.id) as TLAsset | undefined;
            if (saved && current && current.props.src === src) {
              put.push({ ...current, props: { ...current.props, src: saved.marker } } as TLAsset);
            }
          }
        }
      }
      if (put.length > 0) room.apply(put);
    };

    yield* rooms.afterCommit((project, change, room) => {
      const worth = [...change.records.values()].some((record) => {
        // A shape's own url prop is a link URL in tldraw's schema, so only asset sources can hold these.
        const src = record.typeName === "asset" ? (record.props as { src?: unknown }).src : undefined;
        return typeof src === "string" && (src.startsWith("data:") || src.startsWith("blob:"));
      });
      if (!worth) return;
      rewrite(project, change, room).catch((error: unknown) =>
        logError(`canvas ${project}: could not rewrite a data URL: ${errorText(error)}`),
      );
    });

    return MediaStore.of({ save, savePreview, copy, folder });
  }),
);
