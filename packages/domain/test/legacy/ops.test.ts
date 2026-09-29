import { describe, expect, it } from "vitest";
import { rebuild } from "../../src/index.ts";
import { edge, group, image, imageOutput, journal, prompt, snapshot, type Json } from "./journal.ts";

/** The graph after replaying `ops` over a version-1 snapshot, and how many of them applied. */
const replay = (nodes: Json[], edges: Json[], ops: Json[]) => {
  const { graph, stats } = rebuild(snapshot(nodes, edges), journal(ops));
  return { nodes: graph.nodes as Json[], edges: graph.edges as Json[], applied: stats.journalEntriesApplied };
};

const ids = (list: Json[]) => list.map((each) => each.id);

describe("addNode", () => {
  it("appends the node, or inserts it at its index", () => {
    const after = replay([prompt("100"), prompt("101")], [], [
      { type: "addNode", node: prompt("102") },
      { type: "addNode", node: prompt("103"), index: 1 },
    ]);
    expect(ids(after.nodes)).toEqual(["100", "103", "101", "102"]);
    expect(after.applied).toBe(2);
  });

  it("drops the node's transient keys", () => {
    const after = replay([], [], [{ type: "addNode", node: { ...prompt("100", "fox"), width: 96, selected: true, dragging: false, measured: { width: 1 } } }]);
    expect(after.nodes).toEqual([{ id: "100", type: "prompt", position: { x: 0, y: 0 }, width: 96, data: { text: "fox" } }]);
  });

  it("is rejected when the id exists", () => {
    const after = replay([prompt("100", "first")], [], [{ type: "addNode", node: prompt("100", "second") }]);
    expect(after.nodes).toEqual([prompt("100", "first")]);
    expect(after.applied).toBe(0);
  });

  it("is rejected when parentId names no node, or a node that is not a group", () => {
    const after = replay([prompt("100")], [], [
      { type: "addNode", node: prompt("101", "", { parentId: "missing" }) },
      { type: "addNode", node: prompt("102", "", { parentId: "100" }) },
    ]);
    expect(ids(after.nodes)).toEqual(["100"]);
    expect(after.applied).toBe(0);
  });

  it("is rejected when an output or a group would be a member", () => {
    const after = replay([group("box")], [], [
      { type: "addNode", node: imageOutput("140", { parentId: "box" }) },
      { type: "addNode", node: group("inner", { parentId: "box" }) },
    ]);
    expect(ids(after.nodes)).toEqual(["box"]);
    expect(after.applied).toBe(0);
  });

  it("never puts a member ahead of its group", () => {
    const after = replay([prompt("100"), group("box")], [], [{ type: "addNode", node: image("101", { parentId: "box" }), index: 0 }]);
    expect(ids(after.nodes)).toEqual(["100", "box", "101"]);
  });
});

describe("updateNode", () => {
  it("merges the patch into data and deletes a key set to null", () => {
    const after = replay([prompt("100", "red fox", { data: { text: "red fox", sized: true } })], [], [
      { type: "updateNode", id: "100", patch: { text: "lone red fox", sized: null } },
    ]);
    expect(after.nodes[0]!.data).toEqual({ text: "lone red fox" });
  });

  it("is rejected when there is no such node", () => {
    const after = replay([prompt("100")], [], [{ type: "updateNode", id: "999", patch: { text: "x" } }]);
    expect(after.applied).toBe(0);
  });
});

describe("moveNode and resizeNode", () => {
  it("moveNode sets the position", () => {
    const after = replay([prompt("100")], [], [{ type: "moveNode", id: "100", position: { x: 40, y: 60 } }]);
    expect(after.nodes[0]!.position).toEqual({ x: 40, y: 60 });
  });

  it("resizeNode sets each size, and deletes one that is null or absent", () => {
    const after = replay([prompt("100", "", { width: 240, height: 160 }), prompt("101", "", { width: 240, height: 160 })], [], [
      { type: "resizeNode", id: "100", width: 96, height: 30 },
      { type: "resizeNode", id: "101", width: null },
    ]);
    expect(after.nodes[0]).toMatchObject({ width: 96, height: 30 });
    expect(after.nodes[1]).not.toHaveProperty("width");
    expect(after.nodes[1]).not.toHaveProperty("height");
  });
});

describe("reparentNode", () => {
  it("moves a node into a group with its new position, dropping every edge that touches it", () => {
    const after = replay([group("box"), image("106"), imageOutput("140")], [edge("106", "140")], [
      { type: "reparentNode", id: "106", parentId: "box", position: { x: 28, y: 56 } },
    ]);
    expect(after.nodes.find((node) => node.id === "106")).toMatchObject({ parentId: "box", position: { x: 28, y: 56 } });
    expect(after.edges).toEqual([]);
  });

  it("moves a node out of its group with parentId null", () => {
    const after = replay([group("box"), image("106", { parentId: "box" })], [], [
      { type: "reparentNode", id: "106", parentId: null, position: { x: 500, y: 500 }, index: 0 },
    ]);
    expect(after.nodes[0]).toMatchObject({ id: "106", position: { x: 500, y: 500 } });
    expect(after.nodes[0]).not.toHaveProperty("parentId");
  });

  it("keeps a member behind its group", () => {
    const after = replay([image("106"), group("box")], [], [{ type: "reparentNode", id: "106", parentId: "box", position: { x: 28, y: 56 } }]);
    expect(ids(after.nodes)).toEqual(["box", "106"]);
  });

  it("is rejected on the membership rules, on itself as parent and on a missing position", () => {
    const after = replay([group("box"), group("other"), imageOutput("140"), image("106")], [], [
      { type: "reparentNode", id: "140", parentId: "box", position: { x: 0, y: 0 } },
      { type: "reparentNode", id: "other", parentId: "box", position: { x: 0, y: 0 } },
      { type: "reparentNode", id: "box", parentId: "box", position: { x: 0, y: 0 } },
      { type: "reparentNode", id: "106", parentId: "140", position: { x: 0, y: 0 } },
      { type: "reparentNode", id: "106", parentId: "box" },
    ]);
    expect(after.applied).toBe(0);
    expect(after.nodes.every((node) => node.parentId === undefined)).toBe(true);
  });
});

describe("renameNode", () => {
  it("changes the id and follows it in members' parentId and both ends of every edge, keeping edge ids", () => {
    const after = replay([group("hero"), prompt("120", "", { parentId: "hero" }), imageOutput("180")], [edge("hero", "180")], [
      { type: "renameNode", id: "hero", to: "character" },
    ]);
    expect(ids(after.nodes)).toEqual(["character", "120", "180"]);
    expect(after.nodes[1]!.parentId).toBe("character");
    expect(after.edges).toEqual([{ id: "e-hero-180", source: "character", target: "180" }]);
  });

  it("is rejected for a bad name, the same name or a name that is taken", () => {
    const after = replay([group("hero"), prompt("100")], [], [
      { type: "renameNode", id: "hero", to: "the hero" },
      { type: "renameNode", id: "hero", to: "hero" },
      { type: "renameNode", id: "hero", to: "100" },
    ]);
    expect(ids(after.nodes)).toEqual(["hero", "100"]);
    expect(after.applied).toBe(0);
  });
});

describe("removeNode", () => {
  it("removes a node and every edge touching it", () => {
    const after = replay([prompt("100"), prompt("101"), imageOutput("140")], [edge("100", "140"), edge("101", "140")], [{ type: "removeNode", id: "100" }]);
    expect(ids(after.nodes)).toEqual(["101", "140"]);
    expect(ids(after.edges)).toEqual(["e-101-140"]);
  });

  it("removes a group with every member, and every edge touching any of them", () => {
    const after = replay([group("box"), prompt("120", "", { parentId: "box" }), prompt("101"), imageOutput("140")], [edge("box", "140")], [
      { type: "removeNode", id: "box" },
    ]);
    expect(ids(after.nodes)).toEqual(["101", "140"]);
    expect(after.edges).toEqual([]);
  });
});

describe("addEdge and removeEdge", () => {
  it("addEdge inserts the edge, or at its index; removeEdge removes it", () => {
    const after = replay([prompt("100"), prompt("101"), imageOutput("140")], [edge("100", "140")], [
      { type: "addEdge", edge: edge("101", "140", { sourceHandle: "out" }), index: 0 },
      { type: "removeEdge", id: "e-100-140" },
    ]);
    expect(after.edges).toEqual([{ id: "e-101-140", source: "101", target: "140" }]);
  });

  it("addEdge is rejected when the id exists or an end is missing", () => {
    const after = replay([prompt("100"), imageOutput("140")], [edge("100", "140")], [
      { type: "addEdge", edge: edge("100", "140") },
      { type: "addEdge", edge: edge("gone", "140") },
      { type: "addEdge", edge: edge("100", "gone") },
    ]);
    expect(after.edges).toHaveLength(1);
    expect(after.applied).toBe(0);
  });
});

describe("batch", () => {
  it("applies its ops in order", () => {
    const after = replay([prompt("101", "red fox")], [], [
      {
        type: "batch",
        ops: [
          { type: "updateNode", id: "101", patch: { text: "lone red fox" } },
          { type: "resizeNode", id: "101", width: 124, height: 30 },
        ],
      },
    ]);
    expect(after.nodes[0]).toMatchObject({ width: 124, height: 30, data: { text: "lone red fox" } });
    expect(after.applied).toBe(1);
  });

  it("is rejected whole when one of its ops is rejected", () => {
    const after = replay([prompt("101", "red fox")], [], [
      {
        type: "batch",
        ops: [
          { type: "updateNode", id: "101", patch: { text: "lone red fox" } },
          { type: "updateNode", id: "999", patch: { text: "nothing" } },
        ],
      },
    ]);
    expect(after.nodes[0]!.data).toEqual({ text: "red fox" });
    expect(after.applied).toBe(0);
  });
});

describe("an op of any other type", () => {
  it("is rejected", () => {
    const after = replay([prompt("100")], [], [{ type: "setViewport", x: 1 }]);
    expect(after.applied).toBe(0);
    expect(ids(after.nodes)).toEqual(["100"]);
  });
});
