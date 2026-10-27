import { describe, expect, it } from "vitest";
import { scriptFolder, startAgentEngine, type AgentEngine } from "./agent.ts";
import { roomRecords, seed, toolResults } from "./agentCanvas.ts";
import { pageShape } from "./canvasRecords.ts";

const KIT_TURN = [{ name: "kit_write", input: { ops: [{ op: "create", name: "Brand", modes: ["light", "dark"] }, { op: "setToken", path: "color/brand/primary", type: "color", values: { light: "#1a73e8", dark: "#8ab4f8" } }] } }];

const KIT_OPS = [
  { op: "create", name: "Brand", modes: ["light", "dark"] },
  { op: "setToken", path: "color/brand/primary", type: "color", values: { light: "#1a73e8", dark: "#8ab4f8" } },
];

const script = (turns: Array<Array<{ name: string; input: Record<string, unknown> }>>) =>
  scriptFolder({ kits: { when: "^go", turns: turns.map((tools) => ({ text: "Done.", tools })) } });

/** Runs one scripted turn in a new chat and answers the chat. */
const runTurn = async (agent: AgentEngine, mode?: "plan") => {
  const chatId = await agent.createChat(mode === undefined ? {} : { interactionMode: mode });
  await agent.send(chatId, "go", {});
  return agent.settled(chatId, 1);
};

const kitOnRoom = async (agent: AgentEngine) => (await roomRecords(agent)).find((record) => record.typeName === "document")?.meta?.unframed?.kit ?? null;

describe("kit_read and kit_write (spec 19, task 11)", () => {
  it("answers no kit before one exists, then writes the kit and reads back its tokens with their CSS names", async () => {
    const agent = await startAgentEngine({
      script: await script([
        [{ name: "kit_read", input: {} }],
        [{ name: "kit_write", input: { ops: KIT_OPS } }],
        [{ name: "kit_read", input: {} }],
      ]),
    });
    await seed(agent, []);
    const chatId = await agent.createChat();
    await agent.send(chatId, "go", {});
    await agent.settled(chatId, 1);
    await agent.send(chatId, "go", {});
    await agent.settled(chatId, 2);
    await agent.send(chatId, "go", {});
    const chat = await agent.settled(chatId, 3);
    const [first, write, last] = [toolResults(chat, "kit_read")[0], toolResults(chat, "kit_write")[0], toolResults(chat, "kit_read")[1]];
    expect(first?.result).toEqual({ kit: null });
    expect(write?.result).toEqual({ ok: true, tokens: 1, modes: ["light", "dark"], clock: expect.any(Number) });
    expect(last?.result).toMatchObject({
      name: "Brand",
      modes: ["light", "dark"],
      defaultMode: "light",
      tokens: [{ path: "color/brand/primary", css: "--color-brand-primary", type: "color", values: { light: "#1a73e8", dark: "#8ab4f8" } }],
    });
    expect(await kitOnRoom(agent)).toMatchObject({ name: "Brand", modes: ["light", "dark"] });
    expect(write?.status).toBe("completed");
  });

  it("refuses all of a batch when one op breaks a rule, naming the op, and writes nothing", async () => {
    const agent = await startAgentEngine({
      script: await script([[{ name: "kit_write", input: { ops: [...KIT_OPS, { op: "setToken", path: "color/bad", type: "color", value: "#12345" }] } }]]),
    });
    await seed(agent, []);
    const chat = await runTurn(agent);
    const [write] = toolResults(chat, "kit_write");
    expect(write?.result).toEqual({ error: "op 3: #12345 is not a colour. Use a hex value like #1a73e8, or rgb(), hsl() or oklch()." });
    expect(write?.status).toBe("failed");
    expect(await kitOnRoom(agent)).toBeNull();
  });

  it("refuses kit_write in plan mode, as the other write tools are", async () => {
    const agent = await startAgentEngine({ script: await script([[{ name: "kit_write", input: { ops: KIT_OPS } }]]) });
    await seed(agent, []);
    const chat = await runTurn(agent, "plan");
    expect(toolResults(chat, "kit_write")[0]?.status).not.toBe("completed");
    expect(await kitOnRoom(agent)).toBeNull();
  });

  it("moves the pages and motions on a renamed mode to the new name in the same write", async () => {
    const agent = await startAgentEngine({
      script: await script([
        [{ name: "kit_write", input: { ops: KIT_OPS } }],
        [{ name: "kit_write", input: { ops: [{ op: "renameMode", name: "dark", to: "night" }] } }],
      ]),
    });
    await seed(agent, [pageShape("moded", "201", { file: "1-p.html", title: "p", fileName: "p.html", mode: "dark" })]);
    const chatId = await agent.createChat();
    await agent.send(chatId, "go", {});
    await agent.settled(chatId, 1);
    await agent.send(chatId, "go", {});
    const chat = await agent.settled(chatId, 2);
    expect(toolResults(chat, "kit_write")[1]?.status).toBe("completed");
    expect((await roomRecords(agent)).find((record) => record.id === "shape:moded")).toMatchObject({ props: { mode: "night" } });
    expect(await kitOnRoom(agent)).toMatchObject({ modes: ["light", "night"] });
  });

  it("reverts a token the turn set, and leaves alone one a later turn changed", async () => {
    const red = (light: string) => [{ name: "kit_write", input: { ops: [{ op: "setToken", path: "color/brand/primary", type: "color", values: { light, dark: "#8ab4f8" } }] } }];
    const agent = await startAgentEngine({ script: await script([KIT_TURN, red("#ff0000"), red("#00ff00")]) });
    await seed(agent, []);
    const chatId = await agent.createChat();
    for (let turn = 1; turn <= 3; turn++) {
      await agent.send(chatId, "go", {});
      await agent.settled(chatId, turn);
    }
    await agent.dispatch({ type: "thread.turn.revert", threadId: chatId, turnCount: 2 });
    const chat = await (await agent.watch(chatId)).until((current) => current.turns[1]?.reverted !== undefined, "the revert");
    expect(chat.turns[1]?.reverted?.skipped).toEqual([{ id: "kit:color/brand/primary", by: "a later turn" }]);
    expect(await kitOnRoom(agent)).toMatchObject({ tokens: [{ values: { light: "#00ff00" } }] });
  });

  it("puts a token back to what the turn left before it, in one revert", async () => {
    const red = (light: string) => [{ name: "kit_write", input: { ops: [{ op: "setToken", path: "color/brand/primary", type: "color", values: { light, dark: "#8ab4f8" } }] } }];
    const agent = await startAgentEngine({ script: await script([KIT_TURN, red("#ff0000")]) });
    await seed(agent, []);
    const chatId = await agent.createChat();
    for (let turn = 1; turn <= 2; turn++) {
      await agent.send(chatId, "go", {});
      await agent.settled(chatId, turn);
    }
    await agent.dispatch({ type: "thread.turn.revert", threadId: chatId, turnCount: 2 });
    const chat = await (await agent.watch(chatId)).until((current) => current.turns[1]?.reverted !== undefined, "the revert");
    expect(chat.turns[1]?.reverted).toMatchObject({ skipped: [] });
    expect(chat.turns[1]?.reverted?.restored).toEqual(["kit:color/brand/primary"]);
    expect(await kitOnRoom(agent)).toMatchObject({ tokens: [{ values: { light: "#1a73e8" } }] });
  });
});
