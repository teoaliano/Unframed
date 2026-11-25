import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir, sweepTempDirs } from "./harness.ts";

const harness = join(import.meta.dirname, "engineProcess.ts");

const deadPid = (): number => {
  const gone = spawnSync(process.execPath, ["-e", "console.log(process.pid)"], { encoding: "utf8" });
  return Number(gone.stdout.trim());
};

describe("the harness's temporary folders", () => {
  it("are named after the process that made them", async () => {
    const dir = await makeTempDir("unframed-repo-");
    expect(basename(dir)).toMatch(new RegExp(`^unframed-repo-p${process.pid}-[A-Za-z0-9]{6}$`));
  });

  it("are removed when a runner that registers no cleanups exits", async () => {
    const script = `import { makeTempDir } from ${JSON.stringify(harness)};\nconsole.log(await makeTempDir("unframed-repo-"));`;
    const made = execFileSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" }).trim();
    expect(made).toContain("unframed-repo-");
    expect(existsSync(made)).toBe(false);
  });

  it("left by a dead test process are swept, and a live one's are kept", async () => {
    const root = await makeTempDir("unframed-sweep-root-");
    const dead = `unframed-repo-p${deadPid()}-AbC123`;
    const live = `unframed-test-p${process.pid}-XyZ789`;
    const production = "unframed-render-Qw3rty";
    for (const name of [dead, live, production, "unframed-headless-chrome"]) await mkdir(join(root, name, "inside"), { recursive: true });

    expect(await sweepTempDirs(root)).toEqual([dead]);
    expect((await readdir(root)).sort()).toEqual(["unframed-headless-chrome", live, production].sort());
  });
});
