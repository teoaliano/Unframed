import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BRIDGE_TAG, COMPONENT_HELPER_TAG, compileComponent, compiledFileName, TOKENS_TAG } from "@unframed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { componentShape } from "./canvasRecords.ts";
import { startEngine, type TestEngine } from "./harness.ts";
import { connectTab } from "./syncClient.ts";

/** Spec 20, the editor on a component: a sheet that has no element ids yet is prepared, then edited, like a page. */

const DECLARATION = `<script type="application/json" data-uf-component>{"tag":"uf-button","variants":{"kind":["primary","secondary"]},"props":{"label":"text"},"slots":[]}</script>`;
const STYLE = `<style type="text/x-uf-component" data-uf-component-style>:host { display: inline-block; }</style>`;
const UNSTAMPED = `<!doctype html><html><head>\n${DECLARATION}\n${STYLE}\n</head><body><div data-uf-template hidden><button data-uf-prop="label">Buy</button></div></body></html>`;

const setComponentFile = async (engine: TestEngine, file: string) => {
  const tab = await connectTab(engine.port, "board");
  await tab.loaded;
  await tab.pushRaw([componentShape("c1", "uf-button", { file, title: "Button" })]);
  await tab.close();
};

describe("the editor on a component sheet (spec 20)", () => {
  let engine: TestEngine;
  let folder: string;
  let rpc: Awaited<ReturnType<TestEngine["rpc"]>>;

  beforeAll(async () => {
    engine = await startEngine({ env: { UNFRAMED_TEST_CANVAS: "1" } });
    rpc = await engine.rpc();
    await rpc.call("projects.create", { name: "board" });
    folder = join(engine.dataDir, "output", "board");
    await writeFile(join(folder, "1-button.html"), UNSTAMPED);
    await writeFile(join(folder, compiledFileName("1-button.html")), compileComponent(UNSTAMPED, "1-button.html"));
    await setComponentFile(engine, "1-button.html");
  });
  afterAll(() => engine.dispose());

  it("prepares an unstamped sheet as a new version with its tags, element ids and compiled file, keeping its declaration", async () => {
    const { file } = await rpc.call("artifact.prepareEdit", { project: "board", shapeId: "shape:c1" });
    expect(file).toMatch(/^\d+-button\.html$/);
    const html = await readFile(join(folder, file), "utf8");
    expect(html).toContain(TOKENS_TAG);
    expect(html).toContain(BRIDGE_TAG);
    expect(html).toContain(COMPONENT_HELPER_TAG);
    expect(html).toContain(DECLARATION);
    expect(html).toContain(STYLE);
    expect(html).toMatch(/<button data-hf-id="hf-[a-z0-9]+" data-uf-prop="label">Buy<\/button>/);
    expect(await readFile(join(folder, compiledFileName(file)), "utf8")).toBe(compileComponent(html, file));
    expect(await readFile(join(folder, "1-button.html"), "utf8")).toBe(UNSTAMPED);
    await setComponentFile(engine, file);
    expect(await rpc.call("artifact.prepareEdit", { project: "board", shapeId: "shape:c1" })).toEqual({ file });
  });

  it("reads the prepared sheet's elements as ready, and edits its text as a new version of the sheet", async () => {
    const { file: prepared } = await rpc.call("artifact.prepareEdit", { project: "board", shapeId: "shape:c1" });
    const tree = await rpc.call("artifact.sourceTree", { project: "board", file: prepared });
    expect(tree.ready).toBe(true);
    const button = tree.elements.find((element) => element.tag === "button");
    expect(button).toBeDefined();

    await setComponentFile(engine, prepared);
    const answer = await rpc.call("artifact.edit", {
      project: "board",
      shapeId: "shape:c1",
      baseFile: prepared,
      edits: [{ type: "text", elementId: button!.id, text: "Buy now" }],
    });
    expect(answer.file).toMatch(/^\d+-button\.html$/);
    const edited = await readFile(join(folder, answer.file), "utf8");
    expect(edited).toContain(">Buy now</button>");
    expect(edited).toContain(DECLARATION);
    expect(await readFile(join(folder, compiledFileName(answer.file)), "utf8")).toBe(compileComponent(edited, answer.file));
  });
});
