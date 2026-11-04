import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BRIDGE_TAG, compileComponent, COMPONENT_HELPER_TAG, compiledFileName, PLAN_NO_WRITES_MESSAGE } from "@unframed/domain";
import { describe, expect, it } from "vitest";
import { scriptFolder, startAgentEngine, type AgentEngine } from "./agent.ts";
import { roomRecords, roomShape, seed, toolResults } from "./agentCanvas.ts";
import { componentShape, pageShape } from "./canvasRecords.ts";

const BUTTON = `<!doctype html><html><head>
<script type="application/json" data-uf-component>{"tag":"uf-button","variants":{"kind":["primary","secondary"]},"props":{"label":"text"},"slots":[]}</script>
<style type="text/x-uf-component" data-uf-component-style>:host { display: inline-block; }</style>
</head><body><div data-uf-template hidden><button data-uf-prop="label">Buy</button></div></body></html>`;

const CARD = BUTTON.replace('"tag":"uf-button"', '"tag":"uf-card"');
const TILE = BUTTON.replace('"tag":"uf-button"', '"tag":"uf-tile"');
const NO_STYLE = BUTTON.replace(/<style[\s\S]*?<\/style>/, "");

const script = (turns: Array<{ text?: string; tools: Array<{ name: string; input: Record<string, unknown> }> }>) =>
  scriptFolder({ components: { when: "^go", turns: turns.map((turn) => ({ text: turn.text ?? "Done.", tools: turn.tools })) } });

const run = async (agent: AgentEngine, options: { interactionMode?: "plan" } = {}) => {
  const chatId = await agent.createChat(options.interactionMode === undefined ? {} : { interactionMode: options.interactionMode });
  await agent.send(chatId, "go", {});
  return { chatId, chat: await agent.settled(chatId, 1) };
};

const sheets = async (agent: AgentEngine) => (await readdir(agent.folder)).filter((name) => name.endsWith(".html")).sort();

describe("component_write", () => {
  it("creates a component shape with the default title from its tag, its sheet, compiled file, sidecar and the bridge and helper tags", async () => {
    const agent = await startAgentEngine({ script: await script([{ tools: [{ name: "component_write", input: { html: BUTTON } }] }]) });
    const { chatId, chat } = await run(agent);
    const [write] = toolResults(chat, "component_write");
    expect(write?.status).toBe("completed");
    const created = (await roomRecords(agent)).find((record) => record.type === "component");
    expect(created).toMatchObject({ type: "component", props: { w: 480, h: 320, title: "Button", fileName: "", tag: "uf-button" } });
    const file = created?.props.file as string;
    expect(file).toMatch(/^\d+-button\.html$/);
    const html = await readFile(join(agent.folder, file), "utf8");
    expect(html).toContain(BRIDGE_TAG);
    expect(html).toContain(COMPONENT_HELPER_TAG);
    const compiled = compiledFileName(file);
    expect(await readFile(join(agent.folder, compiled), "utf8")).toBe(compileComponent(html, file));
    expect(JSON.parse(await readFile(join(agent.folder, file.replace(/\.html$/, ".json")), "utf8"))).toMatchObject({
      source: "agent",
      kind: "component",
      tag: "uf-button",
      compiled,
      chatId,
      turn: 1,
      shapeId: null,
      title: "Button",
    });
    expect(write?.result).toMatchObject({ ok: true, shapeId: created?.id.replace("shape:", ""), file, tag: "uf-button", title: "Button", usedBy: [] });
  });

  it("takes the title the agent gives", async () => {
    const agent = await startAgentEngine({ script: await script([{ tools: [{ name: "component_write", input: { html: BUTTON, title: "Pricing button" } }] }]) });
    await run(agent);
    expect((await roomRecords(agent)).find((record) => record.type === "component")?.props.title).toBe("Pricing button");
  });

  it("reverts with the turn: the shape goes and the files stay", async () => {
    const agent = await startAgentEngine({ script: await script([{ tools: [{ name: "component_write", input: { html: BUTTON } }] }]) });
    const { chatId } = await run(agent);
    const file = (await roomRecords(agent)).find((record) => record.type === "component")?.props.file as string;
    await agent.dispatch({ type: "thread.turn.revert", threadId: chatId, turnCount: 1 });
    await (await agent.watch(chatId)).until((current) => current.turns[0]?.reverted !== undefined, "the revert");
    expect((await roomRecords(agent)).some((record) => record.type === "component")).toBe(false);
    expect(existsSync(join(agent.folder, file))).toBe(true);
  });

  it("with shapeId writes a new version and points the shape at it, and keeps a title the person gave", async () => {
    const agent = await startAgentEngine({
      script: await script([{ tools: [{ name: "component_write", input: { shapeId: "c1", html: BUTTON.replace("Buy", "Buy now"), title: "Other" } }] }]),
    });
    await writeFile(join(agent.folder, "1-button.html"), BUTTON);
    await seed(agent, [componentShape("c1", "uf-button", { file: "1-button.html", title: "Pricing" })]);
    const { chat } = await run(agent);
    const [write] = toolResults(chat, "component_write");
    const shape = await roomShape(agent, "c1");
    expect(shape.props.file).not.toBe("1-button.html");
    expect(shape.props.title).toBe("Pricing");
    expect(write?.result).toMatchObject({ ok: true, shapeId: "c1", file: shape.props.file, title: "Pricing", tag: "uf-button" });
    expect(await readFile(join(agent.folder, "1-button.html"), "utf8")).toBe(BUTTON);
    expect(JSON.parse(await readFile(join(agent.folder, (shape.props.file as string).replace(/\.html$/, ".json")), "utf8"))).toMatchObject({ shapeId: "c1" });
  });

  it("refuses each bad write through the tool, writing nothing", async () => {
    const agent = await startAgentEngine({
      script: await script([
        {
          tools: [
            { name: "component_write", input: { html: "   " } },
            { name: "component_write", input: { shapeId: "nope", html: BUTTON } },
            { name: "component_write", input: { shapeId: "pg1", html: BUTTON } },
            { name: "component_write", input: { shapeId: "c1", html: TILE } },
            { name: "component_write", input: { html: CARD } },
            { name: "component_write", input: { html: NO_STYLE } },
          ],
        },
      ]),
    });
    await seed(agent, [componentShape("c1", "uf-button", { file: "" }), componentShape("c2", "uf-card", { file: "" }, { y: 500 }), pageShape("pg1", "100")]);
    const before = await sheets(agent);
    const { chat } = await run(agent);
    expect(toolResults(chat, "component_write").map((result) => [result.status, result.result])).toEqual([
      ["failed", { error: "html must be a non-empty string" }],
      ["failed", { error: "no shape nope" }],
      ["failed", { error: "shape pg1 is a page, not a component" }],
      ["failed", { error: "component c1 is uf-button; a component keeps its tag" }],
      ["failed", { error: "uf-card is already the component c2; write to that shape, or choose another tag" }],
      ["failed", { error: 'a component sheet needs one <style type="text/x-uf-component" data-uf-component-style>' }],
    ]);
    expect(await sheets(agent)).toEqual(before);
  });

  it("refuses a write in plan mode with the plan sentence", async () => {
    const agent = await startAgentEngine({ script: await script([{ tools: [{ name: "component_write", input: { html: BUTTON } }] }]) });
    const { chat } = await run(agent, { interactionMode: "plan" });
    expect(toolResults(chat, "component_write")[0]).toMatchObject({ status: "failed", result: { error: PLAN_NO_WRITES_MESSAGE } });
    expect((await roomRecords(agent)).some((record) => record.type === "component")).toBe(false);
  });
});

describe("component_read", () => {
  it("returns the current sheet's HTML, and refuses an unknown shape, a wrong kind and an unreadable file", async () => {
    const reads = ["c1", "nope", "pg1", "c2"];
    const agent = await startAgentEngine({
      script: await script(reads.map((shapeId) => ({ tools: [{ name: "component_read", input: { shapeId } }] }))),
    });
    await writeFile(join(agent.folder, "1-button.html"), BUTTON);
    await seed(agent, [componentShape("c1", "uf-button", { file: "1-button.html", title: "Button" }), pageShape("pg1", "100"), componentShape("c2", "uf-card", { file: "gone.html" }, { y: 500 })]);
    const chatId = await agent.createChat();
    for (let read = 1; read <= reads.length; read++) {
      await agent.send(chatId, "go", {});
      await agent.settled(chatId, read);
    }
    const chat = await agent.settled(chatId, reads.length);
    const results = toolResults(chat, "component_read").map((result) => [result.status, result.result]);
    expect(results).toEqual([
      ["completed", { shapeId: "c1", title: "Button", file: "1-button.html", html: BUTTON }],
      ["failed", { error: "no shape nope" }],
      ["failed", { error: "shape pg1 is a page, not a component" }],
      ["failed", { error: "the file gone.html could not be read" }],
    ]);
  });
});
