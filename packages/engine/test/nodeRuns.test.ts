import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { TLRecord } from "@tldraw/tlschema";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { nodeShape, wireShape } from "./nodeRecords.ts";
import { pngBytes, startGenerating, type Generating } from "./generation.ts";
import { promptShape } from "./canvasRecords.ts";
import { gate } from "./openRouterStub.ts";
import { chatCompletions, type ChatAnswer } from "./textStub.ts";

let generating: Generating;
let chat: (request: { body: any }) => ChatAnswer | Promise<ChatAnswer> = () => ({ kind: "text", text: "a moody forest at dusk" });
const chats = chatCompletions((request) => chat(request));

const folder = () => join(generating.engine.dataDir, "output", "board");
const records = async (): Promise<any[]> => (await generating.rpc.call("testCanvas.read", { project: "board" })).records as any[];
const shape = async (id: string) => (await records()).find((record) => record.id === `shape:${id}`);
const seed = (put: TLRecord[]) => generating.rpc.call("testCanvas.apply", { project: "board", change: { put, remove: [] }, origin: { kind: "system", id: "test-seed" } });
const clear = async () => {
  const shapes = (await records()).filter((record) => record.typeName === "shape").map((record) => record.id);
  await generating.rpc.call("testCanvas.apply", { project: "board", change: { put: [], remove: shapes }, origin: { kind: "system", id: "test-clear" } });
};
const settled = (id: string) => waitNode(id, (node) => node.props.run === undefined && node.props.versions.every((version: any) => version.status === "done"));
const waitNode = async (id: string, check: (node: any) => boolean, what = `node ${id}`) => {
  const started = Date.now();
  for (;;) {
    const node = await shape(id);
    if (node && check(node)) return node;
    if (Date.now() - started > 10_000) throw new Error(`Timed out waiting for ${what}: ${JSON.stringify(node?.props)}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};

beforeAll(async () => {
  generating = await startGenerating({ extra: [chats.handler] });
});
afterAll(() => generating.engine.dispose());
beforeEach(async () => {
  await clear();
  chat = () => ({ kind: "text", text: "a moody forest at dusk" });
  generating.answer(() => ({ kind: "image", bytes: pngBytes(64, 32) }));
});

describe("node.run", () => {
  it("writes a running version before the call answers, fills it on landing and makes it current", async () => {
    const held = gate<void>();
    generating.answer(async () => {
      await held.promise;
      return { kind: "image", bytes: pngBytes(64, 32) };
    });
    await seed([promptShape("p", "101", "a lone red fox"), nodeShape("n", "102", { medium: "image", runs: 2 }), wireShape("w", "p", "n", "prompt")]);
    const started = await generating.rpc.call("node.run", { project: "board", shapeId: "shape:n" });
    expect(started.nodes).toEqual(["shape:n"]);
    const running = await waitNode("n", (node) => node.props.versions.length === 2);
    expect(running.props.run).toMatchObject({ runId: expect.stringMatching(/^run-/), chainId: null });
    expect(running.props.versions.map((version: any) => [version.status, version.runIndex])).toEqual([
      ["running", 2],
      ["running", 1],
    ]);
    held.release();
    const done = await settled("n");
    expect(done.props.versions.map((version: any) => version.status)).toEqual(["done", "done"]);
    const first = done.props.versions.find((version: any) => version.runIndex === 1);
    expect(done.props.currentVersionId).toBe(first.id);
    expect(first.file).toMatch(/\.png$/);
    const sidecar = JSON.parse(await readFile(join(folder(), first.file.replace(/\.png$/, ".json")), "utf8"));
    expect(sidecar).toMatchObject({ prompt: "a lone red fox", cost: 0.042, node: { shapeId: "shape:n", versionId: first.id }, recipe: { medium: "image", sources: ["shape:p"], node: { shapeId: "shape:n", versionId: first.id } } });
    expect(sidecar.chain).toBeUndefined();
  });

  it.each([
    ["no prompt and no instruction", [nodeShape("n", "102", { medium: "image" })], "Prompt is empty. Wire a prompt, or type an instruction."],
    [
      "an input node with no result",
      [nodeShape("up", "101", { medium: "image" }), nodeShape("n", "102", { medium: "image", instruction: "go" }), wireShape("w", "up", "n", "reference")],
      "@101 has no result yet. Run it first, or use Run downstream from it.",
    ],
  ])("refuses %s and writes no version", async (_case, put, message) => {
    await seed(put as TLRecord[]);
    const calls = generating.requests.length;
    await expect(generating.rpc.call("node.run", { project: "board", shapeId: "shape:n" })).rejects.toMatchObject({ code: "bad_request", message });
    expect((await shape("n")).props.versions).toEqual([]);
    expect((await shape("n")).props.run).toBeUndefined();
    expect(generating.requests.length).toBe(calls);
  });

  it("refuses a node that is already running", async () => {
    await seed([nodeShape("n", "102", { medium: "image", instruction: "go", run: { runId: "run-x", chainId: null, startedAt: 1 } })]);
    await expect(generating.rpc.call("node.run", { project: "board", shapeId: "shape:n" })).rejects.toMatchObject({ message: "@102 is running. Wait for it to finish." });
  });

  it("removes the version of a failed run and keeps the failure on the node until it runs again", async () => {
    generating.answer(() => ({ kind: "status", status: 400, body: { error: { message: "The model refused." } } }));
    await seed([nodeShape("n", "102", { medium: "image", instruction: "a fox" })]);
    await generating.rpc.call("node.run", { project: "board", shapeId: "shape:n" });
    const failed = await waitNode("n", (node) => node.props.error !== undefined);
    expect(failed.props.versions).toEqual([]);
    expect(failed.props.error).toContain("The model refused.");
    generating.answer(() => ({ kind: "image", bytes: pngBytes(8, 8) }));
    await generating.rpc.call("node.run", { project: "board", shapeId: "shape:n" });
    const ok = await waitNode("n", (node) => node.props.currentVersionId !== null);
    expect(ok.props.error).toBeUndefined();
  });

  it("a text node keeps the answer as a version, and a node downstream takes it as its prompt", async () => {
    await seed([nodeShape("words", "101", { medium: "text", instruction: "describe a forest" }), nodeShape("still", "102", { medium: "image" }), wireShape("w", "words", "still", "prompt")]);
    await generating.rpc.call("node.run", { project: "board", shapeId: "shape:words", downstream: true, scope: "all" });
    const still = await waitNode("still", (node) => node.props.currentVersionId !== null);
    const words = await shape("words");
    const answer = words.props.versions.find((version: any) => version.id === words.props.currentVersionId);
    expect(answer.text).toBe("a moody forest at dusk");
    expect(generating.requests.at(-1)!.body.prompt).toBe("a moody forest at dusk");
    const version = still.props.versions[0];
    const sidecar = JSON.parse(await readFile(join(folder(), version.file.replace(/\.png$/, ".json")), "utf8"));
    expect(sidecar.chain).toEqual({ chainId: expect.stringMatching(/^chain-/), step: 2 });
  });
});

describe("chain.run", () => {
  it("runs in dependency order, one step at a time", async () => {
    const order: string[] = [];
    chat = (request) => {
      order.push(`text:${request.body.messages.at(-1).content[0].text}`);
      return { kind: "text", text: "words" };
    };
    generating.answer((request) => {
      order.push(`image:${request.body.prompt}`);
      return { kind: "image", bytes: pngBytes(8, 8) };
    });
    await seed([
      nodeShape("still", "102", { medium: "image" }, { x: 0, y: 0 }),
      nodeShape("words", "101", { medium: "text", instruction: "describe" }, { x: 900, y: 0 }),
      wireShape("w", "words", "still", "prompt"),
    ]);
    const started = await generating.rpc.call("chain.run", { project: "board", shapeIds: ["shape:still", "shape:words"] });
    expect(started.nodes).toEqual(["shape:words", "shape:still"]);
    await waitNode("still", (node) => node.props.currentVersionId !== null);
    expect(order).toEqual(["text:describe", "image:words"]);
  });

  it("refuses before any step when a step cannot run, naming the step, and writes nothing", async () => {
    await seed([nodeShape("a", "101", { medium: "text", instruction: "x" }, { y: 0 }), nodeShape("b", "102", { medium: "image" }, { y: 500 })]);
    const calls = chats.requests.length;
    await expect(generating.rpc.call("chain.run", { project: "board", shapeIds: ["shape:a", "shape:b"] })).rejects.toMatchObject({
      message: "Step 2 (@102): Prompt is empty. Wire a prompt, or type an instruction.",
    });
    expect(chats.requests.length).toBe(calls);
    expect((await shape("a")).props.run).toBeUndefined();
  });

  it("stops at a failed step: the steps after it wait and never call", async () => {
    chat = () => ({ kind: "status", status: 500, body: { error: { message: "upstream broke" } } });
    await seed([
      nodeShape("a", "101", { medium: "text", instruction: "x" }, { y: 0 }),
      nodeShape("b", "102", { medium: "image" }, { y: 500 }),
      nodeShape("c", "103", { medium: "image", instruction: "independent" }, { y: 900 }),
      wireShape("w", "a", "b", "prompt"),
    ]);
    const images = generating.requests.length;
    await generating.rpc.call("chain.run", { project: "board", shapeIds: ["shape:a", "shape:b", "shape:c"] });
    const b = await waitNode("b", (node) => node.props.error !== undefined);
    const c = await waitNode("c", (node) => node.props.error !== undefined);
    expect((await shape("a")).props.error).toContain("upstream broke");
    expect(b.props.error).toBe("Waiting for @101, which failed.");
    expect(c.props.error).toBe("Waiting for @101, which failed.");
    expect(b.props.run).toBeUndefined();
    expect(generating.requests.length).toBe(images);
  });

  it("expands a group to the nodes it holds", async () => {
    const { groupShape } = await import("./canvasRecords.ts");
    await seed([groupShape("g", "flow", { x: 0, y: 0 }, { w: 900, h: 900 }), nodeShape("a", "101", { medium: "text", instruction: "x" }, { x: 10, y: 50, parentId: "shape:g" })]);
    const started = await generating.rpc.call("chain.run", { project: "board", shapeIds: ["shape:g"] });
    expect(started.nodes).toEqual(["shape:a"]);
  });
});

describe("versions", () => {
  const two = () =>
    nodeShape("n", "102", {
      medium: "image",
      versions: [
        { id: "v2", runId: "r2", chainId: null, batchId: "b2", runIndex: 1, status: "done", file: "two.png", fingerprint: "f", createdAt: "2026-11-05T00:00:00.000Z" },
        { id: "v1", runId: "r1", chainId: null, batchId: "b1", runIndex: 1, status: "done", file: "one.png", fingerprint: "f", createdAt: "2026-11-04T00:00:00.000Z" },
        { id: "v0", runId: "r0", chainId: null, batchId: "b0", runIndex: 1, status: "running", fingerprint: "f", createdAt: "2026-11-03T00:00:00.000Z", durable: true },
      ],
      currentVersionId: "v2",
    });

  it("uses a version, removes one with its file kept and current moved to the newest left, and refuses a running one", async () => {
    await writeFile(join(folder(), "two.png"), pngBytes(4, 4));
    await seed([two()]);
    await generating.rpc.call("node.useVersion", { project: "board", shapeId: "shape:n", versionId: "v1" });
    expect((await shape("n")).props.currentVersionId).toBe("v1");
    await generating.rpc.call("node.removeVersion", { project: "board", shapeId: "shape:n", versionId: "v1" });
    const after = await shape("n");
    expect(after.props.versions.map((version: any) => version.id)).toEqual(["v2", "v0"]);
    expect(after.props.currentVersionId).toBe("v2");
    await expect(generating.rpc.call("node.removeVersion", { project: "board", shapeId: "shape:n", versionId: "v0" })).rejects.toMatchObject({ message: "That version is still being made." });
    await expect(generating.rpc.call("node.useVersion", { project: "board", shapeId: "shape:gone", versionId: "v0" })).rejects.toMatchObject({ code: "not_found" });
    expect(await readdir(folder())).toContain("two.png");
  });
});

describe("pages", () => {
  it("a page node writes its answer as a page file with its sidecar, stamped like every writer", async () => {
    chat = () => ({ kind: "text", text: "```html\n<!doctype html><html><head><title>Coffee site</title></head><body><h1>Hi</h1></body></html>\n```", cost: 0.003 });
    await seed([nodeShape("n", "102", { medium: "page", instruction: "a coffee site" })]);
    await generating.rpc.call("node.run", { project: "board", shapeId: "shape:n" });
    const node = await waitNode("n", (each) => each.props.currentVersionId !== null);
    const version = node.props.versions[0];
    expect(version.file).toMatch(/-page-coffee-site\.html$/);
    expect(version.fileName).toBe("Coffee site");
    const html = await readFile(join(folder(), version.file), "utf8");
    expect(html).toContain("unframed-dials.js");
    expect(html).toMatch(/data-hf-id=/);
    const sidecar = JSON.parse(await readFile(join(folder(), version.file.replace(/\.html$/, ".json")), "utf8"));
    expect(sidecar).toMatchObject({ kind: "page", source: "node", title: "Coffee site", cost: 0.003, node: { shapeId: "shape:n", versionId: version.id }, file: version.file });
    expect(chats.requests.at(-1)!.body.messages[0].role).toBe("system");
  });

  it("keeps a rejected answer with its cost and fails the run with the message", async () => {
    chat = () => ({ kind: "text", text: "Sure! Here is a fragment: <div>hi</div>", cost: 0.002 });
    await seed([nodeShape("n", "102", { medium: "page", instruction: "a page" })]);
    await generating.rpc.call("node.run", { project: "board", shapeId: "shape:n" });
    const node = await waitNode("n", (each) => each.props.error !== undefined);
    expect(node.props.versions).toEqual([]);
    expect(node.props.error).toMatch(/^The model did not return an HTML page\. The call was made and may have been charged\. Run again to retry\. The answer is in .*-page-rejected\.txt\.$/);
    const rejected = (await readdir(folder())).find((name) => name.endsWith("-page-rejected.txt"))!;
    expect(await readFile(join(folder(), rejected), "utf8")).toContain("fragment");
    expect(JSON.parse(await readFile(join(folder(), rejected.replace(/\.txt$/, ".json")), "utf8"))).toMatchObject({ cost: 0.002 });
  });

  it("a page wire sends the page's HTML as text", async () => {
    await writeFile(join(folder(), "proto.html"), "<!doctype html><html><body>PROTO</body></html>");
    const { pageShape } = await import("./canvasRecords.ts");
    await seed([pageShape("pg", "101", { file: "proto.html" }), nodeShape("n", "102", { medium: "text", instruction: "review it" }), wireShape("w", "pg", "n", "prompt", { files: "entry" })]);
    await generating.rpc.call("node.run", { project: "board", shapeId: "shape:n" });
    await waitNode("n", (each) => each.props.currentVersionId !== null);
    expect(chats.requests.at(-1)!.body.messages.at(-1).content[0].text).toBe("<!doctype html><html><body>PROTO</body></html>\n\nreview it");
  });
});


describe("one run at a time", () => {
  it("two starts at once claim the node once: one runs and pays, the other is refused", async () => {
    const held = gate<void>();
    generating.answer(async () => {
      await held.promise;
      return { kind: "image", bytes: pngBytes(8, 8) };
    });
    await seed([nodeShape("n", "202", { medium: "image", instruction: "a fox" })]);
    const calls = generating.requests.length;
    const results = await Promise.allSettled([
      generating.rpc.call("node.run", { project: "board", shapeId: "shape:n" }),
      generating.rpc.call("node.run", { project: "board", shapeId: "shape:n" }),
      generating.rpc.call("chain.run", { project: "board", shapeIds: ["shape:n"] }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    for (const result of results.filter((each) => each.status === "rejected")) expect((result as PromiseRejectedResult).reason).toMatchObject({ message: "@202 is running. Wait for it to finish." });
    held.release();
    await waitNode("n", (node) => node.props.currentVersionId !== null && node.props.run === undefined);
    expect(generating.requests.length - calls).toBe(1);
    expect((await shape("n")).props.versions).toHaveLength(1);
  });
});

describe("what was confirmed is what runs", () => {
  it("refuses a chain whose steps differ from the ones the person confirmed, and runs nothing", async () => {
    await seed([nodeShape("a", "201", { medium: "text", instruction: "x" }, { y: 0 }), nodeShape("b", "202", { medium: "text", instruction: "y" }, { y: 500 })]);
    const calls = chats.requests.length;
    await expect(generating.rpc.call("chain.run", { project: "board", shapeIds: ["shape:a", "shape:b"], steps: ["shape:a"] })).rejects.toMatchObject({
      message: "The chain changed since you confirmed it. Check its steps and run it again.",
    });
    expect(chats.requests.length).toBe(calls);
    expect((await shape("a")).props.run).toBeUndefined();
    const started = await generating.rpc.call("chain.run", { project: "board", shapeIds: ["shape:a", "shape:b"], steps: ["shape:a", "shape:b"] });
    expect(started.nodes).toEqual(["shape:a", "shape:b"]);
    await waitNode("b", (node) => node.props.currentVersionId !== null);
  });

  it("Run downstream's pending choice runs the node and only the nodes after it that are not up to date", async () => {
    await seed([
      nodeShape("a", "201", { medium: "text", instruction: "x" }, { y: 0 }),
      nodeShape("b", "202", { medium: "text" }, { y: 500 }),
      nodeShape("c", "203", { medium: "text" }, { y: 1000 }),
      wireShape("ab", "a", "b", "prompt"),
      wireShape("bc", "b", "c", "prompt"),
    ]);
    const all = await generating.rpc.call("node.run", { project: "board", shapeId: "shape:a", downstream: true, scope: "all" });
    expect(all.nodes).toEqual(["shape:a", "shape:b", "shape:c"]);
    await waitNode("c", (node) => node.props.currentVersionId !== null && node.props.run === undefined);
    const c = await shape("c");
    await generating.rpc.call("testCanvas.apply", { project: "board", change: { put: [{ ...c, props: { ...c.props, instruction: "changed" } }], remove: [] }, origin: { kind: "system", id: "edit" } });
    const pending = await generating.rpc.call("node.run", { project: "board", shapeId: "shape:a", downstream: true, scope: "pending" });
    expect(pending.nodes).toEqual(["shape:a", "shape:c"]);
    await waitNode("c", (node) => node.props.versions.length === 2 && node.props.run === undefined);
  });
});

