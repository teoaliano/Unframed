import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { TLRecord } from "@tldraw/tlschema";
import type { ArtifactImage, ArtifactSnapshot, ComponentPins as ComponentPinsItem, ComponentUpdate, MotionTimelineReading, OffTokenFound, RenderStatus, SourceEdit, SourceTreeElement } from "@unframed/contracts";
import { UnframedError, unframedError } from "@unframed/contracts";
import { projectSlug, shapeKind } from "@unframed/domain";
import { motionTimeline } from "@unframed/domain/motion";
import { prepareArtifactHtml } from "./artifactHtml.ts";
import { artifactEditService } from "./editService.ts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";
import { CanvasRooms, type ChangeOrigin } from "../canvas/rooms.ts";
import { errorText, logError } from "../log.ts";
import { TLDOCUMENT_ID } from "@tldraw/tlschema";
import { MediaStore } from "../media/mediaStore.ts";
import { OpenProjects } from "../openProjects.ts";
import { Runs } from "../runs/runs.ts";
import { Config } from "../services.ts";
import { ensureLibrary, writeUploadedArtifact } from "./artifactStore.ts";
import { pinComponents } from "./componentRegistry.ts";
import { ensureTokensFor, kitOf, TOKENS_FILE, ensureTokens } from "../kits/tokensFile.ts";
import { findChrome } from "./chrome.ts";
import { producerBackend, Renderer, RenderRefused, stubBackend } from "./renderer.ts";
import { sweepChromeProfiles } from "./chromeProfiles.ts";
import { HeadlessChrome } from "./headlessChrome.ts";
import { LivePointers } from "./livePointers.ts";
import { ComponentPins, type PinsItem } from "./componentPins.ts";
import { copyComponentSheet, ComponentCopyRefused } from "./componentCopy.ts";
import { componentUpdatesOf } from "./componentUpdates.ts";
import { watchFolder } from "./folderWatch.ts";
import { chromeSnapshotRenderer, Snapshots, stubSnapshotRenderer, type SnapshotRenderer } from "./snapshots.ts";
import { SettingsStore } from "../settingsStore.ts";
import { Shutdown } from "../shutdown.ts";

const UPLOAD_LIMIT = 20 * 1_048_576;

const PREPARE_ORIGIN: ChangeOrigin = { kind: "server", id: "artifact:prepare" };

export class Artifacts extends Context.Service<
  Artifacts,
  {
    readonly upload: (input: { project: string; fileName: string; html: string }) => Effect.Effect<{ file: string; fileName: string; bytes: number; mime: "text/html" }, UnframedError>;
    readonly renderStart: (input: {
      project: string;
      file: string;
      title?: string | undefined;
      dials?: unknown;
      mode?: string | undefined;
      shapeId: string;
    }) => Effect.Effect<{ id: string; status: "queued"; placeholder: string }, UnframedError>;
    readonly renderStatus: (project: string, id: string) => Effect.Effect<RenderStatus, UnframedError>;
    readonly snapshots: (project: string) => Stream.Stream<ArtifactSnapshot, UnframedError>;
    readonly timeline: (project: string, file: string) => Effect.Effect<MotionTimelineReading, UnframedError>;
    readonly componentPins: (project: string) => Stream.Stream<ComponentPinsItem, UnframedError>;
    readonly componentCopy: (input: { project: string; file: string; from?: string | undefined }) => Effect.Effect<{ file: string; tag: string }, UnframedError>;
    readonly componentUpdates: (project: string, shapeId: string) => Effect.Effect<ComponentUpdate[], UnframedError>;
    readonly openLive: (project: string, shapeId: string) => Effect.Effect<{}, UnframedError>;
    readonly sourceTree: (project: string, file: string) => Effect.Effect<{ ready: boolean; elements: SourceTreeElement[]; offTokens: OffTokenFound[] }, UnframedError>;
    readonly prepareEdit: (project: string, shapeId: string) => Effect.Effect<{ file: string }, UnframedError>;
    readonly edit: (project: string, shapeId: string, baseFile: string, edits: SourceEdit[]) => Effect.Effect<{ file: string; summary: string[] }, UnframedError>;
    readonly images: (project: string) => Effect.Effect<{ images: ArtifactImage[] }, UnframedError>;
    readonly findChrome: () => Promise<string | undefined>;
    readonly chrome: HeadlessChrome;
  }
>()("unframed/engine/Artifacts") {}

const refused = (error: unknown): UnframedError =>
  error instanceof RenderRefused ? unframedError(error.code, error.message) : unframedError("internal", `Something went wrong: ${errorText(error)}`);

export const artifactsLayer = Layer.effect(
  Artifacts,
  Effect.gen(function* () {
    const config = yield* Config;
    const media = yield* MediaStore;
    const rooms = yield* CanvasRooms;
    const runs = yield* Runs;
    const openProjects = yield* OpenProjects;
    const settings = yield* SettingsStore;
    const shutdown = yield* Shutdown;
    const context = yield* Effect.context<never>();
    const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> => Effect.runPromiseWith(context)(effect);

    const chrome = () => findChrome({ chromePath: config.chromePath, platform: config.platform, testRenderer: config.testRenderer });
    const fixture = join(config.installRoot, "assets", "fixtures", "render-stub.mp4");
    const backend = config.testRenderer === "ok" || config.testRenderer === "fail" ? stubBackend(config.testRenderer, fixture) : producerBackend(chrome);

    const headless = new HeadlessChrome(chrome);
    void sweepChromeProfiles().catch((error: unknown) => logError(`could not sweep old headless Chrome profiles: ${errorText(error)}`));
    yield* shutdown.register("headless Chrome", Effect.promise(() => headless.close()));

    const snapshotRenderer: SnapshotRenderer | undefined =
      config.testRenderer === "ok" ? stubSnapshotRenderer : config.testRenderer === "fail" || config.testRenderer === "no-chrome" ? undefined : chromeSnapshotRenderer(headless);
    const written = yield* PubSub.unbounded<{ readonly project: string; readonly snapshot: ArtifactSnapshot }>();
    const snapshots = new Snapshots({
      renderer: snapshotRenderer,
      folder: (project) => media.folder(project),
      read: (project) => run(rooms.read(project)),
      previewPort: (yield* settings.view).previewPort,
      publish: (project, snapshot) => void run(PubSub.publish(written, { project, snapshot })),
    });
    yield* rooms.afterOpen((project, room) => {
      snapshots.opened(project, room.read(), kitOf(room.read()));
      void media.folder(project).then((folder) => {
        const unwatch =
          folder === undefined || snapshotRenderer === undefined
            ? () => undefined
            : watchFolder(folder, (names) => {
                const records = room.read();
                void snapshots.changed(project, names, records, kitOf(records)).catch((error: unknown) => logError(`snapshots after a file change in ${project}: ${errorText(error)}`));
              });
        void run(
          openProjects.register(
            project,
            "artifact snapshots",
            Effect.sync(() => {
              unwatch();
              snapshots.forget(project);
            }),
          ),
        );
      });
    });
    yield* rooms.afterCommit((project, change, room) => {
      const kit = kitOf(room.read());
      if (change.records.has(TLDOCUMENT_ID)) snapshots.kitChanged(project, room.read(), kit);
      snapshots.committed(project, [...change.records.values()], kit);
    });

    const writeTokens = (project: string, kit: ReturnType<typeof kitOf>) =>
      ensureTokensFor(() => media.folder(project), kit, (error) => logError(`${project}: could not write ${TOKENS_FILE}: ${errorText(error)}`));
    yield* rooms.afterOpen((project, room) => writeTokens(project, kitOf(room.read())));
    yield* rooms.afterCommit((project, change, room) => {
      if (change.records.has(TLDOCUMENT_ID)) writeTokens(project, kitOf(room.read()));
    });

    const edits = artifactEditService({
      folder: (project) => media.folder(project),
      read: (project) => run(rooms.read(project)),
      swapFile: async (project, shapeId, from, to) => {
        let current = to;
        await run(
          rooms.applyWhen(
            project,
            (get) => {
              const record = get(shapeId);
              const shape = record?.typeName === "shape" ? record : undefined;
              const file = shape === undefined ? undefined : (shape.props as { file?: unknown }).file;
              if (shape === undefined || file !== from) {
                current = typeof file === "string" ? file : from;
                return undefined;
              }
              return { put: [{ ...shape, props: { ...shape.props, file: to } } as TLRecord], remove: [] };
            },
            PREPARE_ORIGIN,
          ),
        );
        return current;
      },
    });
    yield* rooms.afterCommit((project, change) => edits.committed(project, change));
    const fromEdits = <A>(attempt: () => Promise<A>): Effect.Effect<A, UnframedError> =>
      Effect.tryPromise({
        try: attempt,
        catch: (error) => (error instanceof UnframedError ? error : unframedError("internal", `Something went wrong: ${errorText(error)}`)),
      });

    const pinned = yield* PubSub.unbounded<{ readonly project: string; readonly item: PinsItem }>();
    const pins = new ComponentPins({
      folder: (project) => media.folder(project),
      read: (project) => run(rooms.read(project)),
      publish: (project, item) => void run(PubSub.publish(pinned, { project, item })),
    });
    yield* rooms.afterCommit((project, change) => void pins.committed(project, [...change.records.values()]));

    const pointers = new LivePointers((project) => media.folder(project));
    yield* rooms.afterOpen((project, room) => pointers.opened(project, room.read(), kitOf(room.read())));
    yield* rooms.afterCommit((project, change, room) => {
      const kit = kitOf(room.read());
      if (change.records.has(TLDOCUMENT_ID)) pointers.kitChanged(project, room.read(), kit);
      pointers.committed(project, change.records.values(), change.removed, kit);
    });

    const openLive = (project: string, shapeId: string) =>
      Effect.gen(function* () {
        const records = yield* rooms.read(project);
        const opened = yield* Effect.tryPromise({
          try: () => pointers.open(projectSlug(project), records.find((record) => record.id === shapeId), kitOf(records)),
          catch: (error) => unframedError("internal", `Could not open the live viewer: ${errorText(error)}`),
        });
        if (opened === false) return yield* unframedError("not_found", `There is no page or motion ${shapeId} on this canvas.`);
        return {};
      });

    const renderer = new Renderer({
      backend,
      folder: (project) => media.folder(project),
      slug: projectSlug,
      read: (project) => run(rooms.read(project)),
      apply: (project, change, origin) => run(rooms.apply(project, change, origin)),
      track: (runId, project) => runs.track(runId, project),
      registerCloser: (project, close) => run(openProjects.register(project, "render tracking", Effect.promise(close))),
    });

    const upload = (input: { project: string; fileName: string; html: string }) =>
      Effect.gen(function* () {
        if (input.html.trim() === "") return yield* unframedError("bad_request", "No composition in the request body.");
        const bytes = Buffer.byteLength(input.html, "utf8");
        if (bytes > UPLOAD_LIMIT) return yield* unframedError("bad_request", `The composition is too large (${(bytes / 1_048_576).toFixed(1)}MB). The limit is 20MB.`);
        const folder = yield* Effect.promise(() => media.folder(input.project));
        if (folder === undefined) return yield* unframedError("not_found", `There is no project named "${projectSlug(input.project)}".`);
        const fileName = input.fileName.split(/[\\/]/).pop()?.trim() || "motion.html";
        const records = yield* rooms.read(input.project);
        const html = (yield* Effect.promise(() => pinComponents(folder, records, prepareArtifactHtml(input.html, "motion")))).html;
        return yield* Effect.tryPromise({
          try: async () => {
            await ensureLibrary(folder);
            await ensureTokens(folder, kitOf(await run(rooms.read(input.project))));
            const saved = await writeUploadedArtifact(folder, { html, fileName });
            return { file: saved.file, fileName, bytes: saved.bytes, mime: "text/html" as const };
          },
          catch: (error) => unframedError("internal", `Could not save the composition: ${errorText(error)}`),
        });
      });

    const readings = new Map<string, MotionTimelineReading>();
    const timeline = (project: string, file: string) =>
      Effect.gen(function* () {
        if (file.trim() === "") return yield* unframedError("bad_request", "Which composition? Pass its .html file name.");
        const folder = yield* Effect.promise(() => media.folder(project));
        const name = basename(file);
        if (folder === undefined || name !== file || !existsSync(join(folder, name))) {
          return yield* unframedError("not_found", `No file ${file} in this project.`);
        }
        const key = `${folder}\0${name}`;
        const cached = readings.get(key);
        if (cached) return cached;
        const html = yield* Effect.promise(() => readFile(join(folder, name), "utf8"));
        const reading = motionTimeline(html, { file: name });
        readings.set(key, reading);
        return reading;
      });

    return Artifacts.of({
      upload,
      timeline,
      renderStart: (input) => Effect.tryPromise({ try: () => renderer.start(input), catch: refused }),
      renderStatus: (project, id) => Effect.try({ try: () => renderer.status(project, id), catch: refused }),
      snapshots: (project) =>
        Stream.unwrap(
          Effect.map(PubSub.subscribe(written), (subscription) => {
            const slug = projectSlug(project);
            return Stream.concat(
              Stream.unwrap(Effect.map(Effect.promise(() => snapshots.list(slug)), (known) => Stream.fromIterable(known))),
              Stream.fromSubscription(subscription).pipe(
                Stream.filter((item) => item.project === slug),
                Stream.map((item) => item.snapshot),
              ),
            );
          }),
        ),
      componentPins: (project) =>
        Stream.unwrap(
          Effect.gen(function* () {
            const slug = projectSlug(project);
            if ((yield* Effect.promise(() => media.folder(slug))) === undefined) return yield* unframedError("not_found", `There is no project named "${slug}".`);
            const subscription = yield* PubSub.subscribe(pinned);
            return Stream.concat(
              Stream.unwrap(Effect.map(Effect.promise(() => pins.initial(slug)), (items) => Stream.fromIterable(items))),
              Stream.fromSubscription(subscription).pipe(
                Stream.filter((entry) => entry.project === slug),
                Stream.map((entry) => entry.item),
              ),
            );
          }),
        ),
      componentUpdates: (project, shapeId) =>
        Effect.gen(function* () {
          const records = yield* rooms.read(project);
          const shape = records.find((record) => record.id === shapeId && record.typeName === "shape");
          const kind = shape === undefined ? undefined : shapeKind((shape as { type: string }).type);
          if (kind !== "page" && kind !== "motion") return yield* unframedError("not_found", `There is no page or motion ${shapeId} on this canvas.`);
          const file = (shape as unknown as { props: { file?: unknown } }).props.file;
          const folder = yield* Effect.promise(() => media.folder(project));
          if (folder === undefined || typeof file !== "string" || file === "") return [];
          return yield* Effect.promise(() => componentUpdatesOf(folder, records, file));
        }),
      componentCopy: (input) =>
        Effect.gen(function* () {
          const project = projectSlug(input.project);
          const from = input.from === undefined ? project : projectSlug(input.from);
          const destination = yield* Effect.promise(() => media.folder(project));
          if (destination === undefined) return yield* unframedError("not_found", `There is no project named "${project}".`);
          const source = yield* Effect.promise(() => media.folder(from));
          if (source === undefined) return yield* unframedError("bad_request", "That is not a file in this project.");
          const records = yield* rooms.read(project);
          const taken = new Set<string>();
          for (const record of records) {
            const tag = (record as { type?: unknown; props?: { tag?: unknown } }).type === "component" ? (record as { props?: { tag?: unknown } }).props?.tag : undefined;
            if (typeof tag === "string") taken.add(tag);
          }
          return yield* Effect.tryPromise({
            try: () =>
              copyComponentSheet({
                source,
                destination,
                file: input.file,
                taken,
                ofProject: from === project ? undefined : from,
              }),
            catch: (error) => (error instanceof ComponentCopyRefused ? unframedError(error.code, error.message) : unframedError("internal", `Could not copy the component: ${errorText(error)}`)),
          });
        }),
      openLive,
      sourceTree: (project, file) => fromEdits(() => edits.sourceTree(project, file)),
      prepareEdit: (project, shapeId) => fromEdits(() => edits.prepareEdit(project, shapeId)),
      edit: (project, shapeId, baseFile, list) => fromEdits(() => edits.edit(project, shapeId, baseFile, list)),
      images: (project) => fromEdits(() => edits.images(project)),
      findChrome: chrome,
      chrome: headless,
    });
  }),
);
