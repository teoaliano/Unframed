import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { TLRecord } from "@tldraw/tlschema";
import { NO_CHROME_RENDER_MESSAGE } from "@unframed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { componentShape, pageShape, promptShape } from "./canvasRecords.ts";
import { startGenerating, type Generating } from "./generation.ts";
import { nodeShape, wireShape } from "./nodeRecords.ts";
import { chatCompletions } from "./textStub.ts";

const BUTTON = `<!doctype html><html><head>
<script type="application/json" data-uf-component>{"tag":"uf-button","variants":{"kind":["primary","secondary"]},"props":{"label":"text"},"slots":[]}</script>
<style type="text/x-uf-component" data-uf-component-style>:host { display: inline-block; }</style>
</head><body><div data-uf-template hidden><button data-uf-prop="label">Buy</button></div></body></html>`;

let answer = "<!doctype html><html><head><title>Shop</title></head><body><uf-button kind=\"primary\"></uf-button></body></html>";
const chats = chatCompletions(() => ({ kind: "text", text: answer, cost: 0.001 }));

const folderOf = (generating: Generating) => join(generating.engine.dataDir, "output", "board");
const records = async (generating: Generating): Promise<any[]> => (await generating.rpc.call("testCanvas.read", { project: "board" })).records as any[];
const seed = async (generating: Generating, put: TLRecord[]) => {
  const shapes = (await records(generating)).filter((record) => record.typeName === "shape").map((record) => record.id);
  if (shapes.length > 0) await generating.rpc.call("testCanvas.apply", { project: "board", change: { put: [], remove: shapes }, origin: { kind: "system", id: "clear" } });
  await generating.rpc.call("testCanvas.apply", { project: "board", change: { put, remove: [] }, origin: { kind: "system", id: "seed" } });
};
const landed = async (generating: Generating, id: string, versions = 1) => {
  const started = Date.now();
  for (;;) {
    const node = (await records(generating)).find((record) => record.id === `shape:${id}`);
    if (node && node.props.run === undefined && (node.props.versions.length >= versions || node.props.error !== undefined)) return node;
    if (Date.now() - started > 10_000) throw new Error(`node ${id} did not land: ${JSON.stringify(node?.props)}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};

describe("the node page writer and page inputs", () => {
  let generating: Generating;
  beforeAll(async () => {
    generating = await startGenerating({ extra: [chats.handler], env: { UNFRAMED_TEST_RENDERER: "ok" } });
  });
  afterAll(() => generating.engine.dispose());

  it("stamps a node's page like every writer: the bridge and tokens tags, element ids, and a pin for each project component it uses", async () => {
    await writeFile(join(folderOf(generating), "1-button.html"), BUTTON);
    await seed(generating, [componentShape("c1", "uf-button", { file: "1-button.html", title: "Button" }, { y: 900 }), nodeShape("n", "202", { medium: "page", instruction: "a shop" })]);
    await generating.rpc.call("node.run", { project: "board", shapeId: "shape:n" });
    const node = await landed(generating, "n");
    const html = await readFile(join(folderOf(generating), node.props.versions[0].file), "utf8");
    expect(html).toContain('<script src="unframed-dials.js"></script>');
    expect(html).toContain('<script src="unframed-tokens.js"></script>');
    expect(html).toMatch(/<h?[a-z-]+[^>]* data-hf-id="[^"]+"/);
    expect(html).toContain('data-uf-component="uf-button"');
    expect(await readdir(folderOf(generating))).toContain("unframed-tokens.js");
  });

  it("a page wire sending a picture takes a capture into the project folder, reuses it while the page is unchanged, and retakes it when it changes", async () => {
    await writeFile(join(folderOf(generating), "proto.html"), "<!doctype html><html><body>one</body></html>");
    await seed(generating, [pageShape("pg", "201", { file: "proto.html" }), nodeShape("n", "202", { medium: "text", instruction: "describe" }, { x: 600 }), wireShape("w", "pg", "n", "reference", { files: "entry" })]);
    await generating.rpc.call("node.run", { project: "board", shapeId: "shape:n" });
    await landed(generating, "n");
    const captures = async () => (await readdir(folderOf(generating))).filter((name) => /-capture-proto\.png$/.test(name)).sort();
    const [first] = await captures();
    expect(first).toBeDefined();
    expect(JSON.parse(await readFile(join(folderOf(generating), first!.replace(/\.png$/, ".json")), "utf8"))).toMatchObject({
      kind: "capture",
      source: "capture",
      of: "proto.html",
      pageHash: expect.any(String),
      files: "entry",
      viewport: { w: 1280, h: 800 },
    });
    const parts = chats.requests.at(-1)!.body.messages.at(-1).content;
    expect(parts[1]).toMatchObject({ type: "image_url", image_url: { url: expect.stringMatching(/^data:image\/png;base64,/) } });

    await generating.rpc.call("node.run", { project: "board", shapeId: "shape:n" });
    await landed(generating, "n", 2);
    expect(await captures()).toEqual([first]);

    await writeFile(join(folderOf(generating), "proto.html"), "<!doctype html><html><body>two</body></html>");
    await generating.rpc.call("node.run", { project: "board", shapeId: "shape:n" });
    await landed(generating, "n", 3);
    expect(await captures()).toHaveLength(2);
  });

  it("a page wire with its linked files sends their text after the page, and refuses a link outside the project", async () => {
    await writeFile(join(folderOf(generating), "site.html"), '<!doctype html><html><head><link rel="stylesheet" href="site.css"></head><body>hi</body></html>');
    await writeFile(join(folderOf(generating), "site.css"), "body { color: red; }");
    await seed(generating, [pageShape("pg", "201", { file: "site.html" }), nodeShape("n", "202", { medium: "text", instruction: "review" }, { x: 600 }), wireShape("w", "pg", "n", "prompt", { files: "linked" })]);
    await generating.rpc.call("node.run", { project: "board", shapeId: "shape:n" });
    await landed(generating, "n");
    expect(chats.requests.at(-1)!.body.messages.at(-1).content[0].text).toContain("<!-- site.css -->\nbody { color: red; }");

    await writeFile(join(folderOf(generating), "site.html"), '<!doctype html><html><body><img src="gone.png"></body></html>');
    await generating.rpc.call("node.run", { project: "board", shapeId: "shape:n" });
    const failed = await landed(generating, "n", 99);
    expect(failed.props.error).toBe("This page links gone.png, which is not in the project folder.");
  });

  it("flow.save keeps the nodes and the wires inside the set, with no results, and counts the ones left out", async () => {
    await seed(generating, [
      promptShape("p", "201", "a fox", { x: -500 }),
      nodeShape("a", "202", { medium: "text", instruction: "x", versions: [{ id: "v", runId: "r", chainId: null, batchId: "b", runIndex: 1, status: "done", text: "t", fingerprint: "f", createdAt: "2026-11-05T00:00:00.000Z" }], currentVersionId: "v" }),
      nodeShape("b", "203", { medium: "image" }, { x: 500 }),
      wireShape("pa", "p", "a", "prompt"),
      wireShape("ab", "a", "b", "prompt"),
    ]);
    const saved = await generating.rpc.call("flow.save", { project: "board", shapeIds: ["shape:a", "shape:b"], name: "Two steps" });
    expect(saved.droppedWires).toBe(1);
    expect(saved.preset).toMatchObject({ name: "Two steps", kind: "flow" });
    const content = (saved.preset as unknown as { content: { shapes: any[] } }).content;
    expect(content.shapes.filter((shape) => shape.type === "node").map((shape) => [shape.props.versions, shape.props.currentVersionId])).toEqual([
      [[], null],
      [[], null],
    ]);
    expect(content.shapes.filter((shape) => shape.type === "wire").map((shape) => shape.props)).toEqual([{ from: "shape:a", to: "shape:b", role: "prompt" }]);
    answer = "<!doctype html><html><head><title>Shop</title></head><body></body></html>";
  });
});

describe("page pictures without Chrome", () => {
  it("refuse the run with spec 09's sentence and write nothing", async () => {
    const generating = await startGenerating({ extra: [chats.handler], env: { UNFRAMED_TEST_RENDERER: "no-chrome" } });
    try {
      await writeFile(join(folderOf(generating), "proto.html"), "<!doctype html><html><body>one</body></html>");
      await seed(generating, [pageShape("pg", "201", { file: "proto.html" }), nodeShape("n", "202", { medium: "text", instruction: "describe" }, { x: 600 }), wireShape("w", "pg", "n", "both", { files: "entry" })]);
      const calls = chats.requests.length;
      await expect(generating.rpc.call("node.run", { project: "board", shapeId: "shape:n" })).rejects.toMatchObject({ message: NO_CHROME_RENDER_MESSAGE });
      expect(chats.requests.length).toBe(calls);
      expect((await readdir(folderOf(generating))).filter((name) => name.includes("-capture-"))).toEqual([]);
    } finally {
      await generating.engine.dispose();
    }
  });
});
