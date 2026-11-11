import { cp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startEngine, type TestEngine } from "./harness.ts";

const DOCUMENT = "document:document";
const kit = {
  format: 1,
  name: "Brand",
  modes: ["light", "dark"],
  tokens: [{ path: "color/brand/primary", type: "color", values: { light: "#1a73e8", dark: "#8ab4f8" } }],
};

describe("a project folder with a kit is self-contained (spec 19, task 42)", () => {
  let engine: TestEngine;
  beforeAll(async () => {
    engine = await startEngine({ env: { UNFRAMED_TEST_CANVAS: "1" } });
    await (await engine.rpc()).call("projects.create", { name: "board" });
    await (await engine.rpc()).call("testCanvas.apply", {
      project: "board",
      change: { put: [{ id: DOCUMENT, typeName: "document", gridSize: 10, name: "", meta: { unframed: { kit } } }], remove: [] },
      origin: { kind: "server", id: "kit:f1" },
    });
  });
  afterAll(() => engine.dispose());

  it("serves a copied folder's page, its tokens script and its kit from the preview origin with no help from the app", async () => {
    const board = join(engine.dataDir, "output", "board");
    await writeFile(join(board, "1-page.html"), `<!doctype html><html><head><script src="unframed-tokens.js"></script></head><body><h1 style="color: var(--color-brand-primary)">Hi</h1></body></html>`);
    await expect.poll(() => readFile(join(board, "unframed-tokens.js"), "utf8").catch(() => ""), { timeout: 10_000 }).toContain("color/brand/primary");
    await cp(board, join(engine.dataDir, "output", "copied"), { recursive: true });

    const get = (path: string) => engine.request(path, { port: engine.previewPort, headers: { host: `localhost:${engine.previewPort}` } });
    const page = await get("/p/copied/1-page.html");
    expect(page.status).toBe(200);
    expect(page.text).toContain("var(--color-brand-primary)");
    const script = await get("/p/copied/unframed-tokens.js");
    expect(script.status).toBe(200);
    expect(script.text).toContain("color/brand/primary");
    expect(script.text).toContain("#1a73e8");
  });
});
