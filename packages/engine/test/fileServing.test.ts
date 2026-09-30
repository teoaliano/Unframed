import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startEngine, type TestEngine } from "./harness.ts";

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const CLIP = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 256));

describe("project file serving", () => {
  let engine: TestEngine;
  beforeAll(async () => {
    engine = await startEngine();
    const project = join(engine.dataDir, "output", "board");
    await mkdir(project, { recursive: true });
    await writeFile(join(project, "cat.png"), PNG);
    await writeFile(join(project, "clip.mp4"), CLIP);
    await writeFile(join(project, "page.html"), "<script>alert(1)</script>");
    await writeFile(join(project, "tool.js"), "alert(1)");
    await writeFile(join(project, "notes.json"), '{"a":1}');
    await writeFile(join(engine.dataDir, "output", "jobs.json"), "[]");
    await writeFile(join(engine.dataDir, "secret.txt"), "outside the output folder");
  });
  afterAll(() => engine.dispose());

  it("serves a file with its content type and the safety headers", async () => {
    const response = await engine.request("/api/file/board/cat.png");
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe("image/png");
    expect(response.headers["cache-control"]).toBe("no-cache");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["accept-ranges"]).toBe("bytes");
    expect(response.headers["content-length"]).toBe(String(PNG.length));
    expect(response.body.equals(PNG)).toBe(true);
    expect((await engine.request("/api/file/board/clip.mp4")).headers["content-type"]).toBe("video/mp4");
    expect((await engine.request("/api/file/board/notes.json")).headers["content-type"]).toMatch(/^application\/json/);
  });

  it("slugs the project name before looking it up", async () => {
    const response = await engine.request("/api/file/Board/cat.png");
    expect(response.status).toBe(200);
    expect(response.body.equals(PNG)).toBe(true);
  });

  it("answers HEAD with the headers and no body", async () => {
    const response = await engine.request("/api/file/board/clip.mp4", { method: "HEAD" });
    expect(response.status).toBe(200);
    expect(response.headers["content-length"]).toBe(String(CLIP.length));
    expect(response.body.length).toBe(0);
  });

  it("answers a range request with 206 and the right bytes", async () => {
    const middle = await engine.request("/api/file/board/clip.mp4", { headers: { range: "bytes=100-199" } });
    expect(middle.status).toBe(206);
    expect(middle.headers["content-range"]).toBe(`bytes 100-199/${CLIP.length}`);
    expect(middle.headers["content-length"]).toBe("100");
    expect(middle.body.equals(CLIP.subarray(100, 200))).toBe(true);

    const open = await engine.request("/api/file/board/clip.mp4", { headers: { range: "bytes=990-" } });
    expect(open.status).toBe(206);
    expect(open.body.equals(CLIP.subarray(990))).toBe(true);

    const suffix = await engine.request("/api/file/board/clip.mp4", { headers: { range: "bytes=-5" } });
    expect(suffix.status).toBe(206);
    expect(suffix.headers["content-range"]).toBe(`bytes 995-999/${CLIP.length}`);
    expect(suffix.body.equals(CLIP.subarray(995))).toBe(true);

    const beyond = await engine.request("/api/file/board/clip.mp4", { headers: { range: "bytes=5000-6000" } });
    expect(beyond.status).toBe(416);
    expect(beyond.headers["content-range"]).toBe(`bytes */${CLIP.length}`);
  });

  it("cannot escape the project folder through either segment", async () => {
    for (const path of [
      "/api/file/board/..%2Fjobs.json",
      "/api/file/board/..%2F..%2Fsecret.txt",
      "/api/file/..%2F..%2F/secret.txt",
      "/api/file/..%2F/jobs.json",
      "/api/file/board/%2E%2E%2F%2E%2E%2Fsecret.txt",
      "/api/file/board/sub%2F..%2F..%2F..%2Fsecret.txt",
    ]) {
      const response = await engine.request(path);
      expect(response.status, path).toBe(404);
      expect(response.text).not.toContain("outside the output folder");
    }
  });

  it("answers 404 File not found. for a missing file or project", async () => {
    for (const path of ["/api/file/board/missing.png", "/api/file/nobody/cat.png", "/api/file/board/", "/api/file/board"]) {
      const response = await engine.request(path);
      expect(response.status, path).toBe(404);
      expect(response.json()).toEqual({ error: "File not found." });
    }
  });

  it("serves an .html file as text/plain, never as a page", async () => {
    const response = await engine.request("/api/file/board/page.html");
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe("text/plain; charset=utf-8");
    expect(response.text).toBe("<script>alert(1)</script>");
  });

  it("serves scripts as text/plain and sandboxes every file opened as a document", async () => {
    const script = await engine.request("/api/file/board/tool.js");
    expect(script.status).toBe(200);
    expect(script.headers["content-type"]).toBe("text/plain; charset=utf-8");
    for (const name of ["cat.png", "page.html", "tool.js"]) {
      expect((await engine.request(`/api/file/board/${name}`)).headers["content-security-policy"]).toBe("sandbox");
    }
  });

  it("answers only GET and HEAD", async () => {
    const response = await engine.request("/api/file/board/cat.png", { method: "POST", body: "x" });
    expect(response.status).toBe(404);
  });

  it("applies the loopback guard", async () => {
    const response = await engine.request("/api/file/board/cat.png", { headers: { origin: "https://evil.example" } });
    expect(response.status).toBe(403);
  });
});
