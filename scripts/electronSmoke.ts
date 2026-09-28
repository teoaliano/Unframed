/**
 * `node scripts/electronSmoke.ts <bundle> <electron binary>`: boots the bundle the way the
 * desktop shell does, under Electron's own Node (`ELECTRON_RUN_AS_NODE=1`) through `fork`
 * with an IPC channel, and checks the ready message, the banner and the web at `/`.
 */
import { fork } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ReadyMessage } from "../packages/contracts/src/ipc.ts";

const [bundleArg, electronArg] = process.argv.slice(2);
if (!bundleArg || !electronArg) {
  process.stderr.write("usage: node scripts/electronSmoke.ts <bundle folder> <electron binary>\n");
  process.exit(2);
}
const bundle = resolve(bundleArg);
const dataDir = await mkdtemp(join(tmpdir(), "unframed-electron-"));

const child = fork(join(bundle, "server", "index.js"), [], {
  execPath: resolve(electronArg),
  env: {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    PORT: "0",
    UNFRAMED_DATA_DIR: dataDir,
    UNFRAMED_CLIENT_DIST: join(bundle, "client", "dist"),
  },
  stdio: ["ignore", "pipe", "pipe", "ipc"],
});
let stdout = "";
child.stdout?.on("data", (chunk) => (stdout += String(chunk)));
child.stderr?.on("data", (chunk) => process.stderr.write(chunk));

const fail = async (message: string): Promise<never> => {
  child.kill("SIGKILL");
  await rm(dataDir, { recursive: true, force: true });
  process.stderr.write(`electron smoke: ${message}\n${stdout}`);
  process.exit(1);
};

const ready = await new Promise<ReadyMessage | undefined>((done) => {
  const timer = setTimeout(() => done(undefined), 30_000);
  child.on("message", (message: { type?: string }) => {
    if (message.type !== "ready") return;
    clearTimeout(timer);
    done(message as ReadyMessage);
  });
  child.on("exit", () => done(undefined));
});
if (!ready) await fail("no ready message");
if (!stdout.includes(`Unframed server  →  http://localhost:${ready!.port}`)) await fail("no banner");
const index = await fetch(`http://127.0.0.1:${ready!.port}/`);
if (index.status !== 200 || !(await index.text()).includes("<title>Unframed</title>")) await fail("no web at /");

const exited = new Promise<number | null>((done) => child.on("exit", (code) => done(code)));
child.kill("SIGTERM");
const code = await exited;
await rm(dataDir, { recursive: true, force: true });
if (code !== 0) await fail(`exited with ${code} after SIGTERM`);
process.stdout.write(`  electron smoke: ready on ${ready!.port}, web served, clean exit\n`);
