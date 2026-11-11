import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BRIDGE_TAG, compileComponent, TOKENS_TAG } from "@unframed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { componentShape, pageShape } from "./canvasRecords.ts";
import { startEngine, type TestEngine } from "./harness.ts";
import { connectTab } from "./syncClient.ts";

const BUTTON = `<!doctype html><html><head>
<script type="application/json" data-uf-component>{"tag":"uf-button","variants":{"kind":["primary","secondary"]},"props":{"label":"text"},"slots":[]}</script>
<style type="text/x-uf-component" data-uf-component-style>:host { display: inline-block; }</style>
</head><body><div data-uf-template hidden><button data-uf-prop="label">Buy</button></div></body></html>`;

const PIN = '<script src="1-button.component.js" data-uf-component="uf-button"></script>';
const USES = "<uf-button label=\"Buy\"></uf-button>";

describe("component pins on every writer (spec 20, task 16)", () => {
  let engine: TestEngine;
  let folder: string;
  let rpc: Awaited<ReturnType<TestEngine["rpc"]>>;

  beforeAll(async () => {
    engine = await startEngine({ env: { UNFRAMED_TEST_CANVAS: "1" } });
    rpc = await engine.rpc();
    await rpc.call("projects.create", { name: "board" });
    folder = join(engine.dataDir, "output", "board");
    await writeFile(join(folder, "1-button.html"), BUTTON);
    await writeFile(join(folder, "1-button.component.js"), compileComponent(BUTTON, "1-button.html"));
    await writeFile(join(folder, "2-use.html"), `<!doctype html><html><head>${BRIDGE_TAG}</head><body>${USES}</body></html>`);
    await writeFile(join(folder, "3-ready.html"), `${TOKENS_TAG}\n${BRIDGE_TAG}\n<h1 data-hf-id="hf-aaaa">Hi</h1>${USES.replace("<uf-button", '<uf-button data-hf-id="hf-bbbb"')}`);
    const tab = await connectTab(engine.port, "board");
    await tab.loaded;
    await tab.pushRaw([
      componentShape("c1", "uf-button", { file: "1-button.html", title: "Button" }),
      pageShape("use", "100", { file: "2-use.html", title: "Use" }),
      pageShape("ready", "101", { file: "3-ready.html", title: "Ready" }),
    ]);
    await tab.close();
  });
  afterAll(() => engine.dispose());

  it("prepareEdit adds the pin right after the tokens tag", async () => {
    const { file } = await rpc.call("artifact.prepareEdit", { project: "board", shapeId: "shape:use" });
    const html = await readFile(join(folder, file), "utf8");
    expect(html.indexOf(TOKENS_TAG)).toBeLessThan(html.indexOf(PIN));
    expect(html.indexOf(PIN)).toBeLessThan(html.indexOf(BRIDGE_TAG));
  });

  it("artifact.edit keeps the pin the page needs in its new version", async () => {
    const answer = await rpc.call("artifact.edit", {
      project: "board",
      shapeId: "shape:ready",
      baseFile: "3-ready.html",
      edits: [{ type: "text", elementId: "hf-aaaa", text: "Hello" }],
    });
    const html = await readFile(join(folder, answer.file), "utf8");
    expect(html).toContain("Hello");
    expect(html).toContain(PIN);
  });

  it("an uploaded html page gets the pin", async () => {
    const response = await engine.request("/api/projects/board/files?name=intro.html", {
      method: "POST",
      body: `<head></head><body>${USES}</body>`,
      headers: { "content-type": "text/html" },
    });
    const { file } = response.json();
    expect(await readFile(join(folder, file), "utf8")).toContain(PIN);
  });

  it("a pasted page (files.copy within the project) gets the pin", async () => {
    const { file } = await rpc.call("files.copy", { project: "board", file: "2-use.html" });
    expect(await readFile(join(folder, file), "utf8")).toContain(PIN);
  });

  it("motion.upload gets the pin", async () => {
    const saved = await rpc.call("motion.upload", { project: "board", fileName: "Intro.html", html: `<head></head><div id=root>${USES}</div>` });
    expect(await readFile(join(folder, saved.file), "utf8")).toContain(PIN);
  });
});
