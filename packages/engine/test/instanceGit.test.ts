import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Instance } from "@unframed/contracts";
import { describe, expect, it } from "vitest";
import { git, makeRepo, repoEngineEnv } from "./gitRepos.ts";
import { startEngine } from "./harness.ts";
import type { TestRpcClient } from "./rpcClient.ts";

const settled = async (rpc: TestRpcClient, project: string, id: string): Promise<Instance> => {
  const started = Date.now();
  for (;;) {
    const instance = await rpc.call("instances.status", { project, id });
    if (instance.state !== "creating" && instance.state !== "installing" && instance.state !== "starting") return instance;
    if (Date.now() - started > 20_000) throw new Error(`Instance never settled: ${JSON.stringify(instance)}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};

export const addRepository = async (env: Record<string, string> = {}, prepare?: (root: string) => Promise<void>) => {
  const root = await makeRepo();
  await prepare?.(root);
  const engine = await startEngine({ env: await repoEngineEnv(env) });
  const rpc = await engine.rpc();
  const added = await rpc.call("repositories.add", { path: root });
  const instance = await settled(rpc, added.name, added.instance.id);
  return { root, engine, rpc, project: added.name as string, instance };
};

const changeWorktree = async (worktree: string) => {
  await writeFile(join(worktree, "src", "new.ts"), "export const answer = 42;\n");
  git(worktree, "add", "src/new.ts");
  git(worktree, "commit", "-q", "-m", "Add the answer");
  await writeFile(join(worktree, "src", "pages", "index.html"), "<h1>Hello, world</h1>\n");
  await writeFile(join(worktree, "src", "pages", "pricing.html"), "<h1>Pricing</h1>\n");
  await mkdir(join(worktree, ".unframed"), { recursive: true });
  await writeFile(join(worktree, ".unframed", "mock-user.js"), "export const user = { name: 'Mock' };\n");
};

describe("an Instance's diff", () => {
  it("shows committed, uncommitted and new files against the merge-base with the base, never Setup's files, env files or the base's later commits", { timeout: 60_000 }, async () => {
    const { root, rpc, project, instance } = await addRepository({}, (at) => writeFile(join(at, ".env.local"), "SECRET=shh\n"));
    await appendFile(join(root, ".git", "info", "exclude"), "/.unframed/mock-user.js\n");
    const forkPoint = git(root, "rev-parse", "trunk").trim();
    await changeWorktree(instance.worktree);
    await writeFile(join(root, "trunk-only.txt"), "later on trunk\n");
    git(root, "add", "trunk-only.txt");
    git(root, "commit", "-q", "-m", "Later on trunk");

    const diff = await rpc.call("instances.diff", { project, id: instance.id });

    expect(diff.base).toBe(forkPoint);
    expect(diff.baseRef).toBe("trunk");
    expect(diff.files).toEqual([
      { path: "src/new.ts", additions: 1, deletions: 0, binary: false },
      { path: "src/pages/index.html", additions: 1, deletions: 1, binary: false },
      { path: "src/pages/pricing.html", additions: 1, deletions: 0, binary: false },
    ]);
    expect(diff.patch).toContain("+export const answer = 42;");
    expect(diff.patch).toContain("+<h1>Hello, world</h1>");
    expect(diff.patch).toContain("+<h1>Pricing</h1>");
    expect(diff.patch).not.toContain("mock-user");
    expect(diff.patch).not.toContain(".env");
    expect(diff.patch).not.toContain("trunk-only");
    expect(diff.truncated).toBe(false);
    expect(git(instance.worktree, "status", "--porcelain")).toContain("?? src/pages/pricing.html");
  });

  it("answers an empty diff for an Instance with no changes, and refuses a removed Instance", { timeout: 60_000 }, async () => {
    const { rpc, project, instance } = await addRepository();
    const diff = await rpc.call("instances.diff", { project, id: instance.id });
    expect(diff).toMatchObject({ files: [], patch: "", truncated: false });

    await rpc.call("instances.remove", { project, id: instance.id });
    await expect(rpc.call("instances.diff", { project, id: instance.id })).rejects.toMatchObject({ message: "That Instance was removed." });
  });
});
