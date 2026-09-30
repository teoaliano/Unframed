import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { groupShape, imageShape, promptShape, refOf, textOf } from "./canvasRecords.ts";
import { startEngine, type TestEngine } from "./harness.ts";
import { connectTab } from "./syncClient.ts";

describe("ref collision repair", () => {
  let engine: TestEngine;
  beforeAll(async () => {
    engine = await startEngine();
    await (await engine.rpc()).call("projects.create", { name: "board" });
  });
  afterAll(() => engine.dispose());

  it("keeps the shape that held a ref first and gives the later one the next ref, prompt texts untouched", async () => {
    const first = await connectTab(engine.port, "board");
    const second = await connectTab(engine.port, "board");
    await Promise.all([first.loaded, second.loaded]);
    await first.put([promptShape("held", "105", "the first one, referenced as @105")]);
    await second.waitFor(() => second.get("shape:held"));

    // The second tab minted the same number while it could not see the first one's shape.
    await second.put([imageShape("late", "105", null)]);
    for (const tab of [first, second]) {
      await tab.waitFor(() => refOf(tab.get("shape:late")) === "106");
      expect(refOf(tab.get("shape:held"))).toBe("105");
      expect(textOf(tab.get("shape:held"))).toBe("the first one, referenced as @105");
    }

    await first.put([groupShape("late-group", "105")]);
    await second.waitFor(() => refOf(second.get("shape:late-group")) === "107");
    expect(refOf(second.get("shape:held"))).toBe("105");
    await Promise.all([first.close(), second.close()]);
  });

  it("repairs an edit that gives an existing shape a ref another holds, and leaves distinct refs alone", async () => {
    const tab = await connectTab(engine.port, "board");
    await tab.loaded;
    await tab.put([promptShape("a", "200", "a"), promptShape("b", "201", "b")]);
    const b = tab.get("shape:b")!;
    await tab.put([{ ...b, meta: { ...b.meta, ref: "200" } } as typeof b]);
    await tab.waitFor(() => refOf(tab.get("shape:b")) === "201");
    expect(refOf(tab.get("shape:a"))).toBe("200");
    await tab.close();
  });
});
