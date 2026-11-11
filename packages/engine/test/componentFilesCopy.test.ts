import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { compileComponent, compiledFileName, readPins } from "@unframed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { componentShape } from "./canvasRecords.ts";
import { startEngine, type TestEngine } from "./harness.ts";

const BUTTON = `<!doctype html><html><head>
<script type="application/json" data-uf-component>{"tag":"uf-button","variants":{"kind":["primary","secondary"]},"props":{"label":"text"},"slots":[]}</script>
<style type="text/x-uf-component" data-uf-component-style>:host { display: inline-block; }</style>
</head><body><div data-uf-template hidden><button data-uf-prop="label">Buy</button></div></body></html>`;

const PAGE = `<!doctype html><html><head><script src="1-button.component.js" data-uf-component="uf-button"></script></head><body><uf-button kind="secondary"></uf-button></body></html>`;

const unstamped = (html: string): string =>
  html
    .replace(/<script src="unframed-(?:tokens|dials)\.js"><\/script>\n?/g, "")
    .replace(/ data-hf-id="[^"]*"/g, "");

describe("files.copy brings a page's pinned components", () => {
  let engine: TestEngine;
  const folder = (project: string) => join(engine.dataDir, "output", project);

  beforeAll(async () => {
    engine = await startEngine({ env: { UNFRAMED_TEST_CANVAS: "1" } });
    const rpc = await engine.rpc();
    await rpc.call("projects.create", { name: "one" });
    await rpc.call("projects.create", { name: "two" });
    await writeFile(join(folder("one"), "1-button.html"), BUTTON);
    await writeFile(join(folder("one"), "1-button.component.js"), compileComponent(BUTTON, "1-button.html"));
    await writeFile(join(folder("one"), "1-button.json"), '{"source":"agent","kind":"component"}\n');
    await writeFile(join(folder("one"), "2-landing.html"), PAGE);
    await writeFile(join(folder("one"), "3-plain.html"), "<h1>no pins</h1>");
  });
  afterAll(() => engine.dispose());

  it("copies the sheet, its compiled file and its sidecar under the same names, and the page beside them", async () => {
    const { file } = await (await engine.rpc()).call("files.copy", { project: "two", file: "2-landing.html", from: "one" });
    expect(file).toMatch(/^\d+-landing\.html$/);
    expect(unstamped(await readFile(join(folder("two"), file), "utf8"))).toBe(PAGE);
    expect(await readFile(join(folder("two"), "1-button.html"), "utf8")).toBe(BUTTON);
    expect(await readFile(join(folder("two"), compiledFileName("1-button.html")), "utf8")).toBe(compileComponent(BUTTON, "1-button.html"));
    expect(await readFile(join(folder("two"), "1-button.json"), "utf8")).toBe('{"source":"agent","kind":"component"}\n');
  });

  it("leaves a sheet the destination already holds, under the same name, as it is", async () => {
    await writeFile(join(folder("two"), "4-other.html"), "<h1>keep me</h1>");
    await writeFile(join(folder("one"), "4-other.html"), "<h1>other</h1>");
    await writeFile(join(folder("two"), "1-button.html"), "<script type=\"application/json\" data-uf-component>{}</script>\n");
    await writeFile(join(folder("one"), "5-page.html"), PAGE);
    await (await engine.rpc()).call("files.copy", { project: "two", file: "5-page.html", from: "one" });
    expect(await readFile(join(folder("two"), "1-button.html"), "utf8")).toBe("<script type=\"application/json\" data-uf-component>{}</script>\n");
    expect(await readFile(join(folder("two"), "4-other.html"), "utf8")).toBe("<h1>keep me</h1>");
  });

  it("keeps the pin a copied page brings when the destination holds the same tag under another sheet", async () => {
    const rpc = await engine.rpc();
    await rpc.call("projects.create", { name: "three" });
    await rpc.call("testCanvas.apply", {
      project: "three",
      change: { put: [componentShape("held", "uf-button", { file: "9-button.html", title: "Button" })], remove: [] },
      origin: { kind: "system", id: "test-seed" },
    });
    await writeFile(join(folder("one"), "6-held.html"), PAGE);
    const { file } = await rpc.call("files.copy", { project: "three", file: "6-held.html", from: "one" });
    expect(readPins(await readFile(join(folder("three"), file), "utf8"))).toEqual([{ tag: "uf-button", sheet: "1-button.html" }]);
  });

  it("copies a page with no pins as it did before", async () => {
    const { file } = await (await engine.rpc()).call("files.copy", { project: "two", file: "3-plain.html", from: "one" });
    expect(unstamped(await readFile(join(folder("two"), file), "utf8"))).toBe("<h1>no pins</h1>");
    expect(existsSync(join(folder("two"), "1-button.component.js"))).toBe(true);
  });
});
