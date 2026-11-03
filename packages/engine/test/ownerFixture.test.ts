import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES, scriptFolder, startAgentEngine } from "./agent.ts";
import { roomShape, seed, toolResults } from "./agentCanvas.ts";
import { pageShape } from "./canvasRecords.ts";

describe("the owner page fixture (spec 18)", () => {
  it("writes a page whose script sets a style from a parameter, one by arithmetic on it, and makes an element at run time", async () => {
    const script = await readFile(join(FIXTURES, "owner.json"), "utf8");
    const agent = await startAgentEngine({ script: await scriptFolder({ owner: script }) });
    await writeFile(join(agent.folder, "1-owner.html"), `<script src="unframed-dials.js"></script>\n<h1>Owner</h1>`);
    await seed(agent, [pageShape("pg1", "100", { file: "1-owner.html", title: "Owner" })]);
    const chatId = await agent.createChat();

    await agent.send(chatId, "owner page");
    const chat = await agent.settled(chatId, 1);

    expect(toolResults(chat, "page_write").at(-1)).toMatchObject({ status: "completed" });
    const file = (await roomShape(agent, "pg1")).props.file as string;
    expect(file).not.toBe("1-owner.html");
    const html = await readFile(join(agent.folder, file), "utf8");
    expect(html).toContain("unframed.dials(");
    expect(html).toContain("el.style.color");
    expect(html).toContain("document.createElement");
  });
});
