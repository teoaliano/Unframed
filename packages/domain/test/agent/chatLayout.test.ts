import { describe, expect, it } from "vitest";
import { CHAT_LAYOUTS, CHAT_WINDOW_HEIGHT, CHAT_WINDOW_LIMITS, chatContainer, chatLayoutOf, panelSize, readChatWindow, resizePanel } from "../../src/index.ts";

const room = { x: 0, y: 36, w: 1440, h: 800 };

describe("the agent chat layout preference", () => {
  it("reads the three layouts and anything missing or unknown as the side panel", () => {
    expect(CHAT_LAYOUTS).toEqual(["panel", "composer", "window"]);
    for (const layout of CHAT_LAYOUTS) expect(chatLayoutOf(layout)).toBe(layout);
    for (const value of [undefined, null, "", "dock", "Window", 1, true, {}, ["window"]]) expect(chatLayoutOf(value)).toBe("panel");
  });

  it("shows the side panel and the floating window as the left Sheet on a narrow window, and the floating composer as itself", () => {
    expect(chatContainer("panel", false)).toBe("rail");
    expect(chatContainer("window", false)).toBe("window");
    expect(chatContainer("composer", false)).toBe("composer");
    expect(chatContainer("panel", true)).toBe("sheet");
    expect(chatContainer("window", true)).toBe("sheet");
    expect(chatContainer("composer", true)).toBe("composer");
  });
});

describe("the agent chat window's saved place", () => {
  it("reads a saved place and size, defaulting the size and always floating", () => {
    expect(readChatWindow(undefined)).toEqual({ mode: "float", w: CHAT_WINDOW_LIMITS.w, h: CHAT_WINDOW_HEIGHT });
    expect(readChatWindow("corner")).toEqual({ mode: "float", w: CHAT_WINDOW_LIMITS.w, h: CHAT_WINDOW_HEIGHT });
    expect(readChatWindow({ mode: "dock", x: 10, y: 60, w: 500, h: 420, dockW: 300 })).toEqual({ mode: "float", x: 10, y: 60, w: 500, h: 420 });
    expect(readChatWindow({ x: 10, w: "wide", h: Number.NaN })).toEqual({ mode: "float", w: CHAT_WINDOW_LIMITS.w, h: CHAT_WINDOW_HEIGHT });
  });

  it("keeps the window within its own limits, larger than the Parameters panel's", () => {
    expect(panelSize({ w: 100, h: 100 }, room, CHAT_WINDOW_LIMITS)).toEqual({ w: CHAT_WINDOW_LIMITS.minW, h: CHAT_WINDOW_LIMITS.minH });
    expect(panelSize({ w: 4000, h: 4000 }, room, CHAT_WINDOW_LIMITS)).toEqual({ w: CHAT_WINDOW_LIMITS.maxW, h: 784 });
    expect(resizePanel({ x: 400, y: 200, w: 400, h: 400 }, "se", -300, -300, room, CHAT_WINDOW_LIMITS)).toEqual({ x: 400, y: 200, w: CHAT_WINDOW_LIMITS.minW, h: CHAT_WINDOW_LIMITS.minH });
    expect(resizePanel({ x: 400, y: 200, w: 400, h: 400 }, "nw", 300, 300, room, CHAT_WINDOW_LIMITS)).toEqual({ x: 480, y: 280, w: CHAT_WINDOW_LIMITS.minW, h: CHAT_WINDOW_LIMITS.minH });
  });
});
