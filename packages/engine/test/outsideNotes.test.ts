import { describe, expect, it } from "vitest";
import { PROJECT, startAgentEngine } from "./agent.ts";
import { chatsIn, outsideLink as outside } from "./outsideCalls.ts";

const prompt = (id: string, text: string) => ({ type: "create", id, kind: "prompt", x: 0, y: 0, props: { text } });
const SHORT = { UNFRAMED_TEST_OUTSIDE_TURN_IDLE_MS: "300" };

describe("outside agents post a note into their chat (chat_note)", () => {
  it("lands the note as the agent's message under the open outside turn, with no work log row of its own", async () => {
    const agent = await startAgentEngine({ env: SHORT });
    const link = await outside(agent);
    const session = await link.open();
    await link.call(session, "canvas_write", { project: PROJECT, ops: [prompt("new:hero", "Fox campaign: hero line")] });
    const posted = await link.call(session, "chat_note", { project: PROJECT, text: "Added a **hero line** prompt.\n\n- Check its wording." });
    expect(posted).toMatchObject({ isError: false, value: { posted: true } });

    const [summary] = await chatsIn(agent);
    const chat = await agent.settled(summary!.id, 1);
    expect(chat.turns).toHaveLength(1);
    const turnId = chat.latestTurn!.turnId;
    expect(chat.messages).toEqual([expect.objectContaining({ role: "assistant", text: "Added a **hero line** prompt.\n\n- Check its wording.", turnId, streaming: false })]);
    const toolNames = chat.activities.filter((activity) => activity.kind.startsWith("tool.")).map((activity) => (activity.payload as { data: { toolName: string } }).data.toolName);
    expect(toolNames).toEqual(["mcp__unframed__canvas_write", "mcp__unframed__canvas_write"]);
  });

  it("opens a turn for a note that comes after the last one settled, so a revert of the earlier turn leaves it alone", async () => {
    const agent = await startAgentEngine({ env: SHORT });
    const link = await outside(agent);
    const session = await link.open();
    await link.call(session, "canvas_read", { project: PROJECT });
    const [summary] = await chatsIn(agent);
    await agent.settled(summary!.id, 1);
    await link.call(session, "chat_note", { project: PROJECT, text: "Read the board; nothing to change." });
    const chat = await agent.settled(summary!.id, 2);
    expect(chat.messages.map((message) => message.turnId)).toEqual([chat.turns[1]!.turnId]);
  });

  it("refuses an empty note and one over 2000 characters with a sentence, and posts nothing", async () => {
    const agent = await startAgentEngine({ env: SHORT });
    const link = await outside(agent);
    const session = await link.open();
    const empty = await link.call(session, "chat_note", { project: PROJECT, text: "   " });
    expect(empty).toMatchObject({ isError: true, value: { error: "The note is empty. Write the summary the person should read." } });
    const long = await link.call(session, "chat_note", { project: PROJECT, text: "x".repeat(2001) });
    expect(long).toMatchObject({ isError: true, value: { error: "Keep a note to 2000 characters; this one has 2001. Say less, or post two notes." } });
    const [summary] = await chatsIn(agent);
    const chat = await agent.settled(summary!.id, 1);
    expect(chat.messages).toEqual([]);
  });

  it("lists chat_note for outside connections only, never for an in-app session", async () => {
    const agent = await startAgentEngine();
    const link = await outside(agent);
    const session = await link.open();
    const names = (await link.list(session)).map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining(["chat_note", "file_add"]));
    const chatId = await agent.createChat();
    await agent.send(chatId, "what is on the canvas?");
    const chat = await agent.settled(chatId, 1);
    const tools = (chat.activities.find((activity) => activity.kind === "session.configured")?.payload as { tools: string[] }).tools;
    expect(tools).not.toContain("mcp__unframed__chat_note");
    expect(tools).not.toContain("mcp__unframed__file_add");
  });
});
