import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scriptFolder, startAgentEngine, type AgentEngine } from "./agent.ts";
import { roomShape } from "./agentCanvas.ts";
import { pageShape } from "./canvasRecords.ts";

/** What the test renderer's picture says it showed: the JSON in its `tEXt` chunk. */
const pictured = (png: Buffer): any => {
  for (let at = 8; at < png.length; ) {
    const length = png.readUInt32BE(at);
    const type = png.subarray(at + 4, at + 8).toString("latin1");
    if (type === "tEXt") return JSON.parse(png.subarray(at + 8, at + 8 + length).toString("latin1").split("\0")[1]!);
    at += 12 + length;
  }
  return undefined;
};

const snapshotsDir = (agent: AgentEngine) => join(agent.folder, ".cache", "snapshots");
const snapshotFiles = async (agent: AgentEngine) => (await readdir(snapshotsDir(agent)).catch(() => [] as string[])).filter((name) => name.endsWith(".png")).sort();
const snapshot = async (agent: AgentEngine, name: string) => pictured(await readFile(join(snapshotsDir(agent), name)));

const until = async <T>(check: () => Promise<T | undefined | false>, what: string, timeoutMs = 8000): Promise<T> => {
  const started = Date.now();
  for (;;) {
    const value = await check();
    if (value !== undefined && value !== false) return value;
    if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};

/** Writes records as a tab or the agent would: the room's commit hooks see a change with origin `system` not at all. */
const seed = async (agent: AgentEngine, records: unknown[]) =>
  agent.rpc.call("testCanvas.apply", { project: "board", change: { put: records, remove: [] }, origin: { kind: "server", id: "test" } });

const update = async (agent: AgentEngine, id: string, props: Record<string, unknown>) => {
  const shape = await roomShape(agent, id);
  await seed(agent, [{ ...shape, props: { ...shape.props, ...props } }]);
};

const startSnapshotting = async (renderer: "ok" | "no-chrome" = "ok", script?: string) => {
  const agent = await startAgentEngine({ env: { UNFRAMED_TEST_RENDERER: renderer }, ...(script === undefined ? {} : { script }) });
  await writeFile(join(agent.folder, "1-landing.html"), "<h1>Landing</h1>");
  return agent;
};

describe("artifact snapshots", () => {
  it("renders a shape that has none, with its saved dials, into the cache folder, and the app's file route serves it", async () => {
    const agent = await startSnapshotting();
    const stream = agent.rpc.subscribe("artifact.snapshots", { project: "board" });
    await seed(agent, [pageShape("pg1", "100", { file: "1-landing.html", title: "Landing", dials: { accent: "#ff0000" } })]);
    const [name] = await until(async () => {
      const files = await snapshotFiles(agent);
      return files.length > 0 ? files : undefined;
    }, "the first snapshot");
    expect(name).toBe("1-landing.html-480x320.png");
    expect(await snapshot(agent, name!)).toMatchObject({
      url: `http://127.0.0.1:${agent.engine.previewPort}/p/board/1-landing.html`,
      file: "1-landing.html",
      w: 480,
      h: 320,
      dials: { accent: "#ff0000" },
    });
    await until(async () => stream.values.length === 1, "the stream to say so");
    expect(stream.values[0]).toEqual({ file: "1-landing.html", w: 480, h: 320, at: expect.any(Number) });
    const served = await agent.engine.request("/api/file/board/1-landing.html?snapshot=480x320");
    expect(served.status).toBe(200);
    expect(served.headers["content-type"]).toBe("image/png");
    expect(pictured(served.body)).toMatchObject({ file: "1-landing.html" });
    // Nothing about it is a project file: no sidecar anywhere.
    expect((await readdir(agent.folder)).some((name) => name.includes("480x320"))).toBe(false);

    // A later subscriber starts from what the cache holds.
    const later = agent.rpc.subscribe("artifact.snapshots", { project: "board" });
    await until(async () => later.values.length === 1, "the cached snapshot");
    expect(later.values[0]).toMatchObject({ file: "1-landing.html", w: 480, h: 320 });
  });

  it("renders again after a file replacement, a saved dial change and a resize over 10 %, and not for a smaller resize", async () => {
    const agent = await startSnapshotting();
    await writeFile(join(agent.folder, "2-landing.html"), "<h1>Landing v2</h1>");
    const stream = agent.rpc.subscribe("artifact.snapshots", { project: "board" });
    await seed(agent, [pageShape("pg1", "100", { file: "1-landing.html", title: "Landing" })]);
    await until(async () => stream.values.length === 1, "the first snapshot");

    await update(agent, "pg1", { file: "2-landing.html" });
    await until(async () => stream.values.length === 2, "the replaced file's snapshot");
    expect(stream.values[1]).toMatchObject({ file: "2-landing.html", w: 480, h: 320 });

    await update(agent, "pg1", { dials: { size: 30 } });
    await until(async () => stream.values.length === 3, "the tuned snapshot");
    expect(await snapshot(agent, "2-landing.html-480x320.png")).toMatchObject({ dials: { size: 30 } });

    await update(agent, "pg1", { w: 520 });
    await new Promise((resolve) => setTimeout(resolve, 1800));
    expect(stream.values).toHaveLength(3);
    await update(agent, "pg1", { w: 540 });
    await until(async () => stream.values.length === 4, "the resized snapshot");
    expect(stream.values[3]).toMatchObject({ file: "2-landing.html", w: 540, h: 320 });
    expect(await snapshotFiles(agent)).toEqual(["1-landing.html-480x320.png", "2-landing.html-480x320.png", "2-landing.html-540x320.png"]);
  });

  it("renders after an agent's write, with the file it wrote", async () => {
    const script = await scriptFolder({ write: { when: "^go", turns: [{ text: "Done.", tools: [{ name: "page_write", input: { shapeId: "pg1", html: "<h1>v2</h1>" } }] }] } });
    const agent = await startSnapshotting("ok", script);
    const stream = agent.rpc.subscribe("artifact.snapshots", { project: "board" });
    await seed(agent, [pageShape("pg1", "100", { file: "1-landing.html", title: "Landing" })]);
    await until(async () => stream.values.length === 1, "the first snapshot");
    const chatId = await agent.createChat();
    await agent.send(chatId, "go");
    await agent.settled(chatId, 1);
    const written = (await roomShape(agent, "pg1")).props.file as string;
    await until(async () => stream.values.some((item: any) => item.file === written), "the written file's snapshot");
  });

  it("waits for a shape's changes to settle, and renders one at a time", async () => {
    const agent = await startSnapshotting();
    await writeFile(join(agent.folder, "2-other.html"), "<h1>Other</h1>");
    const stream = agent.rpc.subscribe("artifact.snapshots", { project: "board" });
    await seed(agent, [pageShape("pg1", "100", { file: "1-landing.html" }), pageShape("pg2", "101", { file: "2-other.html" }, { y: 500 })]);
    await until(async () => stream.values.length === 2, "both first snapshots");
    const [first, second] = await Promise.all([snapshot(agent, "1-landing.html-480x320.png"), snapshot(agent, "2-other.html-480x320.png")]);
    const [earlier, later] = [first, second].sort((a, b) => a.startedAt - b.startedAt);
    expect(later.startedAt).toBeGreaterThanOrEqual(earlier.finishedAt);

    for (const size of [10, 20, 30]) {
      await update(agent, "pg1", { dials: { size } });
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    await until(async () => stream.values.length === 3, "the settled snapshot");
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(stream.values).toHaveLength(3);
    expect(await snapshot(agent, "1-landing.html-480x320.png")).toMatchObject({ dials: { size: 30 } });
  });

  it("renders, on first opening a project, every artifact whose file has no snapshot that fits", async () => {
    const agent = await startSnapshotting();
    await writeFile(join(agent.folder, "2-other.html"), "<h1>Other</h1>");
    // Written as an import would, before any room hook runs: nothing renders yet.
    await agent.rpc.call("testCanvas.apply", {
      project: "board",
      change: { put: [pageShape("pg1", "100", { file: "1-landing.html" }), pageShape("pg2", "101", { file: "2-other.html" }, { y: 500 })], remove: [] },
      origin: { kind: "system", id: "import" },
    });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(await snapshotFiles(agent)).toEqual([]);
    await agent.engine.stop();
    const reopened = await startAgentEngine({ dataDir: agent.engine.dataDir, env: { UNFRAMED_TEST_RENDERER: "ok" } });
    await reopened.rpc.call("testCanvas.read", { project: "board" });
    await until(async () => (await snapshotFiles(reopened)).length === 2, "both snapshots after the open");
    expect(await snapshotFiles(reopened)).toEqual(["1-landing.html-480x320.png", "2-other.html-480x320.png"]);
  });

  it("makes no snapshot on a machine with no Chromium", async () => {
    const agent = await startSnapshotting("no-chrome");
    const stream = agent.rpc.subscribe("artifact.snapshots", { project: "board" });
    await seed(agent, [pageShape("pg1", "100", { file: "1-landing.html" })]);
    await update(agent, "pg1", { dials: { size: 3 } });
    await new Promise((resolve) => setTimeout(resolve, 2000));
    expect(stream.values).toEqual([]);
    expect(existsSync(snapshotsDir(agent))).toBe(false);
  });
});
