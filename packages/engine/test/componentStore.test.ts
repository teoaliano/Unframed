import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { compileComponent, componentHelperSource } from "@unframed/domain";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureComponentLibrary, writeComponentSheet } from "../src/artifacts/artifactStore.ts";
import { makeTempDir } from "./engineProcess.ts";

/** Spec 20, task 7: the artifact store writes a component sheet, its compiled file and its sidecar. */

const SHEET = `<!doctype html><html><head>
<script type="application/json" data-uf-component>{"tag":"uf-button","variants":{"kind":["primary","secondary"]},"props":{"label":"text"},"slots":[]}</script>
<style type="text/x-uf-component" data-uf-component-style>:host { display: inline-block; }</style>
</head><body><div data-uf-template hidden><button data-uf-prop="label">Buy</button></div></body></html>`;

const NOW = 1761400000000;

const input = { html: SHEET, tag: "uf-button", title: "Button", chatId: "chat-1", turn: 3, shapeId: null };

describe("the artifact store's component files", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it("writes the sheet, its compiled file and a sidecar naming both, with exclusive create", async () => {
    const folder = await makeTempDir();
    const written = await writeComponentSheet(folder, input);
    expect(written.file).toBe(`${NOW}-button.html`);
    expect(written.compiled).toBe(`${NOW}-button.component.js`);
    expect(await readFile(join(folder, written.file), "utf8")).toBe(SHEET);
    expect(await readFile(join(folder, written.compiled), "utf8")).toBe(compileComponent(SHEET, written.file));
    const sidecar = JSON.parse(await readFile(join(folder, `${NOW}-button.json`), "utf8"));
    expect(sidecar).toEqual({
      source: "agent",
      kind: "component",
      tag: "uf-button",
      compiled: written.compiled,
      chatId: "chat-1",
      turn: 3,
      shapeId: null,
      title: "Button",
      bytes: Buffer.byteLength(SHEET),
      at: new Date(NOW).toISOString(),
    });
  });

  it("never overwrites: a second write at the same moment takes the next suffix and keeps the first", async () => {
    const folder = await makeTempDir();
    const first = await writeComponentSheet(folder, input);
    const second = await writeComponentSheet(folder, { ...input, html: SHEET.replace("Buy", "Buy now") });
    expect(second.file).toBe(`${NOW}-button-1.html`);
    expect(second.compiled).toBe(`${NOW}-button-1.component.js`);
    expect(await readFile(join(folder, first.file), "utf8")).toBe(SHEET);
  });

  it("treats a name as taken when its compiled name exists, even with no sheet beside it", async () => {
    const folder = await makeTempDir();
    await writeFile(join(folder, `${NOW}-button.component.js`), "/* an older build */");
    const written = await writeComponentSheet(folder, input);
    expect(written.file).toBe(`${NOW}-button-1.html`);
    expect(await readFile(join(folder, `${NOW}-button.component.js`), "utf8")).toBe("/* an older build */");
  });

  it("ensures the sheet helper beside the sheets by its size, and rewrites a stale copy", async () => {
    const folder = await makeTempDir();
    await ensureComponentLibrary(folder);
    expect(await readFile(join(folder, "unframed-components.js"), "utf8")).toBe(componentHelperSource());
    expect(await readFile(join(folder, "unframed-dials.js"), "utf8")).toContain("unframed-dials");

    await writeFile(join(folder, "unframed-components.js"), "stale");
    await ensureComponentLibrary(folder);
    expect(await readFile(join(folder, "unframed-components.js"), "utf8")).toBe(componentHelperSource());
    expect((await stat(join(folder, "unframed-components.js"))).size).toBe(Buffer.byteLength(componentHelperSource()));
  });
});
