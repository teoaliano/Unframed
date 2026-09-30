import type WebSocket from "ws";

/** A raw `/ws` socket speaking Effect RPC's JSON frames directly, for tests of the wire itself. */
export interface RawRpcSocket {
  readonly socket: WebSocket;
  readonly received: any[];
  send(frame: unknown): void;
  sendText(text: string | Buffer): void;
  /** Resolves with the first received message matching the predicate. */
  waitFor(predicate: (message: any) => boolean, timeoutMs?: number): Promise<any>;
  /** Resolves with the close code once the socket closes. */
  readonly closed: Promise<number>;
}

export const request = (id: string, tag: string, payload: unknown) => ({
  _tag: "Request",
  id,
  tag,
  payload,
  headers: [],
});

export const openRawSocket = async (socket: WebSocket): Promise<RawRpcSocket> => {
  const received: any[] = [];
  const closed = new Promise<number>((resolve) => socket.on("close", (code) => resolve(code)));
  socket.on("message", (data) => {
    let message: any;
    try {
      message = JSON.parse(String(data));
    } catch {
      received.push({ unparsable: String(data) });
      return;
    }
    received.push(message);
    // The server sends a stream's next chunk only once the last one is acknowledged.
    if (message._tag === "Chunk") socket.send(JSON.stringify({ _tag: "Ack", requestId: message.requestId }));
  });
  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("unexpected-response", () => reject(new Error("upgrade refused")));
  });
  return {
    socket,
    received,
    send: (frame) => socket.send(JSON.stringify(frame)),
    sendText: (text) => socket.send(text),
    closed,
    waitFor: (predicate, timeoutMs = 10_000) =>
      new Promise((resolve, reject) => {
        const started = Date.now();
        const timer = setInterval(() => {
          const found = received.find(predicate);
          if (found !== undefined) {
            clearInterval(timer);
            resolve(found);
          } else if (Date.now() - started > timeoutMs) {
            clearInterval(timer);
            reject(new Error(`no matching message; got ${JSON.stringify(received)}`));
          }
        }, 5);
      }),
  };
};
