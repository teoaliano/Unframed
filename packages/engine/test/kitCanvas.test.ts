import { describe, expect, it } from "vitest";
import { scriptFolder, startAgentEngine } from "./agent.ts";
import { roomRecords, seed, toolResults } from "./agentCanvas.ts";
import { pageShape } from "./canvasRecords.ts";

const DOCUMENT = "document:document";
const kit = { format: 1, name: "Brand", modes: ["light", "dark"], tokens: [{ path: "color/brand/primary", type: "color", values: { light: "#1a73e8", dark: "#8ab4f8" } }] };
const documentWith = (value: unknown) => ({ id: DOCUMENT, typeName: "document", gridSize: 10, name: "", meta: { unframed: { kit: value } } });

describe("the kit on the canvas tools (spec 19, task 14)", () => {
  it("reports the kit and an artifact's mode in canvas_read, and takes a mode in canvas_write only when the kit has it", async () => {
    const agent = await startAgentEngine({
      script: await scriptFolder({
        board: {
          when: "^go",
          turns: [
            { text: "Read.", tools: [{ name: "canvas_read", input: {} }] },
            { text: "Set.", tools: [{ name: "canvas_write", input: { ops: [{ type: "update", id: "shape:moded", props: { mode: "dark" } }] } }] },
            { text: "Refused.", tools: [{ name: "canvas_write", input: { ops: [{ type: "update", id: "shape:moded", props: { mode: "neon" } }] } }] },
          ],
        },
      }),
    });
    await seed(agent, [pageShape("moded", "201", { file: "1-p.html", title: "p", fileName: "p.html", mode: "light" })]);
    await agent.rpc.call("testCanvas.apply", { project: "board", change: { put: [documentWith(kit)], remove: [] }, origin: { kind: "server", id: "kit:c1" } });
    const chatId = await agent.createChat();
    for (let turn = 1; turn <= 3; turn++) {
      await agent.send(chatId, "go", {});
      await agent.settled(chatId, turn);
    }
    const chat = await agent.settled(chatId, 3);
    const [read] = toolResults(chat, "canvas_read");
    expect(read?.result).toMatchObject({ kit: { name: "Brand", tokens: 1, modes: ["light", "dark"] } });
    expect(read?.result.shapes?.find((shape: { id: string }) => shape.id === "moded")).toMatchObject({ mode: "light" });
    const [set, refused] = toolResults(chat, "canvas_write");
    expect(set?.result).toMatchObject({ ok: true });
    expect(refused?.result).toEqual({ error: "there is no mode neon in the kit" });
    expect((await roomRecords(agent)).find((record) => record.id === "shape:moded")).toMatchObject({ props: { mode: "dark" } });
  });

  it("names a kit change the person made in the change note of the next turn", async () => {
    const note = "Since your last turn the canvas changed: the kit changed by the person. Read it again before acting.";
    const agent = await startAgentEngine({
      script: await scriptFolder({ watcher: { when: "^watch", turns: [{ text: "Watching." }, { text: "Saw it.", expectPreamble: `^${note.replace(/[.()]/g, "\\$&")}$` }] } }),
    });
    await seed(agent, []);
    const watcher = await agent.createChat();
    await agent.send(watcher, "watch the board");
    await agent.settled(watcher, 1);
    await agent.rpc.call("testCanvas.apply", { project: "board", change: { put: [documentWith(kit)], remove: [] }, origin: { kind: "server", id: "kit-edit" } });
    await agent.send(watcher, "what changed?");
    expect((await agent.settled(watcher, 2)).session?.lastError ?? null).toBeNull();
  });
});
