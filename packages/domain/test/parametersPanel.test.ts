import { describe, expect, it } from "vitest";
import { PANEL_MAX_WIDTH, PANEL_MIN_HEIGHT, PANEL_MIN_WIDTH, PANEL_WIDTH, keepPanelOnScreen, panelSize, readPanelPrefs } from "../src/index.ts";

const room = { x: 0, y: 36, w: 1440, h: 800 };

describe("the canvas Parameters panel", () => {
  it("reads a saved preference, and anything unreadable as floating with no place yet", () => {
    expect(readPanelPrefs(undefined)).toEqual({ mode: "float" });
    expect(readPanelPrefs("dock")).toEqual({ mode: "float" });
    expect(readPanelPrefs({ mode: "dock" })).toEqual({ mode: "dock" });
    expect(readPanelPrefs({ mode: "float", x: 10, y: 20, w: 400, h: 300 })).toEqual({ mode: "float", x: 10, y: 20, w: 400, h: 300 });
    expect(readPanelPrefs({ mode: "float", x: 10, y: "20", w: Number.NaN })).toEqual({ mode: "float" });
    expect(readPanelPrefs({ mode: "dock", x: 10, y: 20, w: 360 })).toEqual({ mode: "dock", x: 10, y: 20, w: 360 });
  });

  it("keeps the panel 8 px inside the room on every side", () => {
    expect(keepPanelOnScreen({ x: 100, y: 100 }, { w: 320, h: 400 }, room)).toEqual({ x: 100, y: 100 });
    expect(keepPanelOnScreen({ x: -50, y: 0 }, { w: 320, h: 400 }, room)).toEqual({ x: 8, y: 44 });
    expect(keepPanelOnScreen({ x: 5000, y: 5000 }, { w: 320, h: 400 }, room)).toEqual({ x: 1112, y: 428 });
    expect(keepPanelOnScreen({ x: 10, y: 400 }, { w: 320, h: 2000 }, room)).toEqual({ x: 10, y: 44 });
  });

  it("sizes the panel within its limits and the room, with no height meaning its content's", () => {
    expect(panelSize({}, room)).toEqual({ w: PANEL_WIDTH });
    expect(panelSize({ w: 100, h: 20 }, room)).toEqual({ w: PANEL_MIN_WIDTH, h: PANEL_MIN_HEIGHT });
    expect(panelSize({ w: 4000, h: 4000 }, room)).toEqual({ w: PANEL_MAX_WIDTH, h: 784 });
    expect(panelSize({ w: 500 }, { x: 0, y: 36, w: 400, h: 300 })).toEqual({ w: 384 });
  });
});
