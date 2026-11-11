import { describe, expect, it } from "vitest";
import { canvasView, storedShapeBoxes, type CanvasRecord } from "../../src/index.ts";

const PAGE = "page:page";

const shape = (id: string, type: string, index: string, x: number, y: number, props: Record<string, unknown>): CanvasRecord => ({
  id: `shape:${id}`,
  typeName: "shape",
  type,
  x,
  y,
  index,
  parentId: PAGE,
  props,
});

const arrowBinding = (id: string, arrow: string, to: string, terminal: "start" | "end"): CanvasRecord => ({
  id: `binding:${id}`,
  typeName: "binding",
  type: "arrow",
  fromId: `shape:${arrow}`,
  toId: `shape:${to}`,
  props: { terminal },
} as unknown as CanvasRecord);

const read = (records: CanvasRecord[]) => {
  const all: CanvasRecord[] = [{ id: PAGE, typeName: "page" }, { id: "asset:screen", typeName: "asset", type: "image", props: { src: "project-file:screen.png" } }, ...records];
  const view = canvasView({ records: all, boxes: storedShapeBoxes(all as never), recipes: new Map(), selection: [] });
  return new Map(view.shapes.map((entry) => [entry.id as string, entry]));
};

describe("canvas_read marks", () => {
  const screen = shape("screen", "image", "a1", 0, 0, { w: 400, h: 300, assetId: "asset:screen" });

  it("says which image a mark is drawn over, and which image a mark beside one is near", () => {
    const shapes = read([
      screen,
      shape("circle", "geo", "a2", 100, 100, { geo: "ellipse", w: 80, h: 40 }),
      shape("beside", "note", "a3", 440, 0, { w: 200, h: 200 }),
      shape("far", "note", "a4", 2000, 0, { w: 200, h: 200 }),
    ]);
    expect(shapes.get("circle")).toMatchObject({ on: "screen" });
    expect(shapes.get("circle")).not.toHaveProperty("near");
    expect(shapes.get("beside")).toMatchObject({ near: "screen" });
    expect(shapes.get("beside")).not.toHaveProperty("on");
    expect(shapes.get("far")).not.toHaveProperty("near");
  });

  it("names the shapes an arrow's two ends are attached to", () => {
    const shapes = read([
      screen,
      shape("beside", "note", "a2", 440, 0, { w: 200, h: 200 }),
      shape("pointer", "arrow", "a3", 440, 100, { start: { x: 0, y: 0 }, end: { x: -100, y: 0 } }),
      arrowBinding("one", "pointer", "beside", "start"),
      arrowBinding("two", "pointer", "screen", "end"),
    ]);
    expect(shapes.get("pointer")).toMatchObject({ from: "beside", to: "screen" });
  });
});
