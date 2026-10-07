/**
 * The artifact store (spec 09): the only code that writes artifact files. Every edit is a
 * new file, opened with exclusive create, so no artifact file is ever overwritten or
 * deleted; a shape changes version only by its `file` prop changing. It also keeps the
 * motion library (the viewer, the bridge, the player, the runtime and GSAP) beside the
 * compositions, so the preview origin never needs a second route.
 */
import { constants, existsSync } from "node:fs";
import { copyFile, mkdir, open, readFile, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, join } from "node:path";
import {
  artifactFileName,
  dialsBridgeSource,
  LIVE_VIEWER_FILE,
  liveViewerSource,
  sidecarFileName,
  sidecarText,
  viewerPageSource,
  type ArtifactKind,
} from "@unframed/domain";

const require = createRequire(import.meta.url);

export const BRIDGE_FILE = "unframed-dials.js";

/** One file of the motion library: its fixed name and where its bytes come from. */
interface LibraryFile {
  readonly name: string;
  readonly bytes: () => Promise<Buffer>;
}

/** An installed package's file, read once: a dependency only changes with a new engine process. */
const installed = (resolve: () => string) => {
  let read: Promise<Buffer> | undefined;
  return () => {
    read ??= readFile(resolve());
    read.catch(() => (read = undefined));
    return read;
  };
};

const BRIDGE: LibraryFile = { name: BRIDGE_FILE, bytes: async () => Buffer.from(dialsBridgeSource(), "utf8") };

/** The five files, under fixed names. Nothing is vendored and nothing loads from a CDN. */
const LIBRARY: ReadonlyArray<LibraryFile> = [
  { name: "hyperframes-viewer.html", bytes: async () => Buffer.from(viewerPageSource(), "utf8") },
  BRIDGE,
  // The player's global build sits beside its package entry.
  { name: "hyperframes-player.js", bytes: installed(() => join(dirname(require.resolve("@hyperframes/player")), "hyperframes-player.global.js")) },
  { name: "hyperframes-runtime.js", bytes: installed(() => require.resolve("@hyperframes/core/runtime")) },
  { name: "gsap.js", bytes: installed(() => require.resolve("gsap/dist/gsap.min.js")) },
];

/**
 * Writes each file whose on-disk size differs from its source, or that is missing, and
 * leaves the rest alone, so a dependency bump or a generator change refreshes the copies.
 */
const ensure = async (folder: string, files: ReadonlyArray<LibraryFile>): Promise<void> => {
  await mkdir(folder, { recursive: true });
  for (const file of files) {
    const bytes = await file.bytes();
    const path = join(folder, file.name);
    const current = await stat(path).catch(() => undefined);
    if (current?.isFile() && current.size === bytes.length) continue;
    await writeFile(path, bytes);
  }
};

/** A page write ensures only the bridge; a page never gets the player, runtime or GSAP. */
export const ensureBridge = (folder: string): Promise<void> => ensure(folder, [BRIDGE]);

const LIVE_VIEWER: LibraryFile = { name: LIVE_VIEWER_FILE, bytes: async () => Buffer.from(liveViewerSource(), "utf8") };

/** The live viewer "Open in a new tab" opens, beside every shape's pointer. */
export const ensureLiveViewer = (folder: string): Promise<void> => ensure(folder, [LIVE_VIEWER]);

/** A motion write, a motion upload and a render start each ensure the whole library first. */
export const ensureLibrary = (folder: string): Promise<void> => ensure(folder, LIBRARY);

export interface AgentSidecar {
  readonly source: "agent";
  readonly kind: ArtifactKind;
  readonly chatId: string;
  readonly turn: number;
  /** The shape updated, `null` when creating. */
  readonly shapeId: string | null;
  readonly title: string;
  readonly bytes: number;
  readonly at: string;
}

const taken = (folder: string) => (name: string) => existsSync(join(folder, name)) || existsSync(join(folder, sidecarFileName(name)));

/**
 * Creates a new file named from `title` (or `fallback`): `place` must create it exclusively
 * and fail with EEXIST when another write took the name first, which retries with the next
 * suffix. Then writes its sidecar.
 */
const createNew = async (
  folder: string,
  input: { readonly title: string; readonly fallback: string; readonly ext: string },
  place: (path: string) => Promise<void>,
  sidecar: () => string,
): Promise<string> => {
  const now = Date.now();
  const skipped = new Set<string>();
  for (let attempt = 0; attempt < 1000; attempt++) {
    const file = artifactFileName({ title: input.title, fallback: input.fallback, now, ext: input.ext, exists: (name) => skipped.has(name) || taken(folder)(name) });
    try {
      await place(join(folder, file));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        skipped.add(file);
        continue;
      }
      throw error;
    }
    await writeFile(join(folder, sidecarFileName(file)), sidecar());
    return file;
  }
  throw new Error("No free file name.");
};

const writeExclusive = (bytes: Buffer) => async (path: string) => {
  const handle = await open(path, "wx");
  try {
    await handle.writeFile(bytes);
  } finally {
    await handle.close();
  }
};

/** An agent's new version of a page or motion, with its agent sidecar. */
export const writeAgentArtifact = async (
  folder: string,
  input: { readonly kind: ArtifactKind; readonly html: string; readonly title: string; readonly chatId: string; readonly turn: number; readonly shapeId: string | null },
): Promise<{ file: string; bytes: number }> => {
  const bytes = Buffer.from(input.html, "utf8");
  const file = await createNew(folder, { title: input.title, fallback: input.kind, ext: "html" }, writeExclusive(bytes), () => {
    const sidecar: AgentSidecar = {
      source: "agent",
      kind: input.kind,
      chatId: input.chatId,
      turn: input.turn,
      shapeId: input.shapeId,
      title: input.title,
      bytes: bytes.length,
      at: new Date().toISOString(),
    };
    return `${JSON.stringify(sidecar, null, 2)}\n`;
  });
  return { file, bytes: bytes.length };
};

/** An uploaded composition, saved as an upload with spec 02's sidecar. */
export const writeUploadedArtifact = async (folder: string, input: { readonly html: string; readonly fileName: string }): Promise<{ file: string; bytes: number }> => {
  const bytes = Buffer.from(input.html, "utf8");
  const title = input.fileName.replace(/\.[^.]*$/, "");
  const file = await createNew(folder, { title, fallback: "motion", ext: "html" }, writeExclusive(bytes), () =>
    sidecarText({ source: "upload", fileName: input.fileName, mime: "text/html", bytes: bytes.length, at: new Date().toISOString() }),
  );
  return { file, bytes: bytes.length };
};

/** Reads an artifact file; the name is reduced to its basename first, so it cannot leave the folder. */
export const readArtifact = (folder: string, file: string): Promise<string> => readFile(join(folder, basename(file)), "utf8");

export interface RenderSidecar {
  readonly source: "render";
  readonly of: string;
  readonly title: string;
  readonly mime: "video/mp4";
  readonly fps: 30;
  readonly quality: "standard";
  readonly bytes: number;
  readonly dials?: Readonly<Record<string, unknown>>;
  readonly at: string;
}

/**
 * Copies a finished render out of its temp folder into the project with exclusive create, as
 * `<epochMs>-<slug of the title, or motion>[-<n>].mp4`, with its render sidecar. There is no
 * `cost` field: a render is free local compute.
 */
export const placeRenderOutput = async (
  folder: string,
  input: { readonly from: string; readonly of: string; readonly title: string; readonly dials: Readonly<Record<string, unknown>> | null },
): Promise<{ file: string; bytes: number }> => {
  const bytes = (await stat(input.from)).size;
  const place = (path: string) => copyFile(input.from, path, constants.COPYFILE_EXCL);
  const file = await createNew(folder, { title: input.title, fallback: "motion", ext: "mp4" }, place, () => {
    const sidecar: RenderSidecar = {
      source: "render",
      of: input.of,
      title: input.title,
      mime: "video/mp4",
      fps: 30,
      quality: "standard",
      bytes,
      ...(input.dials !== null && Object.keys(input.dials).length > 0 ? { dials: input.dials } : {}),
      at: new Date().toISOString(),
    };
    return `${JSON.stringify(sidecar, null, 2)}\n`;
  });
  return { file, bytes };
};
