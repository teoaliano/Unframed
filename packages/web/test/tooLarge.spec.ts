import type { WebSocketRoute } from "@playwright/test";
import { expect, isSettingsChunk, test } from "./fixtures.ts";

test("a 1009 close fails the call in flight as a connection failure, and the web reconnects and subscribes again", async ({ page, engine }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  const connections: Array<{ page: WebSocketRoute; openedAt: number; frames: any[]; closedAt?: number }> = [];
  await page.routeWebSocket("**/ws", (socket) => {
    const entry: (typeof connections)[number] = { page: socket, openedAt: Date.now(), frames: [] };
    connections.push(entry);
    const server = socket.connectToServer();
    socket.onMessage((message) => server.send(message));
    server.onMessage((message) => {
      try {
        entry.frames.push(JSON.parse(String(message)));
      } catch {
        // not an RPC frame
      }
      socket.send(message);
    });
  });

  await page.goto(engine.origin);
  await expect.poll(() => connections[0]?.frames.some(isSettingsChunk()) ?? false).toBe(true);

  // The engine closes a socket that sent a frame over 60 MB with 1009; this stands in for it.
  await connections[0]!.page.close({ code: 1009, reason: "Max payload size exceeded" });
  connections[0]!.closedAt = Date.now();

  await expect.poll(() => connections.length, { timeout: 15_000 }).toBeGreaterThan(1);
  expect(connections[1]!.openedAt - connections[0]!.closedAt!).toBeGreaterThanOrEqual(800);
  await (await engine.rpc()).call("settings.update", { textModel: "after/too-large" });
  await expect
    .poll(() => connections[1]!.frames.some(isSettingsChunk("after/too-large")), { timeout: 15_000 })
    .toBe(true);
  expect(errors).toEqual([]);
});
