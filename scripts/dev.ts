/**
 * `pnpm dev`: the engine from source, restarted on change (port 8787 unless PORT says
 * otherwise), and the Vite dev server (port 5173), which proxies /ws and /api to it.
 * When either stops, both stop.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { repoRoot, viteBin, webRoot } from "./buildWeb.ts";

const children: ChildProcess[] = [];
let exitCode: number | undefined;

const stop = (code: number) => {
  if (exitCode !== undefined) return;
  exitCode = code;
  for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 2500).unref();
};

const start = (args: string[], cwd: string, env: NodeJS.ProcessEnv) => {
  const child = spawn(process.execPath, args, { cwd, env, stdio: "inherit" });
  children.push(child);
  child.on("exit", (code) => {
    stop(code ?? 1);
    if (children.every((each) => each.exitCode !== null || each.signalCode !== null)) process.exit(exitCode);
  });
};

start(["--watch", join(repoRoot, "packages/engine/src/main.ts")], repoRoot, process.env);
start([viteBin], webRoot, {
  ...process.env,
  UNFRAMED_SERVER_PORT: process.env.UNFRAMED_SERVER_PORT ?? process.env.PORT ?? "8787",
});

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
