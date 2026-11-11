import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PROJECT, scriptFolder, startAgentEngine, UNFRAMED_TOOLS, type AgentEngine } from "./agent.ts";
import { roomRecords, seed, toolResults } from "./agentCanvas.ts";
import { componentShape, pageShape } from "./canvasRecords.ts";
import { outsideLink } from "./outsideCalls.ts";

const BUTTON = `<!doctype html><html><head>
<script type="application/json" data-uf-component>{"tag":"uf-button","variants":{"kind":["primary","secondary"]},"props":{"label":"text"},"slots":[]}</script>
<style type="text/x-uf-component" data-uf-component-style>:host { display: inline-block; }</style>
</head><body><div data-uf-template hidden><button data-uf-prop="label">Buy</button></div></body></html>`;

const PAGE = `<!doctype html><html><head><script src="1-button.component.js" data-uf-component="uf-button"></script></head><body><uf-button kind="secondary"></uf-button></body></html>`;

type Call = { name: string; input: Record<string, unknown> };

const scripted = async (turns: Call[][]): Promise<AgentEngine> =>
  startAgentEngine({
    script: await scriptFolder({ components: { when: "^go", turns: turns.map((tools) => ({ text: "Done.", tools })) } }),
  });

const turn = async (agent: AgentEngine, chatId: string, number: number) => {
  await agent.send(chatId, "go", {});
  return agent.settled(chatId, number);
};

describe("canvas_read and canvas_write with components", () => {
  it("lists a component with its tag, variants, properties, slots and compiled file, and a page's components", async () => {
    const agent = await scripted([[{ name: "canvas_read", input: {} }]]);
    await writeFile(join(agent.folder, "1-button.html"), BUTTON);
    await writeFile(join(agent.folder, "2-landing.html"), PAGE);
    await writeFile(join(agent.folder, "3-older.html"), PAGE.replace("1-button", "0-button"));
    await seed(agent, [
      componentShape("c1", "uf-button", { file: "1-button.html", title: "Button" }),
      pageShape("pg1", "100", { file: "2-landing.html", title: "Landing" }, { y: 400 }),
      pageShape("pg2", "101", { file: "3-older.html", title: "Older" }, { y: 800 }),
    ]);
    const chatId = await agent.createChat();
    const chat = await turn(agent, chatId, 1);
    const [read] = toolResults(chat, "canvas_read");
    const shapes = (read?.result as { shapes: Array<Record<string, unknown>> }).shapes;
    expect(shapes.find((shape) => shape.id === "c1")).toMatchObject({
      kind: "component",
      title: "Button",
      tag: "uf-button",
      file: "1-button.html",
      compiled: "1-button.component.js",
      variants: { kind: ["primary", "secondary"] },
      props: { label: "text" },
      slots: [],
    });
    expect(shapes.find((shape) => shape.id === "pg1")).toMatchObject({
      kind: "page",
      components: [{ tag: "uf-button", sheet: "1-button.html", current: true }],
    });
    expect(shapes.find((shape) => shape.id === "pg2")).toMatchObject({
      components: [{ tag: "uf-button", sheet: "0-button.html", current: false }],
    });
  });

  it("refuses to create a component or to write its tag or file through canvas_write", async () => {
    const agent = await scripted([
      [{ name: "canvas_write", input: { ops: [{ type: "create", kind: "component", id: "new:c", x: 0, y: 0 }] } }],
      [{ name: "canvas_write", input: { ops: [{ type: "update", id: "c1", props: { tag: "uf-other" } }] } }],
      [{ name: "canvas_write", input: { ops: [{ type: "update", id: "c1", props: { file: "1-button.html" } }] } }],
    ]);
    await writeFile(join(agent.folder, "1-button.html"), BUTTON);
    await seed(agent, [componentShape("c1", "uf-button", { file: "1-button.html", title: "Button" })]);
    const chatId = await agent.createChat();
    await turn(agent, chatId, 1);
    await turn(agent, chatId, 2);
    const chat = await turn(agent, chatId, 3);
    const results = toolResults(chat, "canvas_write").map((result) => [result.status, result.result]);
    expect(results).toEqual([
      ["failed", { error: "create: make components with component_write" }],
      ["failed", { error: "update: tag is written by component_write" }],
      ["failed", { error: "update: file is written by component_write" }],
    ]);
    const shape = (await roomRecords(agent)).find((record) => record.id === "shape:c1");
    expect(shape.props).toMatchObject({ tag: "uf-button", file: "1-button.html" });
  });

  it("still moves and renames a component through canvas_write", async () => {
    const agent = await scripted([[{ name: "canvas_write", input: { ops: [{ type: "move", id: "c1", x: 40, y: 50 }, { type: "rename", id: "c1", name: "btn" }] } }]]);
    await writeFile(join(agent.folder, "1-button.html"), BUTTON);
    await seed(agent, [componentShape("c1", "uf-button", { file: "1-button.html", title: "Button" })]);
    const chatId = await agent.createChat();
    const chat = await turn(agent, chatId, 1);
    expect(toolResults(chat, "canvas_write")[0]).toMatchObject({ status: "completed" });
    const shape = (await roomRecords(agent)).find((record) => record.id === "shape:c1");
    expect(shape).toMatchObject({ x: 40, y: 50, meta: { ref: "btn" } });
  });
});

describe("components on the outside list", () => {
  it("lists both component tools with a required project, as in-app", async () => {
    const agent = await startAgentEngine();
    const link = await outsideLink(agent);
    const session = await link.open();
    const tools = await link.list(session);
    expect(tools.map((tool) => tool.name)).toEqual(["projects_list", ...UNFRAMED_TOOLS, "canvas_select", "canvas_snapshot", "chat_note", "file_add"]);
    for (const name of ["component_write", "component_read"]) {
      expect(tools.find((tool) => tool.name === name)!.inputSchema.required).toContain("project");
    }
  });

  it("answers component_read and component_write the way the in-app tools do", async () => {
    const agent = await startAgentEngine();
    await writeFile(join(agent.folder, "1-button.html"), BUTTON);
    await seed(agent, [componentShape("c1", "uf-button", { file: "1-button.html", title: "Button" })]);
    const link = await outsideLink(agent);
    const session = await link.open();
    const read = await link.call(session, "component_read", { project: PROJECT, shapeId: "c1" });
    expect(read).toMatchObject({ isError: false, value: { shapeId: "c1", title: "Button", file: "1-button.html", html: BUTTON } });
    const written = await link.call(session, "component_write", { project: PROJECT, html: BUTTON.replace("uf-button", "uf-tile"), title: "Pricing" });
    expect(written).toMatchObject({ isError: false, value: { ok: true, tag: "uf-tile", title: "Pricing" } });
    const shape = (await roomRecords(agent)).find((record) => record.id === `shape:${written.value.shapeId}`);
    expect(shape).toMatchObject({ type: "component", props: { tag: "uf-tile", title: "Pricing" } });
  });
});
