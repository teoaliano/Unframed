import net from "node:net";
import { describe, expect, it, onTestFinished } from "vitest";
import { startEngine } from "./harness.ts";

const connects = (host: string, port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = net.connect({ host, port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });

/** Whether this machine has an IPv6 loopback address to bind. */
const hasIpv6Loopback = (): Promise<boolean> =>
  new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen({ host: "::1", port: 0 }, () => server.close(() => resolve(true)));
  });

describe("ready message", () => {
  it("with PORT=0 and an IPC channel sends exactly one ready message after both listeners are bound", async () => {
    const engine = await startEngine();
    const ready = engine.messages.filter((message) => message.type === "ready");
    expect(ready).toEqual([{ type: "ready", port: engine.port, previewPort: engine.previewPort }]);
    expect(engine.port).toBeGreaterThan(0);
    expect(engine.previewPort).toBeGreaterThan(0);
    expect(engine.port).not.toBe(engine.previewPort);
    expect(await connects("127.0.0.1", engine.port)).toBe(true);
    expect(await connects("127.0.0.1", engine.previewPort)).toBe(true);
    // The API is loopback IPv4 only: never ::1, never every interface.
    expect(await connects("::1", engine.port)).toBe(false);
    // The preview origin also answers on ::1 where the machine has it (spec 09), so localhost reaches it.
    expect(await connects("::1", engine.previewPort)).toBe(await hasIpv6Loopback());

    await engine.request("/");
    expect(engine.messages.filter((message) => message.type === "ready")).toHaveLength(1);
  });

  it("forked without an IPC channel boots, answers the same, and sends nothing", async () => {
    const engine = await startEngine({ ipc: false });
    expect(engine.stdout()).toContain(`  Unframed server  →  http://localhost:${engine.port}\n`);
    expect(engine.port).toBeGreaterThan(0);
    const response = await engine.request("/api/nothing-here");
    expect(response.status).toBe(404);
    expect(await connects("127.0.0.1", engine.previewPort)).toBe(true);
    expect(engine.messages).toEqual([]);
    expect(engine.stderr()).toBe("");
  });
});

/** Holds a port on `host` until the test ends, and answers it. */
const hold = async (host: string, port = 0): Promise<number> => {
  const holder = net.createServer();
  await new Promise<void>((resolve, reject) => {
    holder.once("error", reject);
    holder.listen({ host, port, exclusive: true }, resolve);
  });
  onTestFinished(() => new Promise<void>((resolve) => holder.close(() => resolve())));
  const address = holder.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  return address.port;
};

/** A port nothing holds right now. */
const freePort = async (): Promise<number> => {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen({ host: "127.0.0.1", port: 0 }, resolve));
  const address = server.address();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (address === null || typeof address === "string") throw new Error("no port");
  return address.port;
};

describe("the preview port", () => {
  it("is fixed: the port UNFRAMED_PREVIEW_PORT names is the one reported and served", async () => {
    const port = await freePort();
    const engine = await startEngine({ env: { UNFRAMED_PREVIEW_PORT: String(port) } });
    expect(engine.previewPort).toBe(port);
    expect(engine.messages).toContainEqual({ type: "ready", port: engine.port, previewPort: port });
    expect((await (await engine.rpc()).call("server.health")).previewPort).toBe(port);
    expect(engine.stdout()).toContain(`  preview:  http://127.0.0.1:${port}\n`);
    expect(await connects("127.0.0.1", port)).toBe(true);
  });

  it("is 18787 when unset, unless something else holds it", async () => {
    const engine = await startEngine({ env: { UNFRAMED_PREVIEW_PORT: undefined } });
    if (engine.previewPort !== 18787) expect(engine.stdout()).toContain(`  preview port 18787 is taken, so this run uses ${engine.previewPort}.\n`);
    expect(engine.messages).toContainEqual({ type: "ready", port: engine.port, previewPort: engine.previewPort });
  });

  it("falls back to an OS-assigned port when another program holds it, and says so", async () => {
    const held = await hold("127.0.0.1");
    const engine = await startEngine({ env: { UNFRAMED_PREVIEW_PORT: String(held) } });
    expect(engine.previewPort).toBeGreaterThan(0);
    expect(engine.previewPort).not.toBe(held);
    expect(engine.messages).toContainEqual({ type: "ready", port: engine.port, previewPort: engine.previewPort });
    expect((await (await engine.rpc()).call("server.health")).previewPort).toBe(engine.previewPort);
    expect(engine.stdout()).toContain(`  preview port ${held} is taken, so this run uses ${engine.previewPort}.\n`);
    expect(await connects("127.0.0.1", engine.previewPort)).toBe(true);
  });

  it("falls back too when another program holds it on ::1 only, so localhost never reaches that program", async () => {
    if (!(await hasIpv6Loopback())) return;
    const held = await hold("::1");
    const engine = await startEngine({ env: { UNFRAMED_PREVIEW_PORT: String(held) } });
    expect(engine.previewPort).not.toBe(held);
    expect(await connects("::1", engine.previewPort)).toBe(true);
  });

  it("refuses an UNFRAMED_PREVIEW_PORT that is not a port, and exits with code 1", async () => {
    const engine = await startEngine({ env: { UNFRAMED_PREVIEW_PORT: "18787a" }, waitForReady: false });
    expect((await engine.exited).code).toBe(1);
    expect(engine.stderr()).toContain(`  UNFRAMED_PREVIEW_PORT has to be a whole number from 0 to 65535, not "18787a".\n`);
    expect(engine.stdout()).not.toContain("Unframed server");
  });
});
