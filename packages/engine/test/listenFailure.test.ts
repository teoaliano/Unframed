import net from "node:net";
import { describe, expect, it, onTestFinished } from "vitest";
import { startEngine } from "./harness.ts";

describe("listen failure", () => {
  it("prints the error and exits with code 1 when the port is taken", async () => {
    const holder = net.createServer();
    await new Promise<void>((resolve) => holder.listen(0, "127.0.0.1", resolve));
    onTestFinished(() => new Promise<void>((resolve) => holder.close(() => resolve())));
    const address = holder.address();
    if (address === null || typeof address === "string") throw new Error("no port");

    const engine = await startEngine({ env: { PORT: String(address.port) }, waitForReady: false });
    const exit = await engine.exited;
    expect(exit.code).toBe(1);
    expect(engine.stderr()).toContain(`  could not listen on 127.0.0.1:${address.port}: `);
    expect(engine.stderr()).toContain("EADDRINUSE");
    expect(engine.stdout()).not.toContain("Unframed server");
    expect(engine.messages).toEqual([]);
  });
});
