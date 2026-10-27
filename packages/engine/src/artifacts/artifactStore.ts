/**
 * The artifact store (spec 09): the only code that writes artifact files. Every edit is a
 * new file, opened with exclusive create, so no artifact file is ever overwritten or
 * deleted; a shape changes version only by its `file` prop changing. It also keeps the
 * motion library (the viewer, the bridge, the player, the runtime and GSAP) beside the
 * compositions, so the preview origin never needs a second route.
 */
import { constants, existsSync } from "node:fs";
import { copyFile, mkdir, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, join } from "node:path";
import {
  artifactFileName,
  compiledFileName,
  compileComponent,
  pinnedCompiledFile,
  readPins,
  componentHelperSource,
  COMPONENT_HELPER_FILE,
  dialsBridgeSource,
  LIVE_CHECK_FILE,
  LIVE_VIEWER_FILE,
  liveCheckSource,
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

const COMPONENT_HELPER: LibraryFile = { name: COMPONENT_HELPER_FILE, bytes: async () => Buffer.from(componentHelperSource(), "utf8") };

/** A component write ensures the bridge and the sheet helper, by the same size rule. */
export const ensureComponentLibrary = (folder: string): Promise<void> => ensure(folder, [BRIDGE, COMPONENT_HELPER]);

/** The helper alone, for the preview origin's on-request refresh. */
export const ensureComponentHelper = (folder: string): Promise<void> => ensure(folder, [COMPONENT_HELPER]);

const LIVE_FILES: ReadonlyArray<LibraryFile> = [
  { name: LIVE_VIEWER_FILE, bytes: async () => Buffer.from(liveViewerSource(), "utf8") },
  { name: LIVE_CHECK_FILE, bytes: async () => Buffer.from(liveCheckSource(), "utf8") },
];

/** The live viewer "Open in a new tab" opens, and the check it uses to tell whether Unframed is running. */
export const ensureLiveViewer = (folder: string): Promise<void> => ensure(folder, LIVE_FILES);

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

/** A sheet's name is also taken by its compiled file (spec 20), so the pair never splits. */
const taken = (folder: string) => (name: string) =>
  existsSync(join(folder, name)) ||
  existsSync(join(folder, sidecarFileName(name))) ||
  (name.endsWith(".html") && existsSync(join(folder, compiledFileName(name))));

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

export interface ComponentSidecar {
  readonly source: "agent";
  readonly kind: "component";
  readonly tag: string;
  readonly compiled: string;
  readonly chatId: string;
  readonly turn: number;
  /** The shape updated, `null` when creating. */
  readonly shapeId: string | null;
  readonly title: string;
  readonly bytes: number;
  readonly at: string;
}

/**
 * A sheet and the compiled file beside it, both with exclusive create: the compiled file goes
 * first, so a sheet never exists without its build; a sheet that loses the name race takes its
 * build back. `sidecar` gets the compiled file's name and answers the sheet's sidecar.
 */
const createSheet = async (
  folder: string,
  input: { readonly html: string; readonly title: string; readonly fallback: string },
  sidecar: (compiled: string, bytes: number) => object,
): Promise<{ file: string; compiled: string; bytes: number }> => {
  const bytes = Buffer.from(input.html, "utf8");
  let compiled = "";
  const place = async (path: string) => {
    const file = basename(path);
    const build = join(folder, compiledFileName(file));
    compiled = compiledFileName(file);
    await writeExclusive(Buffer.from(compileComponent(input.html, file), "utf8"))(build);
    try {
      await writeExclusive(bytes)(path);
    } catch (error) {
      await rm(build, { force: true });
      throw error;
    }
  };
  const file = await createNew(folder, { title: input.title, fallback: input.fallback, ext: "html" }, place, () => `${JSON.stringify(sidecar(compiled, bytes.length), null, 2)}\n`);
  return { file, compiled, bytes: bytes.length };
};

/**
 * An agent's new version of a component (spec 20): its sheet, the compiled file beside it and the
 * agent sidecar. The caller has checked the sheet (`readComponentSheet`), so this throws only on a bad sheet.
 */
export const writeComponentSheet = (
  folder: string,
  input: { readonly html: string; readonly tag: string; readonly title: string; readonly chatId: string; readonly turn: number; readonly shapeId: string | null },
): Promise<{ file: string; compiled: string; bytes: number }> =>
  createSheet(folder, { html: input.html, title: input.title, fallback: "component" }, (compiled, bytes) => {
    const sidecar: ComponentSidecar = {
      source: "agent",
      kind: "component",
      tag: input.tag,
      compiled,
      chatId: input.chatId,
      turn: input.turn,
      shapeId: input.shapeId,
      title: input.title,
      bytes,
      at: new Date().toISOString(),
    };
    return sidecar;
  });

/**
 * A copy of a sheet under a new tag (spec 20's `component.copy`), with spec 02's copy sidecar plus
 * the tag and the compiled file. `fileName` is the source's name without its stamp.
 */
export const writeCopiedComponentSheet = (
  folder: string,
  input: { readonly html: string; readonly tag: string; readonly fileName: string; readonly of: string; readonly ofProject?: string | undefined },
): Promise<{ file: string; compiled: string; bytes: number }> =>
  createSheet(folder, { html: input.html, title: input.fileName.replace(/\.html$/, ""), fallback: "component" }, (compiled, bytes) => ({
    source: "copy",
    fileName: input.fileName,
    mime: "text/html",
    bytes,
    at: new Date().toISOString(),
    of: input.of,
    ...(input.ofProject === undefined ? {} : { ofProject: input.ofProject }),
    tag: input.tag,
    compiled,
  }));

/**
 * Writes `<base>.component.js` from its sheet `<base>.html` when the sheet exists and is a valid
 * component (spec 20). It writes the bytes the compiler makes and never overwrites. Returns
 * whether a file was written.
 */
export const ensureCompiledComponent = async (folder: string, compiled: string): Promise<boolean> => {
  const sheet = `${compiled.replace(/\.component\.js$/, "")}.html`;
  const html = await readFile(join(folder, sheet), "utf8").catch(() => undefined);
  if (html === undefined) return false;
  let script: string;
  try {
    script = compileComponent(html, sheet);
  } catch {
    return false;
  }
  return writeExclusive(Buffer.from(script, "utf8"))(join(folder, compiled)).then(
    () => true,
    () => false,
  );
};

/** A snapshot, a write or a render ensures the compiled files of every pin in the file it handles (spec 20). */
export const ensurePinnedComponents = async (folder: string, file: string): Promise<void> => {
  const html = await readFile(join(folder, basename(file)), "utf8").catch(() => undefined);
  if (html === undefined) return;
  for (const pin of readPins(html)) {
    const compiled = pinnedCompiledFile(pin);
    if (!existsSync(join(folder, compiled))) await ensureCompiledComponent(folder, compiled);
  }
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
