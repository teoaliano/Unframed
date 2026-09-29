/**
 * Artifacts at the Effect boundary (spec 09): the motion upload, render start and status RPCs
 * and the snapshot stream, over the artifact store, the renderer and the snapshot service.
 */
import { join } from "node:path";
import type { ArtifactSnapshot, RenderStatus } from "@unframed/contracts";
import { UnframedError, unframedError } from "@unframed/contracts";
import { injectTags, projectSlug } from "@unframed/domain";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { CanvasRooms } from "../canvas/rooms.ts";
import { errorText } from "../log.ts";
import { MediaStore } from "../media/mediaStore.ts";
import { OpenProjects } from "../openProjects.ts";
import { Runs } from "../runs/runs.ts";
import { Config } from "../services.ts";
import { ensureLibrary, writeUploadedArtifact } from "./artifactStore.ts";
import { findChrome } from "./chrome.ts";
import { producerBackend, Renderer, RenderRefused, stubBackend } from "./renderer.ts";

/** A composition upload may be at most 20 MB. */
const UPLOAD_LIMIT = 20 * 1_048_576;

export class Artifacts extends Context.Service<
  Artifacts,
  {
    readonly upload: (input: { project: string; fileName: string; html: string }) => Effect.Effect<{ file: string; fileName: string; bytes: number; mime: "text/html" }, UnframedError>;
    readonly renderStart: (input: {
      project: string;
      file: string;
      title?: string | undefined;
      dials?: unknown;
      shapeId: string;
    }) => Effect.Effect<{ id: string; status: "queued"; placeholder: string }, UnframedError>;
    readonly renderStatus: (project: string, id: string) => Effect.Effect<RenderStatus, UnframedError>;
    readonly snapshots: (project: string) => Stream.Stream<ArtifactSnapshot, UnframedError>;
    /** The Chromium this machine has, for the agent's previews and snapshots. */
    readonly findChrome: () => Promise<string | undefined>;
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
    const context = yield* Effect.context<never>();
    const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> => Effect.runPromiseWith(context)(effect);

    const chrome = () => findChrome({ chromePath: config.chromePath, platform: config.platform, testRenderer: config.testRenderer });
    const fixture = join(config.installRoot, "assets", "fixtures", "render-stub.mp4");
    const backend = config.testRenderer === "ok" || config.testRenderer === "fail" ? stubBackend(config.testRenderer, fixture) : producerBackend(chrome);

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
        return yield* Effect.tryPromise({
          try: async () => {
            await ensureLibrary(folder);
            const saved = await writeUploadedArtifact(folder, { html: injectTags(input.html, "motion"), fileName });
            return { file: saved.file, fileName, bytes: saved.bytes, mime: "text/html" as const };
          },
          catch: (error) => unframedError("internal", `Could not save the composition: ${errorText(error)}`),
        });
      });

    return Artifacts.of({
      upload,
      renderStart: (input) => Effect.tryPromise({ try: () => renderer.start(input), catch: refused }),
      renderStatus: (project, id) => Effect.try({ try: () => renderer.status(project, id), catch: refused }),
      snapshots: () => Stream.empty,
      findChrome: chrome,
    });
  }),
);
