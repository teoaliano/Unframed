import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Instance } from "@unframed/contracts";
import { describe, expect, it } from "vitest";
import { git, makeRepo, repoEngineEnv } from "./gitRepos.ts";
import { startEngine, type TestEngine } from "./harness.ts";
import type { TestRpcClient } from "./rpcClient.ts";

const eventually = async <T>(read: () => Promise<T>, accept: (value: T) => boolean, timeoutMs = 30_000): Promise<T> => {
  const started = Date.now();
  for (;;) {
    const value = await read();
    if (accept(value)) return value;
    if (Date.now() - started > timeoutMs) throw new Error(`Timed out; last value: ${JSON.stringify(value)}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};

const becomes = (rpc: TestRpcClient, project: string, id: string, state: Instance["state"]) =>
  eventually(
    () => rpc.call("instances.status", { project, id }),
    (instance) => instance.state === state,
  );

const pictured = (png: Buffer): any => {
  for (let at = 8; at < png.length; ) {
    const length = png.readUInt32BE(at);
    const type = png.subarray(at + 4, at + 8).toString("latin1");
    if (type === "tEXt") return JSON.parse(png.subarray(at + 8, at + 8 + length).toString("latin1").split("\0")[1]!);
    at += 12 + length;
  }
  return undefined;
};

const screensOf = async (rpc: TestRpcClient, project: string) =>
  ((await rpc.call("testCanvas.read", { project })).records as any[]).filter((record) => record.typeName === "shape" && record.type === "screen");

const addRepository = async (env: Record<string, string> = {}) => {
  const root = await makeRepo();
  const engine = await startEngine({ env: await repoEngineEnv({ UNFRAMED_TEST_CANVAS: "1", ...env }) });
  const rpc = await engine.rpc();
  const added = await rpc.call("repositories.add", { path: root });
  return { root, engine, rpc, project: added.name, instance: added.instance };
};

const snapshotFile = (engine: TestEngine, project: string, shapeId: string) => join(engine.dataDir, "output", project, ".cache", "screens", `${shapeId.replace(/^shape:/, "")}.png`);

describe("Screens", () => {
  it("places a first Screen at / for the first Instance when a Repository is added", async () => {
    const { rpc, project, instance } = await addRepository();
    const [screen, ...rest] = await screensOf(rpc, project);
    expect(rest).toEqual([]);
    expect(screen).toMatchObject({ type: "screen", x: 0, y: 0, props: { instance: instance.id, route: "/", w: 1280, h: 800, title: instance.branch } });
  });

  it("snapshots a Screen through its Instance's proxy once the Instance is live, caches it, and renders again when the route changes", async () => {
    const { engine, rpc, project, instance } = await addRepository({ UNFRAMED_TEST_RENDERER: "ok" });
    const [screen] = await screensOf(rpc, project);
    const stream = rpc.subscribe("screens.snapshots", { project });
    await becomes(rpc, project, instance.id, "stopped");
    await rpc.call("instances.demand", { project, client: "window-1", ids: [instance.id] });
    const live = await becomes(rpc, project, instance.id, "live");

    await eventually(async () => stream.values.length, (count) => count >= 1);
    expect(stream.values[0]).toEqual({ shape: screen.id, w: 1280, h: 800, at: expect.any(Number) });
    expect(pictured(await readFile(snapshotFile(engine, project, screen.id)))).toMatchObject({ url: `http://127.0.0.1:${live.proxyPort}/`, w: 1280, h: 800, dials: null });
    const served = await engine.request(`/api/file/${project}/${screen.id.replace(/^shape:/, "")}.png?screen=1`);
    expect(served.status).toBe(200);
    expect(served.headers["content-type"]).toBe("image/png");

    await rpc.call("testCanvas.apply", { project, change: { put: [{ ...screen, props: { ...screen.props, route: "/settings", dials: { accent: "#ff0000" } } }], remove: [] }, origin: { kind: "server", id: "test" } });
    await eventually(async () => stream.values.length, (count) => count >= 2);
    expect(pictured(await readFile(snapshotFile(engine, project, screen.id)))).toMatchObject({ url: `http://127.0.0.1:${live.proxyPort}/settings`, dials: { accent: "#ff0000" } });

    const later = rpc.subscribe("screens.snapshots", { project });
    await eventually(async () => later.values.length, (count) => count >= 1);
    expect(later.values[0]).toMatchObject({ shape: screen.id, w: 1280, h: 800 });
  });

  it("does not snapshot a Screen whose Instance never runs", async () => {
    const { engine, rpc, project, instance } = await addRepository({ UNFRAMED_TEST_RENDERER: "ok" });
    const [screen] = await screensOf(rpc, project);
    await becomes(rpc, project, instance.id, "stopped");
    await new Promise((resolve) => setTimeout(resolve, 2000));
    expect(existsSync(snapshotFile(engine, project, screen.id))).toBe(false);
  });

  it("lists the Repository's branches with the current one", async () => {
    const { root, rpc, project } = await addRepository();
    git(root, "branch", "feature/login");
    const answer = await rpc.call("instances.branches", { project });
    expect(answer.current).toBe("trunk");
    expect(answer.branches).toEqual(expect.arrayContaining(["trunk", "feature/login"]));
  });

  it("reads the Repository record", async () => {
    const { root, rpc, project } = await addRepository();
    expect((await rpc.call("repositories.read", { project })).repository).toMatchObject({ root, baseBranch: "trunk", status: "setting-up", setup: null });
    expect((await rpc.call("repositories.read", { project: "nothing-here" })).repository).toBeNull();
  });
});
