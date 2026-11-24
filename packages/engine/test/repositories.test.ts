import { mkdir, readdir, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, relative } from "node:path";
import { folderPickerPlan } from "@unframed/domain";
import { describe, expect, it } from "vitest";
import { git, makeRepo, repoEngineEnv } from "./gitRepos.ts";
import { makeTempDir, startEngine } from "./harness.ts";

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

describe("repositories.add", () => {
  it("adds a repository from a subfolder: the repo root, named after its folder, recorded in the project's database", async () => {
    const root = await makeRepo();
    const before = await treeOf(root);
    const engine = await startEngine({ env: await repoEngineEnv() });
    const rpc = await engine.rpc();
    const added = await rpc.call("repositories.add", { path: join(root, "src", "pages") });
    expect(added).toEqual({
      name: "my-app",
      uncommitted: false,
      repository: {
        root,
        gitCommonDir: join(root, ".git"),
        baseBranch: "trunk",
        status: "setting-up",
        setup: null,
        addedAt: expect.any(String),
        setupChat: expect.any(String),
      },
      instance: expect.objectContaining({ repository: "my-app", baseRef: "trunk" }),
    });
    expect(await rpc.call("projects.list")).toEqual({ projects: ["my-app"], kinds: { "my-app": "repository" } });
    expect(await readdir(join(engine.dataDir, "output", "my-app"))).toContain("unframed.sqlite");
    expect(await treeOf(root)).toEqual(before);
  });

  it("keeps the kind across a restart, beside whiteboards", async () => {
    const root = await makeRepo("shop");
    const first = await startEngine({ env: await repoEngineEnv() });
    const dataDir = first.dataDir;
    const rpc = await first.rpc();
    await rpc.call("projects.create", { name: "moodboard" });
    await rpc.call("repositories.add", { path: root });
    expect((await first.stop()).code).toBe(0);

    const second = await startEngine({ dataDir, env: await repoEngineEnv() });
    expect(await (await second.rpc()).call("projects.list")).toEqual({
      projects: ["moodboard", "shop"],
      kinds: { moodboard: "whiteboard", shop: "repository" },
    });
    expect((await readdir(join(dataDir, "output", "shop"))).filter((name) => name.startsWith("unframed.sqlite"))).toEqual(["unframed.sqlite"]);
  });

  it("says when the main checkout has uncommitted changes, and leaves them alone", async () => {
    const root = await makeRepo();
    await writeFile(join(root, "package.json"), '{ "scripts": {} }\n');
    const before = await treeOf(root);
    const engine = await startEngine({ env: await repoEngineEnv() });
    const added = await (await engine.rpc()).call("repositories.add", { path: root });
    expect(added.uncommitted).toBe(true);
    expect(await treeOf(root)).toEqual(before);
  });

  it("refuses a folder that is not in a git repository, one that does not exist, and a relative path", async () => {
    const plain = await makeTempDir("unframed-plain-");
    const engine = await startEngine({ env: await repoEngineEnv() });
    const rpc = await engine.rpc();
    await expect(rpc.call("repositories.add", { path: plain })).rejects.toMatchObject({ code: "bad_request", message: "That folder is not in a git repository." });
    await expect(rpc.call("repositories.add", { path: join(plain, "gone") })).rejects.toMatchObject({ code: "bad_request", message: "That folder does not exist." });
    await expect(rpc.call("repositories.add", { path: "relative/app" })).rejects.toMatchObject({ code: "bad_request", message: "That folder does not exist." });
    expect((await rpc.call("projects.list")).projects).toEqual([]);
  });

  it("refuses a name that is taken, and takes a name the person gives", async () => {
    const root = await makeRepo("site");
    const engine = await startEngine({ env: await repoEngineEnv() });
    const rpc = await engine.rpc();
    await rpc.call("projects.create", { name: "site" });
    await expect(rpc.call("repositories.add", { path: root })).rejects.toMatchObject({ code: "conflict", message: 'A project named "site" already exists.' });
    expect(await rpc.call("projects.list")).toEqual({ projects: ["site"], kinds: { site: "whiteboard" } });
    expect((await rpc.call("repositories.add", { path: root, name: "Site Redesign" })).name).toBe("site-redesign");
  });
});

describe("repositories.pickFolder", () => {
  it("opens the folder picker at the home folder with its own prompt and answers the path", async () => {
    const engine = await startEngine({ env: { UNFRAMED_TEST_PICK_FOLDER: "/Users/someone/app" } });
    expect(await (await engine.rpc()).call("repositories.pickFolder")).toEqual({ path: "/Users/someone/app" });
    const plan = folderPickerPlan(process.platform, homedir(), "Choose a git repository to add");
    expect(await engine.nativeLog()).toEqual([{ cmd: plan.cmd, args: plan.args }]);
  });

  it("answers '' for a cancelled dialog", async () => {
    const engine = await startEngine({ env: { UNFRAMED_TEST_PICK_FOLDER: "cancel" } });
    expect(await (await engine.rpc()).call("repositories.pickFolder")).toEqual({ path: "" });
  });
});

describe("a Repository that moved", () => {
  it("is missing while its folder is gone, and is located again at its new folder with its worktrees repaired", { timeout: 60_000 }, async () => {
    const root = await makeRepo();
    const engine = await startEngine({ env: await repoEngineEnv() });
    const rpc = await engine.rpc();
    const added = await rpc.call("repositories.add", { path: root });
    const project = added.name;
    for (let tries = 0; ["creating", "installing"].includes((await rpc.call("instances.status", { project, id: added.instance.id })).state); tries++) {
      if (tries > 200) throw new Error("the Instance never settled");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const moved = `${root}-moved`;
    await rename(root, moved);
    expect((await rpc.call("repositories.read", { project })).repository).toMatchObject({ status: "missing", root });
    await expect(rpc.call("instances.create", { project })).rejects.toMatchObject({ message: "Repository not found." });

    const plain = await makeTempDir("unframed-plain-");
    await expect(rpc.call("repositories.locate", { project, path: plain })).rejects.toMatchObject({ message: "That folder is not in a git repository." });
    const other = join(await makeTempDir("unframed-other-"), "other");
    await mkdir(other);
    await writeFile(join(other, "README.md"), "another project\n");
    git(other, "init", "-q", "-b", "trunk");
    git(other, "add", ".");
    git(other, "commit", "-q", "-m", "other");
    await expect(rpc.call("repositories.locate", { project, path: other })).rejects.toMatchObject({ message: "That folder is a different repository." });

    const located = await rpc.call("repositories.locate", { project, path: join(moved, "src") });
    expect(located.repository).toMatchObject({ root: moved, gitCommonDir: join(moved, ".git"), baseBranch: "trunk", status: "setting-up" });
    expect((await rpc.call("repositories.read", { project })).repository).toMatchObject({ root: moved, status: "setting-up" });
    expect(git(added.instance.worktree, "rev-parse", "--path-format=absolute", "--git-common-dir").trim()).toBe(join(moved, ".git"));
    await writeFile(join(added.instance.worktree, "src", "pages", "about.html"), "<h1>About</h1>\n");
    expect((await rpc.call("instances.diff", { project, id: added.instance.id })).files.map((file) => file.path)).toEqual(["src/pages/about.html"]);
    const second = await rpc.call("instances.create", { project });
    expect(git(moved, "worktree", "list")).toContain(second.worktree);
  });
});
