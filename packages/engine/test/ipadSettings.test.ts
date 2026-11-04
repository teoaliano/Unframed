import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { startEngine } from "./harness.ts";

import { TEST_NAME } from "./ipadClient.ts";

const testIpad = { UNFRAMED_TEST_IPAD: TEST_NAME };

const envText = (dataDir: string) => readFile(join(dataDir, ".env"), "utf8").catch(() => "");

describe("the iPad settings", () => {
  it("is off on a default port when nothing is set", async () => {
    const engine = await startEngine();
    const health = await (await engine.rpc()).call("server.health");
    expect(health).toMatchObject({ ipadAccess: false, ipadPort: 18790 });
  });

  it("reads a pre-written .env", async () => {
    const engine = await startEngine({ dotenv: "IPAD_ACCESS=on\nIPAD_PORT=18999\n", env: testIpad });
    const health = await (await engine.rpc()).call("server.health");
    expect(health).toMatchObject({ ipadAccess: true, ipadPort: 18999 });
  });

  it("turns access on and off again, writing .env each time", async () => {
    const engine = await startEngine({ env: testIpad });
    const rpc = await engine.rpc();
    await rpc.call("settings.update", { ipadAccess: "on" });
    expect(await envText(engine.dataDir)).toContain("IPAD_ACCESS=on");
    expect((await rpc.call("server.health")).ipadAccess).toBe(true);

    await rpc.call("settings.update", { ipadAccess: "" });
    expect(await envText(engine.dataDir)).not.toContain("IPAD_ACCESS");
    expect((await rpc.call("server.health")).ipadAccess).toBe(false);
  });

  it("applies a new port without a restart", async () => {
    const engine = await startEngine({ env: testIpad });
    const rpc = await engine.rpc();
    await rpc.call("settings.update", { ipadPort: "18791" });
    expect((await rpc.call("server.health")).ipadPort).toBe(18791);
    expect(await envText(engine.dataDir)).toContain("IPAD_PORT=18791");

    await rpc.call("settings.update", { ipadPort: "" });
    expect((await rpc.call("server.health")).ipadPort).toBe(18790);
  });

  it.each(["80", "1023", "65536", "18790.5", "-1", "many"])("refuses the port %s", async (ipadPort) => {
    const engine = await startEngine({ env: testIpad });
    const rpc = await engine.rpc();
    await expect(rpc.call("settings.update", { ipadPort })).rejects.toMatchObject({
      code: "bad_request",
      message: "The iPad port has to be a whole number from 1024 to 65535.",
    });
  });

  it("refuses a switch value that is neither on nor empty", async () => {
    const engine = await startEngine({ env: testIpad });
    const rpc = await engine.rpc();
    await expect(rpc.call("settings.update", { ipadAccess: "yes" })).rejects.toMatchObject({
      code: "bad_request",
      message: "iPad access is either on or off.",
    });
  });
});

describe("ipad.status", () => {
  it("answers the test name, the port and a listener that is off", async () => {
    const engine = await startEngine({ env: { ...testIpad, IPAD_PORT: "0" } });
    expect(await (await engine.rpc()).call("ipad.status")).toMatchObject({
      localName: TEST_NAME,
      listening: false,
      portTaken: false,
      testHosts: [TEST_NAME],
    });
  });

  it("answers no test hosts when the test variable is not set", async () => {
    const engine = await startEngine();
    expect((await (await engine.rpc()).call("ipad.status")).testHosts).toBeNull();
  });

  it.skipIf(process.platform !== "darwin")("reads this Mac's local name from scutil", async () => {
    const engine = await startEngine();
    const status = await (await engine.rpc()).call("ipad.status");
    expect(status.localName).toMatch(/^[a-z0-9-]+\.local$/);
  });
});
