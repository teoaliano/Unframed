import { describe, expect, it } from "vitest";
import { makeTempDir, startEngine } from "./harness.ts";
import { connectTab } from "./syncClient.ts";

describe("a new project's canvas", () => {
  it("starts empty, and is still empty after a restart", async () => {
    const dataDir = await makeTempDir();
    const engine = await startEngine({ dataDir });
    await (await engine.rpc()).call("projects.create", { name: "Fresh" });
    const tab = await connectTab(engine.port, "fresh");
    await tab.loaded;
    expect(tab.records().filter((record) => record.typeName === "shape")).toEqual([]);
    expect(tab.records().filter((record) => record.typeName === "page")).toHaveLength(1);
    await tab.close();

    await engine.stop();
    const again = await startEngine({ dataDir });
    const later = await connectTab(again.port, "fresh");
    await later.loaded;
    expect(later.records().filter((record) => record.typeName === "shape")).toEqual([]);
    await later.close();
  });
});
