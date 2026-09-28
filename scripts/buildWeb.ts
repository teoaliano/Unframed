import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
export const webRoot = join(repoRoot, "packages/web");
export const viteBin = join(webRoot, "node_modules/vite/bin/vite.js");

/**
 * Builds the web client into `outDir`. `TLDRAW_LICENSE_KEY` is taken from `env` when
 * given there, else from the process environment.
 */
export const buildWeb = (outDir: string, env: Record<string, string | undefined> = {}): Promise<void> =>
  new Promise((resolvePromise, reject) => {
    const childEnv: Record<string, string> = {};
    for (const [name, value] of Object.entries({ ...process.env, ...env, UNFRAMED_WEB_OUT_DIR: outDir })) {
      if (value !== undefined) childEnv[name] = value;
    }
    const child = spawn(process.execPath, [viteBin, "build", "--logLevel", "warn"], {
      cwd: webRoot,
      env: childEnv,
      stdio: ["ignore", "inherit", "inherit"],
    });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolvePromise() : reject(new Error(`vite build exited with ${code}`))));
  });
