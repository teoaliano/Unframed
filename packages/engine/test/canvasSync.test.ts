import type http from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type WebSocket from "ws";
import { imageShape, promptShape, textOf } from "./canvasRecords.ts";
import { startEngine, type TestEngine } from "./harness.ts";
import { connectTab } from "./syncClient.ts";

type Outcome = { opened: true } | { opened: false; status: number; body: string };

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
      res.on("end", () => resolve({ opened: false, status: res.statusCode ?? 0, body }));
    });
  });

describe("the sync endpoint", () => {
  let engine: TestEngine;
  beforeAll(async () => {
    engine = await startEngine();
    await (await engine.rpc()).call("projects.create", { name: "board" });
  });
  afterAll(() => engine.dispose());

  it("upgrades a same-machine request at /sync/<project>", async () => {
    const path = "/sync/board?sessionId=abc";
    expect(await outcome(engine.socket({ path, headers: { origin: `http://127.0.0.1:${engine.port}` } }))).toEqual({ opened: true });
  });

  it("refuses a non-loopback Origin before tldraw sees the socket", async () => {
    expect(await outcome(engine.socket({ path: "/sync/board?sessionId=abc", headers: { origin: "https://evil.example" } }))).toEqual({
      opened: false,
      status: 403,
      body: JSON.stringify({ error: "Unframed answers only same-machine requests." }),
    });
  });

  it("refuses a non-loopback Host before tldraw sees the socket", async () => {
    const socket = engine.socket({ path: "/sync/board?sessionId=abc", headers: { host: `rebound.example:${engine.port}` } });
    expect(await outcome(socket)).toEqual({
      opened: false,
      status: 403,
      body: JSON.stringify({ error: "Unframed answers only requests addressed to localhost." }),
    });
  });

  it("closes the socket of an unknown project with the reason unknown project", async () => {
    const tab = await connectTab(engine.port, "nowhere");
    await expect(tab.loaded).rejects.toThrow("unknown project");
    expect(await tab.closed()).toEqual({ code: 4099, reason: "unknown project" });
  });

  it("loads a known project's canvas", async () => {
    const tab = await connectTab(engine.port, "board");
    await tab.loaded;
    expect(tab.records().some((record) => record.typeName === "page")).toBe(true);
    await tab.close();
  });
});

describe("one room per project", () => {
  let engine: TestEngine;
  beforeAll(async () => {
    engine = await startEngine();
    const rpc = await engine.rpc();
    await rpc.call("projects.create", { name: "one" });
    await rpc.call("projects.create", { name: "two" });
  });
  afterAll(() => engine.dispose());

  it("sends a change from one tab to a second tab of the same project", async () => {
    const first = await connectTab(engine.port, "one");
    const second = await connectTab(engine.port, "one");
    await Promise.all([first.loaded, second.loaded]);
    await first.put([promptShape("shared", "300", "hello from the first tab")]);
    expect(textOf(await second.waitFor(() => second.get("shape:shared")))).toBe("hello from the first tab");
    await Promise.all([first.close(), second.close()]);
  });

  it("keeps projects apart", async () => {
    const one = await connectTab(engine.port, "one");
    const two = await connectTab(engine.port, "two");
    await Promise.all([one.loaded, two.loaded]);
    await one.put([promptShape("only-in-one", "301", "mine")]);
    const other = await connectTab(engine.port, "two");
    await other.loaded;
    expect(other.get("shape:only-in-one")).toBeUndefined();
    expect(two.get("shape:only-in-one")).toBeUndefined();
    await Promise.all([one.close(), two.close(), other.close()]);
  });

  it("keeps the canvas in the project database: a later tab sees what an earlier one wrote", async () => {
    const writer = await connectTab(engine.port, "two");
    await writer.loaded;
    await writer.put([imageShape("kept", "302", null, { x: 12, y: 34 })]);
    await writer.close();
    const reader = await connectTab(engine.port, "two");
    await reader.loaded;
    expect(reader.get("shape:kept")).toMatchObject({ x: 12, y: 34, meta: { ref: "302" } });
    await reader.close();
  });
});
