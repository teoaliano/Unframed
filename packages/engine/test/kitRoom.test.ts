import type { TLRecord } from "@tldraw/tlschema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pageShape } from "./canvasRecords.ts";
import { startEngine, type TestEngine } from "./harness.ts";
import { connectTab } from "./syncClient.ts";

const DOCUMENT = "document:document";

const kit = (overrides: Record<string, unknown> = {}) => ({
  format: 1,
  name: "Brand",
  modes: ["light", "dark"],
  tokens: [{ path: "color/brand/primary", type: "color", values: { light: "#1a73e8", dark: "#8ab4f8" } }],
  ...overrides,
});

const documentWith = (kitValue: unknown): TLRecord =>
  ({ id: DOCUMENT, typeName: "document", gridSize: 10, name: "", meta: { unframed: { kit: kitValue } } }) as unknown as TLRecord;

describe("the kit and the mode in the room (spec 19, task 9)", () => {
  let engine: TestEngine;
  beforeAll(async () => {
    engine = await startEngine({ env: { UNFRAMED_TEST_CANVAS: "1" } });
    await (await engine.rpc()).call("projects.create", { name: "board" });
  });
  afterAll(() => engine.dispose());

  it("keeps a valid kit in the document record's meta and hands it to every tab", async () => {
    const rpc = await engine.rpc();
    await rpc.call("testCanvas.apply", { project: "board", change: { put: [documentWith(kit())], remove: [] }, origin: { kind: "server", id: "kit:t1" } });
    const tab = await connectTab(engine.port, "board");
    await tab.loaded;
    await tab.waitFor(() => (tab.get(DOCUMENT) as { meta?: { unframed?: { kit?: { name?: string } } } } | undefined)?.meta?.unframed?.kit?.name === "Brand");
    await tab.close();
  });

  it("refuses an engine-side kit that breaks a rule, with the rule's sentence, and changes nothing", async () => {
    const rpc = await engine.rpc();
    const bad = kit({ tokens: [{ path: "color/brand/primary", type: "color", value: "#12345" }] });
    await expect(
      rpc.call("testCanvas.apply", { project: "board", change: { put: [documentWith(bad)], remove: [] }, origin: { kind: "server", id: "kit:t2" } }),
    ).rejects.toMatchObject({ code: "bad_request", message: expect.stringContaining("#12345 is not a colour. Use a hex value like #1a73e8") });
    const tab = await connectTab(engine.port, "board");
    await tab.loaded;
    expect((tab.get(DOCUMENT) as { meta?: { unframed?: { kit?: { name?: string } } } }).meta?.unframed?.kit?.name).toBe("Brand");
    await tab.close();
  });

  it("refuses a tab's kit that breaks a rule, as an invalid record", async () => {
    const tab = await connectTab(engine.port, "board");
    await tab.loaded;
    const verdict = await tab.pushRaw([documentWith(kit({ modes: [] }))]);
    expect(verdict).toEqual({ closed: "INVALID_RECORD" });
    await tab.close();
  });

  it("accepts a page or motion with a kit mode, and keeps the mode", async () => {
    const rpc = await engine.rpc();
    const page = pageShape("moded", "201", { file: "1-p.html", title: "p", fileName: "p.html", mode: "dark" });
    await rpc.call("testCanvas.apply", { project: "board", change: { put: [page], remove: [] }, origin: { kind: "server", id: "kit:t3" } });
    const tab = await connectTab(engine.port, "board");
    await tab.loaded;
    await tab.waitFor(() => tab.get("shape:moded"));
    expect(tab.get("shape:moded")).toMatchObject({ props: { mode: "dark" } });
    await tab.close();
  });
});
