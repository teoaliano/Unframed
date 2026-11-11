import { describe, expect, it } from "vitest";
import { DRAWER_MAX_WIDTH, DRAWER_MIN_WIDTH, DRAWER_WIDTH, PANEL_MAX_WIDTH, PANEL_MIN_HEIGHT, PANEL_MIN_WIDTH, PANEL_WIDTH, drawerWidth, keepPanelOnScreen, panelSize, readPanelPrefs, resizePanel } from "../src/index.ts";

const room = { x: 0, y: 36, w: 1440, h: 800 };

describe("the canvas Parameters panel", () => {
  it("reads a saved preference, and anything unreadable as floating with no place yet", () => {
    expect(readPanelPrefs(undefined)).toEqual({ mode: "float" });
    expect(readPanelPrefs("dock")).toEqual({ mode: "float" });
    expect(readPanelPrefs({ mode: "dock" })).toEqual({ mode: "dock" });
    expect(readPanelPrefs({ mode: "float", x: 10, y: 20, w: 400, h: 300 })).toEqual({ mode: "float", x: 10, y: 20, w: 400, h: 300 });
    expect(readPanelPrefs({ mode: "float", x: 10, y: "20", w: Number.NaN })).toEqual({ mode: "float" });
    expect(readPanelPrefs({ mode: "dock", x: 10, y: 20, w: 360 })).toEqual({ mode: "dock", x: 10, y: 20, w: 360 });
    expect(readPanelPrefs({ mode: "dock", dockW: 500 })).toEqual({ mode: "dock", dockW: 500 });
    expect(readPanelPrefs({ mode: "dock", dockW: "wide" })).toEqual({ mode: "dock" });
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

  it("resizes from any edge or corner, the opposite edges staying put", () => {
    const start = { x: 400, y: 200, w: 320, h: 400 };
    expect(resizePanel(start, "e", 80, 50, room)).toEqual({ x: 400, y: 200, w: 400, h: 400 });
    expect(resizePanel(start, "w", -80, 0, room)).toEqual({ x: 320, y: 200, w: 400, h: 400 });
    expect(resizePanel(start, "n", 0, -100, room)).toEqual({ x: 400, y: 100, w: 320, h: 500 });
    expect(resizePanel(start, "s", 0, 100, room)).toEqual({ x: 400, y: 200, w: 320, h: 500 });
    expect(resizePanel(start, "nw", -40, -40, room)).toEqual({ x: 360, y: 160, w: 360, h: 440 });
    expect(resizePanel(start, "se", 40, 40, room)).toEqual({ x: 400, y: 200, w: 360, h: 440 });
  });

  it("stops a resize at the size limits and 8 px inside the room, without moving the far edge", () => {
    const start = { x: 400, y: 200, w: 320, h: 400 };
    expect(resizePanel(start, "w", 200, 0, room)).toEqual({ x: 440, y: 200, w: PANEL_MIN_WIDTH, h: 400 });
    expect(resizePanel(start, "w", -1000, 0, room)).toEqual({ x: 80, y: 200, w: PANEL_MAX_WIDTH, h: 400 });
    expect(resizePanel({ x: 100, y: 200, w: 320, h: 400 }, "w", -1000, 0, room)).toEqual({ x: 8, y: 200, w: 412, h: 400 });
    expect(resizePanel(start, "n", 0, -1000, room)).toEqual({ x: 400, y: 44, w: 320, h: 556 });
    expect(resizePanel(start, "n", 0, 1000, room)).toEqual({ x: 400, y: 440, w: 320, h: PANEL_MIN_HEIGHT });
    expect(resizePanel(start, "se", 5000, 5000, room)).toEqual({ x: 400, y: 200, w: PANEL_MAX_WIDTH, h: 628 });
  });
});

describe("the docked drawers' width", () => {
  it("starts at 380 px and stays from 320 to 640 px", () => {
    expect(drawerWidth(undefined, 1920)).toBe(DRAWER_WIDTH);
    expect(drawerWidth("wide", 1920)).toBe(DRAWER_WIDTH);
    expect(drawerWidth(100, 1920)).toBe(DRAWER_MIN_WIDTH);
    expect(drawerWidth(2000, 1920)).toBe(DRAWER_MAX_WIDTH);
    expect(drawerWidth(501.6, 1920)).toBe(502);
  });

  it("leaves 400 px of canvas between two open drawers", () => {
    expect(drawerWidth(640, 1280)).toBe(440);
    expect(drawerWidth(640, 1440)).toBe(520);
    expect(drawerWidth(640, 900)).toBe(DRAWER_MIN_WIDTH);
  });
});
