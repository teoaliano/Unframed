import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Instance } from "@unframed/contracts";
import { describe, expect, it, onTestFinished } from "vitest";
import { git, makeRepo, repoEngineEnv } from "./gitRepos.ts";
import { makeTempDir, startEngine, startOpenRouterStub } from "./harness.ts";
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

const GIT_IDENTITY = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Person",
  GIT_AUTHOR_EMAIL: "person@example.com",
  GIT_COMMITTER_NAME: "Person",
  GIT_COMMITTER_EMAIL: "person@example.com",
};

const writerScripts = async () => {
  const scripts = await makeTempDir("unframed-git-scripts-");
  await writeFile(join(scripts, "commit.json"), JSON.stringify({ when: "keys: subject, body", turns: [{ text: '```json\n{"subject":"Add the pricing page","body":"- adds /pricing"}\n```' }] }));
  await writeFile(join(scripts, "pr.json"), JSON.stringify({ when: "keys: title, body", turns: [{ text: '{"title":"Pricing page","body":"## Summary\\n- pricing\\n\\n## Testing\\n- Not run"}' }] }));
  return scripts;
};

const withGithubRemote = async (root: string) => {
  const bare = join(await makeTempDir("unframed-remote-"), "app.git");
  git(root, "init", "-q", "--bare", "-b", "trunk", bare);
  git(root, "remote", "add", "origin", "https://github.com/acme/app.git");
  git(root, "config", `url.${bare}.insteadOf`, "https://github.com/acme/app.git");
  git(root, "push", "-q", "origin", "trunk");
  return bare;
};

const githubStub = async () => {
  const pulls: Array<{ number: number; html_url: string; title: string; head: string }> = [];
  const stub = await startOpenRouterStub((req, body, res) => {
    const url = new URL(req.url ?? "/", "http://stub");
    if (req.method === "GET" && url.pathname === "/repos/acme/app/pulls") {
      const head = url.searchParams.get("head");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(pulls.filter((pull) => `acme:${pull.head}` === head)));
      return true;
    }
    if (req.method === "POST" && url.pathname === "/repos/acme/app/pulls") {
      const asked = JSON.parse(body);
      const pull = { number: 7 + pulls.length, html_url: `https://github.com/acme/app/pull/${7 + pulls.length}`, title: asked.title, head: asked.head };
      pulls.push(pull);
      res.writeHead(201, { "content-type": "application/json" });
      res.end(JSON.stringify(pull));
      return true;
    }
    return false;
  });
  onTestFinished(() => stub.close());
  return stub;
};

describe("an Instance's git actions", () => {
  it("commits with a generated message, pushes the branch with its upstream, and opens a pull request, then finds it open next time", { timeout: 90_000 }, async () => {
    const stub = await githubStub();
    let bare = "";
    const { root, rpc, project, instance } = await addRepository(
      { ...GIT_IDENTITY, UNFRAMED_TEST_AGENT_SCRIPT: await writerScripts(), UNFRAMED_TEST_GITHUB_API: stub.origin, GH_TOKEN: "test-token" },
      async (at) => {
        bare = await withGithubRemote(at);
      },
    );
    await appendFile(join(root, ".git", "info", "exclude"), "/.unframed/mock-user.js\n");
    await changeWorktree(instance.worktree);

    const result = await rpc.call("instances.gitAction", { project, id: instance.id, action: "commit_push_pr" });

    const head = git(instance.worktree, "rev-parse", "HEAD").trim();
    expect(result).toEqual({
      action: "commit_push_pr",
      commit: { sha: head, subject: "Add the pricing page" },
      push: { remote: "origin", branch: instance.branch },
      pr: { number: 7, url: "https://github.com/acme/app/pull/7", title: "Pricing page", existing: false },
    });
    expect(git(instance.worktree, "log", "-1", "--format=%s%n%b%an")).toBe("Add the pricing page\n- adds /pricing\nPerson\n");
    const committed = git(instance.worktree, "show", "--name-only", "--format=", "HEAD");
    expect(committed).toContain("src/pages/pricing.html");
    expect(committed).not.toContain("mock-user");
    expect(git(bare, "rev-parse", `refs/heads/${instance.branch}`).trim()).toBe(head);
    expect(git(instance.worktree, "rev-parse", "--abbrev-ref", "@{upstream}").trim()).toBe(`origin/${instance.branch}`);
    const created = stub.requests.find((request) => request.method === "POST")!;
    expect(created.headers.authorization).toBe("Bearer test-token");
    expect(JSON.parse(created.body)).toEqual({ title: "Pricing page", body: "## Summary\n- pricing\n\n## Testing\n- Not run", head: instance.branch, base: "trunk" });

    await writeFile(join(instance.worktree, "src", "pages", "pricing.html"), "<h1>Plans</h1>\n");
    const again = await rpc.call("instances.gitAction", { project, id: instance.id, action: "commit_push_pr" });
    expect(again.pr).toEqual({ number: 7, url: "https://github.com/acme/app/pull/7", title: "Pricing page", existing: true });
    expect(git(bare, "rev-parse", `refs/heads/${instance.branch}`).trim()).toBe(again.commit!.sha);
    expect(stub.requests.filter((request) => request.method === "POST")).toHaveLength(1);
  });

  it("commits alone, refuses when there is nothing to commit, and refuses a push with no remote or a pull request off GitHub before committing", { timeout: 90_000 }, async () => {
    const { root, rpc, project, instance } = await addRepository({ ...GIT_IDENTITY, UNFRAMED_TEST_AGENT_SCRIPT: await writerScripts() });
    const action = (name: "commit" | "commit_push" | "commit_push_pr") => rpc.call("instances.gitAction", { project, id: instance.id, action: name });
    await expect(action("commit")).rejects.toMatchObject({ message: "There is nothing to commit in this Instance." });

    await writeFile(join(instance.worktree, "src", "pages", "pricing.html"), "<h1>Pricing</h1>\n");
    await expect(action("commit_push")).rejects.toMatchObject({ message: "This repository has no remote to push to." });
    git(root, "remote", "add", "origin", "https://gitlab.com/acme/app.git");
    await expect(action("commit_push_pr")).rejects.toMatchObject({ message: "Unframed opens pull requests on GitHub, and the remote origin is https://gitlab.com/acme/app.git." });
    expect(git(instance.worktree, "status", "--porcelain")).toContain("?? src/pages/pricing.html");

    const committed = await action("commit");
    expect(committed).toMatchObject({ action: "commit", commit: { subject: "Add the pricing page" }, push: null, pr: null });
    expect(git(instance.worktree, "status", "--porcelain")).toBe("");
  });
});
