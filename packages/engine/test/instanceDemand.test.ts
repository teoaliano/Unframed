import { writeFile } from "node:fs/promises";
import net from "node:net";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Instance } from "@unframed/contracts";
import { describe, expect, it } from "vitest";
import { makeRepo, repoEngineEnv } from "./gitRepos.ts";
import { rawRequest, startEngine, type TestEngine } from "./harness.ts";
import type { TestRpcClient } from "./rpcClient.ts";

const freePort = (): Promise<number> =>
  new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as net.AddressInfo;
      server.close(() => resolve(address.port));
    });
  });

const eventually = async <T>(read: () => Promise<T>, accept: (value: T) => boolean, timeoutMs = 30_000): Promise<T> => {
  const started = Date.now();
  for (;;) {
    const value = await read();
    if (accept(value)) return value;
    if (Date.now() - started > timeoutMs) throw new Error(`Timed out; last value: ${JSON.stringify(value)}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const stateOf = (rpc: TestRpcClient, project: string, id: string) => rpc.call("instances.status", { project, id });

const becomes = (rpc: TestRpcClient, project: string, id: string, state: Instance["state"]) =>
  eventually(
    () => stateOf(rpc, project, id),
    (instance) => instance.state === state,
  );

const repositoryDb = (engine: TestEngine, project: string) => new DatabaseSync(join(engine.dataDir, "output", project, "unframed.sqlite"));

const setSinglePort = (engine: TestEngine, project: string, port: number) => {
  const db = repositoryDb(engine, project);
  try {
    const setup = { setupCommand: "npm install", runCommand: "npm run dev", packageManager: "npm", portMode: { mode: "single", port }, files: [], mocks: [], warnings: [] };
    db.prepare("UPDATE repository SET setup = ? WHERE id = 1").run(JSON.stringify(setup));
  } finally {
    db.close();
  }
};

const savedPortMode = (engine: TestEngine, project: string) => {
  const db = repositoryDb(engine, project);
  try {
    return JSON.parse(String(db.prepare("SELECT setup FROM repository WHERE id = 1").get()!.setup)).portMode;
  } finally {
    db.close();
  }
};

const twoInstances = async (env: Record<string, string> = {}, single?: (engine: TestEngine, project: string) => Promise<void>) => {
  const root = await makeRepo();
  const engine = await startEngine({ env: await repoEngineEnv(env) });
  const rpc = await engine.rpc();
  const added = await rpc.call("repositories.add", { path: root });
  const project = added.name;
  const a = added.instance.id;
  await becomes(rpc, project, a, "stopped");
  await single?.(engine, project);
  const b = (await rpc.call("instances.create", { project })).id;
  await becomes(rpc, project, b, "stopped");
  return { root, engine, rpc, project, a, b };
};

describe("driving Instances from canvas demand", () => {
  it("starts demanded Instances one at a time, most wanted first, and keeps the union of every window's demand", async () => {
    const { rpc, project, a, b } = await twoInstances();
    const states = rpc.subscribe("instances.subscribe", { project });
    const answered = await rpc.call("instances.demand", { project, client: "window-1", ids: [a, b, "deadbeef"] });
    expect(answered.instances.map((instance) => instance.id).sort()).toEqual([a, b].sort());
    await becomes(rpc, project, a, "live");
    await becomes(rpc, project, b, "live");
    const seen = states.values.map((instance: Instance) => `${instance.id}:${instance.state}`);
    expect(seen.indexOf(`${a}:live`)).toBeGreaterThan(-1);
    expect(seen.indexOf(`${a}:live`)).toBeLessThan(seen.indexOf(`${b}:starting`));
    await states.close();

    const union = await rpc.call("instances.demand", { project, client: "window-2", ids: [b] });
    expect(union.instances.map((instance) => instance.id).sort()).toEqual([a, b].sort());
    expect((await rpc.call("instances.demand", { project, client: "window-1", ids: [] })).instances.map((instance) => instance.id)).toEqual([b]);
    await pause(500);
    expect((await stateOf(rpc, project, a)).state).toBe("live");
  });

  it("stops the least recently demanded over budget, and leaves an evicted Instance stopped until it is demanded again", async () => {
    const { rpc, project, a, b } = await twoInstances({ UNFRAMED_TEST_INSTANCE_BUDGET_BYTES: "1", UNFRAMED_TEST_INSTANCE_SAMPLE_MS: "200" });
    await rpc.call("instances.demand", { project, client: "window-1", ids: [a] });
    await becomes(rpc, project, a, "live");
    await pause(600);
    expect((await stateOf(rpc, project, a)).state).toBe("live");

    await rpc.call("instances.demand", { project, client: "window-1", ids: [a, b] });
    await becomes(rpc, project, b, "live");
    const evicted = await becomes(rpc, project, a, "stopped");
    expect(evicted.log).toContain("Unframed stopped this Instance to stay within the memory budget.");
    await pause(800);
    expect((await stateOf(rpc, project, a)).state).toBe("stopped");
    expect((await stateOf(rpc, project, b)).state).toBe("live");

    await rpc.call("instances.demand", { project, client: "window-1", ids: [a, b] });
    await pause(500);
    expect((await stateOf(rpc, project, a)).state).toBe("stopped");
    await rpc.call("instances.demand", { project, client: "window-1", ids: [b] });
    await rpc.call("instances.demand", { project, client: "window-1", ids: [a] });
    await becomes(rpc, project, a, "live");
    await becomes(rpc, project, b, "stopped");
  });

  it("stops an Instance after it sits with no demand and no file changes, but never while demanded", async () => {
    const { rpc, project, a } = await twoInstances({ UNFRAMED_TEST_INSTANCE_IDLE_MS: "1500", UNFRAMED_TEST_INSTANCE_SAMPLE_MS: "200" });
    await rpc.call("instances.demand", { project, client: "window-1", ids: [a] });
    const live = await becomes(rpc, project, a, "live");
    await pause(2500);
    expect((await stateOf(rpc, project, a)).state).toBe("live");

    await rpc.call("instances.demand", { project, client: "window-1", ids: [] });
    for (let edit = 0; edit < 10; edit += 1) {
      await writeFile(join(live.worktree, "src", "pages", "index.html"), `<h1>Edit ${edit}</h1>\n`);
      await pause(300);
    }
    expect((await stateOf(rpc, project, a)).state).toBe("live");
    const stopped = await becomes(rpc, project, a, "stopped");
    expect(stopped.log).toContain("Unframed stopped this Instance after it sat unused with no file changes.");
  });

  it("drops a window's demand when its connection closes, so its Instances go idle", async () => {
    const { engine, rpc, project, a } = await twoInstances({ UNFRAMED_TEST_INSTANCE_IDLE_MS: "1500", UNFRAMED_TEST_INSTANCE_SAMPLE_MS: "200" });
    const window = await engine.rpc();
    await window.call("instances.demand", { project, client: "window-2", ids: [a] });
    await becomes(rpc, project, a, "live");
    await pause(2500);
    expect((await stateOf(rpc, project, a)).state).toBe("live");

    await window.close();
    const stopped = await becomes(rpc, project, a, "stopped");
    expect(stopped.log).toContain("Unframed stopped this Instance after it sat unused with no file changes.");
  });

  it("keeps one Instance live on the fixed port of a single-port Repository", async () => {
    const fixed = await freePort();
    const { rpc, project, a, b } = await twoInstances({}, async (engine, slug) => setSinglePort(engine, slug, fixed));
    await rpc.call("instances.demand", { project, client: "window-1", ids: [a] });
    expect(await becomes(rpc, project, a, "live")).toMatchObject({ upstreamPort: fixed });

    await rpc.call("instances.demand", { project, client: "window-1", ids: [b, a] });
    expect(await becomes(rpc, project, b, "live")).toMatchObject({ upstreamPort: fixed });
    expect((await stateOf(rpc, project, a)).state).toBe("stopped");

    expect(await rpc.call("instances.start", { project, id: a })).toMatchObject({ state: "live", upstreamPort: fixed });
    expect((await stateOf(rpc, project, b)).state).toBe("stopped");
  });

  it("fails a single-port Instance whose fixed port something else already answers on", async () => {
    const fixed = await freePort();
    const { rpc, project, a } = await twoInstances({}, async (engine, slug) => setSinglePort(engine, slug, fixed));
    const other = net.createServer((socket) => socket.on("error", () => undefined).end("HTTP/1.1 200 OK\r\ncontent-length: 5\r\n\r\nother"));
    await new Promise<void>((resolve) => other.listen(fixed, "127.0.0.1", resolve));
    try {
      expect(await rpc.call("instances.start", { project, id: a })).toMatchObject({
        state: "failed",
        proxyPort: null,
        error: `Something else is already listening on port ${fixed}, the fixed port this Repository runs on. Stop it, then start the Instance again.`,
      });
    } finally {
      await new Promise((resolve) => other.close(resolve));
    }
  });

  it("records the port a single-port server binds when it is not the one asked for", async () => {
    const fixed = await freePort();
    const bound = await freePort();
    const { engine, rpc, project, a } = await twoInstances({ FAKE_DEV_LISTEN_PORT: String(bound) }, async (engine, slug) => setSinglePort(engine, slug, fixed));
    const live = await rpc.call("instances.start", { project, id: a });
    expect(live).toMatchObject({ state: "live", upstreamPort: bound, error: null });
    expect(live.log).toContain(`The dev server listened on port ${bound} instead of ${fixed}. Unframed now runs this Repository on port ${bound}.`);
    expect(savedPortMode(engine, project)).toEqual({ mode: "single", port: bound });
    expect((await rawRequest(live.proxyPort!, "/", { headers: { host: `127.0.0.1:${live.proxyPort}`, accept: "text/html" } })).text).toContain("Fake app");
  });
});
