/**
 * `pnpm dev`: the engine from source, restarted on change (port 8787 unless PORT says
 * otherwise), and the Vite dev server (port 5173), which proxies /ws and /api to it.
 * When either stops, both stop.
 *
 * `pnpm dev:share` (`--share`) also serves the Vite port on this machine's tailnet with
 * `tailscale serve`, so the app opens on another of your devices, and removes the mapping
 * on exit. The engine stays loopback only: the dev proxy relays the tailnet origin (spec 01).
 *
 * Neither child outlives this script: a closed terminal (SIGHUP) or a dead parent stops both
 * like Ctrl-C does, and a reaper stops them when this script is killed outright.
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { spawnReaper, watchParent, type Reaper } from "../packages/engine/src/lifeline.ts";
import { repoRoot, viteBin, webRoot } from "./buildWeb.ts";

const children: ChildProcess[] = [];
let exitCode: number | undefined;
let unshare: (() => void) | undefined;
const reapers: Reaper[] = [];
const running = (child: ChildProcess) => child.exitCode === null && child.signalCode === null;

const stop = (code: number) => {
  if (exitCode !== undefined) return;
  exitCode = code;
  unshare?.();
  for (const child of children) if (running(child)) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 2500).unref();
};

const start = (args: string[], cwd: string, env: NodeJS.ProcessEnv) => {
  const child = spawn(process.execPath, args, { cwd, env, stdio: "inherit" });
  children.push(child);
  if (child.pid !== undefined) {
    // The engine gets the same two seconds to flush that Ctrl-C gives it.
    const reaper = spawnReaper({ kill: [child.pid], graceMs: 2000 });
    if (reaper) reapers.push(reaper);
  }
  child.on("exit", (code) => {
    stop(code ?? 1);
    if (children.every((each) => each.exitCode !== null || each.signalCode !== null)) process.exit(exitCode);
  });
};

const tailscale = (args: string[]): string => execFileSync("tailscale", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

/** Maps https://<this machine's tailnet name>:<port> to the Vite port and returns that origin. */
const share = (port: string): string => {
  let dnsName: string;
  try {
    dnsName = (JSON.parse(tailscale(["status", "--json"])) as { Self?: { DNSName?: string } }).Self?.DNSName?.replace(/\.$/, "") ?? "";
  } catch (error) {
    throw new Error(`dev:share needs Tailscale running and logged in (tailscale status failed: ${String(error)})`);
  }
  if (dnsName === "") throw new Error("dev:share could not read this machine's tailnet name from tailscale status");
  try {
    tailscale(["serve", "--bg", `--https=${port}`, `http://localhost:${port}`]);
  } catch (error) {
    throw new Error(`tailscale serve failed; it may need \`sudo tailscale set --operator=$USER\` once (${String(error)})`);
  }
  unshare = () => {
    try {
      tailscale(["serve", `--https=${port}`, "off"]);
    } catch {
      console.error(`  could not remove the tailnet mapping; run: tailscale serve --https=${port} off`);
    }
  };
  return `https://${dnsName}:${port}`;
};

const clientPort = process.env.UNFRAMED_CLIENT_PORT ?? "5173";
const webEnv: NodeJS.ProcessEnv = {
  ...process.env,
  UNFRAMED_SERVER_PORT: process.env.UNFRAMED_SERVER_PORT ?? process.env.PORT ?? "8787",
};
if (process.argv.includes("--share")) {
  webEnv.UNFRAMED_CLIENT_PORT = clientPort;
  try {
    webEnv.UNFRAMED_DEV_SHARE_ORIGIN = share(clientPort);
  } catch (error) {
    console.error(`  ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
  console.log(`  Shared on your tailnet  →  ${webEnv.UNFRAMED_DEV_SHARE_ORIGIN}/`);
}

start(["--watch", join(repoRoot, "packages/engine/src/main.ts")], repoRoot, process.env);
start([viteBin], webRoot, webEnv);

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
process.on("SIGHUP", () => stop(0));
watchParent(() => stop(0));
process.on("exit", () => {
  for (const child of children) if (running(child)) child.kill("SIGKILL");
  for (const reaper of reapers) reaper.dismiss();
});
