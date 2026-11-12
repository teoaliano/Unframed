/**
 * `pnpm dev`: the engine from source, restarted on change (port 8787 unless PORT says
 * otherwise), and the Vite dev server (port 5173), which proxies /ws and /api to it.
 * When either stops, both stop.
 *
 * `pnpm dev:share` (`--share`) also serves the Vite port, and the preview port the engine
 * bound, on this machine's tailnet with `tailscale serve`, so the app and its artifact
 * previews open on another of your devices. A loopback proxy readdresses the preview's
 * tailnet origin before it reaches the engine. Both mappings are removed on exit. The
 * engine stays loopback only (spec 01).
 *
 * Neither child outlives this script: a closed terminal (SIGHUP) or a dead parent stops both
 * like Ctrl-C does, and a reaper stops them when this script is killed outright.
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { spawnReaper, watchParent, type Reaper } from "../packages/engine/src/lifeline.ts";
import { repoRoot, viteBin, webRoot } from "./buildWeb.ts";
import { startShareProxy, type ShareProxy } from "./shareProxy.ts";

const children: ChildProcess[] = [];
let exitCode: number | undefined;
let unshare: (() => void) | undefined;
const reapers: Reaper[] = [];
const mapped: string[] = [];
let previewProxy: ShareProxy | undefined;
const running = (child: ChildProcess) => child.exitCode === null && child.signalCode === null;

const stop = (code: number) => {
  if (exitCode !== undefined) return;
  exitCode = code;
  unshare?.();
  previewProxy?.close();
  for (const child of children) if (running(child)) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 2500).unref();
};

const start = (args: string[], cwd: string, env: NodeJS.ProcessEnv, capture = false) => {
  const child = spawn(process.execPath, args, { cwd, env, stdio: capture ? ["inherit", "pipe", "pipe"] : "inherit" });
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
  return child;
};

const tailscale = (args: string[]): string => execFileSync("tailscale", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const tailnetDns = (): string => {
  let dnsName: string;
  try {
    dnsName = (JSON.parse(tailscale(["status", "--json"])) as { Self?: { DNSName?: string } }).Self?.DNSName?.replace(/\.$/, "") ?? "";
  } catch (error) {
    throw new Error(`dev:share needs Tailscale running and logged in (tailscale status failed: ${String(error)})`);
  }
  if (dnsName === "") throw new Error("dev:share could not read this machine's tailnet name from tailscale status");
  return dnsName;
};

const serve = (port: string, target: string): void => {
  try {
    tailscale(["serve", "--bg", `--https=${port}`, target]);
  } catch (error) {
    throw new Error(`tailscale serve failed; it may need \`sudo tailscale set --operator=$USER\` once (${String(error)})`);
  }
  mapped.push(port);
};

unshare = () => {
  for (const port of mapped.splice(0)) {
    try {
      tailscale(["serve", `--https=${port}`, "off"]);
    } catch {
      console.error(`  could not remove the tailnet mapping; run: tailscale serve --https=${port} off`);
    }
  }
};

const waitForPreviewPort = (engine: ChildProcess): Promise<number> =>
  new Promise((resolve, reject) => {
    let buffer = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) reject(new Error("dev:share did not see the engine's preview port"));
    }, 60_000);
    const finish = (port: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(port);
    };
    engine.stdout?.on("data", (chunk: Buffer) => {
      process.stdout.write(chunk);
      if (settled) return;
      buffer += chunk.toString();
      const match = /  preview:  http:\/\/127\.0\.0\.1:(\d+)/.exec(buffer);
      if (!match) return;
      buffer = "";
      finish(Number(match[1]));
    });
    engine.stderr?.on("data", (chunk: Buffer) => process.stderr.write(chunk));
    engine.on("exit", () => {
      if (!settled) {
        clearTimeout(timer);
        reject(new Error("the engine stopped before printing its preview port"));
      }
    });
  });

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
process.on("SIGHUP", () => stop(0));
watchParent(() => stop(0));

const clientPort = process.env.UNFRAMED_CLIENT_PORT ?? "5173";
const sharing = process.argv.includes("--share");
const webEnv: NodeJS.ProcessEnv = {
  ...process.env,
  UNFRAMED_SERVER_PORT: process.env.UNFRAMED_SERVER_PORT ?? process.env.PORT ?? "8787",
};
const engineEnv: NodeJS.ProcessEnv = { ...process.env, UNFRAMED_FEATURES: process.env.UNFRAMED_FEATURES ?? "all" };

if (sharing) {
  let dnsName: string;
  try {
    dnsName = tailnetDns();
    webEnv.UNFRAMED_CLIENT_PORT = clientPort;
    webEnv.UNFRAMED_DEV_SHARE_ORIGIN = `https://${dnsName}:${clientPort}`;
    engineEnv.UNFRAMED_DEV_SHARE_ORIGIN = webEnv.UNFRAMED_DEV_SHARE_ORIGIN;
    serve(clientPort, `http://localhost:${clientPort}`);
  } catch (error) {
    console.error(`  ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
  console.log(`  Shared on your tailnet  →  ${webEnv.UNFRAMED_DEV_SHARE_ORIGIN}/`);
  const engine = start(["--watch", join(repoRoot, "packages/engine/src/main.ts")], repoRoot, engineEnv, true);
  try {
    const previewPort = await waitForPreviewPort(engine);
    const previewOrigin = `https://${dnsName}:${previewPort}`;
    previewProxy = await startShareProxy({
      shareOrigin: previewOrigin,
      appOrigin: webEnv.UNFRAMED_DEV_SHARE_ORIGIN,
      upstreamPort: previewPort,
    });
    serve(String(previewPort), `http://localhost:${previewProxy.port}`);
    webEnv.UNFRAMED_DEV_SHARE_PREVIEW_ORIGIN = previewOrigin;
    console.log(`  Preview on your tailnet  →  ${previewOrigin}/`);
  } catch (error) {
    console.error(`  ${error instanceof Error ? error.message : String(error)}`);
    stop(1);
  }
} else {
  start(["--watch", join(repoRoot, "packages/engine/src/main.ts")], repoRoot, engineEnv);
}

if (exitCode === undefined) start([viteBin], webRoot, webEnv);

process.on("exit", () => {
  for (const child of children) if (running(child)) child.kill("SIGKILL");
  for (const reaper of reapers) reaper.dismiss();
});
