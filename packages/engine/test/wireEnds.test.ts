import { describe, expect, it } from "vitest";
import { scriptFolder, startAgentEngine } from "./agent.ts";
import { roomRecords, seed } from "./agentCanvas.ts";
import { nodeShape, wireShape } from "./nodeRecords.ts";

describe("wires whose end is gone", () => {
  it("go when Revert this turn removes the shape that fed them, though the person drew the wire", async () => {
    const agent = await startAgentEngine({
      script: await scriptFolder({ wires: { when: "^add", turns: [{ text: "Added.", tools: [{ name: "canvas_write", input: { ops: [{ type: "create", id: "fed", kind: "prompt", x: 0, y: 0, props: { text: "a fox" } }] } }] }] } }),
    });
    await seed(agent, [nodeShape("n", "201", { medium: "image" }, { x: 600 })]);
    const chatId = await agent.createChat();
    await agent.send(chatId, "add a prompt");
    await agent.settled(chatId, 1);
    await seed(agent, [wireShape("w", "fed", "n", "prompt")]);
    expect((await roomRecords(agent)).some((record) => record.id === "shape:w")).toBe(true);
    await agent.dispatch({ type: "thread.turn.revert", threadId: chatId, turnCount: 1 });
    await (await agent.watch(chatId)).until((current) => current.turns[0]?.reverted !== undefined, "the revert");
    const started = Date.now();
    while ((await roomRecords(agent)).some((record) => record.id === "shape:w")) {
      if (Date.now() - started > 5000) throw new Error("the wire stayed after its source went");
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect((await roomRecords(agent)).some((record) => record.id === "shape:fed")).toBe(false);
  });

  it("go when any change removes a node, from whatever source", async () => {
    const agent = await startAgentEngine();
    await seed(agent, [nodeShape("a", "201", { medium: "text" }), nodeShape("b", "202", { medium: "text" }, { x: 600 }), wireShape("w", "a", "b", "prompt")]);
    await agent.rpc.call("testCanvas.apply", { project: "board", change: { put: [], remove: ["shape:a"] }, origin: { kind: "server", id: "elsewhere" } });
    const started = Date.now();
    while ((await roomRecords(agent)).some((record) => record.id === "shape:w")) {
      if (Date.now() - started > 5000) throw new Error("the wire stayed");
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  });
});
