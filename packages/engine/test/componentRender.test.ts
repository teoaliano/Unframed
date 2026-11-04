import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { compileComponent, compiledFileName } from "@unframed/domain";
import { describe, expect, it } from "vitest";
import { motionShape } from "./agentCanvas.ts";
import { startEngine, type TestEngine } from "./harness.ts";
import type { TestRpcClient } from "./rpcClient.ts";

const BUTTON = `<!doctype html><html><head>
<script type="application/json" data-uf-component>{"tag":"uf-button","variants":{"kind":["primary","secondary"]},"props":{"label":"text"},"slots":[]}</script>
<style type="text/x-uf-component" data-uf-component-style>:host { display: inline-block; }</style>
</head><body><div data-uf-template hidden><button data-uf-prop="label">Buy</button></div></body></html>`;

const COMPOSITION = '<html><head><script src="1-button.component.js" data-uf-component="uf-button"></script></head><body><div id="root" data-composition-id="main" data-start="0" data-duration="2" data-width="640" data-height="360"><uf-button kind="secondary"></uf-button></div></body></html>';

const startRendering = async (): Promise<{ engine: TestEngine; rpc: TestRpcClient; folder: string }> => {
  const engine = await startEngine({ env: { UNFRAMED_TEST_RENDERER: "ok", UNFRAMED_TEST_CANVAS: "1" } });
  const rpc = await engine.rpc();
  await rpc.call("projects.create", { name: "board" });
  const folder = join(engine.dataDir, "output", "board");
  await writeFile(join(folder, "1-button.html"), BUTTON);
  await writeFile(join(folder, "2-intro.html"), COMPOSITION);
  await rpc.call("testCanvas.apply", {
    project: "board",
    change: { put: [motionShape("m1", "150", "Intro", { file: "2-intro.html", w: 480, h: 300 }, { x: 100, y: 100 })], remove: [] },
    origin: { kind: "system", id: "test-seed" },
  });
  return { engine, rpc, folder };
};

describe("motion.renderStart with component pins", () => {
  it("recompiles a pinned component whose compiled file is missing, before the render starts", async () => {
    const { engine, rpc, folder } = await startRendering();
    try {
      expect(existsSync(join(folder, "1-button.component.js"))).toBe(false);
      await rpc.call("motion.renderStart", { project: "board", file: "2-intro.html", shapeId: "shape:m1" });
      expect(await readFile(join(folder, compiledFileName("1-button.html")), "utf8")).toBe(compileComponent(BUTTON, "1-button.html"));
    } finally {
      await engine.dispose();
    }
  });

  it("keeps a compiled file that is already there", async () => {
    const { engine, rpc, folder } = await startRendering();
    try {
      await writeFile(join(folder, "1-button.component.js"), "/* an older build */");
      await rpc.call("motion.renderStart", { project: "board", file: "2-intro.html", shapeId: "shape:m1" });
      expect(await readFile(join(folder, "1-button.component.js"), "utf8")).toBe("/* an older build */");
    } finally {
      await engine.dispose();
    }
  });
});
