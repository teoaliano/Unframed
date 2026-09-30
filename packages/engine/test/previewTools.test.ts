import { existsSync, readdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromeCandidates, NO_CHROME_PREVIEW_MESSAGE } from "@unframed/domain";
import { describe, expect, it } from "vitest";
import { scriptFolder, startAgentEngine, type AgentEngine } from "./agent.ts";
import { scriptedSession, seed, toolResults } from "./agentCanvas.ts";
import { imageShape, pageShape } from "./canvasRecords.ts";

/** These run a real headless Chrome, as the agent's previews do: they skip, saying so, on a machine without one. */
/** A cold Chrome launch on a CI runner takes several seconds, well past the helper's 10 s default. */
const CHROME_TURN_MS = 45_000;
const chrome = chromeCandidates({
  platform: process.platform,
  env: process.env,
  home: homedir(),
  versionsIn: (dir) => {
    try {
      return readdirSync(dir);
    } catch {
      return [];
    }
  },
}).find((path) => existsSync(path));
if (chrome === undefined) console.log("  preview tool tests skipped: no Chrome, Chromium, Edge or Brave on this machine");

const PAGE = `<!doctype html><html><head><title>Clicker</title></head><body>
<button id="go" onclick="document.getElementById('out').textContent = 'clicked'">Go</button>
<p id="out">waiting</p>
<a id="away" href="https://example.com/">away</a>
</body></html>`;

const call = (name: string, input: Record<string, unknown> = {}) => ({ name, input });

const previewScript = (turns: Array<Array<{ name: string; input: Record<string, unknown> }>>) =>
  scriptFolder({ preview: { when: "^look", turns: turns.map((tools) => ({ text: "Looked.", tools })) } });

const startPreviewing = async (turns: Array<Array<{ name: string; input: Record<string, unknown> }>>, renderer?: string) => {
  const agent = await startAgentEngine({ script: await previewScript(turns), env: renderer === undefined ? {} : { UNFRAMED_TEST_RENDERER: renderer } });
  await writeFile(join(agent.folder, "1-clicker.html"), PAGE);
  await seed(agent, [pageShape("pg1", "100", { file: "1-clicker.html", title: "Clicker" }), imageShape("i1", "101", null, { y: 500 }), pageShape("pg2", "102", { file: "" }, { x: 700 })]);
  return agent;
};

/** The preview tool results of one turn of a chat, the latest by default. */
const results = (chat: Awaited<ReturnType<AgentEngine["settled"]>>, turn = chat.turns.length) => {
  const turnId = chat.turns[turn - 1]?.turnId;
  const inTurn = { ...chat, activities: chat.activities.filter((activity) => activity.turnId === turnId) };
  return toolResults(inTurn)
    .filter((result) => result.toolName.startsWith("mcp__unframed__preview_"))
    .map((result) => ({ tool: result.toolName.slice("mcp__unframed__".length), status: result.status, result: result.result }));
};

describe.skipIf(chrome === undefined)("the agent's preview tools", () => {
  it("open a page, snapshot its elements and a PNG, click in it and evaluate inside it, and refuse what is not an artifact with a file", { timeout: 60_000 }, async () => {
    const agent = await startPreviewing([
      [
        call("preview_status"),
        call("preview_open", { shapeId: "pg1" }),
        call("preview_snapshot"),
        call("preview_click", { locator: "role=button[name='Go']" }),
        call("preview_evaluate", { expression: "document.getElementById('out').textContent" }),
        call("preview_open", { shapeId: "nope" }),
        call("preview_open", { shapeId: "i1" }),
        call("preview_open", { shapeId: "pg2" }),
        call("preview_click", { selector: "p, button" }),
      ],
    ]);
    const chatId = await agent.createChat();
    await agent.send(chatId, "look at it");
    const chat = await agent.settled(chatId, 1, CHROME_TURN_MS);
    const [status, opened, snapshot, clicked, evaluated, missing, wrongKind, empty, ambiguous] = results(chat);
    expect(status).toMatchObject({ status: "completed", result: { exists: false } });
    expect(opened).toMatchObject({
      status: "completed",
      result: { exists: true, url: `http://127.0.0.1:${agent.engine.previewPort}/p/board/1-clicker.html`, title: "Clicker", artifact: { shapeId: "pg1", kind: "page", title: "Clicker" } },
    });
    expect(snapshot?.result).toMatchObject({ title: "Clicker", screenshot: { mimeType: "image/png", width: 1280, height: 800 } });
    expect(snapshot?.result.interactiveElements).toEqual(expect.arrayContaining([expect.objectContaining({ tag: "button", name: "Go", selector: "#go" })]));
    expect(snapshot?.result.visibleText).toContain("waiting");
    expect(clicked?.status).toBe("completed");
    expect(evaluated?.result).toEqual({ value: "clicked" });
    expect(missing).toMatchObject({ status: "failed", result: { error: "no shape nope" } });
    expect(wrongKind).toMatchObject({ status: "failed", result: { error: "shape i1 is a image, not a page or motion" } });
    expect(empty).toMatchObject({ status: "failed", result: { error: "page pg2 has no file yet" } });
    expect(ambiguous?.result.error).toMatch(/matches 2 elements; this needs exactly one/);
    // The previews read the canvas and never write it: no tags, no turn changes.
    expect(chat.tags).toEqual([]);
    expect(chat.turns[0]?.files ?? []).toEqual([]);

    // The screenshot itself comes back as MCP image content.
    const { url, token } = await scriptedSession(agent, chatId);
    const answer = await agent.engine.request(new URL(url).pathname, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "preview_snapshot", arguments: {} } }),
    });
    const content = answer.json().result.content as Array<{ type: string; data?: string; mimeType?: string }>;
    expect(content.map((item) => item.type)).toEqual(["text", "image"]);
    expect(content[1]).toMatchObject({ mimeType: "image/png" });
    expect(Buffer.from(content[1]!.data!, "base64").subarray(1, 4).toString("latin1")).toBe("PNG");
    const textOnly = await agent.engine.request(new URL(url).pathname, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 10, method: "tools/call", params: { name: "preview_snapshot", arguments: { includeImage: false } } }),
    });
    expect((textOnly.json().result.content as unknown[]).length).toBe(1);
  });

  it("keeps the tab on the preview origin, and closes it when the chat's session closes and when the project closes", { timeout: 60_000 }, async () => {
    const agent = await startPreviewing([
      [
        call("preview_open", { shapeId: "pg1" }),
        call("preview_click", { selector: "#away" }),
        call("preview_evaluate", { expression: `(location.href = "http://127.0.0.1:1/escape", "sent")` }),
        call("preview_status"),
      ],
      [call("preview_status"), call("preview_open", { shapeId: "pg1" })],
      [call("preview_status")],
    ]);
    const chatId = await agent.createChat();
    await agent.send(chatId, "look around");
    const first = results(await agent.settled(chatId, 1, CHROME_TURN_MS));
    expect(first.at(-1)?.result).toMatchObject({ exists: true, url: `http://127.0.0.1:${agent.engine.previewPort}/p/board/1-clicker.html` });

    // The session closes: its tab goes with it.
    await agent.dispatch({ type: "thread.session.stop", threadId: chatId });
    await (await agent.watch(chatId)).until((chat) => chat.session?.status === "stopped", "the session to stop");
    await agent.send(chatId, "look again");
    const second = results(await agent.settled(chatId, 2, CHROME_TURN_MS));
    expect(second[0]?.result).toMatchObject({ exists: false });
    expect(second[1]?.result).toMatchObject({ exists: true });

    // The project closes (a rename runs every closer it registered): its tabs close too.
    expect(await agent.rpc.call("projects.rename", { name: "board", to: "renamed" })).toMatchObject({ name: "renamed" });
    await agent.rpc.call("orchestration.dispatchCommand", {
      type: "thread.turn.start",
      commandId: crypto.randomUUID(),
      projectId: "renamed",
      threadId: chatId,
      message: { messageId: `msg-${crypto.randomUUID()}`, text: "look once more", attachments: [] },
      createdAt: new Date().toISOString(),
    } as never);
    const watch = agent.rpc.subscribe("orchestration.subscribeThread", { projectId: "renamed", threadId: chatId });
    let third: ReturnType<typeof results> = [];
    for (let tries = 0; tries < 200 && third.length === 0; tries++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const events = watch.values.filter((item: any) => item.kind === "event" && item.event.type === "thread.activity-appended").map((item: any) => item.event.payload.activity);
      third = events
        .filter((activity: any) => activity.kind === "tool.completed" && String(activity.payload?.data?.toolName ?? "").startsWith("mcp__unframed__preview_"))
        .map((activity: any) => ({ tool: activity.payload.data.toolName, status: activity.payload.status, result: activity.payload.data.result }));
    }
    expect(third[0]?.result).toMatchObject({ exists: false });
  });
});

describe("the agent's preview tools without a browser", () => {
  it("answer every call with the no-Chrome sentence", async () => {
    const agent = await startPreviewing([[call("preview_status"), call("preview_open", { shapeId: "pg1" }), call("preview_snapshot")]], "no-chrome");
    const chatId = await agent.createChat();
    await agent.send(chatId, "look at it");
    for (const result of results(await agent.settled(chatId, 1, CHROME_TURN_MS))) {
      expect(result).toMatchObject({ status: "failed", result: { error: NO_CHROME_PREVIEW_MESSAGE } });
    }
  });
});
