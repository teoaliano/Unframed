import { existsSync } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { compileComponent, compiledFileName } from "@unframed/domain";
import { describe, expect, it } from "vitest";
import { startEngine, type TestEngine } from "./harness.ts";

const SHEET_FILE = "1761400000000-button.html";
const COMPILED = compiledFileName(SHEET_FILE);
const SHEET = `<!doctype html><html><head>
<script type="application/json" data-uf-component>{"tag":"uf-button","variants":{"kind":["primary","secondary"]},"props":{"label":"text"},"slots":[]}</script>
<style type="text/x-uf-component" data-uf-component-style>:host { display: inline-block; }</style>
</head><body><div data-uf-template hidden><button data-uf-prop="label">Buy</button></div></body></html>`;

const CSP =
  "default-src 'none'; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; frame-src 'self'; connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'; frame-ancestors http://localhost:* http://127.0.0.1:*";

const withBoard = async (): Promise<{ engine: TestEngine; folder: string }> => {
  const engine = await startEngine();
  await (await engine.rpc()).call("projects.create", { name: "board" });
  return { engine, folder: join(engine.dataDir, "output", "board") };
};

const preview = (engine: TestEngine, path: string) =>
  engine.request(path, { port: engine.previewPort, headers: { host: `127.0.0.1:${engine.previewPort}` } });

describe("the preview origin and compiled components", () => {
  it("serves a compiled component as text/javascript with the usual headers", async () => {
    const { engine, folder } = await withBoard();
    await writeFile(join(folder, SHEET_FILE), SHEET);
    await writeFile(join(folder, COMPILED), compileComponent(SHEET, SHEET_FILE));
    const response = await preview(engine, `/p/board/${COMPILED}`);
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe("text/javascript; charset=utf-8");
    expect(response.headers["content-security-policy"]).toBe(CSP);
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["cache-control"]).toBe("no-cache");
    expect(response.text).toBe(compileComponent(SHEET, SHEET_FILE));
  });

  it("compiles a missing compiled file from its sheet on request, with the bytes the compiler makes", async () => {
    const { engine, folder } = await withBoard();
    await writeFile(join(folder, SHEET_FILE), SHEET);
    const response = await preview(engine, `/p/board/${COMPILED}`);
    expect(response.status).toBe(200);
    expect(response.text).toBe(compileComponent(SHEET, SHEET_FILE));
    expect(await readFile(join(folder, COMPILED), "utf8")).toBe(compileComponent(SHEET, SHEET_FILE));
  });

  it("answers 404 for a missing compiled file whose sheet is missing or invalid, and writes nothing", async () => {
    const { engine, folder } = await withBoard();
    expect((await preview(engine, `/p/board/${COMPILED}`)).status).toBe(404);
    expect(existsSync(join(folder, COMPILED))).toBe(false);
    await writeFile(join(folder, SHEET_FILE), "<!doctype html><p>not a component</p>");
    expect((await preview(engine, `/p/board/${COMPILED}`)).status).toBe(404);
    expect(existsSync(join(folder, COMPILED))).toBe(false);
  });

  it("never creates a project folder to compile into", async () => {
    const { engine } = await withBoard();
    expect((await preview(engine, `/p/nothere/${COMPILED}`)).status).toBe(404);
    expect(existsSync(join(engine.dataDir, "output", "nothere"))).toBe(false);
  });

  it("refreshes the sheet helper on request, as it refreshes the bridge", async () => {
    const { engine, folder } = await withBoard();
    await writeFile(join(folder, "unframed-components.js"), "stale");
    const response = await preview(engine, "/p/board/unframed-components.js");
    expect(response.status).toBe(200);
    expect(response.text).toMatch(/^\/\* unframed-components\.js: generated/);
    expect(Buffer.byteLength(response.text)).toBe((await stat(join(folder, "unframed-components.js"))).size);
  });
});
