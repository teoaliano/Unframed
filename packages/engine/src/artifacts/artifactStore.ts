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
  editBridgeSource,
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
export const EDIT_BRIDGE_FILE = "unframed-edit.js";

interface LibraryFile {
  readonly name: string;
  readonly bytes: () => Promise<Buffer>;
}

const installed = (resolve: () => string) => {
  let read: Promise<Buffer> | undefined;
  return () => {
    read ??= readFile(resolve());
    read.catch(() => (read = undefined));
    return read;
  };
};

const BRIDGE: LibraryFile = { name: BRIDGE_FILE, bytes: async () => Buffer.from(dialsBridgeSource(), "utf8") };
const EDIT: LibraryFile = { name: EDIT_BRIDGE_FILE, bytes: async () => Buffer.from(editBridgeSource(), "utf8") };

const LIBRARY: ReadonlyArray<LibraryFile> = [
  { name: "hyperframes-viewer.html", bytes: async () => Buffer.from(viewerPageSource(), "utf8") },
  BRIDGE,
  EDIT,
  { name: "hyperframes-player.js", bytes: installed(() => join(dirname(require.resolve("@hyperframes/player")), "hyperframes-player.global.js")) },
  { name: "hyperframes-runtime.js", bytes: installed(() => require.resolve("@hyperframes/core/runtime")) },
  { name: "gsap.js", bytes: installed(() => require.resolve("gsap/dist/gsap.min.js")) },
];

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

export const ensureBridge = (folder: string): Promise<void> => ensure(folder, [BRIDGE, EDIT]);

const COMPONENT_HELPER: LibraryFile = { name: COMPONENT_HELPER_FILE, bytes: async () => Buffer.from(componentHelperSource(), "utf8") };

export const ensureComponentLibrary = (folder: string): Promise<void> => ensure(folder, [BRIDGE, COMPONENT_HELPER]);

export const ensureComponentHelper = (folder: string): Promise<void> => ensure(folder, [COMPONENT_HELPER]);

const LIVE_FILES: ReadonlyArray<LibraryFile> = [
  { name: LIVE_VIEWER_FILE, bytes: async () => Buffer.from(liveViewerSource(), "utf8") },
  { name: LIVE_CHECK_FILE, bytes: async () => Buffer.from(liveCheckSource(), "utf8") },
];

export const ensureLiveViewer = (folder: string): Promise<void> => ensure(folder, LIVE_FILES);

export const ensureLibrary = (folder: string): Promise<void> => ensure(folder, LIBRARY);

const ENGINE_FILES = new Set([...LIBRARY, COMPONENT_HELPER, ...LIVE_FILES].map((file) => file.name));

export const isEngineFile = (name: string): boolean => ENGINE_FILES.has(name) || name.endsWith(".component.js");

interface AgentSidecar {
  readonly source: "agent";
  readonly kind: ArtifactKind;
  readonly chatId: string;
  readonly turn: number;
  readonly shapeId: string | null;
  readonly title: string;
  readonly bytes: number;
  readonly at: string;
}

const taken = (folder: string) => (name: string) =>
  existsSync(join(folder, name)) ||
  existsSync(join(folder, sidecarFileName(name))) ||
  (name.endsWith(".html") && existsSync(join(folder, compiledFileName(name))));

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

interface ComponentSidecar {
  readonly source: "agent";
  readonly kind: "component";
  readonly tag: string;
  readonly compiled: string;
  readonly chatId: string;
  readonly turn: number;
  readonly shapeId: string | null;
  readonly title: string;
  readonly bytes: number;
  readonly at: string;
}

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

export const ensurePinnedComponents = async (folder: string, file: string): Promise<void> => {
  const html = await readFile(join(folder, basename(file)), "utf8").catch(() => undefined);
  if (html === undefined) return;
  for (const pin of readPins(html)) {
    const compiled = pinnedCompiledFile(pin);
    if (!existsSync(join(folder, compiled))) await ensureCompiledComponent(folder, compiled);
  }
};

export const writeUploadedArtifact = async (folder: string, input: { readonly html: string; readonly fileName: string }): Promise<{ file: string; bytes: number }> => {
  const bytes = Buffer.from(input.html, "utf8");
  const title = input.fileName.replace(/\.[^.]*$/, "");
  const file = await createNew(folder, { title, fallback: "motion", ext: "html" }, writeExclusive(bytes), () =>
    sidecarText({ source: "upload", fileName: input.fileName, mime: "text/html", bytes: bytes.length, at: new Date().toISOString() }),
  );
  return { file, bytes: bytes.length };
};

interface EditSidecar {
  readonly source: "edit";
  readonly kind: ArtifactKind;
  readonly of: string;
  readonly shapeId: string;
  readonly edits: ReadonlyArray<string>;
  readonly title: string;
  readonly bytes: number;
  readonly at: string;
  readonly tag?: string | undefined;
  readonly compiled?: string | undefined;
}

export const writeEditArtifact = async (
  folder: string,
  input: { readonly kind: ArtifactKind; readonly html: string; readonly title: string; readonly of: string; readonly shapeId: string; readonly edits: ReadonlyArray<string>; readonly tag?: string | undefined },
): Promise<{ file: string; bytes: number }> => {
  const bytes = Buffer.from(input.html, "utf8");
  const sidecar = (compiled: string | undefined): EditSidecar => ({
    source: "edit",
    kind: input.kind,
    of: input.of,
    shapeId: input.shapeId,
    edits: [...input.edits],
    title: input.title,
    bytes: bytes.length,
    at: new Date().toISOString(),
    ...(input.kind === "component" ? { tag: input.tag, compiled } : {}),
  });
  if (input.kind === "component") {
    const written = await createSheet(folder, { html: input.html, title: input.title, fallback: "component" }, (compiled) => sidecar(compiled));
    return { file: written.file, bytes: written.bytes };
  }
  const file = await createNew(folder, { title: input.title, fallback: input.kind, ext: "html" }, writeExclusive(bytes), () => `${JSON.stringify(sidecar(undefined), null, 2)}\n`);
  return { file, bytes: bytes.length };
};

export const readArtifact = (folder: string, file: string): Promise<string> => readFile(join(folder, basename(file)), "utf8");

interface RenderSidecar {
  readonly source: "render";
  readonly of: string;
  readonly title: string;
  readonly mime: "video/mp4";
  readonly fps: 30;
  readonly quality: "standard";
  readonly bytes: number;
  readonly dials?: Readonly<Record<string, unknown>>;
  readonly mode?: string;
  readonly kit?: { readonly name: string; readonly stamp: string };
  readonly at: string;
}

export const placeRenderOutput = async (
  folder: string,
  input: { readonly from: string; readonly of: string; readonly title: string; readonly dials: Readonly<Record<string, unknown>> | null; readonly mode?: string | undefined; readonly kit?: { readonly name: string; readonly stamp: string } | undefined },
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
      ...(input.mode === undefined ? {} : { mode: input.mode }),
      ...(input.kit === undefined ? {} : { kit: input.kit }),
      at: new Date().toISOString(),
    };
    return `${JSON.stringify(sidecar, null, 2)}\n`;
  });
  return { file, bytes };
};

interface NodePageSidecar {
  readonly kind: "page";
  readonly source: "node";
  readonly title: string;
  readonly prompt: string;
  readonly model: string;
  readonly cost: number | null;
  readonly recipe: unknown;
  readonly node: { readonly shapeId: string; readonly versionId: string };
  readonly chain?: { readonly chainId: string; readonly step: number };
  readonly batchId: string;
  readonly runIndex: number;
  readonly runCount: number;
  readonly createdAt: string;
  readonly file: string;
}

export const writeNodePage = async (folder: string, input: { readonly html: string; readonly slug: string; readonly stamp: string; readonly sidecar: Omit<NodePageSidecar, "file"> }): Promise<{ file: string; bytes: number }> => {
  const bytes = Buffer.from(input.html, "utf8");
  const base = `${input.stamp}-page-${input.slug || "page"}`;
  for (let attempt = 0; attempt < 1000; attempt++) {
    const file = attempt === 0 ? `${base}.html` : `${base}-${attempt + 1}.html`;
    if (taken(folder)(file)) continue;
    try {
      await writeExclusive(bytes)(join(folder, file));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw error;
    }
    const sidecar: NodePageSidecar = { ...input.sidecar, file };
    await writeFile(join(folder, sidecarFileName(file)), `${JSON.stringify(sidecar, null, 2)}\n`);
    return { file, bytes: bytes.length };
  }
  throw new Error("No free file name.");
};
