import { join } from "node:path";
import type { ClientChatCommand, ShellStreamItem, ThreadSearchMatch, ThreadStreamItem, TurnDiff } from "@unframed/contracts";
import { UnframedError, unframedError } from "@unframed/contracts";
import { defaultModel, projectSlug, type ClientCommand } from "@unframed/domain";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import { CanvasRooms } from "../canvas/rooms.ts";
import type { Route } from "../http/api.ts";
import { errorText } from "../log.ts";
import { OpenProjects } from "../openProjects.ts";
import { ProjectDatabase } from "../projectDatabase.ts";
import { Config } from "../services.ts";
import { SettingsStore } from "../settingsStore.ts";
import { AttachmentRefused } from "./attachmentStore.ts";
import { realAdapter } from "./adapters/real.ts";
import { ProviderDetection } from "./detection.ts";
import { mcpRoute, refusal, type OutsideProject } from "./mcp.ts";
import { AgentConnections } from "../agentConnections/layer.ts";
import { SelectionHub } from "../selection/liveSelection.ts";
import { PreferencesStore } from "../preferencesStore.ts";
import { Projects } from "../projects.ts";
import { AgentRuntime, DispatchError } from "./runtime.ts";
import { ArtifactTools } from "../artifacts/artifactTools.ts";
import { Artifacts } from "../artifacts/layer.ts";
import { PreviewTools } from "../artifacts/previewTools.ts";
import { openShell, openThread } from "./subscriptions.ts";

/**
 * The agent runtime at the Effect boundary (spec 07): the RPC methods and the two plain HTTP
 * routes (the MCP endpoint and the signed attachment upload path).
 */
export class Agents extends Context.Service<
  Agents,
  {
    readonly runtime: AgentRuntime;
    readonly dispatch: (command: ClientChatCommand) => Effect.Effect<{ sequence: number }, UnframedError>;
    readonly subscribeShell: (projectId: string, afterSequence: number | undefined) => Stream.Stream<ShellStreamItem, UnframedError>;
    readonly subscribeThread: (projectId: string, threadId: string, afterSequence: number | undefined) => Stream.Stream<ThreadStreamItem, UnframedError>;
    readonly searchThreads: (projectId: string, query: string, limit: number | undefined) => Effect.Effect<{ matches: ReadonlyArray<ThreadSearchMatch> }, UnframedError>;
    readonly turnDiff: (input: { projectId: string; threadId: string; fromTurnCount: number; toTurnCount: number; ignoreWhitespace?: boolean }) => Effect.Effect<TurnDiff, UnframedError>;
    readonly createUploadUrl: (input: { name: string; mimeType: string; sizeBytes: number }) => Effect.Effect<{ relativeUrl: string; expiresAt: string }, UnframedError>;
    readonly routes: ReadonlyArray<Route>;
  }
>()("unframed/engine/Agents") {}

const toUnframed = (error: unknown): UnframedError => {
  if (error instanceof UnframedError) return error;
  if (error instanceof DispatchError) return unframedError(error.code, error.message);
  return unframedError("internal", `The chat store failed: ${errorText(error)}`);
};

export const agentsLayer = Layer.effect(
  Agents,
  Effect.gen(function* () {
    const config = yield* Config;
    const settings = yield* SettingsStore;
    const database = yield* ProjectDatabase;
    const openProjects = yield* OpenProjects;
    const rooms = yield* CanvasRooms;
    const detection = yield* ProviderDetection;
    const { previewPort } = yield* settings.view;
    const artifacts = yield* Artifacts;
    const connections = yield* AgentConnections;
    const projects = yield* Projects;
    const preferences = yield* PreferencesStore;
    const context = yield* Effect.context<never>();
    const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> =>
      Effect.runPromiseWith(context)(effect).catch((error: unknown) => {
        throw error instanceof UnframedError ? new Error(error.message) : error;
      });

    /** Every project in the output folder, sorted by name, with its folder and the active one (spec 14). */
    const outsideProjects = (): Promise<ReadonlyArray<OutsideProject>> =>
      run(
        Effect.gen(function* () {
          const names = yield* projects.list;
          const prefs = yield* preferences.get(["project.active"]);
          const active = typeof prefs["project.active"] === "string" ? prefs["project.active"] : undefined;
          const entries: OutsideProject[] = [];
          for (const name of [...names].sort()) {
            const folder = yield* projects.folder(name);
            if (folder !== undefined) entries.push({ name, folder, active: name === active });
          }
          return entries;
        }),
      );

    const preview = new PreviewTools({
      read: (project) => run(rooms.read(project)),
      chrome: artifacts.chrome,
      findChrome: artifacts.findChrome,
      previewPort: () => previewPort,
      registerCloser: (project, close) => void run(openProjects.register(project, "preview tabs", Effect.promise(close))),
    });

    const selection = yield* SelectionHub;
    const runtime = new AgentRuntime({
      dataDir: config.dataDir,
      selection,
      testAgentScript: config.testAgentScript,
      idleMs: config.testAgentIdleMs,
      outsideTurnIdleMs: config.outsideTurnIdleMs,
      uploadUrlTtlMs: config.testUploadUrlTtlMs,
      agentDebug: config.agentDebug,
      projectFolder: async (project) => {
        const slug = projectSlug(project);
        return slug === "" ? undefined : join(await run(settings.outputDir), slug);
      },
      openDatabase: async (slug) => (await run(database.open(slug))).db,
      registerCloser: (slug, name, close) => run(openProjects.register(slug, name, Effect.promise(close))),
      rooms: {
        read: (project) => run(rooms.read(project)),
        apply: (project, change, origin) => run(rooms.apply(project, change, origin)),
        clock: (project) => run(rooms.clock(project)),
        changeLog: (project, clock) => run(rooms.changeLog(project, clock)),
      },
      runEnvironment: (provider) => run(detection.runEnvironment(provider)),
      defaultModel: async (provider) => defaultModel((await run(detection.statuses({})))[provider].models ?? []),
      realAdapter,
      extraTools: (tools) => [...new ArtifactTools(tools, () => previewPort).tools(), ...preview.tools()],
      onSessionClosed: (_project, chatId) => void preview.closeChat(chatId),
    });

    const opened = (projectId: string) =>
      Effect.tryPromise({ try: () => runtime.project(projectId), catch: toUnframed });

    const subscribe = <A>(
      projectId: string,
      exists: (agent: Awaited<ReturnType<AgentRuntime["project"]>>) => boolean,
      open: (agent: Awaited<ReturnType<AgentRuntime["project"]>>, emit: (item: A) => void) => (() => void) | undefined,
    ) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const agent = yield* opened(projectId);
          if (!exists(agent)) return yield* unframedError("not_found", "That chat does not exist.");
          return Stream.callback<A, UnframedError>((queue) =>
            Effect.gen(function* () {
              let stop: (() => void) | undefined;
              const end = () => {
                stop?.();
                agent.subscriptions.delete(end);
                Queue.endUnsafe(queue);
              };
              stop = open(agent, (item) => Queue.offerUnsafe(queue, item));
              if (stop === undefined) {
                Queue.endUnsafe(queue);
                return;
              }
              agent.subscriptions.add(end);
              yield* Effect.addFinalizer(() =>
                Effect.sync(() => {
                  stop?.();
                  agent.subscriptions.delete(end);
                }),
              );
            }),
          );
        }),
      );

    return Agents.of({
      runtime,
      dispatch: (command) => {
        // The wire schema and the domain type describe one command: this assignment fails to compile if they drift.
        const decided: ClientCommand = command;
        return Effect.tryPromise({ try: () => runtime.dispatch(decided), catch: toUnframed });
      },
      subscribeShell: (projectId, afterSequence) =>
        subscribe<ShellStreamItem>(projectId, () => true, (agent, emit) => openShell(agent.engine, afterSequence, emit)),
      subscribeThread: (projectId, threadId, afterSequence) =>
        subscribe<ThreadStreamItem>(
          projectId,
          (agent) => agent.engine.chat(threadId)?.deletedAt === null,
          (agent, emit) => openThread(agent.engine, threadId, afterSequence, emit),
        ),
      searchThreads: (projectId, query, limit) =>
        Effect.tryPromise({ try: async () => ({ matches: await runtime.searchThreads(projectId, query, limit) }), catch: toUnframed }),
      turnDiff: (input) =>
        Effect.tryPromise({
          try: () => runtime.turnDiff(input.projectId, input.threadId, input.fromTurnCount, input.toTurnCount, input.ignoreWhitespace === true),
          catch: toUnframed,
        }),
      createUploadUrl: (input) =>
        Effect.try({
          try: () => runtime.attachments.createUploadUrl(input),
          catch: (error) => (error instanceof AttachmentRefused ? unframedError("bad_request", error.message) : toUnframed(error)),
        }),
      routes: [
        mcpRoute(runtime.tokens, runtime.registry, undefined, {
          book: connections.book,
          listProjects: () => outsideProjects(),
          tools: () => [...runtime.registry.list(), ...runtime.outsideTools],
          projectSlug: async (name) => {
            const slug = projectSlug(name);
            const names = await projects.list.pipe(Effect.runPromise);
            return names.includes(slug) ? slug : undefined;
          },
          call: (call) => runtime.outside.call(call),
          endSession: (sessionId) => runtime.endOutsideSession(sessionId),
        }),
        runtime.attachments.route(),
      ],
    });
  }),
);
