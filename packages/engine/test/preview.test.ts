import { mkdir, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir, startEngine, type TestEngine } from "./harness.ts";

const CSP =
  "default-src 'none'; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; frame-src 'self'; connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'; frame-ancestors http://localhost:* http://127.0.0.1:* http://[::1]:*";

/** An engine with a project `board` holding `files`. */
const withProject = async (files: Record<string, string | Buffer>): Promise<{ engine: TestEngine; folder: string }> => {
  const engine = await startEngine();
  await (await engine.rpc()).call("projects.create", { name: "board" });
  const folder = join(engine.dataDir, "output", "board");
  for (const [name, bytes] of Object.entries(files)) await writeFile(join(folder, name), bytes);
  return { engine, folder };
};

const preview = (engine: TestEngine, path: string, options: { method?: string; headers?: Record<string, string | undefined> } = {}) =>
  engine.request(path, { port: engine.previewPort, ...options, headers: { host: `127.0.0.1:${engine.previewPort}`, ...options.headers } });

const expectNotFound = async (engine: TestEngine, path: string, method = "GET") => {
  const response = await preview(engine, path, { method });
  expect(response.status, `${method} ${path}`).toBe(404);
  expect(response.headers["content-type"], path).toBe("text/plain; charset=utf-8");
  expect(response.headers["cache-control"], path).toBe("no-store");
  expect(response.text, path).toBe(method === "HEAD" ? "" : "not found");
};

describe("the preview origin", () => {
  it("serves this spec's route on the port the ready message and server.health report", async () => {
    const { engine } = await withProject({ "landing.html": "<h1>Hello</h1>" });
    expect(engine.messages).toContainEqual(expect.objectContaining({ type: "ready", previewPort: engine.previewPort }));
    expect((await (await engine.rpc()).call("server.health")).previewPort).toBe(engine.previewPort);
    const response = await preview(engine, "/p/board/landing.html");
    expect(response.status).toBe(200);
    expect(response.text).toBe("<h1>Hello</h1>");
  });

  it("serves a project .html as text/html and answers 404 to any other path shape or method", async () => {
    const { engine } = await withProject({ "landing.html": "<h1>Hello</h1>" });
    const served = await preview(engine, "/p/board/landing.html?v=2#top");
    expect(served.status).toBe(200);
    expect(served.headers["content-type"]).toBe("text/html; charset=utf-8");
    // The project segment is slugged with the project rule.
    expect((await preview(engine, "/p/Board/landing.html")).status).toBe(200);
    for (const path of ["/", "/p", "/p/board", "/p/board/", "/p//landing.html", "/p/board/x/landing.html", "/api/file/board/landing.html", "/q/board/landing.html", "/p/%20%20/landing.html"]) {
      await expectNotFound(engine, path);
    }
    for (const method of ["POST", "PUT", "DELETE", "OPTIONS"]) await expectNotFound(engine, "/p/board/landing.html", method);
    await expectNotFound(engine, "/p/board/missing.html");
    await expectNotFound(engine, "/p/nothere/landing.html");
  });

  it("answers 404 to names outside the file pattern, dot segments, encoded separators and bad encodings", async () => {
    const { engine, folder } = await withProject({ "ok.html": "fine" });
    await mkdir(join(folder, "sub.html"));
    await writeFile(join(folder, ".hidden.html"), "hidden");
    for (const path of [
      "/p/board/..",
      "/p/board/%2e%2e",
      "/p/board/..%2Fok.html",
      "/p/board/sub%2Fok.html",
      "/p/board/sub%5Cok.html",
      "/p/board/.hidden.html",
      "/p/board/%E0%A4%A.html",
      "/p/board/ok%00.html",
      "/p/board/ok%20x.html",
      "/p/board/sub.html",
      `/p/board/${"a".repeat(202)}.html`,
    ]) {
      await expectNotFound(engine, path);
    }
    expect((await preview(engine, "/p/board/ok.html")).status).toBe(200);
  });

  it("serves each allow-listed type with its Content-Type and 404s everything else", async () => {
    const types: Record<string, string> = {
      "a.html": "text/html; charset=utf-8",
      "b.HTML": "text/html; charset=utf-8",
      "c.js": "text/javascript; charset=utf-8",
      "d.png": "image/png",
      "e.jpg": "image/jpeg",
      "f.jpeg": "image/jpeg",
      "g.webp": "image/webp",
      "h.gif": "image/gif",
      "i.svg": "image/svg+xml",
      "j.mp4": "video/mp4",
      "k.webm": "video/webm",
      "l.mov": "video/quicktime",
      "m.mp3": "audio/mpeg",
      "n.wav": "audio/wav",
      "o.woff": "font/woff",
      "p.woff2": "font/woff2",
    };
    const refused = ["q.json", "unframed.sqlite", "r.log", "s.tmp", "noextension", "t.htm", "u.css", "v.txt"];
    const { engine } = await withProject(Object.fromEntries([...Object.keys(types), ...refused].map((name) => [name, `bytes of ${name}`])));
    for (const [name, type] of Object.entries(types)) {
      const response = await preview(engine, `/p/board/${name}`);
      expect(response.status, name).toBe(200);
      expect(response.headers["content-type"], name).toBe(type);
      expect(response.text, name).toBe(`bytes of ${name}`);
    }
    for (const name of refused) await expectNotFound(engine, `/p/board/${name}`);
  });

  it("puts the content policy and its companion headers on every served response", async () => {
    const { engine } = await withProject({ "landing.html": "<h1>Hello</h1>", "pic.png": Buffer.from([1, 2, 3]) });
    for (const name of ["landing.html", "pic.png"]) {
      const response = await preview(engine, `/p/board/${name}`);
      expect(response.status).toBe(200);
      expect(response.headers["content-security-policy"]).toBe(CSP);
      expect(response.headers["cross-origin-resource-policy"]).toBe("same-origin");
      expect(response.headers["x-content-type-options"]).toBe("nosniff");
      expect(response.headers["referrer-policy"]).toBe("no-referrer");
      expect(response.headers["cache-control"]).toBe("no-cache");
      expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    }
  });

  it("tags a file with an ETag from its size and mtime, answers a matching If-None-Match with 304, and HEAD with headers only", async () => {
    const { engine, folder } = await withProject({ "landing.html": "<h1>Hello</h1>" });
    const mtime = new Date(1_727_000_000_123);
    await utimes(join(folder, "landing.html"), mtime, mtime);
    const expected = `"${(14).toString(16)}-${Math.floor(mtime.getTime()).toString(16)}"`;
    const first = await preview(engine, "/p/board/landing.html");
    expect(first.headers.etag).toBe(expected);
    expect(first.headers["content-length"]).toBe("14");

    const again = await preview(engine, "/p/board/landing.html", { headers: { "if-none-match": expected } });
    expect(again.status).toBe(304);
    expect(again.body.length).toBe(0);
    expect(again.headers["content-length"]).toBeUndefined();
    expect(again.headers.etag).toBe(expected);
    expect(again.headers["content-security-policy"]).toBe(CSP);
    expect(again.headers["content-type"]).toBe("text/html; charset=utf-8");

    const stale = await preview(engine, "/p/board/landing.html", { headers: { "if-none-match": '"0-0"' } });
    expect(stale.status).toBe(200);

    const head = await preview(engine, "/p/board/landing.html", { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.body.length).toBe(0);
    expect(head.headers["content-length"]).toBe("14");
    expect(head.headers.etag).toBe(expected);
  });

  it("refuses a request addressed to a name that is not loopback, before any route", async () => {
    const { engine } = await withProject({ "landing.html": "<h1>Hello</h1>" });
    for (const host of [`rebound.example:${engine.previewPort}`, "localhost.evil.example", undefined]) {
      const response = await preview(engine, "/p/board/landing.html", { headers: { host } });
      expect(response.status, String(host)).toBe(403);
      expect(response.headers["content-type"]).toBe("text/plain; charset=utf-8");
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.text).toBe("Unframed answers only requests addressed to localhost.");
    }
    for (const host of [`LOCALHOST:${engine.previewPort}`, `[::1]:${engine.previewPort}`, "127.0.0.1"]) {
      expect((await preview(engine, "/p/board/landing.html", { headers: { host } })).status, host).toBe(200);
    }
  });

  it("refuses a request from a page on another machine's origin", async () => {
    const { engine } = await withProject({ "landing.html": "<h1>Hello</h1>" });
    const response = await preview(engine, "/p/board/landing.html", { headers: { origin: "https://evil.example" } });
    expect(response.status).toBe(403);
    expect(response.text).toBe("Unframed answers only same-machine requests.");
  });

  it("follows an output folder change without a restart", async () => {
    const { engine } = await withProject({ "landing.html": "<h1>old</h1>" });
    const next = join(await makeTempDir(), "moved");
    await mkdir(join(next, "board"), { recursive: true });
    await writeFile(join(next, "board", "fresh.html"), "<h1>new</h1>");
    await (await engine.rpc()).call("settings.update", { outputDir: next });
    const fresh = await preview(engine, "/p/board/fresh.html");
    expect(fresh.status).toBe(200);
    expect(fresh.text).toBe("<h1>new</h1>");
    await expectNotFound(engine, "/p/board/landing.html");
  });
});
