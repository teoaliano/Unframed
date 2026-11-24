import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { chromeCandidates } from "@unframed/domain";
import { describe, expect, it } from "vitest";
import { toolResults } from "./agentCanvas.ts";
import { McpClient } from "../src/agent/mcp.ts";
import { startRepositoryAgent } from "./repositoryAgent.ts";

const call = (name: string, input: Record<string, unknown> = {}) => ({ name, input });

const results = (chat: Parameters<typeof toolResults>[0]) =>
  toolResults(chat).map((result) => ({ tool: result.toolName.replace("mcp__unframed__", ""), status: result.status, result: result.result }));

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

describe("the agent in a Repository", () => {
  it("is offered the Instance tools, not page_write or motion_write, and a Whiteboard's agent is offered the opposite", { timeout: 60_000 }, async () => {
    const agent = await startRepositoryAgent();
    await agent.script("look", { when: "^look", turns: [{ text: "Looked.", tools: [call("canvas_read")] }] });
    const chatId = await agent.createChat();
    await agent.send(chatId, "look around");
    const chat = await agent.settled(chatId, 1);
    expect(chat.latestTurn?.state).toBe("completed");
    const session = await agent.session(chatId);
    const client = new McpClient(session.url, session.token);
    await client.initialize();
    const names = await client.listTools();
    expect(names).toEqual(expect.arrayContaining(["instance_create", "instance_remove", "instance_status", "instance_start", "instance_stop", "page_edit", "canvas_write"]));
    expect(names).not.toContain("page_write");
    expect(names).not.toContain("motion_write");
    await expect(client.callTool("page_write", { html: "<p>hi</p>" })).rejects.toThrow(/Unknown tool/);

    await agent.rpc.call("projects.create", { name: "board" });
    const whiteboardChat = await agent.createChat("board");
    await agent.send(whiteboardChat, "look around", { project: "board" });
    const boardSettled = await agent.settled(whiteboardChat, 1, "board");
    expect(boardSettled.messages.at(-1)?.text).toBe("Looked.");
    const board = await agent.session(whiteboardChat);
    const boardClient = new McpClient(board.url, board.token);
    await boardClient.initialize();
    const boardNames = await boardClient.listTools();
    expect(boardNames).toContain("page_write");
    expect(boardNames.filter((name) => name.startsWith("instance_"))).toEqual([]);
  });

  it("creates, inspects and removes Instances with its tools, placing a Screen for each new one", { timeout: 90_000 }, async () => {
    const agent = await startRepositoryAgent();
    const screen = agent.screen.id.replace(/^shape:/, "");
    await agent.script("fork", {
      when: "^fork",
      turns: [
        {
          text: "Forked.",
          tools: [
            call("instance_status"),
            call("instance_status", { id: agent.instance.id }),
            call("instance_create", { shapeId: screen, branch: "explore-a" }),
            call("instance_create", { base: "trunk" }),
            call("instance_create", { shapeId: "nope" }),
            call("instance_status", { id: "nope" }),
          ],
        },
      ],
    });
    const chatId = await agent.createChat();
    await agent.send(chatId, "fork it");
    const chat = await agent.settled(chatId, 1, undefined, 60_000);
    const [listed, one, forked, based, badScreen, badId] = results(chat);
    expect(listed).toMatchObject({ status: "completed", result: { instances: [{ id: agent.instance.id, branch: agent.instance.branch }] } });
    expect(one).toMatchObject({ status: "completed", result: { id: agent.instance.id, worktree: agent.instance.worktree, log: expect.any(String) } });
    expect(forked).toMatchObject({ status: "completed", result: { instance: { branch: "explore-a", baseRef: agent.instance.branch, worktree: expect.stringMatching(/explore-a/) }, screen: expect.any(String) } });
    expect(existsSync(forked!.result.instance.worktree)).toBe(true);
    expect(based).toMatchObject({ status: "completed", result: { instance: { baseRef: "trunk", branch: expect.stringMatching(/^unframed\//) } } });
    expect(badScreen).toMatchObject({ status: "failed", result: { error: expect.stringMatching(/no Screen nope/) } });
    expect(badId).toMatchObject({ status: "failed" });

    const screens = (await agent.records()).filter((record) => record.typeName === "shape" && record.type === "screen");
    expect(screens).toHaveLength(3);
    const placed = screens.find((record) => record.id === `shape:${forked!.result.screen}`);
    expect(placed).toMatchObject({ props: { instance: forked!.result.instance.id, route: "/", w: 1280, h: 800, title: "explore-a" }, meta: { ref: expect.any(String) } });
    expect(placed.x).toBeGreaterThan(agent.screen.x);

    await agent.script("remove", {
      when: "^remove",
      turns: [{ text: "Removed.", tools: [call("instance_remove", { id: forked!.result.instance.id, deleteBranch: true })] }],
    });
    const removeChat = await agent.createChat();
    await agent.send(removeChat, "remove it");
    const [removed] = results(await agent.settled(removeChat, 1, undefined, 60_000));
    expect(removed).toMatchObject({ status: "completed", result: { id: forked!.result.instance.id, state: "removed" } });
    expect(existsSync(forked!.result.instance.worktree)).toBe(false);
  });

  it("reads Screens with their ref, creates one and changes its route with canvas_write", { timeout: 60_000 }, async () => {
    const agent = await startRepositoryAgent();
    expect(agent.screen.meta.ref).toMatch(/^\d+$/);
    await agent.script("screens", {
      when: "^screens",
      turns: [
        {
          text: "Done.",
          tools: [
            call("canvas_read"),
            call("canvas_write", { ops: [{ type: "create", kind: "screen", id: "new:settings", x: 1400, y: 0, w: 390, h: 844, props: { instance: agent.instance.id, route: "settings" } }] }),
            call("canvas_write", { ops: [{ type: "update", id: agent.screen.id.replace(/^shape:/, ""), props: { route: "/about" } }] }),
            call("canvas_write", { ops: [{ type: "update", id: agent.screen.id.replace(/^shape:/, ""), props: { route: "https://example.com/" } }] }),
          ],
        },
      ],
    });
    const chatId = await agent.createChat();
    await agent.send(chatId, "screens please");
    const [read, created, moved, refused] = results(await agent.settled(chatId, 1));
    expect(read!.result.shapes).toEqual([
      expect.objectContaining({ id: agent.screen.id.replace(/^shape:/, ""), kind: "screen", ref: agent.screen.meta.ref, instance: agent.instance.id, route: "/", w: 1280, h: 800, title: agent.instance.branch }),
    ]);
    expect(created).toMatchObject({ status: "completed", result: { ok: true } });
    expect(moved).toMatchObject({ status: "completed" });
    expect(refused).toMatchObject({ status: "failed", result: { error: expect.stringMatching(/props.route is a path/) } });
    const screens = (await agent.records()).filter((record) => record.type === "screen");
    expect(screens.find((record) => record.id === agent.screen.id).props.route).toBe("/about");
    expect(screens.find((record) => record.id !== agent.screen.id)).toMatchObject({ props: { instance: agent.instance.id, route: "/settings", w: 390, h: 844 }, meta: { ref: expect.any(String) } });
  });

  it("tags a chat started from a Screen with that Screen", { timeout: 60_000 }, async () => {
    const agent = await startRepositoryAgent();
    await agent.script("look", { when: "^look", turns: [{ text: "Looked." }] });
    const created = await agent.createChat(undefined, { tags: [agent.screen.id] });
    expect((await agent.watch(created)).chat().tags).toEqual([agent.screen.id]);
    const chatId = await agent.createChat();
    await agent.send(chatId, "look at this", { selection: [agent.screen.id] });
    expect((await agent.settled(chatId, 1)).tags).toEqual([agent.screen.id]);
  });

  it.skipIf(chrome === undefined)("opens a Screen in its preview tab, starting its Instance, at its route and viewport", { timeout: 120_000 }, async () => {
    const agent = await startRepositoryAgent();
    const screen = agent.screen.id.replace(/^shape:/, "");
    await agent.rpc.call("testCanvas.apply", {
      project: agent.project,
      change: { put: [{ ...agent.screen, props: { ...agent.screen.props, route: "/pricing", w: 390, h: 844 } }], remove: [] },
      origin: { kind: "server", id: "test" },
    });
    await agent.script("preview", {
      when: "^preview",
      turns: [{ text: "Looked.", tools: [call("preview_open", { shapeId: screen }), call("preview_evaluate", { expression: "document.getElementById('path').textContent" }), call("preview_snapshot", { includeImage: false })] }],
    });
    const chatId = await agent.createChat();
    await agent.send(chatId, "preview it");
    const [opened, evaluated, snapshot] = results(await agent.settled(chatId, 1, undefined, 100_000));
    const live = await agent.rpc.call("instances.status", { project: agent.project, id: agent.instance.id });
    expect(live.state).toBe("live");
    expect(opened).toMatchObject({ status: "completed", result: { exists: true, url: `http://127.0.0.1:${live.proxyPort}/pricing`, screen: { shapeId: screen, instance: agent.instance.id, route: "/pricing" } } });
    expect(evaluated).toMatchObject({ status: "completed", result: { value: "/pricing" } });
    expect(snapshot!.result.visibleText).toContain("Fake app");
    expect(opened!.result.viewport.measured).toEqual({ width: 390, height: 844 });
  });
});

describe("a thread's working Instance", () => {
  it("runs a thread started from a Screen in that Instance's worktree, with the Repository's worktrees granted, and others in the project folder", { timeout: 60_000 }, async () => {
    const agent = await startRepositoryAgent();
    await agent.script("look", { when: "^look", turns: [{ text: "Looked." }, { text: "Again." }] });
    const fromScreen = await agent.createChat();
    await agent.send(fromScreen, "look at this", { selection: [agent.screen.id] });
    const chat = await agent.settled(fromScreen, 1);
    const session = await agent.session(fromScreen);
    expect(session.cwd).toBe(agent.instance.worktree);
    const worktrees = dirname(agent.instance.worktree);
    expect(session.granted).toContain(worktrees);
    expect(chat.activities.find((activity) => activity.kind === "session.configured")?.payload).toMatchObject({ grantedDirectories: expect.arrayContaining([worktrees]) });

    const plain = await agent.createChat();
    await agent.send(plain, "look around");
    await agent.settled(plain, 1);
    expect((await agent.session(plain)).cwd).toBe(join(agent.engine.dataDir, "output", agent.project));
  });
});
