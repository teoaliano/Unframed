import { describe, expect, it } from "vitest";
import { plainText, prepareBatch, readRef, type BatchContext, type CanvasRecord } from "../../src/index.ts";

const PAGE = "page:page";

const text = (value: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: value }] }] });

const prompt = (id: string, ref: string, value: string, at: Partial<CanvasRecord> = {}): CanvasRecord => ({
  id: `shape:${id}`,
  typeName: "shape",
  type: "text",
  x: 0,
  y: 0,
  index: "a1",
  parentId: PAGE,
  props: { w: 320, richText: text(value) },
  meta: { ref },
  ...at,
});

const group = (id: string, name: string, at: Partial<CanvasRecord> = {}): CanvasRecord => ({
  id: `shape:${id}`,
  typeName: "shape",
  type: "frame",
  x: 500,
  y: 100,
  index: "a2",
  parentId: PAGE,
  props: { w: 420, h: 280, name, color: "black" },
  meta: {},
  ...at,
});

const motion = (id: string, title: string): CanvasRecord => ({
  id: `shape:${id}`,
  typeName: "shape",
  type: "motion",
  x: 0,
  y: 400,
  index: "a3",
  parentId: PAGE,
  props: { w: 640, h: 360, file: "intro.html", title, fileName: "" },
  meta: { ref: "150" },
});

const context = (records: CanvasRecord[], files: Record<string, { w?: number; h?: number; mime?: string }> = {}): BatchContext => {
  let n = 0;
  let index = 0;
  return {
    records: [{ id: PAGE, typeName: "page" }, ...records],
    file: (name) => (name in files ? { fileName: `original-${name}`, ...files[name] } : undefined),
    newShapeId: () => `shape:fresh-${++n}`,
    newAssetId: () => `asset:fresh-${++n}`,
    indexAbove: () => `b${++index}`,
    pageId: PAGE,
    boxes: new Map(),
  };
};

const error = (ops: unknown, records: CanvasRecord[] = [], files = {}) => {
  const result = prepareBatch(ops, context(records, files));
  return result.ok ? undefined : result.error;
};

describe("canvas_write refusals", () => {
  it("refuses a batch that is not a non-empty array, or has more than 200 ops", () => {
    expect(error(undefined)).toBe("ops must be a non-empty array");
    expect(error([])).toBe("ops must be a non-empty array");
    expect(error({ type: "move" })).toBe("ops must be a non-empty array");
    const moves = Array.from({ length: 201 }, () => ({ type: "move", id: "p1", x: 0, y: 0 }));
    expect(error(moves, [prompt("p1", "100", "x")])).toBe("at most 200 ops per call");
    expect(error(moves.slice(0, 200), [prompt("p1", "100", "x")])).toBeUndefined();
  });

  it("refuses an op that is not an object, a nested batch and an unknown op", () => {
    expect(error(["move"])).toBe("every op must be an object");
    expect(error([{ type: "batch", ops: [] }])).toBe("a call is already one batch; pass the ops flat");
    expect(error([{ type: "explode" }])).toBe('unknown op type "explode"');
    expect(error([{ id: "p1" }])).toBe('unknown op type "undefined"');
  });

  it("refuses a create with a bad kind, a page or motion, no id, an existing id or no position", () => {
    expect(error([{ type: "create", id: "new:a", kind: "sticker", x: 0, y: 0, props: {} }])).toBe('create: unknown kind "sticker"');
    expect(error([{ type: "create", id: "new:a", kind: "page", x: 0, y: 0, props: {} }])).toBe("create: make pages and motions with page_write and motion_write");
    expect(error([{ type: "create", id: "new:a", kind: "motion", x: 0, y: 0, props: {} }])).toBe("create: make pages and motions with page_write and motion_write");
    expect(error([{ type: "create", kind: "prompt", x: 0, y: 0, props: {} }])).toBe('create: id must be a string (use "new:<name>" for a fresh id)');
    expect(error([{ type: "create", id: "p1", kind: "prompt", x: 0, y: 0, props: {} }], [prompt("p1", "100", "x")])).toBe("create: shape p1 already exists");
    expect(error([{ type: "create", id: "new:a", kind: "prompt", x: "0", y: 0, props: {} }])).toBe("create: x and y must be numbers");
  });

  it("refuses bytes anywhere in props, in any case", () => {
    expect(error([{ type: "create", id: "new:a", kind: "prompt", x: 0, y: 0, props: { text: "DATA:image/png;base64,AAAA" } }])).toBe(
      "create: bytes cannot travel in shape props; name a file in the project folder instead",
    );
    expect(error([{ type: "update", id: "p1", props: { nested: { deep: ["data:text/html,<b>"] } } }], [prompt("p1", "100", "x")])).toBe(
      "update: bytes cannot travel in shape props; name a file in the project folder instead",
    );
  });

  it("refuses a file that is not in the project folder, outside paths included", () => {
    expect(error([{ type: "create", id: "new:i", kind: "image", x: 0, y: 0, props: { file: "missing.png" } }])).toBe(
      'create: no file named "missing.png" in the project folder',
    );
    expect(error([{ type: "create", id: "new:i", kind: "image", x: 0, y: 0, props: { file: "../other/hero.png" } }], [], { "hero.png": {} })).toBe(
      'create: no file named "../other/hero.png" in the project folder',
    );
  });

  it("reports a structural failure the canvas meets, and changes nothing", () => {
    expect(error([{ type: "update", id: "gone", props: { title: "x" } }])).toBe("update: there is no shape gone");
    expect(error([{ type: "reparent", id: "m1", parent: "g1" }], [group("g1", "hero"), motion("m1", "Intro")])).toBe(
      "reparent: a motion cannot be a member of a group",
    );
  });
});

describe("canvas_write batches", () => {
  it("maps every new: id to a fresh id wherever the batch names it", () => {
    const result = prepareBatch(
      [
        { type: "create", id: "new:box", kind: "group", x: 10, y: 10, props: { name: "Hero Shots" } },
        { type: "create", id: "new:caption", kind: "prompt", x: 20, y: 60, parent: "new:box", props: { text: "a fox" } },
        { type: "move", id: "new:caption", x: 30, y: 70 },
      ],
      context([prompt("p1", "120", "see @125")]),
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.ids).toEqual({ "new:box": "fresh-1", "new:caption": "fresh-2" });
    const caption = result.put.find((record) => record.id === "shape:fresh-2")!;
    expect(caption).toMatchObject({ parentId: "shape:fresh-1", x: 30, y: 70, type: "text" });
    expect(plainText(caption.props!.richText)).toBe("a fox");
    const box = result.put.find((record) => record.id === "shape:fresh-1")!;
    expect(box.props).toMatchObject({ name: "hero-shots" });
  });

  it("gives a new prompt its @id from the canvas counter, never from the agent", () => {
    const result = prepareBatch(
      [{ type: "create", id: "new:p", kind: "prompt", x: 0, y: 0, props: { text: "x" }, meta: { ref: "120" } }],
      context([prompt("p1", "120", "see @125")]),
    );
    if (!result.ok) throw new Error(result.error);
    expect(readRef(result.put[0]!)).toBe("126");
  });

  it("strips the run marker and run error from what the agent sends", () => {
    const result = prepareBatch(
      [
        {
          type: "create",
          id: "new:i",
          kind: "image",
          x: 0,
          y: 0,
          props: { file: "hero.png", meta: { unframed: { run: { runId: "r1" } } }, unframed: { runError: "x" } },
        },
      ],
      context([], { "hero.png": { w: 800, h: 400, mime: "image/png" } }),
    );
    if (!result.ok) throw new Error(result.error);
    const image = result.put.find((record) => record.typeName === "shape")!;
    expect(image.props).not.toHaveProperty("meta");
    expect(image.props).not.toHaveProperty("unframed");
    expect(image.meta).toEqual({ ref: "100" });
    expect(image.props).toMatchObject({ w: 480, h: 240 });
    const asset = result.put.find((record) => record.typeName === "asset")!;
    expect(asset.props).toMatchObject({ src: "project-file:hero.png", name: "original-hero.png", w: 800, h: 400 });
  });

  it("patches props shallowly, null deleting a key, and turns a prompt's text into rich text", () => {
    const records = [motion("m1", "Intro"), prompt("p1", "100", "old")];
    const result = prepareBatch(
      [
        { type: "update", id: "m1", props: { title: "Intro (red)", dials: null } },
        { type: "update", id: "p1", props: { text: "new words" } },
      ],
      context(records),
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.put.find((record) => record.id === "shape:m1")!.props).toEqual({ w: 640, h: 360, file: "intro.html", title: "Intro (red)", fileName: "" });
    expect(plainText(result.put.find((record) => record.id === "shape:p1")!.props!.richText)).toBe("new words");
    expect([...result.touched].sort()).toEqual(["shape:m1", "shape:p1"]);
  });

  it("deletes a group's members with it", () => {
    const records = [group("g1", "hero"), prompt("p1", "100", "member", { parentId: "shape:g1" }), prompt("p2", "101", "loose")];
    const result = prepareBatch([{ type: "delete", id: "g1" }], context(records));
    if (!result.ok) throw new Error(result.error);
    expect([...result.remove].sort()).toEqual(["shape:g1", "shape:p1"]);
  });

  it("reparents into a group keeping the page position, and out again", () => {
    const records = [group("g1", "hero", { x: 500, y: 100 }), prompt("p1", "100", "x", { x: 600, y: 300 })];
    const into = prepareBatch([{ type: "reparent", id: "p1", parent: "g1" }], context(records));
    if (!into.ok) throw new Error(into.error);
    expect(into.put[0]).toMatchObject({ parentId: "shape:g1", x: 100, y: 200 });
    const out = prepareBatch([{ type: "reparent", id: "p1", parent: null }], context([records[0]!, { ...records[1]!, parentId: "shape:g1", x: 100, y: 200 }]));
    if (!out.ok) throw new Error(out.error);
    expect(out.put[0]).toMatchObject({ parentId: PAGE, x: 600, y: 300 });
  });

  it("renames a group by the canvas rules and rewrites every @ reference in the same batch", () => {
    const records = [
      group("g1", "fox"),
      prompt("p1", "fox-2", "held"),
      prompt("p2", "100", "a @fox and a @fox-2 and @foxes"),
      { ...prompt("p3", "101", "@fox"), meta: { ref: "101", unframed: { result: { medium: "text", model: "m" } } } },
    ];
    const result = prepareBatch([{ type: "rename", id: "g1", name: "Fox 2" }], context(records));
    if (!result.ok) throw new Error(result.error);
    expect(result.put.find((record) => record.id === "shape:g1")!.props!.name).toBe("fox-2-2");
    expect(plainText(result.put.find((record) => record.id === "shape:p2")!.props!.richText)).toBe("a @fox-2-2 and a @fox-2 and @foxes");
    expect(result.put.find((record) => record.id === "shape:p3")).toBeUndefined();
  });

  it("keeps media's aspect on resize", () => {
    const image: CanvasRecord = { id: "shape:i1", typeName: "shape", type: "image", x: 0, y: 0, parentId: PAGE, index: "a1", props: { w: 200, h: 100 }, meta: { ref: "100" } };
    const result = prepareBatch([{ type: "resize", id: "i1", w: 400, h: 400 }], context([image]));
    if (!result.ok) throw new Error(result.error);
    expect(result.put[0]!.props).toMatchObject({ w: 400, h: 200 });
  });
});
