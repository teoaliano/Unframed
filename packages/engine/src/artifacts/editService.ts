/**
 * The element editor's file operations (spec 18): an artifact's source tree, the prepare that
 * makes an older file editable, the source edit, and the project's images. Each answer or
 * refusal is a plain UnframedError, so the RPC layer passes it through unchanged.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import type { TLRecord } from "@tldraw/tlschema";
import { isBareFileName, unframedError, type ArtifactImage, type SourceTreeElement } from "@unframed/contracts";
import { ARTIFACT_SIZE_LIMIT, artifactTitle, projectSlug, shapeKind, sidecarFileName } from "@unframed/domain";
import { sourceTreeOf, stampElementIds } from "@unframed/domain/html";
import { byteSize, prepareArtifactHtml, tooLargeMessage } from "./artifactHtml.ts";
import { ensureBridge, ensureLibrary, writeEditArtifact } from "./artifactStore.ts";

const BRIDGE_PRESENT = /unframed-dials\.js/i;
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"]);
const PREPARE_EDIT = "Element ids added";

export interface EditServiceDeps {
  /** The folder of a project, or undefined when the project does not exist. */
  readonly folder: (project: string) => Promise<string | undefined>;
  /** The canvas records of a project. */
  readonly read: (project: string) => Promise<ReadonlyArray<TLRecord>>;
}

/** The folder, or the not-found refusal every edit RPC gives an unknown project. */
const folderOf = async (deps: EditServiceDeps, project: string): Promise<string> => {
  const dir = await deps.folder(project);
  if (dir === undefined) throw unframedError("not_found", `There is no project named "${projectSlug(project)}".`);
  return dir;
};

const isReady = (html: string): boolean => BRIDGE_PRESENT.test(html) && stampElementIds(html) === html;

export const artifactEditService = (deps: EditServiceDeps) => ({
  /** The elements of a file that carry an id, and whether the file is ready for editing as it stands. */
  sourceTree: async (project: string, file: string): Promise<{ ready: boolean; elements: SourceTreeElement[] }> => {
    const dir = await folderOf(deps, project);
    if (!isBareFileName(file)) throw unframedError("bad_request", "That is not a file in this project.");
    let html: string;
    try {
      html = await readFile(join(dir, file), "utf8");
    } catch {
      throw unframedError("not_found", `No file ${file} in this project.`);
    }
    return { ready: isReady(html), elements: sourceTreeOf(html) };
  },

  /** A page or motion's file, stamped and bridged in a new version when it is not ready; the current file when it is. */
  prepareEdit: async (project: string, shapeId: string): Promise<{ file: string }> => {
    const dir = await folderOf(deps, project);
    const record = (await deps.read(project)).find((candidate) => candidate.id === shapeId);
    const shape = record?.typeName === "shape" ? record : undefined;
    const kind = shape === undefined ? undefined : shapeKind(shape.type);
    if (shape === undefined || (kind !== "page" && kind !== "motion")) throw unframedError("not_found", `There is no page or motion ${shapeId} on this canvas.`);
    const props = shape.props as { file?: unknown; title?: unknown; fileName?: unknown };
    const file = typeof props.file === "string" ? props.file : "";
    if (file === "") throw unframedError("not_found", `This ${kind} has no file yet.`);
    const html = await readFile(join(dir, file), "utf8").catch(() => {
      throw unframedError("not_found", `No file ${file} in this project.`);
    });
    if (isReady(html)) return { file };
    const prepared = prepareArtifactHtml(html, kind);
    if (byteSize(prepared) > ARTIFACT_SIZE_LIMIT) throw unframedError("bad_request", tooLargeMessage(kind, byteSize(prepared)));
    await (kind === "motion" ? ensureLibrary(dir) : ensureBridge(dir));
    const written = await writeEditArtifact(dir, {
      kind,
      html: prepared,
      title: artifactTitle(props),
      of: file,
      shapeId,
      edits: [PREPARE_EDIT],
    });
    return { file: written.file };
  },

  /** The project's images the preview origin serves, newest first. */
  images: async (project: string): Promise<{ images: ArtifactImage[] }> => {
    const dir = await folderOf(deps, project);
    const names = await readdir(dir).catch(() => [] as string[]);
    const images = await Promise.all(
      names
        .filter((name) => IMAGE_EXTENSIONS.has(extname(name).toLowerCase()) && isBareFileName(name))
        .map(async (file) => {
          const info = await stat(join(dir, file));
          if (!info.isFile()) return undefined;
          const fileName = await readFile(join(dir, sidecarFileName(file)), "utf8")
            .then((text) => {
              const original = (JSON.parse(text) as { fileName?: unknown }).fileName;
              return typeof original === "string" && original !== "" ? original : file;
            })
            .catch(() => file);
          return { file, fileName, at: info.mtimeMs };
        }),
    );
    return { images: images.flatMap((image) => (image === undefined ? [] : [image])).sort((a, b) => b.at - a.at) };
  },
});

