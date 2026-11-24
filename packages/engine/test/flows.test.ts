import { describe, expect, it } from "vitest";
import { flowTooMany, slugName } from "@unframed/domain";
import { toolResults } from "./agentCanvas.ts";
import { startRepositoryAgent } from "./repositoryAgent.ts";

const shapesIn = (records: any[], parentId: string, type: string) => records.filter((record) => record.typeName === "shape" && record.parentId === parentId && record.type === type);

describe("exploding a Screen into a Flow", () => {
  it("lays the typed routes out as Screens of its Instance in a group named after the branch, joined by arrows in order, below the canvas", { timeout: 60_000 }, async () => {
    const agent = await startRepositoryAgent();
    const { group, screens } = await agent.rpc.call("screens.explode", { project: agent.project, shapeId: agent.screen.id, routes: ["/", "pricing", "/checkout", "/pricing"] });
    const records = await agent.records();
    const frame = records.find((record) => record.id === group);
    expect(frame).toMatchObject({ type: "frame", x: agent.screen.x, props: { name: slugName(agent.instance.branch) } });
    expect(frame.y).toBeGreaterThanOrEqual(agent.screen.y + agent.screen.props.h);
    const members = shapesIn(records, group, "screen");
    expect(members.map((screen) => screen.id)).toEqual(screens);
    expect(members.map((screen) => screen.props.route)).toEqual(["/", "/pricing", "/checkout"]);
    for (const screen of members) expect(screen).toMatchObject({ props: { instance: agent.instance.id, w: 1280, h: 800, title: agent.instance.branch }, meta: { ref: expect.any(String) } });
    expect(new Set(members.map((screen) => screen.meta.ref)).size).toBe(3);
    const arrows = shapesIn(records, group, "arrow");
    expect(arrows).toHaveLength(2);
    const bindings = records.filter((record) => record.typeName === "binding" && record.type === "arrow");
    const ends = arrows.map((arrow) => {
      const of = bindings.filter((binding) => binding.fromId === arrow.id);
      return [of.find((binding) => binding.props.terminal === "start")?.toId, of.find((binding) => binding.props.terminal === "end")?.toId];
    });
    expect(ends).toEqual([
      [screens[0], screens[1]],
      [screens[1], screens[2]],
    ]);
  });

  it("refuses a route that is not a path, too many routes for the viewport, and a shape that is not a Screen", { timeout: 60_000 }, async () => {
    const agent = await startRepositoryAgent();
    const explode = (routes: string[], shapeId = agent.screen.id) => agent.rpc.call("screens.explode", { project: agent.project, shapeId, routes });
    await expect(explode(["/", "https://example.com/"])).rejects.toMatchObject({ code: "bad_request", message: expect.stringMatching(/not a route/) });
    await expect(explode(Array.from({ length: 9 }, (_, n) => `/page-${n}`))).rejects.toMatchObject({ code: "bad_request", message: flowTooMany(8) });
    await expect(explode([])).rejects.toMatchObject({ code: "bad_request" });
    await expect(explode(["/"], "shape:nope")).rejects.toMatchObject({ code: "bad_request", message: expect.stringMatching(/no Screen/) });
    expect((await agent.records()).filter((record) => record.type === "frame")).toEqual([]);
  });

  it("is a tool the agent calls with the routes it proposes, and canvas_read then reports the Flow", { timeout: 60_000 }, async () => {
    const agent = await startRepositoryAgent();
    const screen = agent.screen.id.replace(/^shape:/, "");
    await agent.script("flow", {
      when: "^explode",
      turns: [{ text: "Laid out three routes.", tools: [{ name: "screen_explode", input: { shapeId: screen, routes: ["/", "/settings", "/team"] } }, { name: "canvas_read", input: {} }] }],
    });
    const chatId = await agent.createChat();
    await agent.send(chatId, "explode it", { selection: [agent.screen.id] });
    const chat = await agent.settled(chatId, 1);
    const [exploded] = toolResults(chat, "screen_explode");
    expect(exploded).toMatchObject({ status: "completed", result: { group: expect.any(String), screens: [expect.any(String), expect.any(String), expect.any(String)] } });
    const [read] = toolResults(chat, "canvas_read");
    const group = read!.result.shapes.find((shape: any) => shape.id === exploded!.result.group);
    expect(group).toMatchObject({ kind: "group", members: expect.arrayContaining(exploded!.result.screens) });
    const arrows = read!.result.shapes.filter((shape: any) => shape.kind === "mark" && shape.type === "arrow");
    expect(arrows.map((arrow: any) => [arrow.from, arrow.to])).toEqual([
      [exploded!.result.screens[0], exploded!.result.screens[1]],
      [exploded!.result.screens[1], exploded!.result.screens[2]],
    ]);
  });
});
