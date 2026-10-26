import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scriptFolder, startAgentEngine, type AgentEngine } from "./agent.ts";
import { roomRecords, roomShape, seed, toolResults } from "./agentCanvas.ts";
import { groupShape, pageShape, styleShape } from "./canvasRecords.ts";

const LINEAR = "# Linear\n\nCalm and dense. Accent #5E6AD2 on #08090a.\n";
const STRIPE = "# Stripe\n\nBright gradients. #635bff\n";

type Tool = { name: string; input: Record<string, unknown> };

const script = (turns: Array<{ text?: string; tools?: Tool[]; expectPreamble?: string }>) =>
  scriptFolder({ styles: { when: "^go", turns: turns.map((turn) => ({ text: turn.text ?? "Done.", tools: turn.tools ?? [], ...(turn.expectPreamble ? { expectPreamble: turn.expectPreamble } : {}) })) } });

const styleFiles = async (agent: AgentEngine) => (await readdir(agent.folder)).filter((name) => /\.md$/.test(name)).sort();

const seedLinear = async (agent: AgentEngine, extra: Parameters<typeof seed>[1] = []) => {
  await writeFile(join(agent.folder, "1-linear.md"), LINEAR);
  await seed(agent, [styleShape("s1", "100", { file: "1-linear.md", title: "Linear" }), ...extra]);
};

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

describe("style_write", () => {
  it("creates a style beside the selection with a new markdown file, its agent sidecar and its card", async () => {
    const agent = await startAgentEngine({ script: await script([{ tools: [{ name: "style_write", input: { title: "Linear", markdown: LINEAR } }] }]) });
    await seed(agent, [pageShape("pg1", "100", {}, { x: 0, y: 40 })]);
    const chatId = await agent.createChat();
    await agent.send(chatId, "go", { selection: ["shape:pg1"] });
    const chat = await agent.settled(chatId, 1);
    expect(toolResults(chat, "style_write")[0]).toMatchObject({ status: "completed", result: { ok: true, title: "Linear" } });
    const style = (await roomRecords(agent)).find((record) => record.type === "style");
    expect(style).toMatchObject({ x: 540, y: 40, props: { w: 320, h: 240, title: "Linear", fileName: "", swatches: ["#5e6ad2", "#08090a"], excerpt: "Calm and dense. Accent #5E6AD2 on #08090a." }, meta: { ref: expect.stringMatching(/^\d+$/) } });
    expect(style.props.file).toMatch(/^\d+-linear\.md$/);
    expect(await readFile(join(agent.folder, style.props.file), "utf8")).toBe(LINEAR);
    expect(JSON.parse(await readFile(join(agent.folder, style.props.file.replace(/\.md$/, ".json")), "utf8"))).toEqual({
      source: "agent",
      kind: "style",
      chatId,
      turn: 1,
      shapeId: null,
      title: "Linear",
      bytes: Buffer.byteLength(LINEAR),
      at: expect.stringMatching(/^\d{4}-/),
    });
  });

  it("refuses a document over 100 KiB, an empty one and a shape that is not a style, writing nothing", async () => {
    const agent = await startAgentEngine({
      script: await script([
        {
          tools: [
            { name: "style_write", input: { markdown: "a".repeat(102_401) } },
            { name: "style_write", input: { markdown: " " } },
            { name: "style_write", input: { shapeId: "pg1", markdown: "# x" } },
          ],
        },
      ]),
    });
    await seed(agent, [pageShape("pg1", "100")]);
    const chatId = await agent.createChat();
    await agent.send(chatId, "go");
    const chat = await agent.settled(chatId, 1);
    expect(toolResults(chat, "style_write").map((result) => result.result.error)).toEqual([
      "A style document is at most 100 KiB of markdown. Nothing was written.",
      "markdown must be a non-empty string",
      "shape pg1 is a page, not a style",
    ]);
    expect(await styleFiles(agent)).toEqual([]);
  });
});

describe("style_edit and style_read", () => {
  it("reads the text, then writes the edit as a new version and leaves the old file; Revert points the shape back", async () => {
    const agent = await startAgentEngine({
      script: await script([
        {
          tools: [
            { name: "style_read", input: { shapeId: "s1" } },
            { name: "style_edit", input: { shapeId: "s1", edits: [{ old_string: "#5E6AD2", new_string: "#ff0000" }] } },
          ],
        },
      ]),
    });
    await seedLinear(agent);
    const chatId = await agent.createChat();
    await agent.send(chatId, "go");
    const chat = await agent.settled(chatId, 1);
    expect(toolResults(chat, "style_read")[0]?.result).toEqual({ shapeId: "s1", title: "Linear", file: "1-linear.md", markdown: LINEAR });
    const shape = await roomShape(agent, "s1");
    expect(shape.props.file).toMatch(/^\d+-linear\.md$/);
    expect(shape.props.file).not.toBe("1-linear.md");
    expect(shape.props.swatches).toEqual(["#ff0000", "#08090a"]);
    expect(await readFile(join(agent.folder, shape.props.file), "utf8")).toBe(LINEAR.replace("#5E6AD2", "#ff0000"));
    expect(await readFile(join(agent.folder, "1-linear.md"), "utf8")).toBe(LINEAR);
    expect(JSON.parse(await readFile(join(agent.folder, shape.props.file.replace(/\.md$/, ".json")), "utf8"))).toMatchObject({ kind: "style", shapeId: "s1" });

    await agent.dispatch({ type: "thread.turn.revert", threadId: chatId, turnCount: 1 });
    await (await agent.watch(chatId)).until((current) => current.turns[0]?.reverted !== undefined, "the revert");
    expect((await roomShape(agent, "s1")).props.file).toBe("1-linear.md");
  });

  it("allows a read in plan mode and refuses a write and an edit there", async () => {
    const agent = await startAgentEngine({
      script: await script([
        {
          tools: [
            { name: "style_read", input: { shapeId: "s1" } },
            { name: "style_write", input: { markdown: "# New" } },
            { name: "style_edit", input: { shapeId: "s1", edits: [{ old_string: "Calm", new_string: "Loud" }] } },
          ],
        },
      ]),
    });
    await seedLinear(agent);
    const chatId = await agent.createChat({ interactionMode: "plan" });
    await agent.send(chatId, "go");
    const chat = await agent.settled(chatId, 1);
    expect(toolResults(chat, "style_read")[0]).toMatchObject({ status: "completed", result: { markdown: LINEAR } });
    const refusal = "Plan mode changes nothing, so this write did not happen; put the change in your plan instead.";
    expect(toolResults(chat, "style_write")[0]).toMatchObject({ status: "failed", result: { error: refusal } });
    expect(toolResults(chat, "style_edit")[0]).toMatchObject({ status: "failed", result: { error: refusal } });
    expect(await styleFiles(agent)).toEqual(["1-linear.md"]);
  });
});

describe("a chat's style", () => {
  const line = (id: string, title: string, file: string) =>
    `This chat follows the style "${title}" (style ${id}, file ${file}). Read it with style_read before designing if it is not in your context or the file changed.`;

  it("is attached by a message sent with it selected, inside a selected group too, and every later preamble names it", async () => {
    const agent = await startAgentEngine({
      script: await script([
        { expectPreamble: `^Selected: group g1, style s1 \\("Linear"\\)\\.\\n\\n${escape(line("s1", "Linear", "1-linear.md"))}$` },
        { expectPreamble: `^${escape(line("s1", "Linear", "1-linear.md"))}$` },
      ]),
    });
    await writeFile(join(agent.folder, "1-linear.md"), LINEAR);
    await seed(agent, [groupShape("g1", "brand", { x: 0, y: 0 }), styleShape("s1", "100", { file: "1-linear.md", title: "Linear" }, { x: 30, y: 60, parentId: "shape:g1" })]);
    const chatId = await agent.createChat();
    await agent.send(chatId, "go", { selection: ["shape:g1", "shape:s1"] });
    let chat = await agent.settled(chatId, 1);
    expect(chat.session?.lastError ?? null).toBeNull();
    expect(chat.style).toBe("shape:s1");
    expect(chat.activities.find((activity) => activity.kind === "style.attached")).toMatchObject({ summary: "Following the style “Linear”", turnId: chat.turns[0]!.turnId });
    await agent.send(chatId, "go on");
    chat = await agent.settled(chatId, 2);
    expect(chat.session?.lastError ?? null).toBeNull();
    expect(chat.latestTurn?.state).toBe("completed");
  });

  it("is replaced by a second style, which the work log names, and is gone after Detach until Undo puts it back", async () => {
    const agent = await startAgentEngine({ script: await script([{}, {}]) });
    await writeFile(join(agent.folder, "2-stripe.md"), STRIPE);
    await seedLinear(agent, [styleShape("s2", "101", { file: "2-stripe.md", title: "Stripe" }, { x: 400 })]);
    const chatId = await agent.createChat();
    await agent.send(chatId, "go", { selection: ["shape:s1"] });
    await agent.settled(chatId, 1);
    await agent.send(chatId, "go again", { selection: ["shape:s2"] });
    let chat = await agent.settled(chatId, 2);
    expect(chat.style).toBe("shape:s2");
    expect(chat.activities.filter((activity) => activity.kind === "style.attached").map((activity) => activity.summary)).toEqual([
      "Following the style “Linear”",
      "Following the style “Stripe” in place of “Linear”",
    ]);

    await agent.dispatch({ type: "thread.style.remove", threadId: chatId, styleId: "shape:s2" });
    chat = await (await agent.watch(chatId)).until((current) => current.style === null, "the detach");
    await expect(agent.dispatch({ type: "thread.style.set", threadId: chatId, styleId: "shape:gone" })).rejects.toMatchObject({ message: "That style is no longer on the canvas." });
    await agent.dispatch({ type: "thread.style.set", threadId: chatId, styleId: "shape:s2" });
    chat = await (await agent.watch(chatId)).until((current) => current.style === "shape:s2", "the undo");
    expect(chat.style).toBe("shape:s2");
  });

  it("is never a document: a selected document is listed as one for style_read and canvas_read, and a style turned into a document drops out", async () => {
    const NOTES = "# Standup notes\n\n- Ship the card by Friday\n";
    const agent = await startAgentEngine({
      script: await script([
        { expectPreamble: '^Selected: document d1 \\("Notes"\\)\\.$', tools: [{ name: "style_read", input: { shapeId: "d1" } }, { name: "canvas_read", input: {} }] },
        { expectPreamble: `^Selected: style s1 \\("Linear"\\)\\.\\n\\n${escape(line("s1", "Linear", "1-linear.md"))}$` },
        { expectPreamble: "^(?![\\s\\S]*follows the style)" },
      ]),
    });
    await writeFile(join(agent.folder, "2-notes.md"), NOTES);
    await seedLinear(agent, [styleShape("d1", "101", { file: "2-notes.md", title: "Notes", role: "document" }, { x: 400 })]);
    const chatId = await agent.createChat();
    await agent.send(chatId, "go", { selection: ["shape:d1"] });
    let chat = await agent.settled(chatId, 1);
    expect(chat.session?.lastError ?? null).toBeNull();
    expect(chat.style).toBeNull();
    expect(chat.activities.filter((activity) => activity.kind === "style.attached")).toHaveLength(0);
    expect(toolResults(chat, "style_read")[0]?.result).toEqual({ shapeId: "d1", title: "Notes", file: "2-notes.md", markdown: NOTES });
    const shapes = new Map(((toolResults(chat, "canvas_read")[0]?.result.shapes ?? []) as any[]).map((shape) => [shape.id, shape]));
    expect(shapes.get("d1")).toMatchObject({ kind: "document", file: "2-notes.md", title: "Notes" });
    expect(shapes.get("s1")).toMatchObject({ kind: "style" });

    await agent.send(chatId, "go style", { selection: ["shape:s1"] });
    chat = await agent.settled(chatId, 2);
    expect(chat.session?.lastError ?? null).toBeNull();
    expect(chat.style).toBe("shape:s1");
    const linear = await roomShape(agent, "s1");
    await seed(agent, [{ ...linear, props: { ...linear.props, role: "document" } }]);
    await agent.send(chatId, "go on");
    chat = await agent.settled(chatId, 3);
    expect(chat.session?.lastError ?? null).toBeNull();
    expect(chat.latestTurn?.state).toBe("completed");
  });

  it("is recorded on a page written in the chat, in its props and its sidecar, and canvas_read reports it", async () => {
    const agent = await startAgentEngine({
      script: await script([
        { tools: [{ name: "page_write", input: { title: "Home", html: "<html><body>Hi</body></html>" } }] },
        { tools: [{ name: "canvas_read", input: {} }] },
      ]),
    });
    await seedLinear(agent);
    const chatId = await agent.createChat();
    await agent.send(chatId, "go", { selection: ["shape:s1"] });
    await agent.settled(chatId, 1);
    const page = (await roomRecords(agent)).find((record) => record.type === "page");
    expect(page.props.style).toBe("shape:s1");
    expect(JSON.parse(await readFile(join(agent.folder, page.props.file.replace(/\.html$/, ".json")), "utf8"))).toMatchObject({
      kind: "page",
      style: { shapeId: "s1", file: "1-linear.md" },
    });
    await agent.send(chatId, "go read");
    const chat = await agent.settled(chatId, 2);
    const shapes = new Map(((toolResults(chat, "canvas_read")[0]?.result.shapes ?? []) as any[]).map((shape) => [shape.id, shape]));
    expect(shapes.get(page.id.slice("shape:".length))).toMatchObject({ kind: "page", style: "s1" });
    expect(shapes.get("s1")).toEqual({ id: "s1", kind: "style", x: 0, y: 0, w: 320, h: 240, ref: "100", file: "1-linear.md", title: "Linear" });
  });
});

describe("style.write", () => {
  it("saves the person's version as a new file with its sidecar and answers the card, refusing an oversized one", async () => {
    const agent = await startAgentEngine();
    const saved = await agent.rpc.call("style.write", { project: "board", markdown: STRIPE, title: "Stripe", shapeId: "shape:s2", of: "2-stripe.md" });
    expect(saved).toMatchObject({ file: expect.stringMatching(/^\d+-stripe\.md$/), bytes: Buffer.byteLength(STRIPE), swatches: ["#635bff"], excerpt: "Bright gradients. #635bff" });
    expect(await readFile(join(agent.folder, saved.file), "utf8")).toBe(STRIPE);
    expect(JSON.parse(await readFile(join(agent.folder, saved.file.replace(/\.md$/, ".json")), "utf8"))).toMatchObject({ source: "person", kind: "style", shapeId: "s2", of: "2-stripe.md", title: "Stripe" });
    await expect(agent.rpc.call("style.write", { project: "board", markdown: "a".repeat(102_401), title: "Big" })).rejects.toMatchObject({ code: "bad_request" });
  });
});
