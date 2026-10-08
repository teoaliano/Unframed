import type http from "node:http";
import { UnframedRpcs, type EngineIpcMessage, type Settings } from "@unframed/contracts";
import { readPort, readPreviewPort } from "@unframed/domain";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as RpcServer from "effect/unstable/rpc/RpcServer";
import { CanvasRooms, canvasRoomsLayer } from "./canvas/rooms.ts";
import { loadConfig } from "./config.ts";
import { MediaStore, mediaStoreLayer } from "./media/mediaStore.ts";
import { catalogueLayer } from "./openRouter/catalogue.ts";
import { videoCatalogueLayer } from "./openRouter/videoCatalogue.ts";
import { runsLayer } from "./runs/runs.ts";
import { presetStoreLayer } from "./library/presetStore.ts";
import { shareLinksLayer } from "./share/shareLinks.ts";
import { renderJobsLayer } from "./video/renderJobs.ts";
import { artifactsLayer } from "./artifacts/layer.ts";
import { readEnvFileSync } from "./envFile.ts";
import { createApiServer } from "./http/api.ts";
import { clientRoute } from "./http/client.ts";
import { projectFileRoute } from "./http/files.ts";
import { uploadRoute } from "./http/upload.ts";
import { startPreviewOrigin } from "./http/preview.ts";
import { listenLoopback, LOOPBACK_HOST } from "./listen.ts";
import { errorText, logError, logInfo } from "./log.ts";
import { Ipc, nativeLayer } from "./native.ts";
import { OpenProjects, openProjectsLayer } from "./openProjects.ts";
import { installRoot } from "./paths.ts";
import { preferencesStoreLayer } from "./preferencesStore.ts";
import { projectDatabaseLayer } from "./projectDatabase.ts";
import { Projects, projectsLayer } from "./projects.ts";
import { rpcHandlersLayer } from "./rpc/handlers.ts";
import { lifecycleLayer } from "./lifecycle.ts";
import { OAuth, oauthLayer } from "./oauth/oauth.ts";
import { providerDetectionLayer } from "./agent/detection.ts";
import { Agents, agentsLayer } from "./agent/layer.ts";
import { RpcSockets, rpcSocketsLayer } from "./rpc/sockets.ts";
import { Config } from "./services.ts";
import { SettingsStore, settingsStoreLayer } from "./settingsStore.ts";
import { Shutdown, shutdownLayer } from "./shutdown.ts";

export interface EngineHost {
  readonly env: NodeJS.ProcessEnv;
  readonly platform: NodeJS.Platform;
  /** The parent's IPC channel, when there is one. */
  readonly send: ((message: EngineIpcMessage) => void) | undefined;
}

export interface RunningEngine {
  readonly port: number;
  readonly previewPort: number;
  /**
   * Stops accepting connections, closes every WebSocket with 1001 and runs every
   * shutdown hook, abandoning any still running 1.5 s after the stop began.
   */
  readonly stop: () => Promise<void>;
}

/** The desktop shell's CI greps for "Unframed server": that phrase must never change. */
const banner = (port: number, settings: Settings): string =>
  [
    "",
    `  Unframed server  →  http://localhost:${port}`,
    `  image:    ${settings.imageModel}`,
    `  text:     ${settings.textModel}`,
    `  video:    ${settings.videoModel}`,
    `  api key:  ${settings.hasKey ? "loaded" : "MISSING: add one in the app (settings icon, top right)"}`,
    `  preview:  http://127.0.0.1:${settings.previewPort}`,
    `  output:   ${settings.outputDir}`,
    "",
    "",
  ].join("\n");

const stopListening = (server: http.Server) => {
  server.close();
  server.closeIdleConnections();
};

/**
 * Boots the engine: read settings, bind the preview origin, bind the API, print the
 * banner, then report ready to a parent that forked it. Rejects when it cannot listen.
 */
export const startEngine = async (host: EngineHost): Promise<RunningEngine> => {
  const { config, warnings } = loadConfig(host.env, installRoot(), host.platform);
  for (const warning of warnings) logInfo(warning);

  let fileVars: Record<string, string> = {};
  try {
    fileVars = readEnvFileSync(config.envPath);
  } catch (error) {
    logError(`could not read .env: ${errorText(error)}`);
  }
  const port = readPort(fileVars, host.env);
  if (!port.ok) throw new Error(`PORT has to be a whole number from 0 to 65535, not "${port.value}".`);
  const wantedPreviewPort = readPreviewPort(host.env);
  if (!wantedPreviewPort.ok) throw new Error(`UNFRAMED_PREVIEW_PORT has to be a whole number from 0 to 65535, not "${wantedPreviewPort.value}".`);

  // Bound before the services exist, so it reads the output folder once they do.
  let outputDir: (() => Promise<string>) | undefined;
  const preview = await startPreviewOrigin(() => (outputDir === undefined ? Promise.reject(new Error("starting")) : outputDir()), wantedPreviewPort.port).catch(
    (error: unknown) => {
      throw new Error(`could not start the preview origin on ${LOOPBACK_HOST}: ${errorText(error)}`);
    },
  );
  const previewPort = preview.port;
  if (preview.taken !== undefined) logInfo(`preview port ${preview.taken} is taken, so this run uses ${previewPort}.`);

  const services = Layer.mergeAll(RpcServer.layer(UnframedRpcs, { disableTracing: true })).pipe(
    Layer.provideMerge(rpcHandlersLayer),
    Layer.provideMerge(Layer.mergeAll(rpcSocketsLayer, Layer.provideMerge(lifecycleLayer, oauthLayer))),
    Layer.provideMerge(Layer.provideMerge(agentsLayer, providerDetectionLayer)),
    Layer.provideMerge(Layer.mergeAll(artifactsLayer, renderJobsLayer)),
    Layer.provideMerge(shareLinksLayer),
    Layer.provideMerge(runsLayer),
    Layer.provideMerge(presetStoreLayer),
    Layer.provideMerge(catalogueLayer),
    Layer.provideMerge(videoCatalogueLayer),
    Layer.provideMerge(mediaStoreLayer),
    Layer.provideMerge(canvasRoomsLayer),
    Layer.provideMerge(nativeLayer),
    Layer.provideMerge(preferencesStoreLayer),
    Layer.provideMerge(projectsLayer),
    Layer.provideMerge(projectDatabaseLayer),
    Layer.provideMerge(openProjectsLayer),
    Layer.provideMerge(settingsStoreLayer({ fileVars, processEnv: host.env, previewPort })),
    Layer.provideMerge(shutdownLayer),
    Layer.provideMerge(Layer.succeed(Config, config)),
    Layer.provideMerge(Layer.succeed(Ipc, { send: host.send })),
  );
  const runtime = ManagedRuntime.make(services);
  const booted = await runtime.runPromise(
    Effect.gen(function* () {
      const store = yield* SettingsStore;
      const shutdown = yield* Shutdown;
      const openProjects = yield* OpenProjects;
      yield* shutdown.register(
        "open projects",
        Effect.flatMap(openProjects.closeAll, (failures) =>
          Effect.sync(() => {
            for (const failure of failures) {
              logError(`could not close ${failure.name} of ${failure.project}: ${failure.reason}`);
            }
          }),
        ),
      );
      const hookMs = config.testShutdownHookMs;
      if (hookMs !== undefined) yield* shutdown.register("test hook", Effect.sleep(hookMs));
      return {
        settings: yield* store.view,
        sockets: yield* RpcSockets,
        rooms: yield* CanvasRooms,
        media: yield* MediaStore,
        projects: yield* Projects,
        agents: yield* Agents,
        oauth: yield* OAuth,
        shutdown,
        outputDir: store.outputDir,
      };
    }),
  );
  outputDir = () => runtime.runPromise(booted.outputDir);
  const { settings, sockets, rooms, media, projects, shutdown, agents, oauth } = booted;

  const api = createApiServer({
    http: [
      projectFileRoute((project) => runtime.runPromise(projects.folder(project))),
      uploadRoute(media),
      ...agents.routes,
      oauth.callbackRoute,
      ...(config.clientDist === undefined ? [] : [clientRoute(config.clientDist)]),
    ],
    upgrade: [sockets.upgrade, rooms.upgrade],
  });
  const apiPort = await listenLoopback(api, port.port).catch((error: unknown) => {
    throw new Error(`could not listen on ${LOOPBACK_HOST}:${port.port}: ${errorText(error)}`);
  });

  agents.runtime.setApiPort(apiPort);
  oauth.setApiPort(apiPort);
  process.stdout.write(banner(apiPort, settings));
  host.send?.({ type: "ready", port: apiPort, previewPort });

  const stop = async () => {
    const startedAt = Date.now();
    stopListening(api);
    preview.stopListening();
    await Promise.all([sockets.closeAll(1001), rooms.closeSockets(1001)]);
    await runtime.runPromise(shutdown.runHooks(startedAt));
    api.closeAllConnections();
    preview.closeAllConnections();
  };
  return { port: apiPort, previewPort, stop };
};
