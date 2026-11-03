import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { compileComponent, compiledFileName } from "@unframed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { componentShape, pageShape } from "./canvasRecords.ts";
import { startEngine, type TestEngine } from "./harness.ts";
import { connectTab } from "./syncClient.ts";

/** Spec 20, tasks 23 and 24: `artifact.edit` on a component sheet writes a componentRule and refuses one that reaches a locked template element. */

const SHEET = `<!doctype html><html><head>
<script src="unframed-dials.js"></script>
<script type="application/json" data-uf-component>{"tag":"uf-button","variants":{"kind":["primary","secondary"]},"props":{"label":"text"},"slots":[]}</script>
<style type="text/x-uf-component" data-uf-component-style>:host { display: inline-block; }
button { color: red; }
span { color: blue; }
</style>
</head><body><div data-uf-template hidden><button data-hf-id="hf-bbbb" data-uf-prop="label">Buy</button><span data-hf-id="hf-cccc">Tag</span></div></body></html>`;

describe("artifact.edit on a component: componentRule and locks (spec 20)", () => {
  let engine: TestEngine;
  let folder: string;
  let rpc: Awaited<ReturnType<TestEngine["rpc"]>>;

  beforeAll(async () => {
    engine = await startEngine({ env: { UNFRAMED_TEST_CANVAS: "1" } });
    rpc = await engine.rpc();
    await rpc.call("projects.create", { name: "board" });
    folder = join(engine.dataDir, "output", "board");
    await writeFile(join(folder, "1-button.html"), SHEET);
    await writeFile(join(folder, compiledFileName("1-button.html")), compileComponent(SHEET, "1-button.html"));
    const tab = await connectTab(engine.port, "board");
    await tab.loaded;
    await writeFile(join(folder, "2-page.html"), `<!doctype html><html><head><script src="unframed-dials.js"></script><script src="1-button.component.js" data-uf-component="uf-button"></script></head><body><uf-button data-hf-id="hf-dddd" kind="primary"></uf-button></body></html>`);
    await tab.pushRaw([componentShape("c1", "uf-button", { file: "1-button.html", title: "Button", lockedElements: ["hf-bbbb"] }), pageShape("pg1", "101", { file: "2-page.html", title: "Page" }, { y: 400 })]);
    await tab.close();
  });
  afterAll(() => engine.dispose());

  it("refuses a componentRule whose selector reaches a locked template element, writing nothing", async () => {
    const before = (await readdir(folder)).length;
    for (const selector of ["button", ':host([kind="secondary"]) button']) {
      await expect(
        rpc.call("artifact.edit", {
          project: "board",
          shapeId: "shape:c1",
          baseFile: "1-button.html",
          edits: [{ type: "componentRule", rule: { block: 0, selector, occurrence: 0 }, property: "color", value: "#111" }],
        }),
      ).rejects.toMatchObject({ code: "bad_request", message: expect.stringContaining("is locked. Unlock it in Layers to edit it.") });
    }
    expect((await readdir(folder)).length).toBe(before);
  });

  it("accepts a componentRule that reaches only unlocked elements, as a new sheet with its compiled file and edit sidecar", async () => {
    const answer = await rpc.call("artifact.edit", {
      project: "board",
      shapeId: "shape:c1",
      baseFile: "1-button.html",
      edits: [{ type: "componentRule", rule: { block: 0, selector: "span", occurrence: 0 }, property: "color", value: "#111" }],
    });
    expect(answer).toEqual({ file: expect.stringMatching(/^\d+-button\.html$/), summary: ["Colour · span"] });
    const html = await readFile(join(folder, answer.file), "utf8");
    expect(html).toContain("span { color: #111; }");
    expect(html).toContain("button { color: red; }");
    expect(await readFile(join(folder, compiledFileName(answer.file)), "utf8")).toBe(compileComponent(html, answer.file));
    expect(JSON.parse(await readFile(join(folder, answer.file.replace(/\.html$/, ".json")), "utf8"))).toMatchObject({
      source: "edit",
      kind: "component",
      tag: "uf-button",
      compiled: compiledFileName(answer.file),
      of: "1-button.html",
    });
    expect(await readFile(join(folder, "1-button.html"), "utf8")).toBe(SHEET);
  });

  it("sets an instance's declared variant in a page, from the version the page pins", async () => {
    const answer = await rpc.call("artifact.edit", {
      project: "board",
      shapeId: "shape:pg1",
      baseFile: "2-page.html",
      edits: [{ type: "attribute", elementId: "hf-dddd", name: "kind", value: "secondary" }],
    });
    expect(answer.summary[0]).toMatch(/^Kind · /);
    expect(await readFile(join(folder, answer.file), "utf8")).toContain('kind="secondary"');
  });
});
