import { UnframedError, UnframedRpcs, unframedError } from "@unframed/contracts";
import { MAX_REQUEST_BYTES, reconnectDelay, tooLargeMessage } from "@unframed/domain";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcClient from "effect/unstable/rpc/RpcClient";
import type * as RpcGroup from "effect/unstable/rpc/RpcGroup";
import type { FromClientEncoded, FromServerEncoded } from "effect/unstable/rpc/RpcMessage";

type Rpcs = RpcGroup.Rpcs<typeof UnframedRpcs>;
export type Method = Rpcs["_tag"];
type RpcOf<M extends Method> = Rpc.ExtractTag<Rpcs, M>;
export type Payload<M extends Method> = Rpc.PayloadConstructor<RpcOf<M>>;
export type Success<M extends Method> = Rpc.Success<RpcOf<M>>;
export type StreamItem<M extends Method> =
  Rpc.Success<RpcOf<M>> extends Stream.Stream<infer A, any, any> ? A : never;
type PayloadArgs<M extends Method> = Payload<M> extends void ? [] : [Payload<M>];

export type ConnectionState = "connecting" | "open" | "closed";

/** A failure made on this side because the socket went away, not answered by the engine. */
export const isConnectionFailure = (error: unknown): boolean =>
  error instanceof UnframedError &&
  (error.details?.reason === "connection_lost" || error.details?.reason === "too_large");

export interface EngineConnection {
  /** Answers the success value, or rejects with the method's `UnframedError`. */
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

const TOO_LARGE = 1009;

export const engineSocketUrl = (location: Location): string =>
  `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;

type Transport = {
  send(clientId: number, message: FromClientEncoded): void;
  onResponse: (clientId: number, message: FromServerEncoded) => void;
};

/**
 * One WebSocket at a time to `/ws`. Requests made while it is down wait for the next
 * socket; requests in flight when it closes fail at once, with the size message when the
 * engine closed it for a frame over the limit.
 */
const makeTransport = (url: string, setState: (state: ConnectionState) => void) => {
  let socket: WebSocket | undefined;
  let open = false;
  let closedForGood = false;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const waiting: Array<{ clientId: number; message: FromClientEncoded }> = [];
  const inFlight = new Map<string, { clientId: number; tag: string; id: string | number }>();
  const clientIds = new Set<number>();

  const transport: Transport & { close(): void } = {
    onResponse: () => {},
    send(clientId, message) {
      clientIds.add(clientId);
      if (message._tag === "Request") {
        if (!open) {
          waiting.push({ clientId, message });
          return;
        }
        inFlight.set(String(message.id), { clientId, tag: message.tag, id: message.id });
      } else if (message._tag === "Interrupt") {
        const requestId = String(message.requestId);
        inFlight.delete(requestId);
        const queued = waiting.findIndex((entry) => entry.message._tag === "Request" && String(entry.message.id) === requestId);
        if (queued >= 0) {
          waiting.splice(queued, 1);
          return;
        }
      }
      if (open) socket?.send(JSON.stringify(message));
    },
    close() {
      closedForGood = true;
      clearTimeout(timer);
      socket?.close(1000);
    },
  };

  const failInFlight = (code: number) => {
    const error =
      code === TOO_LARGE
        ? unframedError("bad_request", tooLargeMessage(undefined, MAX_REQUEST_BYTES), { reason: "too_large" })
        : unframedError("unavailable", "The connection to the local engine was lost.", { reason: "connection_lost" });
    const failed = [...inFlight.entries()];
    inFlight.clear();
    for (const { clientId, tag, id } of failed.map(([, entry]) => entry)) {
      const rpc = UnframedRpcs.requests.get(tag);
      if (!rpc) continue;
      const exit = Schema.encodeSync(Schema.toCodecJson(Rpc.exitSchema(rpc)))(Exit.fail(error) as never);
      // The client keys its requests by the id as it sent it, number or string.
      transport.onResponse(clientId, { _tag: "Exit", requestId: id, exit } as FromServerEncoded);
    }
  };

  const connect = () => {
    setState("connecting");
    const next = new WebSocket(url);
    socket = next;
    next.onopen = () => {
      open = true;
      attempt = 0;
      setState("open");
      for (const { clientId, message } of waiting.splice(0)) transport.send(clientId, message);
    };
    next.onmessage = (event: MessageEvent) => {
      let message: FromServerEncoded;
      try {
        message = JSON.parse(String(event.data)) as FromServerEncoded;
      } catch {
        return;
      }
      if (message._tag === "Pong") return;
      if ("requestId" in message) {
        const target = inFlight.get(String(message.requestId));
        if (!target) return;
        if (message._tag === "Exit") inFlight.delete(String(message.requestId));
        transport.onResponse(target.clientId, message);
        return;
      }
      for (const clientId of clientIds) transport.onResponse(clientId, message);
    };
    next.onclose = (event: CloseEvent) => {
      if (socket !== next) return;
      open = false;
      socket = undefined;
      failInFlight(event.code);
      if (closedForGood) {
        setState("closed");
        return;
      }
      setState("connecting");
      timer = setTimeout(connect, reconnectDelay(attempt++));
    };
  };
  connect();
  return transport;
};

/** The web's one connection to the engine, through Effect's RPC client. */
export const connectEngine = (url: string = engineSocketUrl(window.location)): EngineConnection => {
  let state: ConnectionState = "connecting";
  const listeners = new Set<(state: ConnectionState) => void>();
  const setState = (next: ConnectionState) => {
    if (next === state) return;
    state = next;
    for (const listener of listeners) listener(next);
  };
  const transport = makeTransport(url, setState);

  const protocol = Layer.effect(
    RpcClient.Protocol,
    RpcClient.Protocol.make((writeResponse) =>
      Effect.gen(function* () {
        const context = yield* Effect.context<never>();
        const runPromise = Effect.runPromiseWith(context);
        let order: Promise<void> = Promise.resolve();
        transport.onResponse = (clientId, message) => {
          order = order.then(() => runPromise(writeResponse(clientId, message))).catch(() => {});
        };
        return {
          send: (clientId: number, request: FromClientEncoded) => Effect.sync(() => transport.send(clientId, request)),
          supportsAck: true,
          supportsTransferables: false,
          codecFor: Schema.toCodecJson,
        };
      }),
    ),
  );
  const scope = Effect.runSync(Scope.make());
  const client = Effect.runPromise(
    Effect.gen(function* () {
      const context = yield* Layer.buildWithScope(protocol, scope);
      return yield* RpcClient.make(UnframedRpcs).pipe(Effect.provideContext(context), Scope.provide(scope));
    }),
  );

  const invoke = async (method: Method, payload: unknown[]) =>
    ((await client)[method] as (...args: unknown[]) => unknown)(...payload);

  const waitForOpen = () =>
    new Promise<void>((resolve) => {
      if (state === "open") return resolve();
      const stop = connection.onStateChange((next) => {
        if (next !== "open") return;
        stop();
        resolve();
      });
    });

  const connection: EngineConnection = {
    async call(method, ...payload) {
      const exit = await Effect.runPromiseExit((await invoke(method, payload)) as Effect.Effect<never, unknown>);
      if (Exit.isSuccess(exit)) return exit.value;
      const error = Cause.findErrorOption(exit.cause);
      throw error._tag === "Some" ? error.value : Cause.squash(exit.cause);
    },
    subscribe(method, payload, onValue) {
      let ended = false;
      let stopCurrent: (() => void) | undefined;
      void (async () => {
        while (!ended) {
          const stream = (await invoke(method, [payload])) as Stream.Stream<StreamItem<typeof method>, unknown>;
          const fiber = Effect.runFork(Stream.runForEach(stream, (value) => Effect.sync(() => onValue(value))));
          stopCurrent = () => void Effect.runFork(Fiber.interrupt(fiber));
          const exit = await Effect.runPromise(Fiber.await(fiber));
          if (ended || Exit.isSuccess(exit)) return;
          const error = Cause.findErrorOption(exit.cause);
          if (error._tag === "None" || !isConnectionFailure(error.value)) {
            console.error(`${method} ended:`, Cause.pretty(exit.cause));
            return;
          }
          await waitForOpen();
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
      transport.close();
      void Effect.runPromise(Scope.close(scope, Exit.void));
    },
  };
  return connection;
};
