import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { compileComponent, compiledFileName } from "@unframed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { componentShape, pageShape } from "./canvasRecords.ts";
import { startEngine, type TestEngine } from "./harness.ts";
import { connectTab } from "./syncClient.ts";

const sheet = (tag: string, kinds: string) =>
  `<!doctype html><html><head>
<script src="unframed-dials.js"></script>
<script type="application/json" data-uf-component>{"tag":"${tag}","variants":{"kind":[${kinds}]},"props":{"label":"text"},"slots":[]}</script>
<style type="text/x-uf-component" data-uf-component-style>:host { display: inline-block; }</style>
</head><body><div data-uf-template hidden><span data-hf-id="hf-bbbb" data-uf-prop="label">Tag</span></div></body></html>`;

const OLD_BUTTON = sheet("uf-button", '"primary","secondary"');
const NEW_BUTTON = sheet("uf-button", '"primary"');
const OLD_CARD = sheet("uf-card", '"primary"');
const NEW_CARD = sheet("uf-card", '"primary"');

const PAGE = `<!doctype html><html><head><script src="unframed-dials.js"></script><script src="1-button.component.js" data-uf-component="uf-button"></script><script src="1-card.component.js" data-uf-component="uf-card"></script></head><body><uf-button data-hf-id="hf-dddd" kind="secondary"></uf-button><uf-card data-hf-id="hf-eeee"></uf-card></body></html>`;
const CURRENT = `<!doctype html><html><head><script src="unframed-dials.js"></script><script src="2-card.component.js" data-uf-component="uf-card"></script></head><body><uf-card data-hf-id="hf-ffff"></uf-card></body></html>`;

describe("component updates (spec 20, task 33)", () => {
  let engine: TestEngine;
  let folder: string;
  let rpc: Awaited<ReturnType<TestEngine["rpc"]>>;

  beforeAll(async () => {
    engine = await startEngine({ env: { UNFRAMED_TEST_CANVAS: "1" } });
    rpc = await engine.rpc();
    await rpc.call("projects.create", { name: "board" });
    folder = join(engine.dataDir, "output", "board");
    for (const [name, html] of [
      ["1-button.html", OLD_BUTTON],
      ["2-button.html", NEW_BUTTON],
      ["1-card.html", OLD_CARD],
      ["2-card.html", NEW_CARD],
    ] as const) {
      await writeFile(join(folder, name), html);
      await writeFile(join(folder, compiledFileName(name)), compileComponent(html, name));
    }
    await writeFile(join(folder, "3-page.html"), PAGE);
    await writeFile(join(folder, "4-current.html"), CURRENT);
    const tab = await connectTab(engine.port, "board");
    await tab.loaded;
    await tab.pushRaw([
      componentShape("c1", "uf-button", { file: "2-button.html", title: "Button" }),
      componentShape("c2", "uf-card", { file: "2-card.html", title: "Card" }, { y: 300 }),
      pageShape("pg1", "101", { file: "3-page.html", title: "Page" }, { y: 600 }),
      pageShape("pg2", "102", { file: "4-current.html", title: "Current" }, { y: 900 }),
    ]);
    await tab.close();
  });
  afterAll(() => engine.dispose());

  it("lists one row per older pin, with the sentences of what the newer version changes", async () => {
    expect(await rpc.call("component.updates", { project: "board", shapeId: "shape:pg1" })).toEqual([
      { tag: "uf-button", title: "Button", from: "1-button.html", to: "2-button.html", warnings: ['Button no longer has kind "secondary". 1 instance will show "primary".'] },
      { tag: "uf-card", title: "Card", from: "1-card.html", to: "2-card.html", warnings: [] },
    ]);
  });

  it("answers no rows for an artifact on the current versions, and refuses a shape that is not a page or motion", async () => {
    expect(await rpc.call("component.updates", { project: "board", shapeId: "shape:pg2" })).toEqual([]);
    await expect(rpc.call("component.updates", { project: "board", shapeId: "shape:nope" })).rejects.toMatchObject({
      code: "not_found",
      message: "There is no page or motion shape:nope on this canvas.",
    });
  });

  it("accepts one component's update as a new version of the artifact, pinning the new sheet, summarised by its title", async () => {
    const answer = await rpc.call("artifact.edit", {
      project: "board",
      shapeId: "shape:pg1",
      baseFile: "3-page.html",
      edits: [{ type: "componentUpdate", tag: "uf-button", to: "2-button.html" }],
    });
    expect(answer).toEqual({ file: expect.stringMatching(/^\d+-page\.html$/), summary: ["Updated Button"] });
    const html = await readFile(join(folder, answer.file), "utf8");
    expect(html).toContain('<script src="2-button.component.js" data-uf-component="uf-button"></script>');
    expect(html).toContain('<script src="1-card.component.js" data-uf-component="uf-card"></script>');
    expect(await readFile(join(folder, compiledFileName("2-button.html")), "utf8")).toBe(compileComponent(NEW_BUTTON, "2-button.html"));
    expect(await readFile(join(folder, "3-page.html"), "utf8")).toBe(PAGE);
  });

  it("accepts every update at once as one change, summarised by the count", async () => {
    const answer = await rpc.call("artifact.edit", {
      project: "board",
      shapeId: "shape:pg1",
      baseFile: "3-page.html",
      edits: [
        { type: "componentUpdate", tag: "uf-button", to: "2-button.html" },
        { type: "componentUpdate", tag: "uf-card", to: "2-card.html" },
      ],
    });
    expect(answer.summary).toEqual(["Updated 2 components"]);
    const html = await readFile(join(folder, answer.file), "utf8");
    expect(html).toContain('data-uf-component="uf-card"');
    expect(html).toContain("2-card.component.js");
  });

  it("refuses a version that is not a sheet of its tag in the project, and a stale base", async () => {
    await expect(
      rpc.call("artifact.edit", { project: "board", shapeId: "shape:pg1", baseFile: "3-page.html", edits: [{ type: "componentUpdate", tag: "uf-button", to: "9-nope.html" }] }),
    ).rejects.toMatchObject({ code: "bad_request", message: "That component version is not in this project." });
    await expect(
      rpc.call("artifact.edit", { project: "board", shapeId: "shape:pg1", baseFile: "3-page.html", edits: [{ type: "componentUpdate", tag: "uf-button", to: "1-card.html" }] }),
    ).rejects.toMatchObject({ code: "bad_request", message: "That component version is not in this project." });
    await expect(
      rpc.call("artifact.edit", { project: "board", shapeId: "shape:pg1", baseFile: "0-old.html", edits: [{ type: "componentUpdate", tag: "uf-button", to: "2-button.html" }] }),
    ).rejects.toMatchObject({ code: "conflict" });
  });
});
