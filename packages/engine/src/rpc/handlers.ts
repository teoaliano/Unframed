import { UnframedRpcs, unframedError, type ResultRecipe, type UnframedError } from "@unframed/contracts";
import type { TLRecord } from "@tldraw/tlschema";
import * as Effect from "effect/Effect";
import { CanvasRooms } from "../canvas/rooms.ts";
import { MediaStore } from "../media/mediaStore.ts";
import { clearStoredModels } from "../lastUsed.ts";
import { Native } from "../native.ts";
import { Catalogue } from "../openRouter/catalogue.ts";
import { VideoCatalogue } from "../openRouter/videoCatalogue.ts";
import { Runs } from "../runs/runs.ts";
import { RenderJobs } from "../video/renderJobs.ts";
import { PreferencesStore } from "../preferencesStore.ts";
import { Projects } from "../projects.ts";
import { revealFiles } from "../reveal.ts";
import { Config } from "../services.ts";
import { SettingsStore } from "../settingsStore.ts";
import { guardHandlers } from "./guardHandlers.ts";
import { copyPresetFiles } from "../library/presetCopier.ts";
import { PresetStore } from "../library/presetStore.ts";
import { ProviderDetection } from "../agent/detection.ts";
import { Agents } from "../agent/layer.ts";
import { Lifecycle } from "../lifecycle.ts";
import { OAuth } from "../oauth/oauth.ts";
import { Artifacts } from "../artifacts/layer.ts";

export const rpcHandlersLayer = UnframedRpcs.toLayer(
  Effect.gen(function* () {
    const settings = yield* SettingsStore;
    const projects = yield* Projects;
    const native = yield* Native;
    const preferences = yield* PreferencesStore;
    const rooms = yield* CanvasRooms;
    const media = yield* MediaStore;
    const config = yield* Config;
    const catalogue = yield* Catalogue;
    const videoCatalogue = yield* VideoCatalogue;
    const runs = yield* Runs;
    const renderJobs = yield* RenderJobs;
    const presets = yield* PresetStore;
    const detection = yield* ProviderDetection;
    const agents = yield* Agents;
    const lifecycle = yield* Lifecycle;
    const oauth = yield* OAuth;
    const artifacts = yield* Artifacts;
    const context = yield* Effect.context<SettingsStore | Projects | Native>();

    const testOnly = <A, E>(run: () => Effect.Effect<A, E>) =>
      config.testCanvasRpc ? run() : Effect.fail(unframedError("unavailable", "That method is only for tests."));

    return guardHandlers({
      "server.health": () => Effect.map(settings.view, (view) => ({ ...view, ok: true as const })),
      "settings.get": () => settings.view,
      "settings.update": (patch) =>
        Effect.tap(lifecycle.updateSettings(patch), () =>
          Effect.andThen(clearStoredModels(preferences, patch), () =>
            Effect.all([
              patch.claudePath !== undefined || patch.claudeConfigDir !== undefined ? detection.forget("claude") : Effect.void,
              patch.codexPath !== undefined ? detection.forget("codex") : Effect.void,
            ]),
          ),
        ),
      "settings.subscribe": () => settings.subscribe,
      "settings.removeKey": () => lifecycle.removeKey,
      "oauth.start": () => oauth.start,
      "oauth.pending": () => oauth.pending,
      "oauth.cancel": () => lifecycle.cancelConnection,
      "oauth.status": () => oauth.status,
      "projects.rename": ({ name, to }) => lifecycle.renameProject(name, to),
      "projects.delete": ({ name, confirmRenders }) => lifecycle.deleteProject(name, confirmRenders === true),
      "settings.pickFolder": () =>
        Effect.map(Effect.flatMap(settings.outputDir, native.pickFolder), (path) => ({ path })),
      "projects.list": () => Effect.map(projects.list, (list) => ({ projects: [...list] })),
      "projects.create": ({ name }) => Effect.map(projects.create(name), (slug) => ({ name: slug })),
      "files.reveal": (input) => revealFiles(input).pipe(Effect.provideContext(context)),
      "files.copy": (input) => Effect.map(media.copy(input.project, input.file, input.from), (file) => ({ file })),
      "preferences.get": ({ keys }) => Effect.map(preferences.get(keys), (values) => ({ values })),
      "preferences.set": ({ key, value }) => Effect.as(preferences.set(key, value), {}),
      "preferences.subscribe": ({ keys }) => preferences.subscribe(keys),
      "models.list": ({ medium }) =>
        medium === "video" ? videoCatalogue.list : medium === "text" ? catalogue.listTextModels : catalogue.listImageModels,
      "models.imagePricing": ({ id }) => catalogue.imagePricing(id),
      "run.image": (request) => runs.image(request),
      "run.text": (request) => runs.text(request),
      "text.complete": (request) => runs.complete(request),
      "run.subscribe": ({ project }) => runs.subscribe(project),
      // A render placeholder has no sidecar until its clip lands: its recipe is in the job record (spec 04).
      "recipe.read": ({ project, shapeId }) =>
        runs.recipe(project, shapeId).pipe(
          Effect.catchIf(
            (error: UnframedError) => error.code === "not_found",
            (error) =>
              Effect.flatMap(renderJobs.placeholderRecipe(project, shapeId), (recipe): Effect.Effect<ResultRecipe, UnframedError> =>
                recipe ? Effect.succeed(recipe) : Effect.fail(error),
              ),
          ),
        ),
      "recipe.copy": ({ project, from, sidecar, file }) => runs.copyRecipe(project, from, sidecar, file),
      "video.start": (request) => renderJobs.start(request),
      "video.poll": (request) => renderJobs.poll(request),
      "video.forget": ({ project, jobId }) => renderJobs.forget(project, jobId),
      "library.list": () => presets.list,
      "library.save": (input) => presets.save(input),
      "library.delete": ({ id }) => presets.remove(id),
      "library.copyFiles": ({ project, files }) => presets.serialised(copyPresetFiles(media, project, files)),
      "providers.getStatuses": ({ refresh, projectId }) =>
        Effect.flatMap(projectId === undefined ? Effect.succeed(undefined) : projects.folder(projectId), (projectFolder) =>
          detection.statuses({ ...(refresh === undefined ? {} : { refresh }), ...(projectFolder === undefined ? {} : { projectFolder }) }),
        ),
      "orchestration.dispatchCommand": (command) => agents.dispatch(command),
      "orchestration.subscribeShell": ({ projectId, afterSequence }) => agents.subscribeShell(projectId, afterSequence),
      "orchestration.subscribeThread": ({ projectId, threadId, afterSequence }) => agents.subscribeThread(projectId, threadId, afterSequence),
      "attachments.createUploadUrl": (input) => agents.createUploadUrl(input),
      "orchestration.searchThreads": ({ projectId, query, limit }) => agents.searchThreads(projectId, query, limit),
      "orchestration.getTurnDiff": (input) => agents.turnDiff(input),
      "orchestration.getFullThreadDiff": ({ toTurnCount, ...rest }) => agents.turnDiff({ ...rest, fromTurnCount: 0, toTurnCount }),
      "motion.upload": (input) => artifacts.upload(input),
      "motion.renderStart": (input) => artifacts.renderStart(input),
      "motion.renderStatus": ({ project, id }) => artifacts.renderStatus(project, id),
      "artifact.snapshots": ({ project }) => artifacts.snapshots(project),
      "testCanvas.read": ({ project }) =>
        testOnly(() =>
          Effect.all({ clock: rooms.clock(project), records: Effect.map(rooms.read(project), (records) => [...records]) }),
        ),
      "testCanvas.apply": ({ project, change, origin }) =>
        testOnly(() =>
          Effect.map(
            rooms.apply(project, { put: change.put as ReadonlyArray<TLRecord>, remove: change.remove }, origin),
            (applied) => ({ clock: applied.clock, inverse: { put: [...applied.inverse.put], remove: [...applied.inverse.remove] } }),
          ),
        ),
      "testCanvas.changedSince": ({ project, recordIds, clock }) =>
        testOnly(() => Effect.map(rooms.changedSince(project, recordIds, clock), (ids) => ({ ids: [...ids] }))),
    });
  }),
);
