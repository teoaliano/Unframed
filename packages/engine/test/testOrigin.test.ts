import { describe, expect, it } from "vitest";
import { startEngine } from "./harness.ts";

describe("UNFRAMED_TEST_OPENROUTER_ORIGIN", () => {
  it.each(["https://openrouter.evil.example", "http://192.168.1.20:9000", "https://127.0.0.1:9000", "http://localhost", "http://localhost.evil.example:9000"])(
    "ignores %s with the documented log line",
    async (value) => {
      const engine = await startEngine({ env: { UNFRAMED_TEST_OPENROUTER_ORIGIN: value } });
      expect(engine.stdout()).toContain(`  test origin ignored: ${value} is not a loopback origin\n`);
      expect((await (await engine.rpc()).call("server.health")).ok).toBe(true);
    },
  );

  it("accepts a loopback stub without a word", async () => {
    const engine = await startEngine();
    expect(engine.stub?.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(engine.stdout()).not.toContain("test origin ignored");
  });
});
