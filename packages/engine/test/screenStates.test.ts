import { describe, expect, it } from "vitest";
import { startRepositoryAgent, type RepositoryAgent } from "./repositoryAgent.ts";

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
