import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { WebSocket } from "ws";
import { Ipc } from "../native.ts";
import { Config } from "../services.ts";

export const KEEP_AWAKE_OFF_MS = 30_000;
const TEST_KEEP_AWAKE_OFF_MS = 500;

export class Presence extends Context.Service<
  Presence,
  {
    readonly track: (deviceId: string, socket: WebSocket) => void;
    readonly count: () => number;
    readonly closeDevice: (id: string, code: number) => Promise<void>;
    readonly closeAll: (code: number) => Promise<void>;
  }
>()("unframed/engine/Presence") {}

const closeSocket = (socket: WebSocket, code: number): Promise<void> =>
  new Promise((resolve) => {
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
  });

export const presenceLayer = Layer.effect(
  Presence,
  Effect.gen(function* () {
    const config = yield* Config;
    const ipc = yield* Ipc;
    const hostedSend = config.clientDist !== undefined ? ipc.send : undefined;
    const offMs = config.testIpadName === undefined ? KEEP_AWAKE_OFF_MS : TEST_KEEP_AWAKE_OFF_MS;
    const sockets = new Map<WebSocket, string>();
    let awake = false;
    let offTimer: NodeJS.Timeout | undefined;

    const settle = () => {
      if (sockets.size > 0) {
        if (offTimer !== undefined) {
          clearTimeout(offTimer);
          offTimer = undefined;
        }
        if (!awake) {
          awake = true;
          hostedSend?.({ type: "keep-awake", on: true });
        }
        return;
      }
      if (!awake || offTimer !== undefined) return;
      offTimer = setTimeout(() => {
        offTimer = undefined;
        if (sockets.size > 0) return;
        awake = false;
        hostedSend?.({ type: "keep-awake", on: false });
      }, offMs);
      offTimer.unref();
    };

    const forget = (socket: WebSocket) => {
      if (!sockets.delete(socket)) return;
      settle();
    };

    return Presence.of({
      track: (deviceId, socket) => {
        sockets.set(socket, deviceId);
        socket.once("close", () => forget(socket));
        socket.once("error", () => forget(socket));
        settle();
      },
      count: () => sockets.size,
      closeDevice: async (id, code) => {
        const theirs = [...sockets].filter(([, deviceId]) => deviceId === id).map(([socket]) => socket);
        await Promise.all(theirs.map((socket) => closeSocket(socket, code)));
      },
      closeAll: async (code) => {
        await Promise.all([...sockets.keys()].map((socket) => closeSocket(socket, code)));
      },
    });
  }),
);
