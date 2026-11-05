import { openRequests, type Chat } from "@unframed/domain";
import { describe, expect, it } from "vitest";
import { scriptFolder, startAgentEngine, type AgentEngine } from "./agent.ts";
import { seed, toolResults } from "./agentCanvas.ts";
import { nodeShape, wireShape } from "./nodeRecords.ts";

const parkedOn = async (agent: AgentEngine, chatId: string): Promise<{ chat: Chat; requestId: string; detail: string }> => {
  const chat = await (await agent.watch(chatId)).until((current) => openRequests(current, "approval").length > 0, "an approval request");
  const request = openRequests(chat, "approval")[0]!;
  const payload = request.payload as { requestId: string; detail: string };
  return { chat, requestId: payload.requestId, detail: payload.detail };
};

const started = async () => {
  const agent = await startAgentEngine({
    script: await scriptFolder({ nodes: { when: "^run the chain", turns: [{ text: "Priced it.", tools: [{ name: "node_run", input: { ids: ["a"], downstream: true, dryRun: true } }] }] } }),
  });
  await seed(agent, [nodeShape("a", "100", { medium: "text", instruction: "write" }), nodeShape("b", "101", { medium: "text" }, { x: 500 }), wireShape("ab", "a", "b", "prompt")]);
  return agent;
};

describe("an in-app agent's node_run", () => {
  it("in Supervised mode asks once for the whole chain, naming its steps, and runs only when accepted", async () => {
    const agent = await started();
    const chatId = await agent.createChat({ runtimeMode: "approval-required" });
    await agent.send(chatId, "run the chain");
    const { chat: parked, requestId, detail } = await parkedOn(agent, chatId);
    expect(detail).toBe("Run a chain of 2 nodes (@100, @101), with no exact estimate.");
    expect(toolResults(parked, "node_run")).toEqual([]);
    await agent.dispatch({ type: "thread.approval.respond", threadId: chatId, requestId, decision: "accept" });
    const chat = await agent.settled(chatId, 1);
    const [answer] = toolResults(chat, "node_run");
    expect(answer?.result).toMatchObject({ dryRun: true, estimate: null, spendLimit: null, steps: [{ node: "a" }, { node: "b" }] });
    expect(openRequests(chat, "approval")).toEqual([]);
  });

  it("in plan mode is refused, writing nothing", async () => {
    const agent = await started();
    const chatId = await agent.createChat({ interactionMode: "plan" });
    await agent.send(chatId, "run the chain");
    const chat = await agent.settled(chatId, 1);
    expect(toolResults(chat, "node_run")[0]?.result).toMatchObject({ error: expect.stringContaining("Plan mode changes nothing") });
  });
});
