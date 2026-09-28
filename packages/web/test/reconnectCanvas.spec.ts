import { rm } from "node:fs/promises";
import type { Page, WebSocketRoute } from "@playwright/test";
import { makeTempDir } from "../../engine/test/engineProcess.ts";
import { centre, openCanvas, roomRecords, shapeOnScreen, toast } from "./canvas.ts";
import { expect, startHostedEngine, test } from "./fixtures.ts";

const LOST = "Lost the connection to the local server. Reconnecting…";

const dragBy = async (page: Page, id: string, dx: number, dy: number) => {
  const from = await centre(shapeOnScreen(page, id));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let step = 1; step <= 8; step++) await page.mouse.move(from.x + (dx * step) / 8, from.y + (dy * step) / 8);
  await page.mouse.up();
};

test("the canvas reconnects by itself after an engine restart, with backoff, and sends the edits made while it was down", async ({ page }) => {
  test.setTimeout(90_000);
  const dataDir = await makeTempDir();
  const first = await startHostedEngine({ dataDir });
  try {
    const attempts: number[] = [];
    page.on("websocket", (socket) => {
      if (new URL(socket.url()).pathname.startsWith("/sync/")) attempts.push(Date.now());
    });
    await openCanvas(page, first);
    const port = first.port;
    const before = (await roomRecords(first, "default")).find((record) => record.id === "shape:starter-scene")!;
    await first.stop();
    const downAt = Date.now();

    await dragBy(page, "shape:starter-scene", 90, 0);
    const movedOnScreen = await centre(shapeOnScreen(page, "shape:starter-scene"));
    await page.waitForTimeout(1500);
    await expect(toast(page, LOST)).toHaveCount(0);
    await expect(toast(page, LOST)).toBeVisible({ timeout: 3000 });
    expect(Date.now() - downAt).toBeGreaterThanOrEqual(1900);

    await page.waitForTimeout(6000);
    const second = await startHostedEngine({ dataDir, env: { PORT: String(port) } });
    try {
      await expect
        .poll(async () => (await roomRecords(second, "default")).find((record) => record.id === "shape:starter-scene")!.x, { timeout: 20_000 })
        .toBeGreaterThan(before.x! + 20);
      await expect(toast(page, LOST)).toHaveCount(0, { timeout: 5000 });
      expect(Math.round((await centre(shapeOnScreen(page, "shape:starter-scene"))).x)).toBe(Math.round(movedOnScreen.x));

      const retries = attempts.filter((at) => at > downAt);
      expect(retries.length).toBeGreaterThanOrEqual(3);
      const gaps = [retries[0]! - downAt, ...retries.slice(1).map((at, index) => at - retries[index]!)];
      expect(gaps[0]).toBeGreaterThanOrEqual(900);
      expect(gaps[1]).toBeGreaterThanOrEqual(1900);
      expect(gaps[2]).toBeGreaterThanOrEqual(3900);
      for (const gap of gaps) expect(gap).toBeLessThanOrEqual(10_900);
    } finally {
      await second.dispose();
    }
  } finally {
    await first.dispose();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test.describe("the connection-lost notice", () => {
  const route = async (page: Page, pattern: string) => {
    const state = { refuse: false, sockets: [] as WebSocketRoute[] };
    await page.routeWebSocket(pattern, (socket) => {
      if (state.refuse) return socket.close({ code: 1006 });
      state.sockets.push(socket);
      socket.connectToServer();
    });
    return {
      drop: async () => {
        state.refuse = true;
        for (const socket of state.sockets.splice(0)) await socket.close({ code: 1006 }).catch(() => {});
      },
      restore: () => void (state.refuse = false),
    };
  };

  test("shows after the sync socket has been down for 2 seconds, not for a shorter drop, and closes when it is back", async ({ page, engine }) => {
    const sync = await route(page, "**/sync/**");
    await openCanvas(page, engine);

    await sync.drop();
    await page.waitForTimeout(900);
    sync.restore();
    await page.waitForTimeout(2500);
    await expect(toast(page, LOST)).toHaveCount(0);

    await sync.drop();
    await expect(toast(page, LOST)).toBeVisible({ timeout: 4000 });
    sync.restore();
    await expect(toast(page, LOST)).toHaveCount(0, { timeout: 15_000 });
  });

  test("shows while the RPC socket alone is down, and closes by itself once it reconnects", async ({ page, engine }) => {
    const rpc = await route(page, "**/ws");
    await openCanvas(page, engine);
    await rpc.drop();
    const droppedAt = Date.now();
    await expect(toast(page, LOST)).toBeVisible({ timeout: 4000 });
    expect(Date.now() - droppedAt).toBeGreaterThanOrEqual(1900);
    rpc.restore();
    await expect(toast(page, LOST)).toHaveCount(0, { timeout: 15_000 });
  });
});
