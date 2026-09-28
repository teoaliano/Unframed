import { describe, expect, it } from "vitest";
import { startEngine } from "./harness.ts";

describe("preview origin", () => {
  it("answers 404 to every path", async () => {
    const engine = await startEngine();
    for (const path of ["/", "/index.html", "/page/abc/index.html", "/api/file/p/a.png", "/ws"]) {
      const response = await engine.request(path, {
        port: engine.previewPort,
        headers: { host: `127.0.0.1:${engine.previewPort}` },
      });
      expect(response.status, path).toBe(404);
      expect(response.json()).toHaveProperty("error");
    }
  });

  it("refuses a request addressed to a name that is not loopback", async () => {
    const engine = await startEngine();
    const response = await engine.request("/", {
      port: engine.previewPort,
      headers: { host: `rebound.example:${engine.previewPort}` },
    });
    expect(response.status).toBe(403);
    expect(response.json()).toEqual({ error: "Unframed answers only requests addressed to localhost." });
  });

  it("refuses a request from a page on another machine's origin", async () => {
    const engine = await startEngine();
    const response = await engine.request("/", {
      port: engine.previewPort,
      headers: { host: `localhost:${engine.previewPort}`, origin: "https://evil.example" },
    });
    expect(response.status).toBe(403);
    expect(response.json()).toEqual({ error: "Unframed answers only same-machine requests." });
  });
});
