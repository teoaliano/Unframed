import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { startEngine, type RawResponse, type TestEngine } from "./harness.ts";

const corsHeaders = (response: RawResponse) =>
  Object.keys(response.headers).filter((name) => name.startsWith("access-control-"));

describe("HTTP loopback guard", () => {
  let engine: TestEngine;
  beforeAll(async () => {
    engine = await startEngine();
  });
  afterAll(() => engine.dispose());

  it("refuses a non-loopback Origin with the same-machine message", async () => {
    for (const origin of ["https://evil.example", "http://localhost.evil.example", "http://127.0.0.2:8787"]) {
      const response = await engine.request("/api/file/p/a.png", { headers: { origin } });
      expect(response.status, origin).toBe(403);
      expect(response.json()).toEqual({ error: "Unframed answers only same-machine requests." });
      expect(corsHeaders(response)).toEqual([]);
    }
  });

  it("refuses a non-loopback Host with the localhost message", async () => {
    for (const host of [`rebound.example:${engine.port}`, "localhost.evil.example", `127.0.0.2:${engine.port}`]) {
      const response = await engine.request("/", { headers: { host } });
      expect(response.status, host).toBe(403);
      expect(response.json()).toEqual({ error: "Unframed answers only requests addressed to localhost." });
    }
  });

  it("refuses a request with no Host at all", async () => {
    const response = await engine.request("/", { headers: { host: undefined } });
    expect(response.status).toBe(403);
    expect(response.json()).toEqual({ error: "Unframed answers only requests addressed to localhost." });
  });

  it("never sends a CORS allow header, even to a loopback Origin", async () => {
    for (const origin of [`http://localhost:${engine.port}`, "http://localhost:5173", "http://127.0.0.1:3000"]) {
      for (const path of ["/", "/api/file/p/a.png", "/api/nothing"]) {
        const response = await engine.request(path, { headers: { origin } });
        expect(response.status).not.toBe(403);
        expect(corsHeaders(response), `${origin} ${path}`).toEqual([]);
      }
    }
  });

  it("answers an OPTIONS preflight 204 with no allow headers", async () => {
    for (const origin of ["http://localhost:5173", `http://localhost:${engine.port}`]) {
      const response = await engine.request("/api/projects/p/files", {
        method: "OPTIONS",
        headers: {
          origin,
          "access-control-request-method": "POST",
          "access-control-request-headers": "content-type",
        },
      });
      expect(response.status).toBe(204);
      expect(response.body.length).toBe(0);
      expect(corsHeaders(response)).toEqual([]);
    }
  });

  it("refuses a preflight from a foreign origin before answering it", async () => {
    const response = await engine.request("/api/file/p/a.png", {
      method: "OPTIONS",
      headers: { origin: "https://evil.example", "access-control-request-method": "GET" },
    });
    expect(response.status).toBe(403);
    expect(corsHeaders(response)).toEqual([]);
  });
});
