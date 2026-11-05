import { describe, expect, it } from "vitest";
import { downstreamOf, downstreamRun, inputFingerprint, NO_NODES_MESSAGE, planChain, type NodeFacts } from "../../src/index.ts";
import { group, prompt } from "../shapes.ts";
import { board, node, version, wire } from "./board.ts";

describe("planChain", () => {
  it("orders by dependency, then by canvas order", () => {
    const canvas = board({
      nodes: [
        { facts: node("video", "video"), at: { x: 0, y: 0 } },
        { facts: node("still", "image"), at: { x: 500, y: 0 } },
        { facts: node("words", "text"), at: { x: 900, y: 0 } },
        { facts: node("aside", "text"), at: { x: 0, y: 900 } },
      ],
      wires: [wire("a", "words", "still", "prompt"), wire("b", "still", "video", "first")],
    });
    expect(planChain(canvas, ["video", "still", "words", "aside"])).toEqual({ ok: true, steps: ["words", "still", "video", "aside"] });
  });

  it("breaks ties by top edge, then left edge, then z", () => {
    const canvas = board({
      nodes: [
        { facts: node("right", "text"), at: { x: 500, y: 0, z: 1 } },
        { facts: node("left", "text"), at: { x: 0, y: 0, z: 2 } },
        { facts: node("over", "text"), at: { x: 0, y: 400, z: 9 } },
        { facts: node("under", "text"), at: { x: 0, y: 400, z: 3 } },
      ],
    });
    expect(planChain(canvas, ["right", "left", "over", "under"])).toEqual({ ok: true, steps: ["left", "right", "under", "over"] });
  });

  it("expands a selected group to the nodes it holds", () => {
    const canvas = board({
      shapes: [group("g", { x: 0, y: 0 }), prompt("p", "loose", { parent: "g" })],
      nodes: [{ facts: node("a", "text"), at: { parent: "g", y: 10 } }, { facts: node("b", "text"), at: { parent: "g", y: 20 } }, { facts: node("out", "text"), at: { y: 5 } }],
    });
    expect(planChain(canvas, ["g"])).toEqual({ ok: true, steps: ["a", "b"] });
    expect(planChain(canvas, ["p"])).toEqual({ ok: false, message: NO_NODES_MESSAGE });
  });

  it("takes an input from a node outside the chain only when it has a result", () => {
    const outside = (facts: NodeFacts) =>
      board({ nodes: [{ facts }, { facts: node("a", "image"), at: { y: 10 } }, { facts: node("b", "video"), at: { y: 20 } }], wires: [wire("w1", "up", "b", "prompt"), wire("w2", "a", "b", "first")] });
    expect(planChain(outside(node("up", "text")), ["a", "b"])).toEqual({
      ok: false,
      message: "Step 2 (@b): @up has no result yet. Run it first, or use Run downstream from it.",
    });
    expect(planChain(outside(node("up", "text", { versions: [version("v", { text: "x" })], currentVersionId: "v" })), ["a", "b"])).toEqual({ ok: true, steps: ["a", "b"] });
  });

  it("refuses a loop", () => {
    const canvas = board({ nodes: [{ facts: node("a", "text") }, { facts: node("b", "text") }], wires: [wire("ab", "a", "b", "prompt"), wire("ba", "b", "a", "prompt")] });
    expect(planChain(canvas, ["a", "b"])).toMatchObject({ ok: false, message: expect.stringContaining("loop") });
  });
});

describe("downstream", () => {
  const chain = () => {
    const base = board({
      shapes: [prompt("p", "go")],
      nodes: [{ facts: node("a", "text") }, { facts: node("b", "text") }, { facts: node("c", "text") }, { facts: node("d", "text") }],
      wires: [wire("pa", "p", "a", "prompt"), wire("ab", "a", "b", "prompt"), wire("bc", "b", "c", "prompt"), wire("pd", "p", "d", "prompt")],
    });
    return base;
  };

  it("finds every node that depends on one, directly or through others", () => {
    expect(downstreamOf(chain(), "a").sort()).toEqual(["b", "c"]);
  });

  it("runs the node itself always, and only the pending ones below it unless asked for all", () => {
    const base = chain();
    const done = (facts: NodeFacts): NodeFacts => ({ ...facts, versions: [version(`v-${facts.id}`, { text: facts.id, fingerprint: inputFingerprint(facts, base) })], currentVersionId: `v-${facts.id}` });
    const a = done(base.nodes.get("a")!);
    const withA = board({ shapes: base.shapes.filter((shape) => shape.kind === "prompt"), nodes: [{ facts: a }, { facts: base.nodes.get("b")! }, { facts: base.nodes.get("c")! }, { facts: base.nodes.get("d")! }], wires: base.wires });
    const b = { ...withA.nodes.get("b")!, versions: [version("vb", { text: "b", fingerprint: inputFingerprint(withA.nodes.get("b")!, withA) })], currentVersionId: "vb" };
    const canvas = board({ shapes: withA.shapes.filter((shape) => shape.kind === "prompt"), nodes: [{ facts: a }, { facts: b }, { facts: base.nodes.get("c")! }, { facts: base.nodes.get("d")! }], wires: base.wires });
    expect(downstreamRun(canvas, "a", "pending")).toEqual(["a", "c"]);
    expect(downstreamRun(canvas, "a", "all").sort()).toEqual(["a", "b", "c"]);
  });
});
