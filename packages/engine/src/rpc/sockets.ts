import type http from "node:http";
import type { Duplex } from "node:stream";
import { UnframedRpcs, unframedError } from "@unframed/contracts";
import { MAX_REQUEST_BYTES } from "@unframed/domain";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";
import * as Rpc from "effect/unstable/rpc/Rpc";
import type { FromClientEncoded, FromServerEncoded } from "effect/unstable/rpc/RpcMessage";
import * as RpcServer from "effect/unstable/rpc/RpcServer";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import type { UpgradeRoute } from "../http/api.ts";
import { logInfo } from "../log.ts";

/** The inbound frame limit. A larger frame closes that socket with 1009. */
export const MAX_FRAME_BYTES = MAX_REQUEST_BYTES;
export const RPC_PATH = "/ws";

/**
 * Methods whose payload refuses any field its schema does not name, at any depth. A chat
 * command never carries a binary path or anything else a page could use to choose what
 * runs (spec 07): paths arrive only through settings.
 */
const STRICT_PAYLOADS: ReadonlySet<string> = new Set(["orchestration.dispatchCommand"]);

/**
 * The RPC socket at `/ws`: every connected client, and the RPC server protocol that
 * carries their messages. One bad frame closes only its own socket. Hand-written because
 * Effect's socket protocol answers a non-JSON frame and an undecodable payload with a
 * defect, where the spec needs a 1007 close and `bad_request` naming the field.
 */
export class RpcSockets extends Context.Service<
  RpcSockets,
  {
    readonly upgrade: UpgradeRoute;
    /** Closes every socket with `code` and waits (briefly) for them to go. */
    readonly closeAll: (code: number) => Promise<void>;
  }
>()("unframed/engine/RpcSockets") {}

type RpcCodecs = {
  readonly decodePayload: (input: unknown) => Exit.Exit<unknown, Schema.SchemaError>;
  readonly encodeExit: (exit: Exit.Exit<unknown, unknown>) => unknown;
};

const describeIssue = (error: Schema.SchemaError): { message: string; field: string } => {
  const [first] = SchemaIssue.makeFormatterStandardSchemaV1()(error.issue).issues;
  const path = (first?.path ?? [])
    .map((segment, index) => (typeof segment === "number" ? `[${segment}]` : index === 0 ? String(segment) : `.${String(segment)}`))
    .join("");
  const problem = first?.message ?? "Invalid value";
  if (path === "") return { field: "", message: `That request is not valid: ${problem}.` };
  if (problem === "Missing key") return { field: path, message: `The request field "${path}" is missing.` };
  return { field: path, message: `The request field "${path}" is not valid: ${problem}.` };
};

const frameText = (data: RawData): string =>
  Buffer.isBuffer(data) ? data.toString("utf8") : Array.isArray(data) ? Buffer.concat(data).toString("utf8") : Buffer.from(data).toString("utf8");

const isMessage = (value: unknown): value is FromClientEncoded =>
  typeof value === "object" && value !== null && typeof (value as { _tag?: unknown })._tag === "string";

export const rpcSocketsLayer = Layer.effectContext(
  Effect.gen(function* () {
    const context = yield* Effect.context<never>();
    const runPromise = Effect.runPromiseWith(context);
    const disconnects = yield* Queue.unbounded<number>();
    const clients = new Map<number, WebSocket>();
    let nextClientId = 0;

    const codecs = new Map<string, RpcCodecs>();
    const codecsFor = (tag: string): RpcCodecs | undefined => {
      const cached = codecs.get(tag);
      if (cached) return cached;
      const rpc = UnframedRpcs.requests.get(tag);
      if (!rpc) return undefined;
      const made: RpcCodecs = {
        decodePayload: Schema.decodeUnknownExit(
          Schema.toCodecJson(rpc.payloadSchema),
          STRICT_PAYLOADS.has(tag) ? { onExcessProperty: "error" } : undefined,
        ) as RpcCodecs["decodePayload"],
        encodeExit: Schema.encodeSync(Schema.toCodecJson(Rpc.exitSchema(rpc))) as RpcCodecs["encodeExit"],
      };
      codecs.set(tag, made);
      return made;
    };

    const send = (clientId: number, response: FromServerEncoded) =>
      Effect.sync(() => {
        const socket = clients.get(clientId);
        if (socket && socket.readyState === socket.OPEN) socket.send(JSON.stringify(response));
      });

    let writeRequest: (clientId: number, data: FromClientEncoded) => Effect.Effect<void> = () => Effect.void;
    const protocol = yield* RpcServer.Protocol.make((write) => {
      writeRequest = write;
      return Effect.succeed({
        disconnects,
        send,
        end: () => Effect.void,
        clientIds: Effect.sync(() => new Set(clients.keys())),
        initialMessage: Effect.succeed(Option.none()),
        supportsAck: true,
        supportsTransferables: false,
        supportsSpanPropagation: false,
        supportsNotifications: false,
        codecFor: Schema.toCodecJson,
      });
    });

    /** Answers a payload that fails decoding with `bad_request` naming the field, never a defect. */
    const refuseUndecodable = (clientId: number, message: FromClientEncoded): boolean => {
      if (message._tag !== "Request") return false;
      const rpcCodecs = codecsFor(message.tag);
      if (!rpcCodecs) return false;
      const decoded = rpcCodecs.decodePayload(message.payload);
      if (Exit.isSuccess(decoded)) return false;
      const failure = Exit.findErrorOption(decoded);
      const described = Option.isSome(failure)
        ? describeIssue(failure.value)
        : { field: "", message: "That request is not valid." };
      const error = unframedError("bad_request", described.message, described.field ? { field: described.field } : undefined);
      void runPromise(
        send(clientId, { _tag: "Exit", requestId: message.id, exit: rpcCodecs.encodeExit(Exit.fail(error)) } as FromServerEncoded),
      );
      return true;
    };

    const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES, perMessageDeflate: false });

    const onConnection = (socket: WebSocket) => {
      const clientId = nextClientId++;
      clients.set(clientId, socket);
      let queue: Promise<void> = Promise.resolve();
      socket.on("message", (data) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(frameText(data));
        } catch {
          logInfo("ws: closed a socket that sent a frame that was not JSON");
          socket.close(1007);
          return;
        }
        const messages = Array.isArray(parsed) ? parsed : [parsed];
        if (!messages.every(isMessage)) {
          logInfo("ws: closed a socket that sent a frame that was not an RPC message");
          socket.close(1007);
          return;
        }
        for (const message of messages) {
          if (refuseUndecodable(clientId, message)) continue;
          queue = queue.then(() => runPromise(writeRequest(clientId, message))).catch(() => {});
        }
      });
      socket.on("error", () => {});
      socket.on("close", () => {
        clients.delete(clientId);
        Queue.offerUnsafe(disconnects, clientId);
      });
    };

    const upgrade: UpgradeRoute = (req: http.IncomingMessage, socket: Duplex, head: Buffer, url: URL) => {
      if (url.pathname !== RPC_PATH) return false;
      wss.handleUpgrade(req, socket, head, onConnection);
      return true;
    };

    const closeAll = async (code: number) => {
      const open = [...clients.values()];
      await Promise.all(
        open.map(
          (socket) =>
            new Promise<void>((resolve) => {
              if (socket.readyState === socket.CLOSED) return resolve();
              const timer = setTimeout(() => {
                socket.terminate();
                resolve();
              }, 250);
              socket.once("close", () => {
                clearTimeout(timer);
                resolve();
              });
              socket.close(code);
            }),
        ),
      );
    };

    return Context.make(RpcSockets, RpcSockets.of({ upgrade, closeAll })).pipe(
      Context.add(RpcServer.Protocol, protocol),
    );
  }),
);
