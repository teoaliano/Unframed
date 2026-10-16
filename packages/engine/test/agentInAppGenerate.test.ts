import { openRequests, type Chat } from "@unframed/domain";
import { describe, expect, it } from "vitest";
import { PROJECT, startAgentEngine, type AgentEngine } from "./agent.ts";
import { seed, toolResults } from "./agentCanvas.ts";
import { promptShape } from "./canvasRecords.ts";

const MESSAGE = "make the poster in-app";

/** The request the in-app agent opened for its generate call, once it is waiting. */
const parkedOn = async (agent: AgentEngine, chatId: string): Promise<{ chat: Chat; requestId: string; detail: string }> => {
  const chat = await (await agent.watch(chatId)).until((current) => openRequests(current, "approval").length > 0, "an approval request");
  const request = openRequests(chat, "approval")[0]!;
  const payload = request.payload as { requestId: string; detail: string };
  return { chat, requestId: payload.requestId, detail: payload.detail };
};

/** A chat whose one prompt the fixture names as `p1`, on a canvas the fixture can read. */
const started = async () => {
  const agent = await startAgentEngine();
  await seed(agent, [promptShape("p1", "100", "a poster")]);
  return agent;
};

describe("an in-app agent's generate", () => {
  it("in Supervised mode asks first, naming the medium and that the estimate is not exact, and runs only when accepted", async () => {
    const agent = await started();
    const chatId = await agent.createChat({ runtimeMode: "approval-required" });
    await agent.send(chatId, MESSAGE);
    const { chat: parked, requestId, detail } = await parkedOn(agent, chatId);
    expect(detail).toBe("Generate an image from 1 shape, with no exact estimate.");
    expect(parked.activities.find((activity) => activity.kind === "approval.requested")?.payload).toMatchObject({ requestType: "dynamic_tool_call" });
    expect(toolResults(parked, "generate")).toEqual([]);

    await agent.dispatch({ type: "thread.approval.respond", threadId: chatId, requestId, decision: "accept" });
    const chat = await agent.settled(chatId, 1);
    expect(chat.latestTurn?.state).toBe("completed");
    const [answer] = toolResults(chat, "generate");
    expect(answer?.result).toMatchObject({ dryRun: true, estimate: null, spendLimit: null });
    expect(answer?.result.prompt).toBe("a poster\n\nin snow");
  });

  it("when the person declines, the call does not run", async () => {
    const agent = await started();
    const chatId = await agent.createChat({ runtimeMode: "approval-required" });
    await agent.send(chatId, MESSAGE);
    const { requestId } = await parkedOn(agent, chatId);
    await agent.dispatch({ type: "thread.approval.respond", threadId: chatId, requestId, decision: "decline" });
    const chat = await agent.settled(chatId, 1);
    // The declined call is recorded as refused: it never reaches the run services, so no dry-run answer exists.
    const [refused] = toolResults(chat, "generate");
    expect(refused?.result).toMatchObject({ error: expect.any(String) });
    expect(refused?.result.dryRun).toBeUndefined();
    expect(chat.activities.some((activity) => activity.kind === "approval.resolved")).toBe(true);
  });

  it("in Full access it runs at once, with no request", async () => {
    const agent = await started();
    const chatId = await agent.createChat();
    await agent.send(chatId, MESSAGE);
    const chat = await agent.settled(chatId, 1);
    expect(chat.activities.some((activity) => activity.kind === "approval.requested")).toBe(false);
    expect(toolResults(chat, "generate")[0]?.result).toMatchObject({ dryRun: true });
  });
});
