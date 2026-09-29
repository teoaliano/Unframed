import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES, scriptFolder, startAgentEngine } from "./agent.ts";
import { motionShape, roomRecords, roomShape, seed, toolResults } from "./agentCanvas.ts";
import { pageShape, promptShape, textOf } from "./canvasRecords.ts";
import { connectTab } from "./syncClient.ts";

const writes = (...batches: unknown[][]) => batches.map((ops) => ({ name: "canvas_write", input: { ops } }));

const revertScript = async () =>
  scriptFolder({
    permission: JSON.parse(await readFile(join(FIXTURES, "permission.json"), "utf8")),
    revert: {
      when: "^rework",
      turns: [
        {
          text: "Reworked.",
          tools: writes(
            [
              { type: "update", id: "m1", props: { title: "Intro (red)" } },
              { type: "delete", id: "p1" },
              { type: "create", id: "new:note", kind: "prompt", x: 400, y: 400, props: { text: "a new note" } },
              { type: "update", id: "pg1", props: { file: "landing-v2.html" } },
            ],
            [{ type: "move", id: "m2", x: 900, y: 0 }],
          ),
        },
        { text: "Understood.", expectPreamble: "including a revert of one of your turns" },
      ],
    },
  });

describe("reverting a turn", () => {
  it("restores what it changed, recreates what it deleted, removes what it created and points a page at its previous file, as one change", async () => {
    const agent = await startAgentEngine({ script: await revertScript() });
    await writeFile(join(agent.folder, "landing-v1.html"), "<h1>v1</h1>");
    await writeFile(join(agent.folder, "landing-v2.html"), "<h1>v2</h1>");
    await seed(agent, [
      motionShape("m1", "100", "Intro"),
      motionShape("m2", "101", "Outro", {}, { x: 700 }),
      promptShape("p1", "102", "doomed"),
      pageShape("pg1", "103", { file: "landing-v1.html", title: "Landing" }, { y: 800 }),
    ]);
    const chatId = await agent.createChat();
    await agent.send(chatId, "rework the board");
    const done = await agent.settled(chatId, 1);
    const created = toolResults(done, "canvas_write")[0]!.result.ids["new:note"] as string;
    expect(done.turns[0]?.files).toEqual(
      expect.arrayContaining([
        { shapeId: "shape:pg1", kind: "page", change: "updated", file: "landing-v2.html", previousFile: "landing-v1.html" },
        { shapeId: "shape:p1", kind: "prompt", change: "deleted" },
        { shapeId: `shape:${created}`, kind: "prompt", change: "created" },
      ]),
    );
    const clock = (await agent.rpc.call("testCanvas.read", { project: "board" })).clock;

    await agent.dispatch({ type: "thread.turn.revert", threadId: chatId, turnCount: 1 });
    const watched = await agent.watch(chatId);
    const chat = await watched.until((current) => current.turns[0]?.reverted !== undefined, "the revert");
    expect(chat.turns[0]?.reverted).toMatchObject({ skipped: [] });
    expect([...chat.turns[0]!.reverted!.restored].sort()).toEqual(["shape:m1", "shape:m2", "shape:p1", "shape:pg1", `shape:${created}`].sort());
    expect((await roomShape(agent, "m1")).props.title).toBe("Intro");
    expect((await roomShape(agent, "m2")).x).toBe(700);
    expect(textOf(await roomShape(agent, "p1"))).toBe("doomed");
    expect(await roomShape(agent, created)).toBeUndefined();
    expect((await roomShape(agent, "pg1")).props.file).toBe("landing-v1.html");
    expect((await agent.rpc.call("testCanvas.read", { project: "board" })).clock).toBe(clock + 1);

    await agent.send(chatId, "rework, said and done");
    const next = await agent.settled(chatId, 2);
    expect(next.latestTurn?.state).toBe("completed");
  });

  it("leaves a shape a tab edited since alone and names who, and the next turn hears of the revert", async () => {
    const agent = await startAgentEngine({ script: await revertScript() });
    await writeFile(join(agent.folder, "landing-v2.html"), "<h1>v2</h1>");
    await seed(agent, [
      motionShape("m1", "100", "Intro"),
      motionShape("m2", "101", "Outro", {}, { x: 700 }),
      promptShape("p1", "102", "doomed"),
      pageShape("pg1", "103", { file: "", title: "Landing" }, { y: 800 }),
    ]);
    const chatId = await agent.createChat();
    await agent.send(chatId, "rework the board");
    await agent.settled(chatId, 1);
    const tab = await connectTab(agent.engine.port, "board");
    await tab.loaded;
    await tab.put([{ ...tab.get("shape:m2"), y: 55 }]);
    await tab.close();

    await agent.dispatch({ type: "thread.turn.revert", threadId: chatId, turnCount: 1 });
    const chat = await (await agent.watch(chatId)).until((current) => current.turns[0]?.reverted !== undefined, "the revert");
    expect(chat.turns[0]?.reverted?.skipped).toEqual([{ id: "shape:m2", by: "person" }]);
    expect(await roomShape(agent, "m2")).toMatchObject({ x: 900, y: 55 });
    expect((await roomShape(agent, "m1")).props.title).toBe("Intro");

    await agent.send(chatId, "rework, said and done");
    const next = await agent.settled(chatId, 2);
    expect(next.session?.lastError ?? null).toBeNull();
  });
});

describe("revert refusals", () => {
  it("refuses a revert while a turn of the chat runs, and a second revert of one turn", async () => {
    const agent = await startAgentEngine({ script: await revertScript() });
    await writeFile(join(agent.folder, "landing-v2.html"), "<h1>v2</h1>");
    await seed(agent, [motionShape("m1", "100", "Intro"), motionShape("m2", "101", "Outro"), promptShape("p1", "102", "x"), pageShape("pg1", "103")]);
    const chatId = await agent.createChat();
    await agent.send(chatId, "rework the board");
    await agent.settled(chatId, 1);

    const parked = await agent.createChat({ runtimeMode: "approval-required" });
    await agent.send(parked, "clean the build folder");
    await (await agent.watch(parked)).until((chat) => chat.activities.some((activity) => activity.kind === "approval.requested"), "the request");
    await expect(agent.dispatch({ type: "thread.turn.revert", threadId: parked, turnCount: 1 })).rejects.toMatchObject({
      code: "conflict",
      message: "Wait for the turn to finish before reverting.",
    });

    await agent.dispatch({ type: "thread.turn.revert", threadId: chatId, turnCount: 1 });
    await (await agent.watch(chatId)).until((chat) => chat.turns[0]?.reverted !== undefined, "the revert");
    await expect(agent.dispatch({ type: "thread.turn.revert", threadId: chatId, turnCount: 1 })).rejects.toMatchObject({
      code: "conflict",
      message: "That turn is already reverted.",
    });
    expect((await roomRecords(agent)).some((record) => record.id === "shape:p1")).toBe(true);
  });
});
