import { UnframedRpcs, unframedError } from "@unframed/contracts";
import type { TLRecord } from "@tldraw/tlschema";
import * as Effect from "effect/Effect";
import { CanvasRooms } from "../canvas/rooms.ts";
import { MediaStore } from "../media/mediaStore.ts";
import { clearStoredModels } from "../lastUsed.ts";
import { Native } from "../native.ts";
import { Catalogue } from "../openRouter/catalogue.ts";
import { Runs } from "../runs/runs.ts";
import { PreferencesStore } from "../preferencesStore.ts";
import { Projects } from "../projects.ts";
import { revealFiles } from "../reveal.ts";
import { Config } from "../services.ts";
import { SettingsStore } from "../settingsStore.ts";
import { guardHandlers } from "./guardHandlers.ts";

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
    const runs = yield* Runs;
    const context = yield* Effect.context<SettingsStore | Projects | Native>();

    const testOnly = <A, E>(run: () => Effect.Effect<A, E>) =>
      config.testCanvasRpc ? run() : Effect.fail(unframedError("unavailable", "That method is only for tests."));

    return guardHandlers({
      "server.health": () => Effect.map(settings.view, (view) => ({ ...view, ok: true as const })),
      "settings.get": () => settings.view,
      "settings.update": (patch) => Effect.tap(settings.update(patch), () => clearStoredModels(preferences, patch)),
      "settings.subscribe": () => settings.subscribe,
      "settings.pickFolder": () =>
        Effect.map(Effect.flatMap(settings.outputDir, native.pickFolder), (path) => ({ path })),
      "projects.list": () => Effect.map(projects.list, (list) => ({ projects: [...list] })),
      "projects.create": ({ name }) => Effect.map(projects.create(name), (slug) => ({ name: slug })),
      "files.reveal": (input) => revealFiles(input).pipe(Effect.provideContext(context)),
      "files.copy": (input) => Effect.map(media.copy(input.project, input.file, input.from), (file) => ({ file })),
      "preferences.get": ({ keys }) => Effect.map(preferences.get(keys), (values) => ({ values })),
      "preferences.set": ({ key, value }) => Effect.as(preferences.set(key, value), {}),
      "preferences.subscribe": ({ keys }) => preferences.subscribe(keys),
      "models.list": () => catalogue.listImageModels,
      "models.imagePricing": ({ id }) => catalogue.imagePricing(id),
      "run.image": (request) => runs.image(request),
      "run.subscribe": ({ project }) => runs.subscribe(project),
      "recipe.read": ({ project, shapeId }) => runs.recipe(project, shapeId),
      "recipe.copy": ({ project, from, sidecar, file }) => runs.copyRecipe(project, from, sidecar, file),
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
