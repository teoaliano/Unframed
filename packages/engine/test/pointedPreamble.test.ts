import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES, scriptFolder, startAgentEngine } from "./agent.ts";
import { seed } from "./agentCanvas.ts";
import { pageShape, screenShape } from "./canvasRecords.ts";

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

const SCREEN_CHIP = { shapeId: "shape:sc1", elementId: null, selector: "body > main > button.save", tag: "button", label: "save", excerpt: "<button>Save</button>" };

const screenScript = (expectPreamble: string) => JSON.stringify({ when: "^screen", turns: [{ text: "I can see the button.", expectPreamble }] });

const pointAtScreen = async (features: string | undefined, expectPreamble: string) => {
  const agent = await startAgentEngine({ script: await scriptFolder({ screen: screenScript(expectPreamble) }), env: { UNFRAMED_FEATURES: features } });
  await seed(agent, [screenShape("sc1", { title: "trunk", route: "/app" })]);
  const chatId = await agent.createChat();
  await agent.send(chatId, "screen: make it red", { selection: ["shape:sc1"], elements: [SCREEN_CHIP] });
  return agent.settled(chatId, 1);
};

describe("a Screen's element chips in the preamble (Screen editor)", () => {
  it("lists them under the Screen, saying each selector finds the element in the running page", async () => {
    const chat = await pointAtScreen("all", 'Screen "trunk · /app" \\(shape sc1\\), the running app; each selector finds the element in the page as it renders, not in a source file:\\n- body > main > button\\.save: <button>Save</button>$');
    expect(chat.messages.some((message) => message.text === "I can see the button.")).toBe(true);
  });
});
