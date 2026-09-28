import { describe, expect, it } from "vitest";
import { startEngine } from "./harness.ts";
import { openRawSocket, request } from "./rawSocket.ts";

const LIMIT = 62_914_560;

describe("frame limits", () => {
  it("closes a socket that sends a frame over 60 MB with 1009, and another socket keeps working", async () => {
    const engine = await startEngine();
    const other = await engine.rpc();
    const raw = await openRawSocket(engine.socket());
    const frame = JSON.stringify(request("1", "settings.update", { imageModel: "a".repeat(LIMIT) }));
    expect(Buffer.byteLength(frame)).toBeGreaterThan(LIMIT);
    raw.sendText(frame);
    expect(await raw.closed).toBe(1009);
    expect((await other.call("server.health")).ok).toBe(true);
  });

  it("accepts a frame just under the limit", async () => {
    const engine = await startEngine();
    const raw = await openRawSocket(engine.socket());
    const envelope = JSON.stringify(request("1", "server.health", null));
    // Pad with whitespace, which JSON allows, to land exactly on the limit.
    raw.sendText(envelope + " ".repeat(LIMIT - Buffer.byteLength(envelope)));
    const answer = await raw.waitFor((message) => message.requestId === "1", 20_000);
    expect(answer.exit._tag).toBe("Success");
  });

  it("closes a socket that sends a frame that is not JSON with 1007, and logs it", async () => {
    const engine = await startEngine();
    const other = await engine.rpc();
    const raw = await openRawSocket(engine.socket());
    raw.sendText("this is {not json");
    expect(await raw.closed).toBe(1007);
    await engine.waitForOutput("  ws: closed a socket that sent a frame that was not JSON\n");
    expect((await other.call("server.health")).ok).toBe(true);
  });
});
