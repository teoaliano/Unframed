import { rm } from "node:fs/promises";
import { makeTempDir } from "../../engine/test/engineProcess.ts";
import { expect, isSettingsChunk, startHostedEngine, test, watchRpcSockets } from "./fixtures.ts";

test("reconnects on its own after the engine restarts, and a settings.subscribe from before delivers again", async ({ page }) => {
  const dataDir = await makeTempDir();
  const first = await startHostedEngine({ dataDir });
  try {
    const watch = watchRpcSockets(page);
    await page.goto(first.origin);
    await watch.frame(0, isSettingsChunk());

    const port = first.port;
    await first.stop();
    await expect.poll(() => watch.sockets[0]?.closedAt).toBeDefined();
    const second = await startHostedEngine({ dataDir, env: { PORT: String(port) } });
    try {
      await expect.poll(() => watch.sockets.length, { timeout: 15_000 }).toBeGreaterThan(1);
      // The first attempt waits the initial 1 s of backoff.
      expect(watch.sockets[1]!.openedAt - watch.sockets[0]!.closedAt!).toBeGreaterThanOrEqual(800);

      await (await second.rpc()).call("settings.update", { textModel: "after/restart" });
      await expect
        .poll(() => watch.sockets.some((entry, index) => index > 0 && entry.frames.some(isSettingsChunk("after/restart"))), {
          timeout: 15_000,
        })
        .toBe(true);
    } finally {
      await second.dispose();
    }
  } finally {
    await first.dispose();
    await rm(dataDir, { recursive: true, force: true });
  }
});
