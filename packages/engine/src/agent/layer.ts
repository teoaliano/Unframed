import { join } from "node:path";
import type { ClientChatCommand, ShellStreamItem, ThreadStreamItem } from "@unframed/contracts";
import { UnframedError, unframedError } from "@unframed/contracts";
import { projectSlug, type ClientCommand } from "@unframed/domain";
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
import { mcpRoute } from "./mcp.ts";
import { AgentRuntime, DispatchError } from "./runtime.ts";
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
    const context = yield* Effect.context<never>();
    const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> =>
      Effect.runPromiseWith(context)(effect).catch((error: unknown) => {
        throw error instanceof UnframedError ? new Error(error.message) : error;
      });

    const runtime = new AgentRuntime({
      dataDir: config.dataDir,
      testAgentScript: config.testAgentScript,
      idleMs: config.testAgentIdleMs,
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
      realAdapter,
    });

    const opened = (projectId: string) =>
      Effect.tryPromise({ try: () => runtime.project(projectId), catch: toUnframed });

    const subscribe = <A>(projectId: string, open: (agent: Awaited<ReturnType<AgentRuntime["project"]>>, emit: (item: A) => void) => (() => void) | undefined) =>
      Stream.callback<A, UnframedError>((queue) =>
        Effect.gen(function* () {
          const agent = yield* opened(projectId);
          let stop: (() => void) | undefined;
          const end = () => {
            stop?.();
            agent.subscriptions.delete(end);
            Queue.endUnsafe(queue);
          };
          stop = open(agent, (item) => Queue.offerUnsafe(queue, item));
          if (stop === undefined) return yield* unframedError("not_found", "That chat does not exist.");
          agent.subscriptions.add(end);
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              stop?.();
              agent.subscriptions.delete(end);
            }),
          );
        }),
      );

    return Agents.of({
      runtime,
      dispatch: (command) => Effect.tryPromise({ try: () => runtime.dispatch(command as ClientCommand), catch: toUnframed }),
      subscribeShell: (projectId, afterSequence) => subscribe<ShellStreamItem>(projectId, (agent, emit) => openShell(agent.engine, afterSequence, emit)),
      subscribeThread: (projectId, threadId, afterSequence) =>
        subscribe<ThreadStreamItem>(projectId, (agent, emit) => openThread(agent.engine, threadId, afterSequence, emit)),
      createUploadUrl: (input) =>
        Effect.try({
          try: () => runtime.attachments.createUploadUrl(input),
          catch: (error) => (error instanceof AttachmentRefused ? unframedError("bad_request", error.message) : toUnframed(error)),
        }),
      routes: [mcpRoute(runtime.tokens, runtime.registry), runtime.attachments.route()],
    });
  }),
);
