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

  it("asks the window to draw the area around the shapes, padded, and answers its PNG with the shapes in the picture", async () => {
    const agent = await startAgentEngine();
    const link = await outsideLink(agent);
    const session = await link.open();
    const made = await link.call(session, "canvas_write", {
      project: PROJECT,
      ops: [
        { type: "create", id: "new:screen", kind: "mark", x: 100, y: 200, props: { type: "geo", w: 400, h: 300 } },
        { type: "create", id: "new:far", kind: "mark", x: 5000, y: 5000, props: { type: "geo", w: 50, h: 50 } },
      ],
    });
    const screen = (made.value.ids as Record<string, string>)["new:screen"]!;
    const far = (made.value.ids as Record<string, string>)["new:far"]!;
    const window = windowOf(agent, "window-1");
    await window.report([]);

    const call = link.call(session, "canvas_snapshot", { project: PROJECT, shapeIds: [screen] });
    const asked = (await nextItem(window.stream)) as { kind: string; requestId: string; bounds: unknown; scale: number };
    expect(asked).toMatchObject({ kind: "snapshot", bounds: { x: 52, y: 152, w: 496, h: 396 }, scale: 2 });
    await agent.rpc.call("selection.snapshotResult", { requestId: asked.requestId, png: "iVBORw0KGgo=", width: 992, height: 792 });

    const answered = await call;
    expect(answered.isError).toBe(false);
    expect(answered.value).toMatchObject({ area: { x: 52, y: 152, w: 496, h: 396 }, scale: 2, width: 992, height: 792 });
    expect(answered.value.shapes).toContain(screen);
    expect(answered.value.shapes).not.toContain(far);
    expect(answered.images).toEqual([{ data: "iVBORw0KGgo=", mimeType: "image/png" }]);
    await window.close();
  });

  it("draws a given area, scaling a large one down to 1600 pixels on its longer side and saying so", async () => {
    const agent = await startAgentEngine();
    const link = await outsideLink(agent);
    const session = await link.open();
    await seed(link, session);
    const window = windowOf(agent, "window-1");
    await window.report([]);
    const call = link.call(session, "canvas_snapshot", { project: PROJECT, area: { x: 0, y: 0, w: 8000, h: 4000 } });
    const asked = (await nextItem(window.stream)) as { requestId: string; scale: number };
    expect(asked.scale).toBe(0.2);
    await agent.rpc.call("selection.snapshotResult", { requestId: asked.requestId, png: "AA==", width: 1600, height: 800 });
    expect((await call).value.note).toBe("This area is large, so the picture is scaled down. Snapshot fewer shapes to read the details.");
    await window.close();
  });

  it("refuses an unknown shape, a bad area, a window's error, and a project with no window open", async () => {
    const agent = await startAgentEngine();
    const link = await outsideLink(agent);
    const session = await link.open();
    const { a } = await seed(link, session);
    expect((await link.call(session, "canvas_snapshot", { project: PROJECT, shapeIds: ["nope"] })).value.error).toBe("no shape with the id nope; call canvas_read for the ids");
    expect((await link.call(session, "canvas_snapshot", { project: PROJECT, area: { x: 0, y: 0, w: 0, h: 10 } })).value.error).toBe(
      "area must be {x, y, w, h} with numbers, and w and h above zero",
    );
    expect((await link.call(session, "canvas_snapshot", { project: PROJECT, shapeIds: [a] })).value.error).toBe(
      "Unframed has no window open on this project, so there is nothing to look at. Ask the person to open the project in Unframed.",
    );
    const window = windowOf(agent, "window-1");
    await window.report([]);
    const call = link.call(session, "canvas_snapshot", { project: PROJECT, shapeIds: [a] });
    const asked = (await nextItem(window.stream)) as { requestId: string };
    await agent.rpc.call("selection.snapshotResult", { requestId: asked.requestId, error: "Nothing is drawn in that area of the canvas." });
    const refused = await call;
    expect(refused.isError).toBe(true);
    expect(refused.value.error).toBe("Nothing is drawn in that area of the canvas.");
    await window.close();
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
