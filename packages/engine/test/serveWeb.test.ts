import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeTempDir, startEngine, type TestEngine } from "./harness.ts";

const INDEX = '<!doctype html><html><head><title>Unframed</title><script type="module" src="/assets/index-a1b2c3.js"></script></head><body><div id="root"></div></body></html>';

describe("serving the web", () => {
  let engine: TestEngine;
  let dist: string;
  beforeAll(async () => {
    dist = await makeTempDir("unframed-client-");
    await mkdir(join(dist, "assets"), { recursive: true });
    await writeFile(join(dist, "index.html"), INDEX);
    await writeFile(join(dist, "assets", "index-a1b2c3.js"), "console.log('app')");
    await writeFile(join(dist, "assets", "index-d4e5f6.css"), "body{}");
    await writeFile(join(dist, "assets", "favicon-0a9b8c.svg"), "<svg/>");
    await writeFile(join(dist, "stray.txt"), "not served");
    await writeFile(join(dist, "..", "outside.txt"), "outside");
    engine = await startEngine({ clientDist: dist });
  });
  afterAll(() => engine.dispose());

  it("serves index.html for / with no-cache", async () => {
    const response = await engine.request("/");
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(response.headers["cache-control"]).toBe("no-cache");
    expect(response.text).toBe(INDEX);
  });

  it("serves hashed assets as immutable, with their types", async () => {
    const script = await engine.request("/assets/index-a1b2c3.js");
    expect(script.status).toBe(200);
    expect(script.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(script.headers["content-type"]).toBe("text/javascript; charset=utf-8");
    expect(script.text).toBe("console.log('app')");
    expect((await engine.request("/assets/index-d4e5f6.css")).headers["content-type"]).toBe("text/css; charset=utf-8");
    expect((await engine.request("/assets/favicon-0a9b8c.svg")).headers["content-type"]).toBe("image/svg+xml");
  });

  it("answers 404 for anything else, with no SPA catch-all", async () => {
    for (const path of ["/settings", "/index.html", "/stray.txt", "/assets/missing.js", "/assets/", "/assets/..%2F..%2Foutside.txt", "/api/unknown"]) {
      const response = await engine.request(path);
      expect(response.status, path).toBe(404);
      expect(response.text).not.toContain("<title>Unframed</title>");
    }
  });

  it("answers 404 for / when UNFRAMED_CLIENT_DIST is unset", async () => {
    const standalone = await startEngine();
    const response = await standalone.request("/");
    expect(response.status).toBe(404);
    expect(response.json()).toHaveProperty("error");
  });
});
