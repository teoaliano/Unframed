import { execFileSync } from "node:child_process";
import { mkdir, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, relative } from "node:path";
import { folderPickerPlan } from "@unframed/domain";
import { describe, expect, it } from "vitest";
import { makeTempDir, startEngine } from "./harness.ts";

const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
};

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, env: gitEnv, stdio: ["ignore", "pipe", "pipe"] }).toString();

const makeRepo = async (name = "My App") => {
  const root = join(await makeTempDir("unframed-repo-"), name);
  await mkdir(join(root, "src", "pages"), { recursive: true });
  await writeFile(join(root, "package.json"), '{ "scripts": { "dev": "node server.js" } }\n');
  await writeFile(join(root, "src", "pages", "index.html"), "<h1>Hello</h1>\n");
  git(root, "init", "-q", "-b", "trunk");
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "first");
  return realpath(root);
};

const treeOf = async (root: string): Promise<Record<string, string>> => {
  const tree: Record<string, string> = {};
  const walk = async (dir: string) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
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
    const engine = await startEngine();
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
      },
    });
    expect(await rpc.call("projects.list")).toEqual({ projects: ["my-app"], kinds: { "my-app": "repository" } });
    expect(await readdir(join(engine.dataDir, "output", "my-app"))).toContain("unframed.sqlite");
    expect(await treeOf(root)).toEqual(before);
  });

  it("keeps the kind across a restart, beside whiteboards", async () => {
    const root = await makeRepo("shop");
    const first = await startEngine();
    const dataDir = first.dataDir;
    const rpc = await first.rpc();
    await rpc.call("projects.create", { name: "moodboard" });
    await rpc.call("repositories.add", { path: root });
    expect((await first.stop()).code).toBe(0);

    const second = await startEngine({ dataDir });
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
    const engine = await startEngine();
    const added = await (await engine.rpc()).call("repositories.add", { path: root });
    expect(added.uncommitted).toBe(true);
    expect(await treeOf(root)).toEqual(before);
  });

  it("refuses a folder that is not in a git repository, one that does not exist, and a relative path", async () => {
    const plain = await makeTempDir("unframed-plain-");
    const engine = await startEngine();
    const rpc = await engine.rpc();
    await expect(rpc.call("repositories.add", { path: plain })).rejects.toMatchObject({ code: "bad_request", message: "That folder is not in a git repository." });
    await expect(rpc.call("repositories.add", { path: join(plain, "gone") })).rejects.toMatchObject({ code: "bad_request", message: "That folder does not exist." });
    await expect(rpc.call("repositories.add", { path: "relative/app" })).rejects.toMatchObject({ code: "bad_request", message: "That folder does not exist." });
    expect((await rpc.call("projects.list")).projects).toEqual([]);
  });

  it("refuses a name that is taken, and takes a name the person gives", async () => {
    const root = await makeRepo("site");
    const engine = await startEngine();
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
