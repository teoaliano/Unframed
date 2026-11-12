import type { TLRecord } from "@tldraw/tlschema";
import { describe, expect, it } from "vitest";
import { connectTab } from "./syncClient.ts";
import { PROJECT, scriptFolder, startAgentEngine, until, type AgentEngine } from "./agent.ts";
import { motionShape, roomRecords, seed, toolResults } from "./agentCanvas.ts";
import { chatsIn, outsideLink } from "./outsideCalls.ts";

const SHORT = { UNFRAMED_TEST_OUTSIDE_TURN_IDLE_MS: "300" };

const body = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

const personThread = (id: string, text: string, anchor: Record<string, unknown> = { type: "point", x: 40, y: 50 }) => [
  { id: `comment-thread:${id}`, typeName: "comment-thread", pageId: "page:page", anchor, createdBy: "person", createdAt: 1000, resolved: null, isDeleted: false, meta: { number: 1 } },
  { id: `comment:${id}-1`, typeName: "comment", threadId: `comment-thread:${id}`, pageId: "page:page", authorId: "person", createdAt: 1000, editedAt: null, body: body(text), isDeleted: false, meta: {} },
];

const asPerson = async (agent: AgentEngine, records: unknown[]) => {
  const tab = await connectTab(agent.engine.port, PROJECT);
  await tab.loaded;
  await tab.put(records as TLRecord[]);
  await tab.close();
};

const comments = async (agent: AgentEngine) => (await roomRecords(agent)).filter((record) => record.typeName === "comment" || record.typeName === "comment-thread");

describe("comment tools over an outside connection", () => {
  it("starts a thread on a shape, replies to the person's thread, resolves it, and reads them back", async () => {
    const agent = await startAgentEngine({ env: SHORT });
    await seed(agent, [motionShape("m1", "150", "Intro", {}, { x: 100, y: 200 })]);
    await asPerson(agent, personThread("p", "Make the title bigger"));
    const link = await outsideLink(agent, "Studio Codex");
    const session = await link.open();

    const read = await link.call(session, "canvas_read", { project: PROJECT });
    expect(read.value.comments).toEqual({ open: 1 });

    const wrote = await link.call(session, "comment_write", {
      project: PROJECT,
      ops: [
        { op: "start", on: "m1", text: "The intro starts too late" },
        { op: "reply", thread: "#1", text: "Made it 20% bigger" },
        { op: "resolve", thread: "#1" },
      ],
    });
    expect(wrote).toMatchObject({ isError: false, value: { ok: true, started: ["#2"] } });

    const open = await link.call(session, "comments_read", { project: PROJECT });
    expect(open.value).toEqual({
      threads: [
        {
          thread: "#2",
          on: "m1",
          at: { x: 740, y: 200 },
          resolved: false,
          messages: [{ id: expect.any(String), author: "Studio Codex", agent: true, at: expect.any(String), text: "The intro starts too late" }],
        },
      ],
      resolvedHidden: 1,
    });
    const one = await link.call(session, "comments_read", { project: PROJECT, thread: "#1" });
    expect(one.value.threads[0]).toMatchObject({ thread: "#1", at: { x: 40, y: 50 }, resolved: true });
    expect(one.value.threads[0].messages.map((message: { author: string; text: string }) => [message.author, message.text])).toEqual([
      ["You", "Make the title bigger"],
      ["Studio Codex", "Made it 20% bigger"],
    ]);

    const stored = await comments(agent);
    const reply = stored.find((record) => record.typeName === "comment" && record.body.content[0].content[0].text === "Made it 20% bigger");
    expect(reply).toMatchObject({ authorId: expect.stringMatching(/^chat:/), meta: { author: { name: "Studio Codex", provider: "outside" } } });

    const refused = await link.call(session, "comment_write", { project: PROJECT, ops: [{ op: "edit", comment: "p-1", text: "rewritten" }] });
    expect(refused).toMatchObject({ isError: true, value: { error: "Op 0: you can edit only your own comments." } });
    const missing = await link.call(session, "comments_read", { project: PROJECT, thread: "#9" });
    expect(missing).toMatchObject({ isError: true, value: { error: "No comment thread #9." } });
  });

  it("lists both tools for outside connections", async () => {
    const agent = await startAgentEngine();
    const link = await outsideLink(agent);
    const names = (await link.list(await link.open())).map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining(["comments_read", "comment_write"]));
  });
});

describe("comment tools in an in-app turn", () => {
  it("writes as the chat's agent, leaves comments out of the turn's files, and Revert takes the thread away", async () => {
    const script = await scriptFolder({
      pin: { when: "^pin", turns: [{ text: "Pinned a note.", tools: [{ name: "comment_write", input: { ops: [{ op: "start", at: { x: 10, y: 20 }, text: "Look here" }] } }] }] },
    });
    const agent = await startAgentEngine({ script });
    const chatId = await agent.createChat();
    await agent.send(chatId, "pin a note");
    const chat = await agent.settled(chatId, 1);
    expect(toolResults(chat, "comment_write")[0]?.result).toMatchObject({ ok: true, started: ["#1"] });
    expect(chat.turns[0]?.files ?? []).toEqual([]);
    const made = await comments(agent);
    expect(made).toHaveLength(2);
    expect(made.find((record) => record.typeName === "comment")).toMatchObject({ authorId: `chat:${chatId}`, meta: { author: { name: "Claude", provider: "claude" } } });

    await agent.dispatch({ type: "thread.turn.revert", threadId: chatId, turnCount: 1 });
    await (await agent.watch(chatId)).until((current) => current.turns[0]?.reverted !== undefined, "the revert");
    expect(await comments(agent)).toEqual([]);
  });

  it("keeps a thread on Revert when the person replied in it since", async () => {
    const script = await scriptFolder({
      pin: { when: "^pin", turns: [{ text: "Pinned.", tools: [{ name: "comment_write", input: { ops: [{ op: "start", at: { x: 0, y: 0 }, text: "Look here" }] } }] }] },
    });
    const agent = await startAgentEngine({ script });
    const chatId = await agent.createChat();
    await agent.send(chatId, "pin it");
    await agent.settled(chatId, 1);
    const thread = (await comments(agent)).find((record) => record.typeName === "comment-thread");
    await asPerson(agent, [
      { id: "comment:mine", typeName: "comment", threadId: thread.id, pageId: "page:page", authorId: "person", createdAt: 2000, editedAt: null, body: body("Thanks"), isDeleted: false, meta: {} },
    ]);
    await agent.dispatch({ type: "thread.turn.revert", threadId: chatId, turnCount: 1 });
    const reverted = await (await agent.watch(chatId)).until((current) => current.turns[0]?.reverted !== undefined, "the revert");
    const left = await comments(agent);
    expect(left.map((record) => record.id).sort()).toEqual(["comment:mine", thread.id].sort());
    expect(reverted.turns[0]?.reverted?.skipped).toEqual([{ id: thread.id, by: "person" }]);
  });

  it("refuses to write comments in plan mode", async () => {
    const script = await scriptFolder({
      pin: { when: "^pin", turns: [{ text: "Planned.", tools: [{ name: "comment_write", input: { ops: [{ op: "start", at: { x: 0, y: 0 }, text: "x" }] } }] }] },
    });
    const agent = await startAgentEngine({ script });
    const chatId = await agent.createChat({ interactionMode: "plan" });
    await agent.send(chatId, "pin it");
    const chat = await agent.settled(chatId, 1);
    expect(toolResults(chat, "comment_write")[0]).toMatchObject({ status: "failed" });
    expect(await comments(agent)).toEqual([]);
  });
});

describe("mentioning an agent in a comment", () => {
  const script = () =>
    scriptFolder({
      mention: {
        when: "mentioned you in comment thread #1",
        turns: [{ text: "Answered in the thread.", tools: [{ name: "comment_write", input: { ops: [{ op: "reply", thread: "#1", text: "On it: the title is bigger now." }] } }] }],
      },
    });

  it("starts a chat with that agent, which answers in the thread, and reuses the chat for the next mention there", async () => {
    const agent = await startAgentEngine({ script: await script() });
    await asPerson(agent, personThread("p", "@Claude make the title bigger"));
    const chats = await until(async () => {
      const found = await chatsIn(agent);
      return found.length === 1 ? found : undefined;
    }, "the mention's chat");
    expect(chats[0]!.title).toBe("Comment #1");
    const chat = await agent.settled(chats[0]!.id, 1);
    expect(chat.messages.find((message) => message.role === "user")?.text).toContain("> You: @Claude make the title bigger");
    await until(async () => (await comments(agent)).some((record) => record.authorId === `chat:${chats[0]!.id}`), "the agent's reply");

    await asPerson(agent, [
      { id: "comment:p-3", typeName: "comment", threadId: "comment-thread:p", pageId: "page:page", authorId: "person", createdAt: 3000, editedAt: null, body: body("@claude and the subtitle"), isDeleted: false, meta: {} },
    ]);
    const again = await agent.settled(chats[0]!.id, 2);
    expect(again.turns).toHaveLength(2);
    expect(await chatsIn(agent)).toHaveLength(1);
  });

  it("starts nothing for a comment without a mention, an edit, or a comment an agent wrote", async () => {
    const agent = await startAgentEngine({ script: await script() });
    await asPerson(agent, personThread("p", "make the title bigger"));
    const [thread, first] = personThread("p", "@Claude edited in");
    await asPerson(agent, [{ ...first!, editedAt: 2000 }]);
    await agent.rpc.call("testCanvas.apply", {
      project: PROJECT,
      change: { put: [{ ...first!, id: "comment:agent", authorId: "chat:other", meta: { author: { name: "Claude", provider: "claude" } } }], remove: [] },
      origin: { kind: "server", id: "chat:other" },
    });
    void thread;
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(await chatsIn(agent)).toEqual([]);
  });
});
