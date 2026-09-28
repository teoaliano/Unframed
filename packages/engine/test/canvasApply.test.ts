import type { TLRecord } from "@tldraw/tlschema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { imageShape, promptShape, textOf } from "./canvasRecords.ts";
import { startEngine, type TestEngine } from "./harness.ts";
import { connectTab } from "./syncClient.ts";

describe("engine-side writes", () => {
  let engine: TestEngine;
  beforeAll(async () => {
    engine = await startEngine({ env: { UNFRAMED_TEST_CANVAS: "1" } });
    await (await engine.rpc()).call("projects.create", { name: "board" });
  });
  afterAll(() => engine.dispose());

  it("reaches every connected tab as a remote change and answers the clock and an inverse that restores the prior state", async () => {
    const rpc = await engine.rpc();
    const tabs = [await connectTab(engine.port, "board"), await connectTab(engine.port, "board")];
    await Promise.all(tabs.map((tab) => tab.loaded));
    const before = tabs[0]!.get("shape:starter-subject")!;
    const { clock: clockBefore } = await rpc.call("testCanvas.read", { project: "board" });

    const moved = { ...before, x: 500 } as TLRecord;
    const added = imageShape("placeholder", "600", null, { x: 10, y: 10 });
    const applied = await rpc.call("testCanvas.apply", {
      project: "board",
      change: { put: [moved, added], remove: ["shape:starter-scene"] },
      origin: { kind: "server", id: "run:r1" },
    });
    expect(applied.clock).toBeGreaterThan(clockBefore);

    for (const tab of tabs) {
      await tab.waitFor(() => tab.get("shape:placeholder") && tab.get("shape:starter-subject")?.x === 500 && !tab.get("shape:starter-scene"));
      expect(tab.received.some((message) => message.type === "patch" && message.diff?.["shape:placeholder"])).toBe(true);
    }
    expect(applied.inverse.remove).toEqual(["shape:placeholder"]);
    expect((applied.inverse.put as TLRecord[]).map((record) => record.id).sort()).toEqual(["shape:starter-scene", "shape:starter-subject"]);

    await rpc.call("testCanvas.apply", { project: "board", change: applied.inverse, origin: { kind: "server", id: "revert:c1:1" } });
    const [tab] = tabs;
    await tab!.waitFor(() => !tab!.get("shape:placeholder") && tab!.get("shape:starter-scene"));
    expect(tab!.get("shape:starter-subject")).toEqual(before);
    expect(textOf(tab!.get("shape:starter-scene"))).toBe("A @100 on a windswept cliff at golden hour, cinematic, 35mm");
    await Promise.all(tabs.map((each) => each.close()));
  });

  it("refuses a change with an invalid record whole, and changes nothing", async () => {
    const rpc = await engine.rpc();
    const { clock, records } = await rpc.call("testCanvas.read", { project: "board" });
    const bad = { ...promptShape("bad", "601", "x"), meta: {} };
    await expect(
      rpc.call("testCanvas.apply", {
        project: "board",
        change: { put: [promptShape("good", "602", "y"), bad], remove: [] },
        origin: { kind: "server", id: "run:r2" },
      }),
    ).rejects.toMatchObject({ code: "bad_request", message: expect.stringContaining("That canvas change is not valid") });
    expect(await rpc.call("testCanvas.read", { project: "board" })).toEqual({ clock, records });
  });

  it("answers not_found for a project that does not exist", async () => {
    const rpc = await engine.rpc();
    await expect(rpc.call("testCanvas.read", { project: "missing" })).rejects.toMatchObject({
      code: "not_found",
      message: 'There is no project named "missing".',
    });
  });
});
