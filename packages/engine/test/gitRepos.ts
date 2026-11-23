import { execFileSync } from "node:child_process";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { makeTempDir } from "./engineProcess.ts";

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

export const makeRepo = async (name = "My App") => {
  const root = join(await makeTempDir("unframed-repo-"), name);
  await mkdir(join(root, "src", "pages"), { recursive: true });
  await writeFile(join(root, "package.json"), '{ "scripts": { "dev": "node server.js" } }\n');
  await writeFile(join(root, "src", "pages", "index.html"), "<h1>Hello</h1>\n");
  git(root, "init", "-q", "-b", "trunk");
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "first");
  return realpath(root);
};

