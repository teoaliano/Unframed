import { UnframedError, UnframedRpcs, unframedError, type ResultRecipe } from "@unframed/contracts";
import { connectionSetup } from "@unframed/domain";
import { AgentConnections } from "../agentConnections/layer.ts";
import { SelectionHub } from "../selection/liveSelection.ts";
import { projectSlug } from "@unframed/domain";
import type { SelectionApply } from "@unframed/contracts";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import { errorText } from "../log.ts";
import { exportKit, kitUsage } from "../kits/kitFiles.ts";
import { kitOf } from "../kits/tokensFile.ts";
import type { TLRecord } from "@tldraw/tlschema";
import * as Effect from "effect/Effect";
import { CanvasRooms } from "../canvas/rooms.ts";
import { MediaStore } from "../media/mediaStore.ts";
import { clearStoredModels } from "../lastUsed.ts";
import { Native } from "../native.ts";
import { Catalogue } from "../openRouter/catalogue.ts";
import { ElevenLabsError, listAudioModels, listVoices, subscriptionStatus } from "../elevenLabs/client.ts";
import { ELEVENLABS_NO_KEY, GENERATION_PROVIDERS, providerServesMessage } from "@unframed/domain";
import { vercelCredits } from "../vercel/client.ts";
import { providerCatalogues } from "../runs/providers.ts";
import { VideoCatalogue } from "../openRouter/videoCatalogue.ts";
import { Runs } from "../runs/runs.ts";
import { RenderJobs } from "../video/renderJobs.ts";
import { PreferencesStore } from "../preferencesStore.ts";
import { Projects } from "../projects.ts";
import { filePath, revealFiles } from "../reveal.ts";
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
import { legacyImportMethods } from "../legacy/methods.ts";
import { ProjectDatabase } from "../projectDatabase.ts";
import { projectActivityStream } from "../projectActivity.ts";
import { IpadAccess } from "../ipad/layer.ts";
import { CLIENT_HEADER } from "../ipad/deviceSockets.ts";

const clientOf = (headers: Readonly<Record<string, string>>): "mac" | "device" => (headers[CLIENT_HEADER] === "device" ? "device" : "mac");
import { NodeRuns } from "../nodes/nodeRuns.ts";
import { flowContent } from "../nodes/flowSave.ts";

const asUnframed = (error: unknown): UnframedError => (error instanceof UnframedError ? error : unframedError("internal", errorText(error)));

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
    const catalogues = providerCatalogues({
      vercelOrigin: config.vercelOrigin,
      openRouter: (medium) => Effect.runPromise(medium === "image" ? catalogue.listImageModels : catalogue.listTextModels),
    });
    const videoCatalogue = yield* VideoCatalogue;
    const runs = yield* Runs;
    const renderJobs = yield* RenderJobs;
    const presets = yield* PresetStore;
    const detection = yield* ProviderDetection;
    const agents = yield* Agents;
    const lifecycle = yield* Lifecycle;
    const oauth = yield* OAuth;
    const artifacts = yield* Artifacts;
    const connections = yield* AgentConnections;
    const selectionHub = yield* SelectionHub;
    const ipad = yield* IpadAccess;
    const nodeRuns = yield* NodeRuns;
    const legacy = legacyImportMethods(yield* ProjectDatabase, projects);
    const context = yield* Effect.context<SettingsStore | Projects | Native>();

    const testOnly = <A, E>(run: () => Effect.Effect<A, E>) =>
      config.testCanvasRpc ? run() : Effect.fail(unframedError("unavailable", "That method is only for tests."));

    return guardHandlers({
      "server.health": (_payload, { headers }) => Effect.map(settings.view, (view) => ({ ...view, ok: true as const, client: clientOf(headers) })),
      "ipad.status": () => ipad.status,
      "ipad.setAvailability": ({ available }) => Effect.as(ipad.setAvailability(available), {}),
      "ipad.pairStart": () => ipad.pairStart,
      "ipad.devices": () => Effect.map(ipad.devices, (devices) => ({ devices })),
      "ipad.revoke": ({ id }) => Effect.as(ipad.revoke(id), {}),
      "ipad.exportProfile": () => Effect.flatMap(ipad.exportProfile, (path) => Effect.as(native.reveal(config.ipadDir, [path]), { path })),
      "settings.get": () => settings.view,
      "settings.update": (patch) =>
        Effect.tap(Effect.tap(lifecycle.updateSettings(patch), () => ipad.apply), () =>
          Effect.andThen(clearStoredModels(preferences, patch), () =>
            Effect.all([
              patch.claudePath !== undefined || patch.claudeConfigDir !== undefined ? detection.forget("claude") : Effect.void,
              patch.codexPath !== undefined ? detection.forget("codex") : Effect.void,
            ]),
          ),
        ),
      "settings.subscribe": () => settings.subscribe,
      "settings.removeKey": () => lifecycle.removeKey,
      "settings.removeElevenLabsKey": () => lifecycle.removeElevenLabsKey,
      "elevenlabs.status": () =>
        Effect.flatMap(settings.read, (current) =>
          Effect.tryPromise({
            try: () => subscriptionStatus(config.elevenLabsOrigin, current.elevenLabsKey),
            catch: (error) => unframedError("upstream", errorText(error)),
          }),
        ),
      "settings.removeVercelKey": () => lifecycle.removeVercelKey,
      "vercel.status": () =>
        Effect.flatMap(settings.read, (current) =>
          Effect.tryPromise({
            try: () => vercelCredits(config.vercelOrigin, current.vercelKey),
            catch: (error) => unframedError("upstream", errorText(error)),
          }),
        ),
      "voices.list": (input) =>
        Effect.flatMap(settings.read, (current) =>
          current.elevenLabsKey === ""
            ? Effect.fail(unframedError("unavailable", ELEVENLABS_NO_KEY))
            : Effect.tryPromise({
                try: () => listVoices(config.elevenLabsOrigin, current.elevenLabsKey, input),
                catch: (error) => unframedError("upstream", error instanceof ElevenLabsError ? error.message : errorText(error)),
              }),
        ),
      "run.audio": (request) => runs.audio(request),
      "oauth.start": () => oauth.start,
      "oauth.pending": () => oauth.pending,
      "oauth.cancel": () => lifecycle.cancelConnection,
      "oauth.status": () => oauth.status,
      "projects.rename": ({ name, to }) => lifecycle.renameProject(name, to),
      "projects.delete": ({ name, confirmRenders }) => lifecycle.deleteProject(name, confirmRenders === true),
      "settings.pickFolder": () =>
        Effect.map(Effect.flatMap(settings.outputDir, native.pickFolder), (path) => ({ path })),
      "projects.list": () => Effect.map(projects.list, (list) => ({ projects: [...list] })),
      "projects.activity": () =>
        projectActivityStream({
          list: projects.list,
          live: (project) =>
            Effect.map(runs.liveRuns(project), (liveRuns) => {
              const chats = agents.runtime.liveActivity(project);
              return { running: liveRuns + chats.running, needsYou: chats.needsYou };
            }),
        }).pipe(Stream.mapError(asUnframed)),
      "projects.create": ({ name }) => Effect.map(projects.create(name), (slug) => ({ name: slug })),
      "files.reveal": (input) => revealFiles(input).pipe(Effect.provideContext(context)),
      "files.path": (input) => filePath(input).pipe(Effect.provideContext(context)),
      "files.copy": (input) => Effect.map(media.copy(input.project, input.file, input.from), (file) => ({ file })),
      "selection.report": ({ project, windowId, shapeIds }) =>
        Effect.as(
          Effect.sync(() => selectionHub.report(projectSlug(project), windowId, shapeIds)),
          {},
        ),
      "selection.snapshotResult": (result) => Effect.as(Effect.sync(() => selectionHub.snapshotResult(result)), {}),
      "selection.subscribe": ({ project, windowId }) =>
        Stream.callback<SelectionApply, UnframedError>((queue) =>
          Effect.gen(function* () {
            const detach = selectionHub.attach(projectSlug(project), windowId, (item) => Queue.offerUnsafe(queue, item));
            yield* Effect.addFinalizer(() => Effect.sync(detach));
          }),
        ),
      "agentConnections.list": () => Effect.sync(() => ({ connections: connections.book.list() })),
      "agentConnections.create": ({ name, client, spendLimit }) =>
        Effect.tryPromise({ try: () => connections.book.create({ name, client, ...(spendLimit === undefined ? {} : { spendLimit }) }), catch: asUnframed }).pipe(
          Effect.map(({ connection, token }) => ({
            connection,
            token,
            setup: connectionSetup({
              client,
              platform: process.platform,
              execPath: process.execPath,
              shimPath: config.shimPath,
              dataDir: config.dataDir,
              token,
              runAsNode: config.runAsNode,
            }).steps,
          })),
        ),
      "agentConnections.setSpendLimit": ({ id, spendLimit }) =>
        Effect.tryPromise({ try: () => connections.book.setSpendLimit(id, spendLimit), catch: asUnframed }).pipe(Effect.as({})),
      "agentConnections.revoke": ({ id }) =>
        Effect.tryPromise({
          try: async () => {
            await connections.book.revoke(id);
            await agents.runtime.disconnectOutside(id);
          },
          catch: asUnframed,
        }).pipe(Effect.as({})),
      "preferences.get": ({ keys }) => Effect.map(preferences.get(keys), (values) => ({ values })),
      "preferences.set": ({ key, value }) => Effect.as(preferences.set(key, value), {}),
      "preferences.subscribe": ({ keys }) => preferences.subscribe(keys),
      "models.list": ({ medium, provider }) =>
        provider !== undefined && provider !== "openrouter"
          ? GENERATION_PROVIDERS[provider].media.includes(medium) && (medium === "image" || medium === "text")
            ? Effect.flatMap(settings.read, (current) => Effect.promise(() => catalogues[provider](current, medium)))
            : Effect.fail(unframedError("bad_request", providerServesMessage(provider, medium)))
          : medium === "audio"
          ? Effect.flatMap(settings.read, (current) => Effect.promise(() => listAudioModels(config.elevenLabsOrigin, current.elevenLabsKey, current.audioModel)))
          : medium === "video"
            ? videoCatalogue.list
            : medium === "text"
              ? catalogue.listTextModels
              : catalogue.listImageModels,
      "models.imagePricing": ({ id }) => catalogue.imagePricing(id),
      "run.image": (request) => runs.image(request),
      "node.run": ({ project, shapeId, downstream, scope, rendered, steps }) => nodeRuns.run({ project, ids: [shapeId], downstream, scope, rendered, expect: steps }),
      "chain.run": ({ project, shapeIds, rendered, steps }) => nodeRuns.run({ project, ids: shapeIds, rendered, expect: steps }),
      "node.useVersion": ({ project, shapeId, versionId }) => nodeRuns.useVersion(project, shapeId, versionId),
      "node.removeVersion": ({ project, shapeId, versionId }) => nodeRuns.removeVersion(project, shapeId, versionId),
      "node.renders": ({ project, files }) => nodeRuns.renders(project, files),
      "flow.save": ({ project, shapeIds, name, summary }) =>
        Effect.gen(function* () {
          const made = flowContent(project, yield* rooms.read(project), shapeIds, name);
          if ("error" in made) return yield* unframedError("bad_request", made.error);
          const saved = yield* presets.save({ name, summary: summary ?? "", content: made.content });
          return { preset: saved.preset, droppedWires: made.droppedWires };
        }),
      "run.text": (request) => runs.text(request),
      "text.complete": (request) => runs.complete(request),
      "run.subscribe": ({ project }) => runs.subscribe(project),
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
      "motion.timeline": ({ project, file }) => artifacts.timeline(project, file),
      "artifact.snapshots": ({ project }) => artifacts.snapshots(project),
      "artifact.fileChanges": ({ project }) => artifacts.fileChanges(project),
      "component.pins": ({ project }) => artifacts.componentPins(project),
      "component.copy": (input) => artifacts.componentCopy(input),
      "component.updates": ({ project, shapeId }) => artifacts.componentUpdates(project, shapeId),
      "artifact.openLive": ({ project, shapeId }) => artifacts.openLive(project, shapeId),
      "kit.usage": ({ project }) =>
        Effect.gen(function* () {
          const records = yield* rooms.read(project);
          const folder = yield* Effect.promise(() => media.folder(project));
          if (folder === undefined) return yield* unframedError("not_found", `There is no project named "${projectSlug(project)}".`);
          return yield* Effect.tryPromise({
            try: () => kitUsage(records, folder),
            catch: (error) => unframedError("internal", `Could not read the uses of the kit: ${errorText(error)}`),
          });
        }),
      "kit.saveToLibrary": ({ project, name, summary }) =>
        Effect.gen(function* () {
          if (name.trim() === "") return yield* unframedError("bad_request", "Give it a name.");
          const kit = kitOf(yield* rooms.read(project));
          if (kit === null) return yield* unframedError("bad_request", "This project has no kit yet.");
          const { from: _link, ...definition } = kit;
          return yield* presets.saveKit({ name, summary, kit: definition });
        }),
      "kit.updateInLibrary": ({ project }) =>
        Effect.gen(function* () {
          const kit = kitOf(yield* rooms.read(project));
          if (kit === null) return yield* unframedError("bad_request", "This project has no kit yet.");
          if (kit.from === undefined) return yield* unframedError("bad_request", "This kit is not linked to your library.");
          const { from, ...definition } = kit;
          return yield* presets.updateKit({ id: from.presetId, kit: definition, knownRevision: from.revision });
        }),
      "kit.exportFile": ({ project, format }) =>
        Effect.gen(function* () {
          const kit = kitOf(yield* rooms.read(project));
          if (kit === null) return yield* unframedError("bad_request", "This project has no kit yet.");
          const folder = yield* Effect.promise(() => media.folder(project));
          if (folder === undefined) return yield* unframedError("not_found", `There is no project named "${projectSlug(project)}".`);
          return yield* Effect.tryPromise({
            try: () => exportKit(folder, kit, format),
            catch: (error) => unframedError("internal", `Could not write the export: ${errorText(error)}`),
          });
        }),
      "artifact.sourceTree": ({ project, file }) => artifacts.sourceTree(project, file),
      "artifact.prepareEdit": ({ project, shapeId }) => artifacts.prepareEdit(project, shapeId),
      "artifact.edit": ({ project, shapeId, baseFile, edits }) => artifacts.edit(project, shapeId, baseFile, [...edits]),
      "artifact.images": ({ project }) => artifacts.images(project),
      "legacyImport.status": ({ project }) => legacy.status(project),
      "legacyImport.report": ({ project }) => legacy.report(project),
      "legacyImport.markSeen": ({ project }) => legacy.markSeen(project),
      "legacyImport.retry": ({ project }) => legacy.retry(project),
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
