import { describe, expect, it } from "vitest";
import { toolResults } from "./agentCanvas.ts";
import { chromeOnMachine as chrome } from "./chrome.ts";
import { REACT_APP, REACT_CARD, positionOf, prepareReactApp } from "./reactFixture.ts";
import { liveAgent, stateTurn } from "./repositoryAgent.ts";

if (chrome === undefined) console.log("  screen_element tests skipped: no Chrome, Chromium, Edge or Brave on this machine");

describe.skipIf(chrome === undefined)("the screen_element tool", () => {
  it("resolves a Screen's element to its file, JSX span, component and instance, and refuses what it cannot", { timeout: 150_000 }, async () => {
    const { agent } = await liveAgent(prepareReactApp);
    await agent.rpc.call("testCanvas.apply", { project: agent.project, change: { put: [{ ...agent.screen, props: { ...agent.screen.props, route: "/react" } }], remove: [] }, origin: { kind: "server", id: "test" } });
    const screen = agent.screen.id.replace(/^shape:/, "");
    const chat = await stateTurn(agent, [
      { name: "screen_element", input: { shapeId: screen, selector: "header" } },
      { name: "screen_element", input: { shapeId: screen, selector: "li:nth-of-type(2)" } },
      { name: "screen_element", input: { shapeId: screen, selector: "#nowhere" } },
    ]);
    const [header, card, nothing] = toolResults(chat, "screen_element");
    const at = positionOf(REACT_APP, "<header");
    expect(header).toMatchObject({ status: "completed", result: { file: "src/App.jsx", line: at.line, col: at.col, endLine: at.line + 2, tag: "header", component: "Header", instanceOf: "Header", instanceIndex: 0, instanceCount: 1, selfMapped: true } });
    expect(header!.result.jsx).toContain('<header className="flex h-12 items-center pl-3.5 pr-2">');
    expect(card).toMatchObject({ status: "completed", result: { file: "src/Card.jsx", ...positionOf(REACT_CARD, "<li"), component: "Card", instanceOf: "Card", props: { title: "Second" }, instanceIndex: 1, instanceCount: 3 } });
    expect(nothing).toMatchObject({ status: "failed", result: { error: "nothing on the Screen matches #nowhere" } });
  });
});
