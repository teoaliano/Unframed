import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { chromeCandidates } from "@unframed/domain";
import { describe, expect, it } from "vitest";
import { toolResults } from "./agentCanvas.ts";
import { startRepositoryAgent, type RepositoryAgent } from "./repositoryAgent.ts";

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
if (chrome === undefined) console.log("  screen state tests skipped: no Chrome, Chromium, Edge or Brave on this machine");

const CHROME_TURN_MS = 90_000;

const EMPTY = { url: "/api/items", body: [] };
const FAILED = { url: "/api/items", fail: true };

const liveAgent = async (): Promise<{ agent: RepositoryAgent; proxy: number }> => {
  const agent = await startRepositoryAgent();
  const live = await agent.rpc.call("instances.start", { project: agent.project, id: agent.instance.id });
  return { agent, proxy: live.proxyPort! };
};

const put = (agent: RepositoryAgent, records: any[]) => agent.rpc.call("testCanvas.apply", { project: agent.project, change: { put: records, remove: [] }, origin: { kind: "server", id: "test" } });

const page = async (proxy: number, path: string) => (await fetch(`http://127.0.0.1:${proxy}${path}`)).text();

const bridgeOf = (html: string) => /<script src="(\/__unframed\/bridge\.js[^"]*)"/.exec(html)?.[1];

describe("a Screen's mocks reach its page through a per-load token", () => {
  it("issues a token per Screen that the proxy turns into that Screen's mocks inlined with the bridge, once, and keeps the token from the dev server", { timeout: 60_000 }, async () => {
    const { agent, proxy } = await liveAgent();
    const steps = [{ action: "click", target: { role: "button", name: "Menu" } }];
    await put(agent, [
      { ...agent.screen, props: { ...agent.screen.props, route: "/app", mocks: [EMPTY], steps, state: "an empty list" } },
      { ...agent.screen, id: "shape:failing", props: { ...agent.screen.props, route: "/app", mocks: [FAILED], state: "a failed list" } },
      { ...agent.screen, id: "shape:plain", props: { ...agent.screen.props } },
    ]);
    const records = await agent.records();
    const token = async (shapeId: string) => {
      const props = records.find((record) => record.id === shapeId).props;
      return (await agent.rpc.call("screens.stateToken", { project: agent.project, instance: props.instance, steps: props.steps ?? [], mocks: props.mocks ?? [] })).token;
    };
    const first = await token(agent.screen.id);
    const failing = await token("shape:failing");
    expect(first).toEqual(expect.any(String));
    expect(failing).not.toBe(first);
    expect(await token("shape:plain")).toBeNull();

    const html = await page(proxy, `/settings?tab=2&__unframed_state=${first}`);
    expect(html).toContain('<p id="search">?tab=2</p>');
    const bridge = bridgeOf(html)!;
    expect(bridge).toMatch(/\?state=/);
    const script = await page(proxy, bridge);
    expect(script).toContain(`window.__unframedScreenState = ${JSON.stringify({ steps, mocks: [{ url: "/api/items", status: 200, headers: { "content-type": "application/json" }, body: "[]", delay: 0 }] })};`);
    expect(await page(proxy, bridge)).not.toContain("__unframedScreenState =");

    const again = await page(proxy, `/app?__unframed_state=${first}`);
    expect(bridgeOf(again)).toBe("/__unframed/bridge.js");

    const other = await page(proxy, bridgeOf(await page(proxy, `/app?__unframed_state=${failing}`))!);
    expect(other).toContain(`window.__unframedScreenState = ${JSON.stringify({ steps: [], mocks: [{ url: "/api/items", fail: true }] })};`);
  });
});

const MENU = { action: "click", target: { role: "button", name: "Menu" } };

const stateTurn = async (agent: RepositoryAgent, tools: Array<{ name: string; input: Record<string, unknown> }>) => {
  await agent.script("states", { when: "^make states", turns: [{ text: "Made them.", tools }] });
  const chatId = await agent.createChat();
  await agent.send(chatId, "make states", { selection: [agent.screen.id] });
  return agent.settled(chatId, 1, agent.project, CHROME_TURN_MS);
};

describe.skipIf(chrome === undefined)("the screen_state tool", () => {
  it("proves states headlessly against the Instance and saves them: a click that opens a menu, a typed search, an empty list and a failed list", { timeout: 150_000 }, async () => {
    const { agent } = await liveAgent();
    const screen = agent.screen.id.replace(/^shape:/, "");
    const chat = await stateTurn(agent, [
      { name: "screen_state", input: { shapeId: screen, route: "/app", steps: [MENU, { action: "type", target: { role: "textbox", name: "Search" }, text: "pears" }], state: "the menu open while searching" } },
      { name: "screen_state", input: { shapeId: screen, route: "/app", steps: [{ action: "wait", target: { text: "No items yet" } }], mocks: [EMPTY], state: "an empty list", newScreen: true } },
      { name: "screen_state", input: { shapeId: screen, route: "/app", steps: [{ action: "wait", target: { text: "Could not load items" } }], mocks: [FAILED], state: "a failed list", newScreen: true } },
      { name: "screen_state", input: { shapeId: screen, route: "/app", steps: [{ action: "wait", target: { text: "No items yet" } }], state: "an empty list without a mock" } },
      { name: "canvas_read", input: {} },
    ]);
    const [read] = toolResults(chat, "canvas_read");
    expect(read!.result.shapes.find((shape: any) => shape.id === screen)).toMatchObject({ kind: "screen", route: "/app", state: "the menu open while searching", steps: [MENU, expect.any(Object)] });
    const [menu, empty, failed, unmocked] = toolResults(chat, "screen_state");
    expect(menu).toMatchObject({ status: "completed", result: { screen, route: "/app", state: "the menu open while searching" } });
    expect(empty).toMatchObject({ status: "completed", result: { route: "/app", state: "an empty list" } });
    expect(failed).toMatchObject({ status: "completed", result: { route: "/app", state: "a failed list" } });
    expect(unmocked).toMatchObject({ status: "failed", result: { error: 'Step 1, wait for "No items yet", failed: nothing matched "No items yet" within 5 seconds', step: 1 } });

    const records = await agent.records();
    const shown = records.find((record) => record.id === agent.screen.id);
    expect(shown.props).toMatchObject({ route: "/app", state: "the menu open while searching", steps: [MENU, { action: "type", target: { role: "textbox", name: "Search" }, text: "pears" }], mocks: [] });
    const added = records.filter((record) => record.type === "screen" && record.id !== agent.screen.id);
    expect(added.map((record) => record.props.state).sort()).toEqual(["a failed list", "an empty list"]);
    for (const record of added) expect(record.props).toMatchObject({ instance: agent.instance.id, w: agent.screen.props.w, h: agent.screen.props.h });
    expect(added.find((record) => record.props.state === "a failed list").props.mocks).toEqual([{ url: "/api/items", fail: true }]);
  });
});
