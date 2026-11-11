import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES, scriptFolder, startAgentEngine } from "./agent.ts";
import { seed } from "./agentCanvas.ts";
import { pageShape } from "./canvasRecords.ts";

const CHIP = {
  shapeId: "shape:pg1",
  elementId: "hf-aaaa",
  selector: '[data-hf-id="hf-aaaa"]',
  tag: "h1",
  label: "Hi",
  excerpt: '<h1 data-hf-id="hf-aaaa">Hi</h1>',
};

describe("element chips in the preamble (spec 18)", () => {
  it("gives a turn with element chips the elements part after the selection, and keeps the chips on the stored message", async () => {
    const script = await readFile(join(FIXTURES, "pointed.json"), "utf8");
    const agent = await startAgentEngine({ script: await scriptFolder({ pointed: script }) });
    await seed(agent, [pageShape("pg1", "100", { file: "", title: "Pointed" })]);
    const chatId = await agent.createChat();
    await agent.send(chatId, "pointed at the heading", { selection: ["shape:pg1"], elements: [CHIP] });
    const chat = await agent.settled(chatId, 1);

    expect(chat.messages.some((message) => message.text === "I can see the heading you pointed at.")).toBe(true);
    const user = chat.messages.find((message) => message.role === "user");
    expect(user?.context).toEqual({ selection: ["shape:pg1"], elements: [CHIP] });
  });
});
