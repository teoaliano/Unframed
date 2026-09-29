import net from "node:net";
import { describe, expect, it } from "vitest";
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
