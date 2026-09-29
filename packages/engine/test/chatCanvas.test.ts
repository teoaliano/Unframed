import { describe, expect, it } from "vitest";
import { scriptFolder, startAgentEngine } from "./agent.ts";
import { motionShape, roomShape, seed } from "./agentCanvas.ts";
import { imageShape, pageShape, promptShape } from "./canvasRecords.ts";
import { connectTab } from "./syncClient.ts";

const writes = (...batches: unknown[][]) => batches.map((ops) => ({ name: "canvas_write", input: { ops } }));

describe("tags from the first message", () => {
  it("tags the chat with the selected page and motion only, as the canvas decides", async () => {
    const agent = await startAgentEngine();
    await seed(agent, [pageShape("pg1", "100"), imageShape("i3", "101", null), motionShape("m1", "102", "Intro")]);
    const chatId = await agent.createChat();
    await agent.send(chatId, "what is on the board?", { selection: ["shape:pg1", "shape:i3", "shape:m1", "shape:nothing"] });
    const chat = await agent.settled(chatId, 1);
    expect(chat.tags).toEqual(["shape:pg1", "shape:m1"]);
  });
});

describe("tags from writes", () => {
  it("tags a moved page and a resized motion once each, nothing for a prompt edit, and keeps a tag when the page goes", async () => {
    const script = await scriptFolder({
      tags: {
        when: "^tidy",
        turns: [
          {
            text: "Moved.",
            tools: writes(
              [{ type: "move", id: "pg1", x: 40, y: 40 }],
              [{ type: "resize", id: "m1", w: 320, h: 180 }],
              [{ type: "move", id: "pg1", x: 80, y: 80 }],
              [{ type: "update", id: "p1", props: { text: "edited" } }],
            ),
          },
          { text: "Deleted.", tools: writes([{ type: "delete", id: "pg1" }]) },
        ],
      },
    });
    const agent = await startAgentEngine({ script });
    await seed(agent, [pageShape("pg1", "100"), motionShape("m1", "101", "Intro"), promptShape("p1", "102", "a prompt")]);
    const chatId = await agent.createChat();
    await agent.send(chatId, "tidy the board");
    expect((await agent.settled(chatId, 1)).tags).toEqual(["shape:pg1", "shape:m1"]);
    await agent.send(chatId, "now delete the page");
    const chat = await agent.settled(chatId, 2);
    expect(await roomShape(agent, "pg1")).toBeUndefined();
    expect(chat.tags).toEqual(["shape:pg1", "shape:m1"]);
  });
});

describe("change log origins and the change note", () => {
  it("counts a tab's edit and a run's write as the person's, another chat's write as another chat's, and leaves system rows out", async () => {
    const note = "Since your last turn the canvas changed: 2 changes by the person, 1 change by another chat. Read it again before acting.";
    const script = await scriptFolder({
      watcher: { when: "^watch", turns: [{ text: "Watching." }, { text: "Saw it.", expectPreamble: `^${note.replace(/[.()]/g, "\\$&")}$` }] },
      other: { when: "^other", turns: [{ text: "Moved it.", tools: writes([{ type: "move", id: "m2", x: 900, y: 900 }]) }] },
    });
    const agent = await startAgentEngine({ script });
    await seed(agent, [motionShape("m1", "100", "Intro"), motionShape("m2", "101", "Outro", {}, { x: 700 }), promptShape("p1", "102", "x")]);
    const watcher = await agent.createChat();
    await agent.send(watcher, "watch the board");
    await agent.settled(watcher, 1);

    const tab = await connectTab(agent.engine.port, "board");
    await tab.loaded;
    await tab.put([{ ...tab.get("shape:m1"), props: { ...tab.get("shape:m1").props, title: "Intro, by hand" } }]);
    await tab.close();
    const placeholder = imageShape("r1", "103", null, { x: 1200 });
    await agent.rpc.call("testCanvas.apply", { project: "board", change: { put: [placeholder], remove: [] }, origin: { kind: "server", id: "run:run-1" } });
    await agent.rpc.call("testCanvas.apply", { project: "board", change: { put: [{ ...(await roomShape(agent, "p1")), x: 5 }], remove: [] }, origin: { kind: "system", id: "repair" } });
    const other = await agent.createChat();
    await agent.send(other, "other chat moves m2");
    await agent.settled(other, 1);

    await agent.send(watcher, "what changed?");
    const chat = await agent.settled(watcher, 2);
    expect(chat.latestTurn?.state).toBe("completed");
  });
});

describe("the preamble reaches the agent", () => {
  it("gives turn 2 the change note after a tab edits between turns (the bulk-edit fixture)", async () => {
    const agent = await startAgentEngine();
    await seed(agent, [motionShape("m1", "100", "Intro"), motionShape("m2", "101", "Outro", {}, { x: 700 })]);
    const chatId = await agent.createChat();
    await agent.send(chatId, "make the titles red");
    await agent.settled(chatId, 1);
    const tab = await connectTab(agent.engine.port, "board");
    await tab.loaded;
    await tab.put([{ ...tab.get("shape:m2"), x: 750 }]);
    await tab.close();
    await agent.send(chatId, "now make the titles blue");
    const chat = await agent.settled(chatId, 2);
    expect(chat.latestTurn?.state).toBe("completed");
    expect((await roomShape(agent, "m1")).props.title).toBe("Intro (blue)");
  });

  it("puts the selection line first and the change note after it", async () => {
    const expected = 'Selected: motion m1 ("Intro (red)").\n\nSince your last turn the canvas changed: 1 change by the person. Read it again before acting.';
    const script = await scriptFolder({
      exact: {
        when: "^titles",
        turns: [
          { text: "Red.", tools: writes([{ type: "update", id: "m1", props: { title: "Intro (red)" } }]) },
          { text: "Seen.", expectPreamble: `^${expected.replace(/[.()]/g, "\\$&")}$` },
        ],
      },
    });
    const agent = await startAgentEngine({ script });
    await seed(agent, [motionShape("m1", "100", "Intro"), promptShape("p1", "101", "x")]);
    const chatId = await agent.createChat();
    await agent.send(chatId, "titles red");
    await agent.settled(chatId, 1);
    const tab = await connectTab(agent.engine.port, "board");
    await tab.loaded;
    await tab.put([{ ...tab.get("shape:p1"), x: 44 }]);
    await tab.close();
    await agent.send(chatId, "look again", { selection: ["shape:m1"] });
    const chat = await agent.settled(chatId, 2);
    expect(chat.session?.lastError ?? null).toBeNull();
    expect(chat.latestTurn?.state).toBe("completed");
  });
});
