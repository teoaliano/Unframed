import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import net from "node:net";
import { join, relative } from "node:path";
import type { Instance } from "@unframed/contracts";
import { describe, expect, it } from "vitest";
import { git, makeRepo, repoEngineEnv } from "./gitRepos.ts";
import { rawRequest, startEngine } from "./harness.ts";
import type { TestRpcClient } from "./rpcClient.ts";

const treeOf = async (root: string): Promise<Record<string, string>> => {
  const tree: Record<string, string> = {};
  const walk = async (dir: string) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name === ".git") continue;
      const path = join(dir, entry.name);
      const info = await stat(path);
      tree[relative(root, path)] = entry.isDirectory() ? "dir" : `${info.size}:${info.mtimeMs}`;
      if (entry.isDirectory()) await walk(path);
    }
  };
  await walk(root);
  return tree;
};

const answers = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    socket.setTimeout(500);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
  });

const freePort = (): Promise<number> =>
  new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as net.AddressInfo;
      server.close(() => resolve(address.port));
    });
  });

const eventually = async <T>(read: () => Promise<T>, accept: (value: T) => boolean, timeoutMs = 20_000): Promise<T> => {
  const started = Date.now();
  for (;;) {
    const value = await read();
    if (accept(value)) return value;
    if (Date.now() - started > timeoutMs) throw new Error(`Timed out; last value: ${JSON.stringify(value)}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};

const settled = (rpc: TestRpcClient, project: string, id: string) =>
  eventually(
    () => rpc.call("instances.status", { project, id }),
    (instance) => instance.state !== "creating" && instance.state !== "installing" && instance.state !== "starting",
  );

const addRepository = async (env: Record<string, string | undefined> = {}) => {
  const root = await makeRepo();
  await writeFile(join(root, ".env.local"), "SECRET=shh\n");
  const engine = await startEngine({ env: await repoEngineEnv(env) });
  const rpc = await engine.rpc();
  const added = await rpc.call("repositories.add", { path: root });
  const first = await settled(rpc, added.name, added.instance.id);
  return { root, engine, rpc, project: added.name, added, first };
};

const info = async (port: number) => JSON.parse((await rawRequest(port, "/__fake/info")).text) as { argv: string[]; envPort: string; cwd: string; pid: number };

describe("creating an Instance", () => {
  it("adds a Repository with its first Instance: a fresh worktree from the current branch, .env files copied, the exclude merged, the setup command run", async () => {
    const root = await makeRepo();
    await writeFile(join(root, ".env.local"), "SECRET=shh\n");
    await writeFile(join(root, "src", "pages", "index.html"), "<h1>Work in progress</h1>\n");
    const before = await treeOf(root);
    const engine = await startEngine({ env: await repoEngineEnv() });
    const rpc = await engine.rpc();
    const added = await rpc.call("repositories.add", { path: root });
    const id = added.instance.id;
    expect(id).toMatch(/^[0-9a-f]{8}$/);
    const worktree = join(engine.dataDir, "worktrees", "my-app", `unframed-${id}-${id}`);
    expect(added.uncommitted).toBe(true);
    expect(added.instance).toEqual({
      id,
      repository: "my-app",
      branch: `unframed/${id}`,
      baseRef: "trunk",
      worktree,
      state: "installing",
      proxyPort: null,
      upstreamPort: null,
      error: null,
      log: expect.any(String),
    });

    const ready = await settled(rpc, "my-app", id);
    expect(ready.state).toBe("stopped");
    expect(await readFile(join(worktree, "installed.txt"), "utf8")).toBe("yes\n");
    expect(await readFile(join(worktree, ".env.local"), "utf8")).toBe("SECRET=shh\n");
    expect(await readFile(join(worktree, "src", "pages", "index.html"), "utf8")).toBe("<h1>Hello</h1>\n");
    expect((await readFile(join(root, ".git", "info", "exclude"), "utf8")).split("\n")).toContain("/.env.local");
    expect(git(worktree, "rev-parse", "--abbrev-ref", "HEAD").trim()).toBe(`unframed/${id}`);
    expect(await treeOf(root)).toEqual(before);
    expect((await rpc.call("instances.list", { project: "my-app" })).instances).toEqual([ready]);
  });

  it("creates an Instance on a named branch from a picked base, merging the exclude once", async () => {
    const { root, engine, rpc, project } = await addRepository();
    git(root, "checkout", "-q", "-b", "other");
    await writeFile(join(root, "other.txt"), "other\n");
    git(root, "add", ".");
    git(root, "commit", "-q", "-m", "other");
    git(root, "checkout", "-q", "trunk");

    const created = await rpc.call("instances.create", { project, base: "other", branch: "try/Red_Header" });
    expect(created).toMatchObject({ branch: "try/Red_Header", baseRef: "other", state: "installing" });
    expect(created.worktree).toBe(join(engine.dataDir, "worktrees", project, `try-red-header-${created.id}`));
    expect((await settled(rpc, project, created.id)).state).toBe("stopped");
    expect(await readFile(join(created.worktree, "other.txt"), "utf8")).toBe("other\n");
    expect((await readFile(join(root, ".git", "info", "exclude"), "utf8")).split("\n").filter((line) => line === "/.env.local")).toHaveLength(1);
    expect((await rpc.call("instances.list", { project })).instances.map((instance) => instance.branch)).toContain("try/Red_Header");
  });

  it("refuses a taken branch, a bad branch name, an unknown base and a project that is not a Repository", async () => {
    const { rpc, project, first } = await addRepository();
    await expect(rpc.call("instances.create", { project, branch: first.branch })).rejects.toMatchObject({
      code: "conflict",
      message: `A branch named "${first.branch}" already exists.`,
    });
    await expect(rpc.call("instances.create", { project, branch: "no..dots" })).rejects.toMatchObject({ code: "bad_request", message: '"no..dots" is not a valid branch name.' });
    await expect(rpc.call("instances.create", { project, base: "nowhere" })).rejects.toMatchObject({ code: "bad_request", message: 'There is no branch or commit named "nowhere".' });
    await rpc.call("projects.create", { name: "board" });
    await expect(rpc.call("instances.create", { project: "board" })).rejects.toMatchObject({ code: "bad_request", message: "That project is not a Repository." });
    await expect(rpc.call("instances.status", { project, id: "deadbeef" })).rejects.toMatchObject({ code: "not_found", message: "That worktree does not exist." });
    expect((await rpc.call("instances.list", { project })).instances).toHaveLength(1);
  });

  it("reports a setup command that fails", async () => {
    const root = await makeRepo();
    await writeFile(join(root, "install.js"), 'console.error("install broke"); process.exit(4);\n');
    git(root, "commit", "-q", "-am", "break install");
    const engine = await startEngine({ env: await repoEngineEnv() });
    const rpc = await engine.rpc();
    const added = await rpc.call("repositories.add", { path: root });
    const failed = await settled(rpc, added.name, added.instance.id);
    expect(failed.state).toBe("failed");
    expect(failed.error).toMatch(/^The setup command failed/);
    expect(failed.log).toContain("install broke");
  });
});

describe("removing an Instance", () => {
  it("deletes the worktree and keeps the branch, or deletes both", async () => {
    const { root, rpc, project, first } = await addRepository();
    const removed = await rpc.call("instances.remove", { project, id: first.id });
    expect(removed).toMatchObject({ id: first.id, state: "removed" });
    expect(existsSync(first.worktree)).toBe(false);
    expect(git(root, "branch", "--list", first.branch).trim()).not.toBe("");
    expect(await rpc.call("instances.status", { project, id: first.id })).toMatchObject({ state: "removed" });

    const second = await settled(rpc, project, (await rpc.call("instances.create", { project })).id);
    await rpc.call("instances.remove", { project, id: second.id, deleteBranch: true });
    expect(existsSync(second.worktree)).toBe(false);
    expect(git(root, "branch", "--list", second.branch).trim()).toBe("");
    await expect(rpc.call("instances.start", { project, id: second.id })).rejects.toMatchObject({ code: "conflict", message: "That branch's worktree was removed." });
  });

  it("refuses unpushed and unmerged commits, and uncommitted changes, unless forced", async () => {
    const { root, rpc, project, first } = await addRepository();
    await writeFile(join(first.worktree, "draft.txt"), "draft\n");
    await expect(rpc.call("instances.remove", { project, id: first.id })).rejects.toMatchObject({
      code: "conflict",
      message: `The worktree of "${first.branch}" has uncommitted changes. Remove it anyway to lose them.`,
    });
    git(first.worktree, "add", ".");
    git(first.worktree, "commit", "-q", "-m", "draft");
    await expect(rpc.call("instances.remove", { project, id: first.id, deleteBranch: true })).rejects.toMatchObject({
      code: "conflict",
      message: `The branch "${first.branch}" has work that is not pushed or merged. Remove it anyway to lose that work.`,
    });
    expect(existsSync(first.worktree)).toBe(true);

    git(root, "merge", "-q", "--ff-only", first.branch);
    await rpc.call("instances.remove", { project, id: first.id, deleteBranch: true });
    expect(existsSync(first.worktree)).toBe(false);

    const second = await settled(rpc, project, (await rpc.call("instances.create", { project })).id);
    await writeFile(join(second.worktree, "draft.txt"), "lost\n");
    git(second.worktree, "add", ".");
    git(second.worktree, "commit", "-q", "-m", "lost");
    await rpc.call("instances.remove", { project, id: second.id, force: true, deleteBranch: true });
    expect(existsSync(second.worktree)).toBe(false);
    expect(git(root, "branch", "--list", second.branch).trim()).toBe("");
  });

  it("refuses unpushed commits when git warns that the base name is ambiguous", async () => {
    const { root, rpc, project, first } = await addRepository();
    git(root, "tag", first.baseRef);
    await writeFile(join(first.worktree, "draft.txt"), "draft\n");
    git(first.worktree, "add", ".");
    git(first.worktree, "commit", "-q", "-m", "draft");
    await expect(rpc.call("instances.remove", { project, id: first.id, deleteBranch: true })).rejects.toMatchObject({
      code: "conflict",
      message: `The branch "${first.branch}" has work that is not pushed or merged. Remove it anyway to lose that work.`,
    });
    expect(git(root, "branch", "--list", first.branch).trim()).not.toBe("");
  });
});

describe("running an Instance", () => {
  it("starts on a free port with PORT and the port flag, verifies the bound port, and stops", async () => {
    const { rpc, project, first } = await addRepository();
    const states = rpc.subscribe("instances.subscribe", { project });
    const live = await rpc.call("instances.start", { project, id: first.id });
    expect(live).toMatchObject({ id: first.id, state: "live", error: null });
    const port = live.upstreamPort!;
    expect(port).toBeGreaterThan(0);
    expect(live.log).toContain(`http://localhost:${port}/`);
    const started = await info(port);
    expect(started.argv).toEqual(["--port", String(port)]);
    expect(started.envPort).toBe(String(port));
    expect(started.cwd).toBe(await realpath(first.worktree));
    expect(await rpc.call("instances.status", { project, id: first.id })).toMatchObject({ state: "live", upstreamPort: port });

    const stopped = await rpc.call("instances.stop", { project, id: first.id });
    expect(stopped).toMatchObject({ state: "stopped", upstreamPort: null });
    expect(await answers(port)).toBe(false);
    await eventually(
      async () => states.values.map((instance: Instance) => instance.state),
      (seen) => seen.includes("starting") && seen.includes("live") && seen.at(-1) === "stopped",
    );
    await states.close();
  });

  it("runs two Instances at once on different ports", async () => {
    const { rpc, project, first } = await addRepository();
    const second = await settled(rpc, project, (await rpc.call("instances.create", { project })).id);
    const [a, b] = await Promise.all([rpc.call("instances.start", { project, id: first.id }), rpc.call("instances.start", { project, id: second.id })]);
    expect(a.upstreamPort).not.toBe(b.upstreamPort);
    expect((await info(a.upstreamPort!)).cwd).toBe(await realpath(first.worktree));
    expect((await info(b.upstreamPort!)).cwd).toBe(await realpath(second.worktree));
  });

  it("reports a server that exits before it listens, with its log", async () => {
    const { rpc, project, first } = await addRepository({ FAKE_DEV_EXIT_CODE: "3" });
    const failed = await rpc.call("instances.start", { project, id: first.id });
    expect(failed.state).toBe("failed");
    expect(failed.error).toMatch(/^The dev server exited with code 3 before it listened on port \d+\.$/);
    expect(failed.log).toContain("fake dev server: giving up");
  });

  it("reports a server that listens on another port than the one it was given", async () => {
    const pinned = await freePort();
    const { rpc, project, first } = await addRepository({ FAKE_DEV_LISTEN_PORT: String(pinned) });
    const failed = await rpc.call("instances.start", { project, id: first.id });
    expect(failed.state).toBe("failed");
    expect(failed.error).toMatch(new RegExp(`^The dev server listened on port ${pinned} instead of \\d+, so its port cannot be chosen\\.$`));
    expect(await answers(pinned)).toBe(false);
  });

  it("kills every dev server when the engine quits", async () => {
    const { engine, rpc, project, first } = await addRepository();
    const port = (await rpc.call("instances.start", { project, id: first.id })).upstreamPort!;
    expect((await engine.stop()).code).toBe(0);
    expect(await answers(port)).toBe(false);
  });

  it.skipIf(process.platform === "win32")("sweeps a dev server a dead engine left behind on the next start", async () => {
    const { engine, rpc, project, first } = await addRepository();
    const port = (await rpc.call("instances.start", { project, id: first.id })).upstreamPort!;
    const { pid } = await info(port);
    const group = execFileSync("ps", ["-o", "pgid=", "-p", String(pid)], { encoding: "utf8" }).trim();
    for (const line of execFileSync("ps", ["-axww", "-o", "pid=,command="], { encoding: "utf8" }).split("\n")) {
      const match = /^\s*(\d+)\s+(.*)$/.exec(line);
      if (match && match[2]!.includes("unframed-reaper") && match[2]!.split(/\s+/).includes(`kill:${group}`)) process.kill(Number(match[1]), "SIGKILL");
    }
    await engine.stop("SIGKILL");
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(await answers(port)).toBe(true);

    const next = await startEngine({ dataDir: engine.dataDir, env: await repoEngineEnv() });
    await next.rpc();
    await eventually(() => answers(port), (open) => !open, 10_000);
    expect(await (await next.rpc()).call("instances.status", { project, id: first.id })).toMatchObject({ state: "stopped", upstreamPort: null });
  });
});
