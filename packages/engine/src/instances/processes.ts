import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { join } from "node:path";
import { isAlive, killGroup, spawnReaper, type Reaper } from "../lifeline.ts";

const unix = process.platform !== "win32";
const REAPER_GRACE_MS = 2_000;
const EXIT_FLUSH_MS = 200;
const PROBE_TIMEOUT_MS = 300;
const LOOPBACK_HOSTS = ["127.0.0.1", "::1"] as const;

export interface Tracked {
  readonly child: ChildProcess;
  readonly exited: Promise<number | null>;
  readonly hasExited: () => boolean;
}

const startTimeOf = (pid: number): string | undefined => {
  if (!unix) return undefined;
  try {
    return execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || undefined;
  } catch {
    return undefined;
  }
};

const signalGroup = (child: ChildProcess, signal: NodeJS.Signals): void => {
  if (unix && child.pid !== undefined) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      return;
    }
  }
  child.kill(signal);
};

export const spawnTracked = (input: {
  readonly command: string;
  readonly cwd: string;
  readonly env: Record<string, string>;
  readonly pidFile: string;
  readonly onOutput: (chunk: string) => void;
}): Tracked => {
  const child = spawn(input.command, { cwd: input.cwd, env: input.env, shell: true, detached: unix, stdio: ["ignore", "pipe", "pipe"] });
  let reaper: Reaper | undefined;
  const pid = child.pid;
  if (pid !== undefined) {
    reaper = spawnReaper({ kill: [pid], graceMs: REAPER_GRACE_MS });
    const started = startTimeOf(pid);
    if (started !== undefined) {
      try {
        mkdirSync(join(input.pidFile, ".."), { recursive: true });
        writeFileSync(input.pidFile, JSON.stringify({ pid, started }));
      } catch {
        rmSync(input.pidFile, { force: true });
      }
    }
  }
  child.stdout?.setEncoding("utf8").on("data", input.onOutput);
  child.stderr?.setEncoding("utf8").on("data", input.onOutput);
  let done = false;
  const exited = new Promise<number | null>((resolve) => {
    let code: number | null = null;
    const finish = () => {
      if (done) return;
      done = true;
      if (unix && pid !== undefined) killGroup(pid);
      rmSync(input.pidFile, { force: true });
      reaper?.dismiss();
      resolve(code);
    };
    child.once("exit", (exitCode) => {
      code = exitCode;
      setTimeout(finish, EXIT_FLUSH_MS);
    });
    child.once("close", (exitCode) => {
      code = exitCode ?? code;
      finish();
    });
    child.once("error", (error) => {
      input.onOutput(`${error.message}\n`);
      finish();
    });
  });
  return { child, exited, hasExited: () => done };
};

export const stopTracked = async (tracked: Tracked, graceMs: number): Promise<void> => {
  if (tracked.hasExited()) return;
  signalGroup(tracked.child, "SIGTERM");
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<"late">((resolve) => (timer = setTimeout(() => resolve("late"), graceMs)));
  const outcome = await Promise.race([tracked.exited, late]);
  clearTimeout(timer);
  if (outcome === "late") signalGroup(tracked.child, "SIGKILL");
  await tracked.exited;
};

export const sweepLeftovers = (pidDir: string): void => {
  let names: string[];
  try {
    names = readdirSync(pidDir);
  } catch {
    return;
  }
  for (const name of names) {
    const path = join(pidDir, name);
    try {
      const { pid, started } = JSON.parse(readFileSync(path, "utf8")) as { pid: number; started: string };
      if (Number.isInteger(pid) && pid > 1 && isAlive(pid) && startTimeOf(pid) === started) killGroup(pid);
    } catch {
      continue;
    } finally {
      rmSync(path, { force: true });
    }
  }
};

const listenOnce = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => resolve(port));
    });
  });

export const freePort = async (reserved: ReadonlySet<number>): Promise<number> => {
  for (;;) {
    const port = await listenOnce();
    if (!reserved.has(port)) return port;
  }
};

const connects = (host: string, port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (value: boolean) => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(PROBE_TIMEOUT_MS);
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
    socket.once("timeout", () => done(false));
  });

export const listeningHost = async (port: number): Promise<string | undefined> => {
  for (const host of LOOPBACK_HOSTS) if (await connects(host, port)) return host;
  return undefined;
};

export const answers = async (port: number): Promise<boolean> => (await listeningHost(port)) !== undefined;
