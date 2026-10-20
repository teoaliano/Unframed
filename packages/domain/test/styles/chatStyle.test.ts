import { describe, expect, it } from "vitest";
import { buildTimeline, decide, describeTool, UNFRAMED_WRITE_TOOLS, decidePermission, type ProjectChats } from "../../src/index.ts";
import { chatOf, created, decideOn, NOW, run } from "../agent/chatFixtures.ts";

const send = (model: ProjectChats, messageId: string, style?: { id: string; title: string; previousTitle?: string }) =>
  run(model, { type: "thread.turn.start", message: { messageId, text: "make a page", attachments: [], ...(style ? { style } : {}) }, createdAt: NOW });

const rejection = (decision: ReturnType<typeof decideOn>) => (decision.ok ? undefined : decision.rejection);

describe("a chat's style", () => {
  it("starts with none", () => {
    expect(chatOf(created()).style).toBeNull();
  });

  it("is attached by a message with a style selected, and the work log of that turn says so", () => {
    const chat = chatOf(send(created(), "m1", { id: "shape:s1", title: "Linear" }));
    expect(chat.style).toBe("shape:s1");
    const attached = chat.activities.find((activity) => activity.kind === "style.attached");
    expect(attached).toMatchObject({ id: "style:m1", tone: "info", summary: "Following the style “Linear”", turnId: "turn:m1", payload: { styleId: "shape:s1", previous: null } });
    const rows = buildTimeline(chat)[0]!.blocks.flatMap((block) => (block.kind === "work" ? block.entries : []));
    expect(rows).toEqual([expect.objectContaining({ kind: "row", label: "Following the style “Linear”", tone: "info" })]);
  });

  it("is kept by a message with no style selected, and by one with the same style, which logs nothing", () => {
    const first = send(created(), "m1", { id: "shape:s1", title: "Linear" });
    run(first, { type: "thread.turn.settle", turnCount: 1, clock: null });
    const second = send(run(first, { type: "thread.session.set", session: { status: "ready", activeTurnId: null, lastError: null } }), "m2");
    expect(chatOf(second).style).toBe("shape:s1");
    const third = send(run(second, { type: "thread.session.set", session: { status: "ready", activeTurnId: null, lastError: null } }), "m3", { id: "shape:s1", title: "Linear" });
    expect(chatOf(third).activities.filter((activity) => activity.kind === "style.attached")).toHaveLength(1);
  });

  it("is replaced by a newer one, naming the one it replaces", () => {
    const first = send(created(), "m1", { id: "shape:s1", title: "Linear" });
    const ready = run(first, { type: "thread.session.set", session: { status: "ready", activeTurnId: null, lastError: null } });
    const chat = chatOf(send(ready, "m2", { id: "shape:s2", title: "Stripe", previousTitle: "Linear" }));
    expect(chat.style).toBe("shape:s2");
    expect(chat.activities.at(-1)).toMatchObject({ summary: "Following the style “Stripe” in place of “Linear”", turnId: "turn:m2", payload: { previous: "shape:s1" } });
  });

  it("is detached by the person, and an Undo attaches it again", () => {
    const attached = send(created(), "m1", { id: "shape:s1", title: "Linear" });
    const detached = run(attached, { type: "thread.style.remove", styleId: "shape:s1" });
    expect(chatOf(detached).style).toBeNull();
    expect(rejection(decideOn(detached, { type: "thread.style.remove", styleId: "shape:s1" }))).toEqual({ code: "not_found", message: "This chat does not follow that style." });
    const undone = run(detached, { type: "thread.style.set", styleId: "shape:s1" });
    expect(chatOf(undone).style).toBe("shape:s1");
    expect(rejection(decideOn(undone, { type: "thread.style.set", styleId: "shape:s1" }))?.message).toBe("Command produced no events.");
  });

  it("records each change as an event in the chat's log", () => {
    const attached = send(created(), "m1", { id: "shape:s1", title: "Linear" });
    const decision = decide({ commandId: "c", projectId: "board", threadId: "chat-1", type: "thread.style.remove", styleId: "shape:s1" }, attached, NOW);
    expect(decision.ok && decision.events).toEqual([{ type: "thread.style-set", aggregateId: "chat-1", payload: { threadId: "chat-1", styleId: null, previous: "shape:s1" } }]);
  });
});

describe("the style tools in the work log and the permission policy", () => {
  it("labels each call", () => {
    const label = (tool: string, input: Record<string, unknown>) =>
      describeTool({ toolName: `mcp__unframed__${tool}`, itemType: "mcp_tool_call", toolInput: input, data: {}, result: {}, state: "completed" });
    expect(label("style_read", { shapeId: "s1" })).toEqual({ label: "Read style s1", action: "read" });
    expect(label("style_write", { title: "Linear" })).toEqual({ label: "Wrote style Linear", action: "canvas" });
    expect(label("style_edit", { shapeId: "s1" })).toEqual({ label: "Edited style s1", action: "canvas" });
  });

  it("allows a read in plan mode and refuses the writes", () => {
    const decide = (tool: string) => decidePermission({ runtimeMode: "full-access", interactionMode: "plan", tool: `mcp__unframed__${tool}`, input: {} }).kind;
    expect(decide("style_read")).toBe("allow");
    expect(decide("style_write")).toBe("deny");
    expect(decide("style_edit")).toBe("deny");
    expect(UNFRAMED_WRITE_TOOLS.has("style_write")).toBe(true);
  });
});

describe("canvas_read and canvas_write on styles", () => {
  const base = { typeName: "shape", x: 0, y: 0, index: "a1", parentId: "page:page" } as const;
  const records = [
    { ...base, id: "shape:s1", type: "style", props: { w: 320, h: 240, file: "1-linear.md", title: "Linear", fileName: "", swatches: ["#5e6ad2"], excerpt: "Calm." }, meta: { ref: "100" } },
    { ...base, id: "shape:p1", type: "page", index: "a2", props: { w: 480, h: 320, file: "1-home.html", title: "Home", fileName: "", style: "shape:s1" }, meta: { ref: "101" } },
  ];

  it("reports a style by id, ref, title and file, never its text, and a page with the style it was made with", async () => {
    const { canvasView, prepareBatch } = await import("../../src/index.ts");
    const view = canvasView({ records, boxes: new Map(), recipes: new Map(), selection: [] });
    expect(view.shapes).toEqual([
      { id: "s1", kind: "style", x: 0, y: 0, w: 0, h: 0, ref: "100", file: "1-linear.md", title: "Linear" },
      { id: "p1", kind: "page", x: 0, y: 0, w: 0, h: 0, ref: "101", file: "1-home.html", title: "Home", style: "s1" },
    ]);
    const refused = prepareBatch([{ type: "create", id: "new:s", kind: "style", x: 0, y: 0, props: {} }], {
      records,
      file: () => undefined,
      newShapeId: () => "shape:x",
      newAssetId: () => "asset:x",
      indexAbove: () => "a9",
      pageId: "page:page",
      boxes: new Map(),
    });
    expect(refused).toEqual({ ok: false, error: "create: make styles with style_write" });
  });
});
