import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { BRIDGE_TAG, chromeCandidates, compileComponent, compiledFileName, cssName, RUNTIME_TAG, TOKENS_TAG } from "@unframed/domain";
import { describe, expect, it } from "vitest";
import { motionShape } from "./agentCanvas.ts";
import { startEngine } from "./harness.ts";
import type { TestRpcClient } from "./rpcClient.ts";

/**
 * Spec 20, task 42: the real producer renders a motion whose only content is an instance filling the
 * frame in a token colour. A local render, no model and no network call. It skips, saying what is
 * missing, where Chrome or ffmpeg is not found.
 */

const chrome = chromeCandidates({
  platform: process.platform,
  env: process.env,
  home: homedir(),
  versionsIn: (dir) => {
    try {
      return readdirSync(dir);
    } catch {
      return [];
    }
  },
}).find((path) => existsSync(path));
const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();
const missing = [chrome === undefined ? "Chrome" : undefined, hasFfmpeg ? undefined : "ffmpeg"].filter((name): name is string => name !== undefined);
if (missing.length > 0) console.log(`  real render probe skipped: no ${missing.join(" or ")} on this machine`);

const TOKEN = "color/brand/primary";
const TOKEN_LIGHT = "#1a73e8";
const KIT = { format: 1, name: "Brand", modes: ["light", "dark"], tokens: [{ path: TOKEN, type: "color", values: { light: TOKEN_LIGHT, dark: "#8ab4f8" } }] };
const WIDTH = 320;
const HEIGHT = 180;

const TILE = `<!doctype html><html><head>
<script type="application/json" data-uf-component>{"tag":"uf-tile","variants":{},"props":{},"slots":[]}</script>
<style type="text/x-uf-component" data-uf-component-style>:host { display: block; width: 100%; height: 100%; background: var(${cssName(TOKEN)}); }</style>
</head><body><div data-uf-template hidden><span data-hf-id="hf-aaaa">Tile</span></div></body></html>`;

const COMPOSITION = `<!doctype html><html><head><meta charset="utf-8">${TOKENS_TAG}
<script src="gsap.js"></script>
<script src="1-tile.component.js" data-uf-component="uf-tile"></script>
${RUNTIME_TAG}
${BRIDGE_TAG}</head><body style="margin:0;background:#000">
<div id="root" data-composition-id="main" data-start="0" data-duration="2" data-width="${WIDTH}" data-height="${HEIGHT}" style="position:relative;width:${WIDTH}px;height:${HEIGHT}px;overflow:hidden">
<uf-tile id="tile" class="clip" data-start="0" data-duration="2"></uf-tile>
</div>
<script>window.__timelines = window.__timelines || {}; window.__timelines.main = gsap.timeline({ paused: true });</script>
</body></html>`;

/** The pixel at the frame's centre, as red, green and blue, read by ffmpeg at one second. */
const centreAt1s = (mp4: string): number[] => {
  const raw = execFileSync("ffmpeg", ["-v", "error", "-ss", "1", "-i", mp4, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 16 * 1024 * 1024 });
  expect(raw.length).toBe(WIDTH * HEIGHT * 3);
  const at = (Math.floor(HEIGHT / 2) * WIDTH + Math.floor(WIDTH / 2)) * 3;
  return [raw[at]!, raw[at + 1]!, raw[at + 2]!];
};

const follow = async (rpc: TestRpcClient, id: string) => {
  for (let i = 0; i < 3000; i++) {
    const status = await rpc.call("motion.renderStatus", { project: "board", id });
    if (status.status === "done" || status.status === "failed") return status;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("The render did not settle.");
};

describe.skipIf(missing.length > 0)("the real render probe (spec 20, task 42)", () => {
  it("renders an instance filling the frame in a token colour, and the frame at 1 s has that colour", async () => {
    const engine = await startEngine({ env: { UNFRAMED_TEST_CANVAS: "1" } });
    try {
      const rpc = await engine.rpc();
      await rpc.call("projects.create", { name: "board" });
      const folder = join(engine.dataDir, "output", "board");
      await writeFile(join(folder, "1-tile.html"), TILE);
      await writeFile(join(folder, compiledFileName("1-tile.html")), compileComponent(TILE, "1-tile.html"));
      await writeFile(join(folder, "2-probe.html"), COMPOSITION);
      await rpc.call("testCanvas.apply", {
        project: "board",
        change: { put: [{ id: "document:document", typeName: "document", gridSize: 10, name: "", meta: { unframed: { kit: KIT } } }, motionShape("m1", "150", "Probe", { file: "2-probe.html", w: WIDTH, h: HEIGHT }, { x: 100, y: 100 })], remove: [] },
        origin: { kind: "system", id: "test-seed" },
      });

      const started = await rpc.call("motion.renderStart", { project: "board", file: "2-probe.html", title: "Probe", shapeId: "shape:m1" });
      const done = await follow(rpc, started.id);
      expect(done).toMatchObject({ status: "done" });
      const output = join(folder, done.output as string);
      expect(existsSync(output)).toBe(true);
      expect(existsSync(output.replace(/\.mp4$/, ".json"))).toBe(true);

      const [red, green, blue] = centreAt1s(output);
      const expected = [0x1a, 0x73, 0xe8];
      for (const [channel, value] of [red, green, blue].entries()) expect(Math.abs(value! - expected[channel]!)).toBeLessThanOrEqual(8);
    } finally {
      await engine.dispose();
    }
  }, 300_000);
});
