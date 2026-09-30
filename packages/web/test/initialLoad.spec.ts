import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { toast } from "./canvas.ts";
import { expect, startHostedEngine, test } from "./fixtures.ts";

const LOST = "Lost the connection to the local server. Reconnecting…";

test.describe("the initial load", () => {
  test("waits for the RPC socket under the connection-lost notice, then opens a project and closes the notice", async ({ page, engine }) => {
    let refuse = true;
    await page.routeWebSocket("**/ws", (socket) => {
      if (refuse) {
        socket.close({ code: 1006 });
        return;
      }
      socket.connectToServer();
    });
    const started = Date.now();
    await page.goto(engine.origin);
    await expect(toast(page, LOST)).toBeVisible({ timeout: 10_000 });
    expect(Date.now() - started).toBeGreaterThanOrEqual(1900);
    await expect(page.locator("[data-canvas-project]")).toHaveCount(0);

    refuse = false;
    await expect(page.locator("[data-canvas-project='default'] .tl-canvas")).toBeVisible({ timeout: 20_000 });
    await expect(toast(page, LOST)).toHaveCount(0);
  });

  test("tries a list that fails while connected once more after a second, then shows the sticky failed-list toast and opens nothing", async ({ page }) => {
    const engine = await startHostedEngine({ dotenv: "OUTPUT_DIR=./blocked\n" });
    try {
      await writeFile(join(engine.dataDir, "blocked"), "a file where the folder should be");
      const lists: number[] = [];
      page.on("websocket", (socket) => {
        socket.on("framesent", ({ payload }) => {
          if (String(payload).includes('"tag":"projects.list"')) lists.push(Date.now());
        });
      });
      await page.goto(engine.origin);
      const failed = toast(page, /Could not list your projects: Could not list the output folder: .+\. Reload to try again\./);
      await expect(failed).toBeVisible({ timeout: 10_000 });
      expect(lists).toHaveLength(2);
      expect(lists[1]! - lists[0]!).toBeGreaterThanOrEqual(950);
      await page.waitForTimeout(7000);
      await expect(failed).toBeVisible();
      expect(lists).toHaveLength(2);
      await expect(page.locator("[data-canvas-project]")).toHaveCount(0);
      expect((await (await engine.rpc()).call("preferences.get", {})).values).toEqual({});
    } finally {
      await engine.dispose();
    }
  });
});
