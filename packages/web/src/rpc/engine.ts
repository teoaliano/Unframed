import { UnframedError, UnframedRpcs, unframedError } from "@unframed/contracts";
import { connectionFailure, reconnectDelay } from "@unframed/domain";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import type * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcClient from "effect/unstable/rpc/RpcClient";
import { RpcClientError } from "effect/unstable/rpc/RpcClientError";
import type * as RpcGroup from "effect/unstable/rpc/RpcGroup";
import * as RpcSerialization from "effect/unstable/rpc/RpcSerialization";
import * as Socket from "effect/unstable/socket/Socket";

type Rpcs = RpcGroup.Rpcs<typeof UnframedRpcs>;
export type Method = Rpcs["_tag"];
type RpcOf<M extends Method> = Rpc.ExtractTag<Rpcs, M>;
export type Payload<M extends Method> = Rpc.PayloadConstructor<RpcOf<M>>;
export type Success<M extends Method> = Rpc.Success<RpcOf<M>>;
export type StreamItem<M extends Method> =
  Rpc.Success<RpcOf<M>> extends Stream.Stream<infer A, any, any> ? A : never;
type PayloadArgs<M extends Method> = Payload<M> extends void ? [] : [Payload<M>];

export type ConnectionState = "connecting" | "open" | "closed";

/** A failure made on this side because the socket went away, not one the engine answered. */
export const isConnectionFailure = (error: unknown): boolean =>
  error instanceof UnframedError &&
  (error.details?.reason === "connection_lost" || error.details?.reason === "too_large");

export interface EngineConnection {
  /**
   * Answers the success value, or rejects with an `UnframedError`: the method's own, or a
   * connection failure when the socket closed with the call in flight. A call made while
   * the socket is down waits for the next one.
   */
  call<M extends Method>(method: M, ...payload: PayloadArgs<M>): Promise<Success<M>>;
  /**
   * Calls `onValue` for every value of a `*.subscribe` stream, and subscribes again each
   * time the socket reconnects. Answers a function that ends the subscription.
   */
  subscribe<M extends Method>(method: M, payload: Payload<M>, onValue: (value: StreamItem<M>) => void): () => void;
  onStateChange(listener: (state: ConnectionState) => void): () => void;
  readonly state: ConnectionState;
  /** Closes the socket for good. */
  close(): void;
}

export const engineSocketUrl = (location: Location): string =>
  `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;

/** Every failure the web handles is an `UnframedError`; a closed socket becomes one here. */
const asUnframedError = (error: unknown): unknown => {
  if (!(error instanceof RpcClientError)) return error;
  const failure = connectionFailure(error.reason._tag === "SocketCloseError" ? error.reason.code : undefined);
  return unframedError(failure.code, failure.message, { reason: failure.reason });
};

/** The web's one connection to the engine: Effect's RPC client over its WebSocket transport. */
export const connectEngine = (url: string = engineSocketUrl(window.location)): EngineConnection => {
  let state: ConnectionState = "connecting";
  let closed = false;
  let failedAttempts = 0;
  const listeners = new Set<(state: ConnectionState) => void>();
  const setState = (next: ConnectionState) => {
    if (next === state) return;
    state = next;
    for (const listener of listeners) listener(next);
  };

  const hooks = RpcClient.ConnectionHooks.of({
    onConnect: Effect.sync(() => {
      failedAttempts = 0;
      setState("open");
    }),
    onDisconnect: Effect.sync(() => setState(closed ? "closed" : "connecting")),
  });
  // The delay comes from a counter the open socket resets, so every drop starts again at
  // 1 s; a schedule's own state would keep growing across drops.
  const retryPolicy = Schedule.modifyDelay(Schedule.forever, () => Effect.sync(() => reconnectDelay(failedAttempts++)));
  const protocol = Layer.effect(
    RpcClient.Protocol,
    RpcClient.makeProtocolSocket({ retryTransientErrors: true, retryPolicy }),
  ).pipe(
    Layer.provide(
      Layer.mergeAll(Socket.layerWebSocket(url), RpcSerialization.layerJson, Layer.succeed(RpcClient.ConnectionHooks, hooks)),
    ),
    Layer.provide(Socket.layerWebSocketConstructorGlobal),
  );
  const scope = Effect.runSync(Scope.make());
  const client = Effect.runPromise(
    Effect.gen(function* () {
      const context = yield* Layer.buildWithScope(protocol, scope);
      return yield* RpcClient.make(UnframedRpcs).pipe(Effect.provideContext(context), Scope.provide(scope));
    }),
  );

  const waitForOpen = () =>
    new Promise<void>((resolve) => {
      if (state === "open") return resolve();
      const stop = connection.onStateChange((next) => {
        if (next !== "open") return;
        stop();
        resolve();
      });
    });

  const invoke = async (method: Method, payload: unknown[]) => {
    await waitForOpen();
    return ((await client)[method] as (...args: unknown[]) => unknown)(...payload);
  };

  const connection: EngineConnection = {
    async call(method, ...payload) {
      const exit = await Effect.runPromiseExit((await invoke(method, payload)) as Effect.Effect<never, unknown>);
      if (Exit.isSuccess(exit)) return exit.value;
      const error = Cause.findErrorOption(exit.cause);
      throw error._tag === "Some" ? asUnframedError(error.value) : Cause.squash(exit.cause);
    },
    subscribe(method, payload, onValue) {
      let ended = false;
      let stopCurrent: (() => void) | undefined;
      void (async () => {
        while (!ended) {
          const stream = (await invoke(method, [payload])) as Stream.Stream<StreamItem<typeof method>, unknown>;
          if (ended) return;
          const fiber = Effect.runFork(Stream.runForEach(stream, (value) => Effect.sync(() => onValue(value))));
          stopCurrent = () => void Effect.runFork(Fiber.interrupt(fiber));
          const exit = await Effect.runPromise(Fiber.await(fiber));
          if (ended || Exit.isSuccess(exit)) return;
          const error = Cause.findErrorOption(exit.cause);
          if (error._tag === "None" || !isConnectionFailure(asUnframedError(error.value))) {
            console.error(`${method} ended:`, Cause.pretty(exit.cause));
            return;
          }
        }
      })();
      return () => {
        ended = true;
        stopCurrent?.();
      };
    },
    onStateChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    get state() {
      return state;
    },
    close() {
      closed = true;
      void Effect.runPromise(Scope.close(scope, Exit.void));
    },
  };
  return connection;
};
