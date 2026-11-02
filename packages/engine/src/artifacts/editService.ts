/**
 * The element editor's file operations (spec 18): an artifact's source tree, the prepare that
 * makes an older file editable, the source edit, and the project's images. Each answer or
 * refusal is a plain UnframedError, so the RPC layer passes it through unchanged.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import type { TLRecord } from "@tldraw/tlschema";
import { isBareFileName, unframedError, type ArtifactImage, type OffTokenFound, type SourceEdit, type SourceTreeElement } from "@unframed/contracts";
import { ARTIFACT_SIZE_LIMIT, artifactTitle, offTokenValues, projectSlug, shapeKind, sidecarFileName, type ArtifactKind } from "@unframed/domain";
import { applySourceEdits, sourceTreeOf, stampElementIds } from "@unframed/domain/html";
import type { CommittedChange } from "../canvas/rooms.ts";
import { byteSize, prepareArtifactHtml, tooLargeMessage } from "./artifactHtml.ts";
import { kitOf } from "../kits/tokensFile.ts";
import { ensureBridge, ensureLibrary, writeEditArtifact } from "./artifactStore.ts";
import { pinComponents } from "./componentRegistry.ts";

const BRIDGE_PRESENT = /unframed-dials\.js/i;
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"]);
const PREPARE_EDIT = "Element ids added";

export interface EditServiceDeps {
  /** The folder of a project, or undefined when the project does not exist. */
  readonly folder: (project: string) => Promise<string | undefined>;
  /** The canvas records of a project. */
  readonly read: (project: string) => Promise<ReadonlyArray<TLRecord>>;
}

type Origin = CommittedChange["origin"];

/** The artifact shape an edit names, with its kind and its props, or the refusal when there is none. */
const artifactShape = (records: ReadonlyArray<TLRecord>, shapeId: string) => {
  const record = records.find((candidate) => candidate.id === shapeId);
  const shape = record?.typeName === "shape" ? record : undefined;
  const kind = shape === undefined ? undefined : shapeKind(shape.type);
  if (shape === undefined || (kind !== "page" && kind !== "motion")) throw unframedError("not_found", `There is no page or motion ${shapeId} on this canvas.`);
  return { kind, props: shape.props as { file?: unknown; title?: unknown; fileName?: unknown; lockedElements?: unknown } };
};

/** The element and the locked ancestor, if any, that holds an edit's element under a lock. */
const lockedBy = (elementId: string, locked: ReadonlySet<string>, byId: ReadonlyMap<string, { parent: string | null; name: string }>): string | undefined => {
  for (let id: string | null = elementId; id !== null; id = byId.get(id)?.parent ?? null) {
    if (locked.has(id)) return id;
  }
  return undefined;
};

/** The folder, or the not-found refusal every edit RPC gives an unknown project. */
const folderOf = async (deps: EditServiceDeps, project: string): Promise<string> => {
  const dir = await deps.folder(project);
  if (dir === undefined) throw unframedError("not_found", `There is no project named "${projectSlug(project)}".`);
  return dir;
};

const isReady = (html: string): boolean => BRIDGE_PRESENT.test(html) && stampElementIds(html) === html;

export const artifactEditService = (deps: EditServiceDeps) => {
  /** The origin that last set each artifact's file, by project and shape: a chat's makes an agent conflict. */
  const fileOrigins = new Map<string, Origin>();
  const keyOf = (project: string, shapeId: string) => `${projectSlug(project)}\u0000${shapeId}`;

  return {
  /** Notes the origin of every committed change that set an artifact's file. */
  committed: (project: string, change: CommittedChange): void => {
    for (const record of change.records.values()) {
      if (record.typeName !== "shape" || (record.type !== "page" && record.type !== "motion")) continue;
      if (typeof (record.props as { file?: unknown }).file === "string") fileOrigins.set(keyOf(project, record.id), change.origin);
    }
  },

  /** The elements of a file that carry an id, and whether the file is ready for editing as it stands. */
  sourceTree: async (project: string, file: string): Promise<{ ready: boolean; elements: SourceTreeElement[]; offTokens: OffTokenFound[] }> => {
    const dir = await folderOf(deps, project);
    if (!isBareFileName(file)) throw unframedError("bad_request", "That is not a file in this project.");
    let html: string;
    try {
      html = await readFile(join(dir, file), "utf8");
    } catch {
      throw unframedError("not_found", `No file ${file} in this project.`);
    }
    const kit = kitOf(await deps.read(project));
    return { ready: isReady(html), elements: sourceTreeOf(html), offTokens: kit === null ? [] : offTokenValues(html, kit) };
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
    const records = await deps.read(project);
    const prepared = (await pinComponents(dir, records, isReady(html) ? html : prepareArtifactHtml(html, kind))).html;
    if (prepared === html) return { file };
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

  /** The person's source edits to an artifact's base file, written as a new version (spec 18). */
  edit: async (project: string, shapeId: string, baseFile: string, edits: readonly SourceEdit[]): Promise<{ file: string; summary: string[] }> => {
    const dir = await folderOf(deps, project);
    const records = await deps.read(project);
    const { kind, props } = artifactShape(records, shapeId);
    if (edits.length === 0) throw unframedError("bad_request", "There is nothing to save.");
    if (props.file !== baseFile) {
      const origin = fileOrigins.get(keyOf(project, shapeId));
      const reason = origin?.kind === "server" && origin.id.startsWith("chat:") ? "agent" : "elsewhere";
      throw unframedError("conflict", `This ${kind} changed while you were editing it.`, { reason });
    }
    const html = await readFile(join(dir, baseFile), "utf8").catch(() => {
      throw unframedError("not_found", `No file ${baseFile} in this project.`);
    });
    const tree = sourceTreeOf(html);
    const byId = new Map(tree.map((entry) => [entry.id, { parent: entry.parent, name: entry.name }]));
    const locked = new Set(Array.isArray(props.lockedElements) ? (props.lockedElements as string[]) : []);
    if (locked.size > 0) {
      for (const edit of edits) {
        // Rename and hide still work on a locked element, so a person can tidy what they protected. A style rule is no element, so no lock holds it.
        if (edit.type === "attribute" || edit.type === "hide" || edit.elementId === undefined) continue;
        const holder = lockedBy(edit.elementId, locked, byId);
        if (holder !== undefined) throw unframedError("bad_request", `${byId.get(holder)?.name ?? holder} is locked. Unlock it in Layers to edit it.`);
      }
    }
    const result = applySourceEdits(html, edits, kind, kitOf(records));
    if (!result.ok) throw unframedError("bad_request", result.refusal);
    const prepared = (await pinComponents(dir, records, prepareArtifactHtml(result.html, kind))).html;
    if (byteSize(prepared) > ARTIFACT_SIZE_LIMIT) throw unframedError("bad_request", tooLargeMessage(kind, byteSize(prepared)));
    await (kind === "motion" ? ensureLibrary(dir) : ensureBridge(dir));
    const written = await writeEditArtifact(dir, { kind, html: prepared, title: artifactTitle(props), of: baseFile, shapeId, edits: result.summary });
    return { file: written.file, summary: result.summary };
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
};
};
