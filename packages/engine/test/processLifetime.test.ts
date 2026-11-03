/**
 * Nothing the engine starts outlives it: however the engine ends (SIGKILL, an uncaught
 * exception, the process that started it dying), its headless Chrome is gone and its profile
 * folder deleted within five seconds, and the next engine's boot cleans up what a dead one
 * left. The Chrome cases run a real headless Chrome and skip on a machine without one.
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { chromeCandidates } from "@unframed/domain";
import { afterEach, describe, expect, it } from "vitest";
import { pageShape } from "./canvasRecords.ts";
import { makeTempDir, sourceEntry, startEngine } from "./harness.ts";
import { connectRpc } from "./rpcClient.ts";

const PROFILE_ROOT = join(tmpdir(), "unframed-headless-chrome");
const CHROME_START_MS = 30_000;
const GONE_WITHIN_MS = 5_000;

const chrome = chromeCandidates({
  platform: process.platform,
  env: process.env,
  home: homedir(),
  versionsIn: (dir) => {
    try {
      return readdirSync(dir);
    } catch {
      return [];
    }
  },
}).find((path) => existsSync(path));
const unix = process.platform !== "win32";
if (chrome === undefined) console.log("  engine lifetime tests with Chrome skipped: no Chrome, Chromium, Edge or Brave on this machine");

const processes = (): Array<{ pid: number; ppid: number; command: string }> =>
  execFileSync("ps", ["-axww", "-o", "pid=,ppid=,command="], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    .split("\n")
    .flatMap((line) => {
      const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
      return match ? [{ pid: Number(match[1]), ppid: Number(match[2]), command: match[3]! }] : [];
    });

const profileMarker = (enginePid: number) => `--user-data-dir=${PROFILE_ROOT}/engine-${enginePid}-`;
const chromesOf = (enginePid: number) => processes().filter((row) => row.command.includes(profileMarker(enginePid)));
const profilesOf = (enginePid: number) => (existsSync(PROFILE_ROOT) ? readdirSync(PROFILE_ROOT) : []).filter((name) => name.startsWith(`engine-${enginePid}-`));

/** The test process's environment without anything that would reach this machine's real settings, key or network. */
const cleanEnv = (): Record<string, string> => {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value === undefined || /^(UNFRAMED_|OPENROUTER_|VITEST|CLAUDE_|CODEX_)/.test(name)) continue;
    if (name === "NODE_OPTIONS" || name === "OUTPUT_DIR" || name === "PORT") continue;
    env[name] = value;
  }
  return env;
};

const until = async (check: () => boolean, what: string, timeoutMs: number): Promise<number> => {
  const started = Date.now();
  for (;;) {
    if (check()) return Date.now() - started;
    if (Date.now() - started > timeoutMs) throw new Error(`Timed out after ${timeoutMs} ms waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};

const isAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Puts a page artifact on a canvas, so the engine renders its snapshot in its headless Chrome. */
const render = async (port: number, dataDir: string) => {
  const rpc = await connectRpc(`ws://127.0.0.1:${port}/ws`);
  try {
    await rpc.call("projects.create", { name: "board" });
    const folder = join(dataDir, "output", "board");
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, "1-landing.html"), "<h1>Landing</h1>");
    await rpc.call("testCanvas.apply", { project: "board", change: { put: [pageShape("pg1", "100", { file: "1-landing.html", title: "Landing" })], remove: [] }, origin: { kind: "server", id: "test" } });
  } finally {
    await rpc.close();
  }
};

const snapshotTaken = (dataDir: string) => {
  const folder = join(dataDir, "output", "board", ".cache", "snapshots");
  return existsSync(folder) && readdirSync(folder).some((name) => name.endsWith(".png"));
};

/** Waits for the engine's Chrome to have taken the snapshot, runs `end`, and expects the Chrome and its profile gone within 5 s. */
const expectNothingLeftAfter = async (enginePid: number, dataDir: string, end: () => void | Promise<void>) => {
  await until(() => snapshotTaken(dataDir), "the headless Chrome to take the snapshot", CHROME_START_MS);
  expect(chromesOf(enginePid).length).toBeGreaterThan(0);
  expect(profilesOf(enginePid)).toHaveLength(1);
  await end();
  await until(() => !isAlive(enginePid), "the engine to exit", GONE_WITHIN_MS);
  await until(() => chromesOf(enginePid).length === 0 && profilesOf(enginePid).length === 0, "no Chrome and no profile folder", GONE_WITHIN_MS);
};

const started: ChildProcess[] = [];
afterEach(() => {
  for (const child of started.splice(0)) {
    try {
      process.kill(-child.pid!, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }
});

describe.skipIf(chrome === undefined || !unix)("the engine's headless Chrome", () => {
  it("is gone, profile and all, within 5 s of the engine being killed with SIGKILL", { timeout: 60_000 }, async () => {
    const engine = await startEngine({ env: { UNFRAMED_TEST_CANVAS: "1" } });
    await render(engine.port, engine.dataDir);
    await expectNothingLeftAfter(engine.pid, engine.dataDir, () => void process.kill(engine.pid, "SIGKILL"));
  });

  it("is gone within 5 s of an uncaught exception, which runs the shutdown hooks and exits with code 1", { timeout: 60_000 }, async () => {
    const engine = await startEngine({ env: { UNFRAMED_TEST_CANVAS: "1", UNFRAMED_TEST_UNCAUGHT: "1" } });
    await render(engine.port, engine.dataDir);
    await expectNothingLeftAfter(engine.pid, engine.dataDir, () => void process.kill(engine.pid, "SIGUSR2"));
    expect((await engine.exited).code).toBe(1);
    expect(engine.stderr()).toContain("uncaught exception: Error: UNFRAMED_TEST_UNCAUGHT");
  });

  for (const ipc of [true, false]) {
    it(`goes with the engine when the process that started it is killed (${ipc ? "IPC channel" : "no IPC channel"})`, { timeout: 60_000 }, async () => {
      const dataDir = await makeTempDir();
      const log = join(dataDir, "engine.log");
      // A parent that starts the engine the way the shell (IPC) or a terminal (none) does, then gets killed.
      const parent = spawn(
        process.execPath,
        [
          "-e",
          `const { fork, spawn } = require("node:child_process");
           const fs = require("node:fs");
           const out = fs.openSync(process.argv[2], "a");
           const child = ${ipc}
             ? fork(process.argv[1], [], { stdio: ["ignore", out, out, "ipc"] })
             : spawn(process.execPath, [process.argv[1]], { stdio: ["ignore", out, out] });
           process.stdout.write(child.pid + "\\n");
           setInterval(() => {}, 1000);`,
          sourceEntry,
          log,
        ],
        {
          cwd: dataDir,
          detached: true,
          stdio: ["ignore", "pipe", "inherit"],
          env: { ...cleanEnv(), UNFRAMED_TEST_OPENROUTER_ORIGIN: "http://127.0.0.1:9", PORT: "0", UNFRAMED_PREVIEW_PORT: "0", UNFRAMED_DATA_DIR: dataDir, UNFRAMED_TEST_CANVAS: "1", UNFRAMED_TEST_NATIVE_LOG: join(dataDir, ".native-log.jsonl") },
        },
      );
      started.push(parent);
      const enginePid = await new Promise<number>((resolve) => parent.stdout!.once("data", (chunk: Buffer) => resolve(Number(String(chunk).trim()))));
      let port = 0;
      await until(
        () => {
          port = Number(/Unframed server {2}→ {2}http:\/\/localhost:(\d+)/.exec(existsSync(log) ? readFileSync(log, "utf8") : "")?.[1] ?? 0);
          return port > 0;
        },
        "the engine's banner",
        20_000,
      );
      await render(port, dataDir);
      try {
        await expectNothingLeftAfter(enginePid, dataDir, () => void process.kill(parent.pid!, "SIGKILL"));
      } finally {
        if (isAlive(enginePid)) process.kill(enginePid, "SIGKILL");
      }
      expect(readFileSync(log, "utf8")).toContain("the process that started the engine is gone; stopping");
    });
  }
});

describe.skipIf(!unix)("an engine's boot", () => {
  it("kills the processes and deletes the profiles a dead engine left, and leaves a live engine's and everyone else's alone", { timeout: 30_000 }, async () => {
    // A pid that is certainly free: a process that has already exited.
    const gone = spawn(process.execPath, ["-e", ""]);
    const deadPid = gone.pid!;
    await new Promise((resolve) => gone.once("exit", resolve));
    const dead = join(PROFILE_ROOT, `engine-${deadPid}-lifetime`);
    const live = join(PROFILE_ROOT, `engine-${process.pid}-lifetime`);
    const elsewhere = join(await makeTempDir(), "profile");
    for (const dir of [dead, live, elsewhere]) mkdirSync(dir, { recursive: true });
    const holder = (dir: string) => {
      const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)", "--", "--headless", `--user-data-dir=${dir}`], { detached: true, stdio: "ignore" });
      started.push(child);
      return child;
    };
    const orphan = holder(dead);
    const owned = holder(live);
    const stranger = holder(elsewhere);
    await until(() => processes().some((row) => row.pid === stranger.pid), "the stand-in processes", 5_000);

    await startEngine();
    await until(() => !isAlive(orphan.pid!) && !existsSync(dead), "the dead engine's process and profile to go", GONE_WITHIN_MS);
    expect(isAlive(owned.pid!)).toBe(true);
    expect(isAlive(stranger.pid!)).toBe(true);
    expect(existsSync(live)).toBe(true);
    expect(existsSync(elsewhere)).toBe(true);
    execFileSync("rm", ["-rf", live]);
  });
});
