import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fakeShell } from "./agentFakes.ts";
import { makeTempDir, startEngine } from "./harness.ts";

const envDumpingCli = async (dir: string, name: string, version: string) => {
  await mkdir(dir, { recursive: true });
  const path = join(dir, name);
  await writeFile(
    path,
    `#!${process.execPath}
const fs = require("node:fs");
if (process.argv[2] === "--version") {
  fs.writeFileSync(process.env.FAKE_ENV_DIR + "/${name}.json", JSON.stringify(process.env));
  console.log("${version}");
  process.exit(0);
}
process.exit(1);
`,
  );
  await chmod(path, 0o755);
  return path;
};

describe("the login shell", () => {
  it("is asked for PATH once with -ilc, and both CLIs are found on it", async () => {
    const dir = await makeTempDir("unframed-shell-");
    const bin = join(dir, "shell-bin");
    await envDumpingCli(bin, "claude", "2.1.280 (Claude Code)");
    await envDumpingCli(bin, "codex", "codex-cli 0.156.1");
    const shellLog = join(dir, "shell.log");
    const engine = await startEngine({
      env: { PATH: "/usr/bin:/bin", SHELL: await fakeShell(join(dir, "shell")), FAKE_SHELL_PATH: bin, FAKE_SHELL_LOG: shellLog, FAKE_ENV_DIR: dir },
    });
    const statuses = await (await engine.rpc()).call("providers.getStatuses", { refresh: true });
    expect(statuses.claude.version).toBe("2.1.280");
    expect(statuses.codex.version).toBe("0.156.1");
    expect((await readFile(shellLog, "utf8")).split("\n").filter((line) => line !== "")).toEqual(['-ilc echo "$PATH"']);
  });

  it("keeps the engine's hosting and Electron variables out of every process it spawns", async () => {
    const dir = await makeTempDir("unframed-shell-");
    const bin = join(dir, "shell-bin");
    await envDumpingCli(bin, "claude", "2.1.280 (Claude Code)");
    const engine = await startEngine({
      env: {
        PATH: "/usr/bin:/bin",
        SHELL: await fakeShell(join(dir, "shell")),
        FAKE_SHELL_PATH: bin,
        FAKE_ENV_DIR: dir,
        ESBUILD_BINARY_PATH: join(dir, "bundled-esbuild"),
        ELECTRON_RUN_AS_NODE: "1",
        OUTPUT_DIR: join(dir, "output"),
        UNFRAMED_CLIENT_PORT: "5173",
        KEPT_BY_THE_ENGINE: "yes",
      },
    });
    await (await engine.rpc()).call("providers.getStatuses", { refresh: true });
    const env = JSON.parse(await readFile(join(dir, "claude.json"), "utf8")) as Record<string, string>;
    expect(env.KEPT_BY_THE_ENGINE).toBe("yes");
    expect((env.PATH ?? "").split(":")).toContain(bin);
    for (const name of ["ESBUILD_BINARY_PATH", "ELECTRON_RUN_AS_NODE", "OUTPUT_DIR", "PORT"]) expect(env, name).not.toHaveProperty(name);
    expect(Object.keys(env).filter((name) => name.startsWith("UNFRAMED_"))).toEqual([]);
  });
});
