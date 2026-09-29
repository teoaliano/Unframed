import { describe, expect, it } from "vitest";
import { continuableChat, nextActive, tabLabel, tabTooltip, visibleChats, type RailChat } from "../../src/index.ts";

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
    expect(tabTooltip({ title: "", preview: "make these three stills into a landing page" })).toBe("make these three stills into a landing page");
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
