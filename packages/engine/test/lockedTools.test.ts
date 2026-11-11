import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES, scriptFolder, startAgentEngine, type AgentEngine } from "./agent.ts";
import { roomShape, seed, toolResults } from "./agentCanvas.ts";
import { pageShape } from "./canvasRecords.ts";

const HEADING = '<h1 data-hf-id="hf-aaaa">Hi</h1>';

const lockedAgent = async (): Promise<AgentEngine> => {
  const script = await readFile(join(FIXTURES, "locked.json"), "utf8");
  const agent = await startAgentEngine({ script: await scriptFolder({ locked: script }) });
  await writeFile(join(agent.folder, "1-locked.html"), `<script src="unframed-dials.js"></script>\n${HEADING}`);
  await writeFile(join(agent.folder, "2-other.html"), `<script src="unframed-dials.js"></script>\n<p>Other</p>`);
  await seed(agent, [pageShape("pg1", "100", { file: "1-locked.html", title: "Locked", lockedElements: ["hf-aaaa"] })]);
  return agent;
};

describe("locks in the agent's tools (spec 18)", () => {
  it("refuses a page_write that changes a locked element and writes nothing, then accepts one that keeps it", async () => {
    const agent = await lockedAgent();
    const chatId = await agent.createChat();
    const files = async () => (await readdir(agent.folder)).filter((name) => name.endsWith(".html")).sort();
    const before = await files();

    await agent.send(chatId, "locked one");
    const first = await agent.settled(chatId, 1);
    const [refused] = toolResults(first, "page_write");
    expect(refused).toMatchObject({ status: "failed" });
    expect(refused?.result).toEqual({
      error: 'The element data-hf-id="hf-aaaa" ("Hi") is locked by the person, and this write changes it. Keep that element exactly as it is in the current file (page_read shows it), or ask the person to unlock it in the editor\'s Layers tab.',
    });
    expect((await roomShape(agent, "pg1")).props.file).toBe("1-locked.html");
    expect(await files()).toEqual(before);

    await agent.send(chatId, "locked two");
    const second = await agent.settled(chatId, 2);
    expect(toolResults(second, "page_write").at(-1)).toMatchObject({ status: "completed" });
    expect((await roomShape(agent, "pg1")).props.file).not.toBe("1-locked.html");
  });

  it("reports lockedElements in canvas_read and refuses canvas_write setting them or moving a page off its locked file", async () => {
    const agent = await lockedAgent();
    const chatId = await agent.createChat();
    let chat!: Awaited<ReturnType<AgentEngine["settled"]>>;
    for (let turn = 1; turn <= 5; turn++) {
      await agent.send(chatId, "locked");
      chat = await agent.settled(chatId, turn);
    }

    const [read] = toolResults(chat, "canvas_read").slice(-1);
    expect(JSON.stringify(read?.result)).toContain('"lockedElements":["hf-aaaa"]');

    const writes = toolResults(chat, "canvas_write");
    expect(writes[0]).toMatchObject({ status: "failed", result: { error: "update: lockedElements is set by the person in the editor's Layers tab" } });
    expect(writes[1]).toMatchObject({ status: "failed" });
    expect(String((writes[1]?.result as { error?: string }).error)).toMatch(/is locked by the person/);
    expect((await roomShape(agent, "pg1")).props.file).not.toBe("2-other.html");
  });
});
