import { describe, expect, it } from "vitest";
import { continuableChat, nextActive, recapRows, revertSkipLine, tabLabel, tabTooltip, visibleChats, type ChatActivity, type RailChat } from "../../src/index.ts";

const chat = (id: string, createdAt: string, fields: Partial<RailChat> = {}): RailChat => ({
  id,
  title: "",
  preview: "",
  tags: [],
  status: "idle",
  createdAt: `2026-09-${createdAt}T10:00:00.000Z`,
  ...fields,
});

describe("visible chats", () => {
  const chats = [
    chat("old", "01", { tags: ["shape:a"] }),
    chat("both", "03", { tags: ["shape:a", "shape:b"] }),
    chat("b", "02", { tags: ["shape:b"] }),
    chat("untagged", "04"),
    chat("stale", "05", { tags: ["shape:gone"] }),
  ];

  it("shows every chat, newest first, when no artifact is selected, stale tags included", () => {
    expect(visibleChats(chats, []).map((each) => each.id)).toEqual(["stale", "untagged", "both", "b", "old"]);
  });

  it("shows the chats tagged with any selected artifact", () => {
    expect(visibleChats(chats, ["shape:a"]).map((each) => each.id)).toEqual(["both", "old"]);
    expect(visibleChats(chats, ["shape:a", "shape:b"]).map((each) => each.id)).toEqual(["both", "b", "old"]);
    expect(visibleChats(chats, ["shape:nothing"])).toEqual([]);
  });
});

describe("the active tab", () => {
  const visible = [{ id: "new" }, { id: "older" }];

  it("keeps the one last chosen while it is visible", () => {
    expect(nextActive("older", visible)).toBe("older");
  });

  it("falls back to the newest visible one, else none", () => {
    expect(nextActive("hidden", visible)).toBe("new");
    expect(nextActive(null, visible)).toBe("new");
    expect(nextActive("older", [])).toBeNull();
  });
});

describe("tab labels", () => {
  it("reads the chat's name first", () => {
    expect(tabLabel({ title: "Landing page", preview: "make a landing page" })).toBe("Landing page");
  });

  it("else the first 32 characters of the first message, with an ellipsis when cut", () => {
    expect(tabLabel({ title: "", preview: "make these three stills into a landing page" })).toBe("make these three stills into a l…");
    expect(tabLabel({ title: "", preview: "short one" })).toBe("short one");
    expect(tabLabel({ title: "", preview: "two\nlines" })).toBe("two lines");
  });

  it("else Chat", () => {
    expect(tabLabel({ title: "", preview: "" })).toBe("Chat");
    expect(tabLabel({ title: "   ", preview: "  " })).toBe("Chat");
  });

  it("gives a tooltip of the label and the opening words when they differ", () => {
    expect(tabTooltip({ title: "Landing page", preview: "make a landing page" })).toBe("Landing page · make a landing page");
    expect(tabTooltip({ title: "Same", preview: "Same" })).toBe("Same");
    expect(tabTooltip({ title: "", preview: "make these three stills into a landing page" })).toBe("make these three stills into a l… · make these three stills into a landing page");
    expect(tabTooltip({ title: "", preview: "a short one" })).toBe("a short one");
    expect(tabTooltip({ title: "", preview: "" })).toBe("Chat");
  });
});

describe("the continuable chat", () => {
  it("is the newest chat not running whose tags include every selected artifact", () => {
    const chats = [
      chat("a-only", "04", { tags: ["shape:a"] }),
      chat("both-old", "01", { tags: ["shape:a", "shape:b"] }),
      chat("both-new", "02", { tags: ["shape:b", "shape:a"] }),
      chat("both-running", "03", { tags: ["shape:a", "shape:b"], status: "running" }),
    ];
    expect(continuableChat(chats, ["shape:a", "shape:b"])?.id).toBe("both-new");
    expect(continuableChat(chats, ["shape:a"])?.id).toBe("a-only");
    expect(continuableChat(chats, ["shape:c"])).toBeUndefined();
  });

  it("is all-of, unlike the strip's any-of", () => {
    const chats = [chat("a", "01", { tags: ["shape:a"] })];
    expect(visibleChats(chats, ["shape:a", "shape:b"]).map((each) => each.id)).toEqual(["a"]);
    expect(continuableChat(chats, ["shape:a", "shape:b"])).toBeUndefined();
  });

  it("with nothing selected is the newest chat not running that has no tags", () => {
    const chats = [
      chat("tagged", "03", { tags: ["shape:a"] }),
      chat("untagged-old", "01"),
      chat("untagged-new", "02"),
      chat("untagged-running", "04", { status: "running" }),
    ];
    expect(continuableChat(chats, [])?.id).toBe("untagged-new");
  });

  it("may continue a chat whose last turn failed", () => {
    expect(continuableChat([chat("failed", "01", { status: "failed" })], [])?.id).toBe("failed");
  });
});

describe("the recap rows", () => {
  let sequence = 0;
  const activity = (kind: string, payload: Record<string, unknown>): ChatActivity => ({
    id: `a${++sequence}`,
    tone: "tool",
    kind,
    summary: kind,
    payload,
    turnId: "t1",
    sequence,
    createdAt: new Date(Date.UTC(2026, 8, 29, 10, 0, sequence)).toISOString(),
  });
  /** A call as the runtime ingests it: the input on its start, the result on its end. */
  const call = (toolName: string, input: Record<string, unknown>, result: unknown = {}) => {
    const itemId = `i${++sequence}`;
    return [
      activity("tool.started", { itemId, itemType: "mcp_tool_call", status: "inProgress", data: { toolName, input } }),
      activity("tool.completed", { itemId, itemType: "mcp_tool_call", status: "completed", data: { toolName, result } }),
    ];
  };

  it("lists what the artifact tools named and what canvas_write ops touched, in first-touch order, canvas_read adding nothing", () => {
    const activities = [
      ...call("mcp__unframed__canvas_read", {}, { shapes: [{ id: "p9" }] }),
      ...call("mcp__unframed__motion_read", { shapeId: "m1" }),
      ...call("mcp__unframed__canvas_write", { ops: [{ type: "create", id: "new:note", kind: "prompt", x: 0, y: 0 }, { type: "move", id: "m1", x: 1, y: 2 }, { type: "update", id: "shape:p2" }] }, { ok: true, ids: { "new:note": "p7" } }),
      ...call("mcp__unframed__page_write", { shapeId: "g1", title: "Landing" }),
    ];
    const rows = recapRows(activities, [], [
      { id: "shape:m1", kind: "motion", title: "Intro" },
      { id: "shape:p7", kind: "prompt" },
      { id: "shape:p2", kind: "prompt", title: "  " },
      { id: "shape:g1", kind: "page", fileName: "landing.html" },
    ]);
    expect(rows.map((row) => [row.shapeId, row.kind, row.label])).toEqual([
      ["shape:m1", "motion", "Intro"],
      ["shape:p7", "prompt", "p7"],
      ["shape:p2", "prompt", "p2"],
      ["shape:g1", "page", "landing"],
    ]);
    expect(rows.some((row) => row.shapeId === "shape:p9")).toBe(false);
  });

  it("adds the turn changes after the tool calls, and offers a diff for a page or motion whose file the turn wrote", () => {
    const activities = call("mcp__unframed__motion_write", { shapeId: "m1", title: "Intro" });
    const rows = recapRows(
      activities,
      [
        { shapeId: "shape:m1", kind: "motion", change: "updated", file: "intro.html", previousFile: "intro.html" },
        { shapeId: "shape:p4", kind: "prompt", change: "updated" },
        { shapeId: "shape:g2", kind: "page", change: "created", file: "new.html" },
      ],
      [
        { id: "shape:m1", kind: "motion", title: "Intro" },
        { id: "shape:p4", kind: "prompt", title: "Fox" },
        { id: "shape:g2", kind: "page", title: "New" },
      ],
    );
    expect(rows.map((row) => [row.label, row.rewritten])).toEqual([
      ["Intro", true],
      ["Fox", false],
      ["New", true],
    ]);
  });

  it("marks a shape no longer on the canvas deleted, keeping the title the tool gave it", () => {
    const rows = recapRows(call("mcp__unframed__page_write", { shapeId: "g1", title: "Landing" }), [], []);
    expect(rows).toEqual([{ shapeId: "shape:g1", kind: "page", label: "Landing", deleted: true, rewritten: false }]);
  });
});

describe("a revert that left shapes alone", () => {
  it("names each one and who changed it since", () => {
    expect(revertSkipLine([{ label: "Intro", by: "person" }], 2)).toBe("Left 1 shape alone because they changed since: Intro (by the person).");
    expect(revertSkipLine([{ label: "Intro", by: "person" }, { label: "Fox", by: "another chat" }], 1)).toBe(
      "Left 2 shapes alone because they changed since: Intro (by the person), Fox (by another chat).",
    );
  });

  it("says there was nothing to revert when every shape was skipped, and nothing when none was", () => {
    expect(revertSkipLine([{ label: "Intro", by: "a later turn" }], 0)).toBe("Nothing to revert: everything this turn changed has changed since.");
    expect(revertSkipLine([], 3)).toBeUndefined();
  });
});
