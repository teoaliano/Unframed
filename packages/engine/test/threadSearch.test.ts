import { describe, expect, it } from "vitest";
import { PROJECT, scriptFolder, startAgentEngine } from "./agent.ts";
import { openRawSocket, request } from "./rawSocket.ts";

const LONG = `${"a patient prelude about nothing much at all. ".repeat(8)}the lantern glows here ${"and then a long tail that keeps going on. ".repeat(8)}`;

const scripts = () =>
  scriptFolder({
    search: {
      turns: [{ text: "A reply that mentions the lantern once." }, { text: "The second reply is plain." }],
    },
  });

describe("thread search", () => {
  it("matches the person's messages and final replies, one row per chat, the person's matches first", async () => {
    const agent = await startAgentEngine({ script: await scripts() });
    const userMatch = await agent.createChat({ createdAt: "2026-09-01T10:00:00.000Z" });
    await agent.send(userMatch, "where is the Lantern kept");
    await agent.settled(userMatch, 1);
    await agent.send(userMatch, "and the lantern oil?");
    await agent.settled(userMatch, 2);

    const replyMatch = await agent.createChat({ createdAt: "2026-09-02T10:00:00.000Z" });
    await agent.send(replyMatch, "tell me something");
    await agent.settled(replyMatch, 1);

    const titled = await agent.createChat({ createdAt: "2026-09-03T10:00:00.000Z" });
    await agent.dispatch({ type: "thread.meta.update", threadId: titled, title: "Lantern plans" });

    const deleted = await agent.createChat({ createdAt: "2026-09-04T10:00:00.000Z" });
    await agent.send(deleted, "the lantern is gone");
    await agent.settled(deleted, 1);
    await agent.dispatch({ type: "thread.delete", threadId: deleted });

    const long = await agent.createChat({ createdAt: "2026-09-05T10:00:00.000Z" });
    await agent.send(long, LONG);
    await agent.settled(long, 1);

    const { matches } = await agent.rpc.call("orchestration.searchThreads", { projectId: PROJECT, query: "LANTERN" });
    expect(matches.map((match) => [match.threadId, match.source])).toEqual([
      [long, "user"],
      [userMatch, "user"],
      [replyMatch, "assistant"],
    ]);
    const userRow = matches.find((match) => match.threadId === userMatch)!;
    expect(userRow.snippet).toBe("and the lantern oil?");
    expect(Date.parse(userRow.messageCreatedAt)).not.toBeNaN();
    expect(matches.find((match) => match.threadId === replyMatch)!.snippet).toBe("A reply that mentions the lantern once.");

    const longRow = matches.find((match) => match.threadId === long)!;
    expect(longRow.snippet.length).toBeLessThanOrEqual(240);
    expect(longRow.snippet).toContain("the lantern glows here");
    expect(longRow.snippet.startsWith("…")).toBe(true);
    expect(longRow.snippet.endsWith("…")).toBe(true);

    const limited = await agent.rpc.call("orchestration.searchThreads", { projectId: PROJECT, query: "lantern", limit: 1 });
    expect(limited.matches.map((match) => match.threadId)).toEqual([long]);
    expect((await agent.rpc.call("orchestration.searchThreads", { projectId: PROJECT, query: "no such words" })).matches).toEqual([]);
  });

  it("takes 2 to 200 characters and a limit of 1 to 50", async () => {
    const agent = await startAgentEngine({ script: await scripts() });
    const socket = await openRawSocket(agent.engine.socket());
    let id = 0;
    // Sent raw, past the client's own encoding, as a page could send it.
    const refused = async (payload: Record<string, unknown>) => {
      const requestId = String(++id);
      socket.send(request(requestId, "orchestration.searchThreads", { projectId: PROJECT, query: "ok", ...payload }));
      const exit = (await socket.waitFor((message) => message._tag === "Exit" && message.requestId === requestId)).exit;
      return exit._tag === "Success" ? "accepted" : JSON.stringify(exit).includes("bad_request") ? "bad_request" : JSON.stringify(exit);
    };
    expect(await refused({ query: "a" })).toBe("bad_request");
    expect(await refused({ query: "x".repeat(201) })).toBe("bad_request");
    expect(await refused({ limit: 0 })).toBe("bad_request");
    expect(await refused({ limit: 51 })).toBe("bad_request");
    expect(await refused({ query: "ab", limit: 50 })).toBe("accepted");
    expect(await refused({ query: "x".repeat(200), limit: 1 })).toBe("accepted");
  });
});
