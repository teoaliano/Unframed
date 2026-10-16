import { describe, expect, it } from "vitest";
import { PROJECT, startAgentEngine, UNFRAMED_TOOLS } from "./agent.ts";
import { outsideLink } from "./outsideCalls.ts";

const prompt = (id: string, text: string) => ({ type: "create", id, kind: "prompt", x: 0, y: 0, props: { text } });

const NO_WINDOW = "Unframed has no window open on this project, so there is no selection to read.";

/** A window of the app: its selection stream, and the two things it does, report and receive. */
const windowOf = (agent: Awaited<ReturnType<typeof startAgentEngine>>, windowId: string) => {
  const stream = agent.rpc.subscribe("selection.subscribe", { project: PROJECT, windowId });
  return {
    stream,
    report: (roomIds: string[]) => agent.rpc.call("selection.report", { project: PROJECT, windowId, shapeIds: roomIds }),
    close: () => stream.close(),
  };
};

/** Makes two prompts from outside. Returns each one's id as canvas_read names it, and as the room holds it. */
const seed = async (link: Awaited<ReturnType<typeof outsideLink>>, session: string) => {
  const made = await link.call(session, "canvas_write", { project: PROJECT, ops: [prompt("new:a", "first"), prompt("new:b", "second")] });
  const ids = made.value.ids as Record<string, string>;
  const a = ids["new:a"]!;
  const b = ids["new:b"]!;
  return { a, b, roomA: `shape:${a}`, roomB: `shape:${b}` };
};

describe("the live selection", () => {
  it("answers the selection of the window that changed most recently, and an earlier one once that window closes", async () => {
    const agent = await startAgentEngine();
    const link = await outsideLink(agent);
    const session = await link.open();
    const { a, b, roomA, roomB } = await seed(link, session);

    const first = windowOf(agent, "window-1");
    await first.report([roomA]);
    expect((await link.call(session, "canvas_read", { project: PROJECT })).value.selection).toEqual([a]);

    const second = windowOf(agent, "window-2");
    await second.report([roomB]);
    expect((await link.call(session, "canvas_read", { project: PROJECT })).value.selection).toEqual([b]);

    await second.close();
    await waitUntil(async () => (await link.call(session, "canvas_read", { project: PROJECT })).value.selection[0] === a);
    expect((await link.call(session, "canvas_read", { project: PROJECT })).value.selection).toEqual([a]);
    await first.close();
  });

  it("answers an empty selection and says why when no window has the project open", async () => {
    const agent = await startAgentEngine();
    const link = await outsideLink(agent);
    const session = await link.open();
    await seed(link, session);
    const read = await link.call(session, "canvas_read", { project: PROJECT });
    expect(read.value.selection).toEqual([]);
    expect(read.value.selectionNote).toBe(NO_WINDOW);
  });

  it("leaves out a selected shape that no longer exists", async () => {
    const agent = await startAgentEngine();
    const link = await outsideLink(agent);
    const session = await link.open();
    const { a, b, roomA, roomB } = await seed(link, session);
    const window = windowOf(agent, "window-1");
    await window.report([roomA, roomB]);
    await link.call(session, "canvas_write", { project: PROJECT, ops: [{ type: "delete", id: a }] });
    expect((await link.call(session, "canvas_read", { project: PROJECT })).value.selection).toEqual([b]);
    await window.close();
  });

  it("sets the window's selection through canvas_select, answers what the window reports, and lists unknown ids as missing", async () => {
    const agent = await startAgentEngine();
    const link = await outsideLink(agent);
    const session = await link.open();
    const { a, roomA } = await seed(link, session);
    const window = windowOf(agent, "window-1");
    await window.report([]);

    const call = link.call(session, "canvas_select", { project: PROJECT, shapeIds: [a, "not-a-shape"] });
    const apply = await nextItem(window.stream);
    expect(apply).toMatchObject({ kind: "apply", shapeIds: [roomA] });
    await window.report([roomA]);
    expect((await call).value).toEqual({ selection: [a], missing: ["not-a-shape"] });
    await window.close();
  });

  it("clears the selection with an empty list", async () => {
    const agent = await startAgentEngine();
    const link = await outsideLink(agent);
    const session = await link.open();
    const { roomA } = await seed(link, session);
    const window = windowOf(agent, "window-1");
    await window.report([roomA]);
    const call = link.call(session, "canvas_select", { project: PROJECT, shapeIds: [] });
    expect(await nextItem(window.stream)).toMatchObject({ kind: "apply", shapeIds: [] });
    await window.report([]);
    expect((await call).value).toEqual({ selection: [], missing: [] });
    await window.close();
  });

  it("answers the note and changes nothing when no window is open", async () => {
    const agent = await startAgentEngine();
    const link = await outsideLink(agent);
    const session = await link.open();
    const { a } = await seed(link, session);
    const answered = await link.call(session, "canvas_select", { project: PROJECT, shapeIds: [a] });
    expect(answered.value).toEqual({ selection: [], missing: [], selectionNote: NO_WINDOW });
  });

  it("keeps canvas_select off the in-app tool list", async () => {
    const agent = await startAgentEngine();
    const link = await outsideLink(agent);
    const session = await link.open();
    expect((await link.list(session)).map((tool) => tool.name)).toContain("canvas_select");
    expect(UNFRAMED_TOOLS).not.toContain("canvas_select");
    expect(agent.engine.port).toBeGreaterThan(0);
  });
});

/** The next item a stream receives after the ones it already holds. */
const nextItem = (stream: { values: unknown[]; next: (index?: number) => Promise<unknown> }) => stream.next(stream.values.length);

const waitUntil = async (check: () => Promise<boolean>) => {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("timed out waiting for the selection to change");
};
