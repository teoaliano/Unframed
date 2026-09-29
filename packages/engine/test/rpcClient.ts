import { UnframedError, UnframedRpcs } from "@unframed/contracts";
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
import type * as RpcGroup from "effect/unstable/rpc/RpcGroup";
import * as RpcSerialization from "effect/unstable/rpc/RpcSerialization";
import * as Socket from "effect/unstable/socket/Socket";

type Rpcs = RpcGroup.Rpcs<typeof UnframedRpcs>;
type Client = RpcClient.FromGroup<typeof UnframedRpcs>;
type Method = Rpcs["_tag"];
type RpcOf<M extends Method> = Rpc.ExtractTag<Rpcs, M>;
type CallPayload<M extends Method> = Rpc.PayloadConstructor<RpcOf<M>>;
type Success<M extends Method> = Rpc.Success<RpcOf<M>>;
type StreamItem<M extends Method> = Rpc.Success<RpcOf<M>> extends Stream.Stream<infer A, any, any> ? A : never;

/** A live `*.subscribe` stream, collecting every value it receives. */
export interface Subscription<A> {
  readonly values: A[];
  /** Resolves with the value at `index` once it arrives (the next one when omitted). */
  next(index?: number): Promise<A>;
  /** Resolves once the engine ended the stream, or it failed. */
  ended(): Promise<void>;
  close(): Promise<void>;
}

export interface TestRpcClient {
  /** Answers the success value, or rejects with the method's `UnframedError`. */
  call<M extends Method>(method: M, ...payload: CallPayload<M> extends void ? [] : [CallPayload<M>]): Promise<Success<M>>;
  subscribe<M extends Method>(method: M, ...payload: CallPayload<M> extends void ? [] : [CallPayload<M>]): Subscription<StreamItem<M>>;
  close(): Promise<void>;
}

const unwrap = <A>(exit: Exit.Exit<A, unknown>): A => {
  if (Exit.isSuccess(exit)) return exit.value;
  const error = Cause.findErrorOption(exit.cause);
  if (error._tag === "Some") throw error.value;
  throw Cause.squash(exit.cause);
};

/** An Effect RPC client over one WebSocket to the engine, with no reconnect. */
export const connectRpc = async (url: string): Promise<TestRpcClient> => {
  const scope = Effect.runSync(Scope.make());
  const protocol = Layer.effect(
    RpcClient.Protocol,
    RpcClient.makeProtocolSocket({ retryTransientErrors: false, retryPolicy: Schedule.recurs(0) }),
  ).pipe(
    Layer.provide(Socket.layerWebSocket(url)),
    Layer.provide(Socket.layerWebSocketConstructorGlobal),
    Layer.provide(RpcSerialization.layerJson),
  );
  // Built into the long-lived scope, or the socket closes as soon as `make` returns.
  const context = await Effect.runPromise(Layer.buildWithScope(protocol, scope));
  const client = await Effect.runPromise(
    RpcClient.make(UnframedRpcs).pipe(Effect.provideContext(context), Scope.provide(scope)),
  );
  const subscriptions = new Set<Subscription<unknown>>();

  const invoke = (method: Method, payload: unknown[]): unknown =>
    (client[method] as (...args: unknown[]) => unknown)(...payload);

  return {
    async call(method, ...payload) {
      const exit = await Effect.runPromiseExit(invoke(method, payload) as Effect.Effect<never, unknown>);
      return unwrap(exit);
    },
    subscribe(method, ...payload) {
      type A = StreamItem<typeof method>;
      const values: A[] = [];
      const waiters: Array<{ index: number; resolve: (a: A) => void; reject: (e: unknown) => void }> = [];
      let failure: unknown;
      const flush = () => {
        for (const waiter of [...waiters]) {
          const value = values[waiter.index];
          if (waiter.index < values.length) {
            waiters.splice(waiters.indexOf(waiter), 1);
            waiter.resolve(value as A);
          } else if (failure !== undefined) {
            waiters.splice(waiters.indexOf(waiter), 1);
            waiter.reject(failure);
          }
        }
      };
      const fiber = Effect.runFork(
        Stream.runForEach(invoke(method, payload) as Stream.Stream<A, unknown>, (value) =>
          Effect.sync(() => {
            values.push(value);
            flush();
          }),
        ).pipe(
          Effect.catchCause((cause) =>
            Effect.sync(() => {
              failure = Cause.squash(cause);
              flush();
            }),
          ),
        ),
      );
      const finished = Effect.runPromise(Fiber.await(fiber)).then(() => undefined);
      let consumed = 0;
      const subscription: Subscription<A> = {
        values,
        next(index) {
          const at = index ?? consumed;
          consumed = Math.max(consumed, at + 1);
          return new Promise<A>((resolve, reject) => {
            waiters.push({ index: at, resolve, reject });
            flush();
          });
        },
        ended: () => finished,
        async close() {
          subscriptions.delete(subscription as Subscription<unknown>);
          await Effect.runPromise(Fiber.interrupt(fiber));
        },
      };
      subscriptions.add(subscription as Subscription<unknown>);
      return subscription;
    },
    async close() {
      for (const subscription of subscriptions) await subscription.close();
      await Effect.runPromise(Scope.close(scope, Exit.void));
    },
  };
};

export const isUnframedError = (value: unknown): value is UnframedError =>
  value instanceof UnframedError;
