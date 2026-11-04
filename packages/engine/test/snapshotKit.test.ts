import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { kitStamp, type Kit } from "@unframed/domain";
import { describe, expect, it } from "vitest";
import { until, startAgentEngine, type AgentEngine } from "./agent.ts";
import { roomShape } from "./agentCanvas.ts";
import { pageShape } from "./canvasRecords.ts";

const pictured = (png: Buffer): any => {
  for (let at = 8; at < png.length; ) {
    const length = png.readUInt32BE(at);
    const type = png.subarray(at + 4, at + 8).toString("latin1");
    if (type === "tEXt") return JSON.parse(png.subarray(at + 8, at + 8 + length).toString("latin1").split("\0")[1]!);
    at += 12 + length;
  }
  return undefined;
};

const snapshotOf = async (agent: AgentEngine) => {
  const dir = join(agent.folder, ".cache", "snapshots");
  const names = (await readdir(dir).catch(() => [] as string[])).filter((name) => name.endsWith(".png"));
  return names.length === 0 ? undefined : pictured(await readFile(join(dir, names[0]!)));
};

const kit: Kit = {
  format: 1,
  name: "Brand",
  modes: ["light", "dark"],
  tokens: [{ path: "color/brand/primary", type: "color", values: { light: "#1a73e8", dark: "#8ab4f8" } }],
};

describe("snapshots follow the kit and the mode (spec 19, task 26)", () => {
  it("re-renders a page that loads the tokens script after a kit change and a mode change, with the mode and the kit stamp", async () => {
    const agent = await startAgentEngine({ env: { UNFRAMED_TEST_RENDERER: "ok" } });
    await writeFile(join(agent.folder, "1-tokened.html"), `<!doctype html><html><head><script src="unframed-tokens.js"></script></head><body>x</body></html>`);
    await agent.rpc.call("testCanvas.apply", { project: "board", change: { put: [pageShape("tk", "500", { file: "1-tokened.html", title: "T", fileName: "t.html" })], remove: [] }, origin: { kind: "server", id: "test" } });
    await until(async () => (await snapshotOf(agent)) !== undefined, "the first snapshot");

    await agent.rpc.call("testCanvas.apply", { project: "board", change: { put: [{ id: "document:document", typeName: "document", gridSize: 10, name: "", meta: { unframed: { kit } } }], remove: [] }, origin: { kind: "server", id: "kit:k1" } });
    await until(async () => (await snapshotOf(agent))?.kit === kitStamp(kit), "a snapshot made with the kit");

    const shape = await roomShape(agent, "tk");
    await agent.rpc.call("testCanvas.apply", { project: "board", change: { put: [{ ...shape, props: { ...shape.props, mode: "dark" } }], remove: [] }, origin: { kind: "server", id: "test" } });
    await until(async () => (await snapshotOf(agent))?.mode === "dark", "a snapshot in the dark mode");
    expect(await snapshotOf(agent)).toMatchObject({ mode: "dark", kit: kitStamp(kit) });
  });
});
