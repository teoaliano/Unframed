import { describe, expect, it } from "vitest";
import { flowTooMany, slugName } from "@unframed/domain";
import { toolResults } from "./agentCanvas.ts";
import { chromeOnMachine } from "./chrome.ts";
import { liveAgent, stateTurn } from "./repositoryAgent.ts";

const shapesIn = (records: any[], parentId: string, type: string) => records.filter((record) => record.typeName === "shape" && record.parentId === parentId && record.type === type);

const labelOf = (arrow: any): string => arrow.props.richText.content.flatMap((paragraph: any) => (paragraph.content ?? []).map((node: any) => node.text)).join("");

const MENU = { action: "click", target: { role: "button", name: "Menu" } };
const OPEN = { route: "/app", state: "the app" };
const MENU_OPEN = { route: "/app", steps: [MENU], state: "the menu open", action: "click Menu" };
const EMPTY = { route: "/app", steps: [{ action: "wait", target: { text: "No items yet" } }], mocks: [{ url: "/api/items", body: [] }], state: "an empty list" };

describe.skipIf(chromeOnMachine === undefined)("flow_create", () => {
  it("proves each state and builds the Flow as one change: Screens of the Instance holding the states, in a group named after the branch, joined by arrows labelled with each action", { timeout: 150_000 }, async () => {
    const { agent } = await liveAgent();
    const screen = agent.screen.id.replace(/^shape:/, "");
    const chat = await stateTurn(agent, [{ name: "flow_create", input: { shapeId: screen, states: [OPEN, MENU_OPEN, EMPTY] } }, { name: "canvas_read", input: {} }]);
    const [built] = toolResults(chat, "flow_create");
    expect(built).toMatchObject({ status: "completed", result: { group: expect.any(String), screens: [expect.any(String), expect.any(String), expect.any(String)] } });
    const records = await agent.records();
    const group = `shape:${built!.result.group}`;
    const frame = records.find((record) => record.id === group);
    expect(frame).toMatchObject({ type: "frame", x: agent.screen.x, props: { name: slugName(agent.instance.branch) } });
    expect(frame.y).toBeGreaterThanOrEqual(agent.screen.y + agent.screen.props.h);
    const members = shapesIn(records, group, "screen");
    expect(members.map((member) => member.props.state)).toEqual(["the app", "the menu open", "an empty list"]);
    expect(members[1].props).toMatchObject({ instance: agent.instance.id, route: "/app", steps: [MENU], mocks: [], w: agent.screen.props.w, h: agent.screen.props.h });
    expect(members[2].props.mocks).toEqual([{ url: "/api/items", status: 200, headers: { "content-type": "application/json" }, body: "[]", delay: 0 }]);
    const arrows = shapesIn(records, group, "arrow");
    const bindings = records.filter((record) => record.typeName === "binding" && record.type === "arrow");
    const ends = arrows.map((arrow) => {
      const of = bindings.filter((binding) => binding.fromId === arrow.id);
      return [of.find((binding) => binding.props.terminal === "start")?.toId, of.find((binding) => binding.props.terminal === "end")?.toId, labelOf(arrow)];
    });
    expect(ends).toEqual([
      [members[0].id, members[1].id, "click Menu"],
      [members[1].id, members[2].id, 'wait for "No items yet"'],
    ]);
    const [read] = toolResults(chat, "canvas_read");
    expect(read!.result.shapes.find((shape: any) => shape.id === built!.result.group)).toMatchObject({ kind: "group", members: expect.arrayContaining(built!.result.screens) });
  });

  it("builds nothing when one state fails, naming it, and refuses too many states for the viewport", { timeout: 150_000 }, async () => {
    const { agent } = await liveAgent();
    const screen = agent.screen.id.replace(/^shape:/, "");
    const broken = { route: "/app", steps: [{ action: "click", target: { role: "button", name: "Missing" } }], state: "a missing menu", action: "click Missing" };
    const chat = await stateTurn(agent, [
      { name: "flow_create", input: { shapeId: screen, states: [OPEN, broken, EMPTY] } },
      { name: "flow_create", input: { shapeId: screen, states: Array.from({ length: 9 }, () => OPEN) } },
    ]);
    const [failed, tooMany] = toolResults(chat, "flow_create");
    expect(failed).toMatchObject({ status: "failed", result: { error: "State 2, a missing menu: Step 1, click button Missing, failed: nothing matched button Missing within 5 seconds. Nothing was built.", state: 2 } });
    expect(tooMany).toMatchObject({ status: "failed", result: { error: flowTooMany(8) } });
    expect((await agent.records()).filter((record) => record.type === "frame")).toEqual([]);
  });
});
