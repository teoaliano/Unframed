import { stat } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { promptShape, textOf } from "./canvasRecords.ts";
import { makeTempDir, startEngine } from "./harness.ts";
import { connectTab } from "./syncClient.ts";

const walBytes = (dataDir: string, project: string) =>
  stat(join(dataDir, "output", project, "unframed.sqlite-wal")).then(
    (info) => info.size,
    () => 0,
  );

describe("canvas durability", () => {
  it("keeps a change the room acknowledged through a SIGKILL right after", async () => {
    const dataDir = await makeTempDir();
    const first = await startEngine({ dataDir });
    await (await first.rpc()).call("projects.create", { name: "board" });
    const tab = await connectTab(first.port, "board");
    await tab.loaded;
    await tab.put([promptShape("durable", "400", "still here")]);
    await first.stop("SIGKILL");

    const second = await startEngine({ dataDir });
    const again = await connectTab(second.port, "board");
    await again.loaded;
    expect(textOf(again.get("shape:durable"))).toBe("still here");
    await again.close();
  });

  it(
    "closes the room 60 seconds after its last tab leaves, flushing storage",
    async () => {
      const dataDir = await makeTempDir();
      const engine = await startEngine({ dataDir });
      await (await engine.rpc()).call("projects.create", { name: "board" });
      const tab = await connectTab(engine.port, "board");
      await tab.loaded;
      await tab.put([promptShape("flushed", "401", "on disk")]);
      await tab.close();
      const leftAt = Date.now();
      expect(await walBytes(dataDir, "board")).toBeGreaterThan(0);

      await new Promise((resolve) => setTimeout(resolve, 50_000));
      expect(await walBytes(dataDir, "board")).toBeGreaterThan(0);

      await expect.poll(() => walBytes(dataDir, "board"), { timeout: 20_000, interval: 250 }).toBe(0);
      expect(Date.now() - leftAt).toBeGreaterThanOrEqual(59_000);

      const reopened = await connectTab(engine.port, "board");
      await reopened.loaded;
      expect(textOf(reopened.get("shape:flushed"))).toBe("on disk");
      await reopened.close();
    },
    120_000,
  );
});
