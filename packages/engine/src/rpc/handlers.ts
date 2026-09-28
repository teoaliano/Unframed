import { UnframedRpcs } from "@unframed/contracts";
import * as Effect from "effect/Effect";
import { Native } from "../native.ts";
import { PreferencesStore } from "../preferencesStore.ts";
import { Projects } from "../projects.ts";
import { revealFiles } from "../reveal.ts";
import { SettingsStore } from "../settingsStore.ts";
import { guardHandlers } from "./guardHandlers.ts";

export const rpcHandlersLayer = UnframedRpcs.toLayer(
  Effect.gen(function* () {
    const settings = yield* SettingsStore;
    const projects = yield* Projects;
    const native = yield* Native;
    const preferences = yield* PreferencesStore;
    const context = yield* Effect.context<SettingsStore | Projects | Native>();
    return guardHandlers({
      "server.health": () => Effect.map(settings.view, (view) => ({ ...view, ok: true as const })),
      "settings.get": () => settings.view,
      "settings.update": (patch) => settings.update(patch),
      "settings.subscribe": () => settings.changes,
      "settings.pickFolder": () =>
        Effect.map(Effect.flatMap(settings.outputDir, native.pickFolder), (path) => ({ path })),
      "projects.list": () => Effect.map(projects.list, (list) => ({ projects: [...list] })),
      "projects.create": ({ name }) => Effect.map(projects.create(name), (slug) => ({ name: slug })),
      "files.reveal": (input) => revealFiles(input).pipe(Effect.provideContext(context)),
      "preferences.get": ({ keys }) => Effect.map(preferences.get(keys), (values) => ({ values })),
      "preferences.set": ({ key, value }) => Effect.as(preferences.set(key, value), {}),
      "preferences.subscribe": ({ keys }) => preferences.subscribe(keys),
    });
  }),
);
