import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PROJECT, scriptFolder, startAgentEngine } from "./agent.ts";
import { motionShape, seed } from "./agentCanvas.ts";
import { pageShape } from "./canvasRecords.ts";

const point = (id: string, file: string) => ({ name: "canvas_write", input: { ops: [{ type: "update", id, props: { file } }] } });

const scripts = () =>
  scriptFolder({
    diffs: {
      when: "^rewrite",
      turns: [
        { text: "Rewrote both.", tools: [point("pg1", "landing-v2.html"), point("m1", "intro-v2.html")] },
        { text: "Rewrote the page again.", tools: [point("pg1", "landing-v3.html")] },
        { text: "Pointed it at the big one.", tools: [point("pg1", "huge.html")] },
        { text: "Reindented the motion.", tools: [point("m1", "intro-v3.html")] },
      ],
    },
  });

const PAGE_V1 = "<h1>Landing</h1>\n<p>One</p>\n<p>Two</p>\n";
const PAGE_V2 = "<h1>Landing</h1>\n<p>One</p>\n<p>Two, changed</p>\n<p>Three</p>\n";
const PAGE_V3 = "<h1>Landing page</h1>\n<p>One</p>\n<p>Two, changed</p>\n<p>Three</p>\n";
const MOTION_V1 = "<div>intro</div>\n";
const MOTION_V2 = "<div>intro, faster</div>\n";

describe("artifact diffs", () => {
  it("diffs the pages and motions a turn rewrote, and the whole chat from its start", async () => {
    const agent = await startAgentEngine({ script: await scripts() });
    const files: Record<string, string> = {
      "landing-v1.html": PAGE_V1,
      "landing-v2.html": PAGE_V2,
      "landing-v3.html": PAGE_V3,
      "intro-v1.html": MOTION_V1,
      "intro-v2.html": MOTION_V2,
      "intro-v3.html": "<div>intro,   faster</div>  \n",
      "huge.html": `<p>${"x".repeat(2 * 1024 * 1024)}</p>\n`,
    };
    for (const [name, text] of Object.entries(files)) await writeFile(join(agent.folder, name), text);
    await seed(agent, [pageShape("pg1", "100", { file: "landing-v1.html", title: "Landing" }), motionShape("m1", "101", "Intro", { file: "intro-v1.html" }, { x: 700 })]);
    const chatId = await agent.createChat();
    await agent.send(chatId, "rewrite them");
    await agent.settled(chatId, 1);
    await agent.send(chatId, "rewrite the page");
    await agent.settled(chatId, 2);

    const first = await agent.rpc.call("orchestration.getTurnDiff", { projectId: PROJECT, threadId: chatId, fromTurnCount: 0, toTurnCount: 1 });
    expect(first.files.map((file) => [file.shapeId, file.label, file.kind, file.before, file.after, file.additions, file.deletions])).toEqual([
      ["shape:pg1", "Landing", "page", "landing-v1.html", "landing-v2.html", 2, 1],
      ["shape:m1", "Intro", "motion", "intro-v1.html", "intro-v2.html", 1, 1],
    ]);
    const page = first.files[0]!;
    expect(page.patch).toContain("--- landing-v1.html");
    expect(page.patch).toContain("+++ landing-v2.html");
    expect(page.patch).toContain("-<p>Two</p>\n+<p>Two, changed</p>\n+<p>Three</p>");
    expect(page.tooLarge).toBeUndefined();

    const second = await agent.rpc.call("orchestration.getTurnDiff", { projectId: PROJECT, threadId: chatId, fromTurnCount: 1, toTurnCount: 2 });
    expect(second.files.map((file) => [file.shapeId, file.before, file.after, file.additions, file.deletions])).toEqual([["shape:pg1", "landing-v2.html", "landing-v3.html", 1, 1]]);

    // The whole chat: each artifact from before the first turn to after the last.
    const all = await agent.rpc.call("orchestration.getFullThreadDiff", { projectId: PROJECT, threadId: chatId, toTurnCount: 2 });
    expect(all.files.map((file) => [file.shapeId, file.before, file.after, file.additions, file.deletions])).toEqual([
      ["shape:pg1", "landing-v1.html", "landing-v3.html", 3, 2],
      ["shape:m1", "intro-v1.html", "intro-v2.html", 1, 1],
    ]);

    // A file over 2 MiB is named but not diffed.
    await agent.send(chatId, "rewrite with the big one");
    await agent.settled(chatId, 3);
    const big = await agent.rpc.call("orchestration.getTurnDiff", { projectId: PROJECT, threadId: chatId, fromTurnCount: 2, toTurnCount: 3 });
    expect(big.files).toEqual([expect.objectContaining({ shapeId: "shape:pg1", after: "huge.html", tooLarge: true, patch: "This file is too large to diff.", additions: 0, deletions: 0 })]);

    // A change of whitespace only counts unless whitespace is ignored.
    await agent.send(chatId, "rewrite the spacing");
    await agent.settled(chatId, 4);
    const range = { projectId: PROJECT, threadId: chatId, fromTurnCount: 3, toTurnCount: 4 };
    expect((await agent.rpc.call("orchestration.getTurnDiff", range)).files.map((file) => [file.additions, file.deletions])).toEqual([[1, 1]]);
    expect((await agent.rpc.call("orchestration.getTurnDiff", { ...range, ignoreWhitespace: true })).files.map((file) => [file.additions, file.deletions])).toEqual([[0, 0]]);
  });

  it("answers a range that runs backwards, and a chat that is not there", async () => {
    const agent = await startAgentEngine({ script: await scripts() });
    const chatId = await agent.createChat();
    await expect(agent.rpc.call("orchestration.getTurnDiff", { projectId: PROJECT, threadId: chatId, fromTurnCount: 2, toTurnCount: 1 })).rejects.toMatchObject({
      message: "A diff runs from an earlier turn to a later one.",
    });
    await expect(agent.rpc.call("orchestration.getTurnDiff", { projectId: PROJECT, threadId: "no-such-chat", fromTurnCount: 0, toTurnCount: 1 })).rejects.toMatchObject({ code: "not_found" });
    expect((await agent.rpc.call("orchestration.getTurnDiff", { projectId: PROJECT, threadId: chatId, fromTurnCount: 0, toTurnCount: 0 })).files).toEqual([]);
  });
});
