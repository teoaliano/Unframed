import { describe, expect, it } from "vitest";
import { startEngine } from "./harness.ts";
import { openRawSocket } from "./rawSocket.ts";

describe("graceful shutdown", () => {
  it.each(["SIGTERM", "SIGINT"] as const)("on %s closes every socket with 1001 and exits 0 within 2 seconds", async (signal) => {
    const engine = await startEngine();
    const first = await openRawSocket(engine.socket());
    const second = await openRawSocket(engine.socket());
    const started = Date.now();
    const exit = await engine.stop(signal);
    const elapsed = Date.now() - started;
    expect(exit).toEqual({ code: 0, signal: null });
    expect(elapsed).toBeLessThan(2000);
    expect(await first.closed).toBe(1001);
    expect(await second.closed).toBe(1001);
  });

  it("stops accepting connections", async () => {
    const engine = await startEngine({ env: { UNFRAMED_TEST_SHUTDOWN_HOOK_MS: "800" } });
    engine.process.kill("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 200));
    await expect(engine.request("/api/nothing")).rejects.toThrow();
    expect((await engine.exited).code).toBe(0);
  });

  it("abandons a shutdown hook that has not finished by 1.5 seconds and exits anyway", async () => {
    const engine = await startEngine({ env: { UNFRAMED_TEST_SHUTDOWN_HOOK_MS: "60000" } });
    const started = Date.now();
    const exit = await engine.stop("SIGTERM");
    const elapsed = Date.now() - started;
    expect(exit.code).toBe(0);
    expect(elapsed).toBeGreaterThanOrEqual(1400);
    expect(elapsed).toBeLessThan(2000);
  });

  it("waits for a hook that finishes inside the budget", async () => {
    const engine = await startEngine({ env: { UNFRAMED_TEST_SHUTDOWN_HOOK_MS: "300" } });
    const started = Date.now();
    const exit = await engine.stop("SIGTERM");
    const elapsed = Date.now() - started;
    expect(exit.code).toBe(0);
    expect(elapsed).toBeGreaterThanOrEqual(250);
    expect(elapsed).toBeLessThan(1400);
  });
});
