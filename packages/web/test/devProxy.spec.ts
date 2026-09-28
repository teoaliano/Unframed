import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import net from "node:net";
import { join } from "node:path";
import { viteBin, webRoot } from "../../../scripts/buildWeb.ts";
import { startEngine, type TestEngine } from "../../engine/test/engineProcess.ts";
import { expect, isSettingsChunk, test, watchRpcSockets } from "./fixtures.ts";

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });

const startVite = async (serverPort: number): Promise<{ port: number; child: ChildProcess; output: () => string }> => {
  const port = await freePort();
  let output = "";
  const child = spawn(process.execPath, [viteBin, "--clearScreen", "false"], {
    cwd: webRoot,
    env: { ...process.env, UNFRAMED_CLIENT_PORT: String(port), UNFRAMED_SERVER_PORT: String(serverPort) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (chunk) => (output += String(chunk)));
  child.stderr?.on("data", (chunk) => (output += String(chunk)));
  await expect
    .poll(async () => fetch(`http://localhost:${port}/`).then((response) => response.status, () => 0), { timeout: 30_000 })
    .toBe(200);
  return { port, child, output: () => output };
};

test.describe("Vite dev server", () => {
  let engine: TestEngine;
  let vite: Awaited<ReturnType<typeof startVite>>;
  test.beforeAll(async () => {
    engine = await startEngine();
    vite = await startVite(engine.port);
  });
  test.afterAll(async () => {
    vite?.child.kill("SIGTERM");
    await engine?.dispose();
  });

  test("proxies /ws and /api to the engine, and both pass the loopback guards", async ({ page }) => {
    const folder = join(engine.dataDir, "output", "board");
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, "note.txt"), "through the proxy");

    const watch = watchRpcSockets(page);
    await page.goto(`http://localhost:${vite.port}/`);
    await expect(page.locator(".unframed-chrome-left")).toBeVisible();
    await watch.frame(0, isSettingsChunk());
    expect(new URL(watch.sockets[0]!.socket.url()).host).toBe(`localhost:${vite.port}`);

    const file = await page.evaluate(async () => {
      const response = await fetch("/api/file/board/note.txt");
      return { status: response.status, text: await response.text() };
    });
    expect(file).toEqual({ status: 200, text: "through the proxy" });
    const missing = await page.evaluate(async () => (await fetch("/api/file/board/none.png")).json());
    expect(missing).toEqual({ error: "File not found." });
  });
});
