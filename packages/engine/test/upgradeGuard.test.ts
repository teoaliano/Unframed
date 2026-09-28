import type http from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type WebSocket from "ws";
import { startEngine, type TestEngine } from "./harness.ts";

type Outcome = { opened: true } | { opened: false; status: number; body: string; upgrade: string | undefined };

const outcome = (socket: WebSocket): Promise<Outcome> =>
  new Promise((resolve) => {
    socket.on("open", () => {
      socket.close();
      resolve({ opened: true });
    });
    socket.on("unexpected-response", (_req: http.ClientRequest, res: http.IncomingMessage) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => (body += chunk));
      res.on("end", () => resolve({ opened: false, status: res.statusCode ?? 0, body, upgrade: res.headers.upgrade }));
    });
  });

describe("WebSocket upgrade guard", () => {
  let engine: TestEngine;
  beforeAll(async () => {
    engine = await startEngine();
  });
  afterAll(() => engine.dispose());

  it("upgrades a same-machine request", async () => {
    expect(await outcome(engine.socket({ headers: { origin: `http://localhost:${engine.port}` } }))).toEqual({ opened: true });
    expect(await outcome(engine.socket())).toEqual({ opened: true });
  });

  it("refuses a non-loopback Origin with a plain 403 and no handshake", async () => {
    const result = await outcome(engine.socket({ headers: { origin: "https://evil.example" } }));
    expect(result).toEqual({
      opened: false,
      status: 403,
      body: JSON.stringify({ error: "Unframed answers only same-machine requests." }),
      upgrade: undefined,
    });
  });

  it("refuses a non-loopback Host with a plain 403 and no handshake", async () => {
    const result = await outcome(engine.socket({ headers: { host: `rebound.example:${engine.port}` } }));
    expect(result).toEqual({
      opened: false,
      status: 403,
      body: JSON.stringify({ error: "Unframed answers only requests addressed to localhost." }),
      upgrade: undefined,
    });
  });

  it("refuses an upgrade on the preview origin the same way", async () => {
    const socket = engine.socket({ port: engine.previewPort, headers: { origin: "https://evil.example" } });
    expect(await outcome(socket)).toEqual({
      opened: false,
      status: 403,
      body: JSON.stringify({ error: "Unframed answers only same-machine requests." }),
      upgrade: undefined,
    });
  });

  it("refuses an upgrade on any path but /ws", async () => {
    expect(await outcome(engine.socket({ path: "/other" }))).toMatchObject({ opened: false, status: 404 });
  });
});
