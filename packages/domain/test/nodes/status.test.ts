import { describe, expect, it } from "vitest";
import {
  inputFingerprint,
  nodeStatus,
  NOT_RUN_LINE,
  OUT_OF_DATE_LINE,
  QUEUED_LINE,
  RESTART_STOP,
  RUNNING_LINE,
  type NodeCanvas,
  type NodeFacts,
} from "../../src/index.ts";
import { artifact, group, image, prompt } from "../shapes.ts";
import { board, node, version, wire } from "./board.ts";

const stamped = (facts: NodeFacts, canvas: NodeCanvas): NodeFacts => {
  const fingerprint = inputFingerprint(facts, canvas);
  return { ...facts, versions: [version("v1", { file: "out.png", fingerprint })], currentVersionId: "v1" };
};

const ready = () => {
  const shapes = [prompt("p", "a fox", { y: 0 }), image("i", "fox.png", { y: 200 }), prompt("far", "unrelated", { y: 900 })];
  const wires = [wire("wp", "p", "n", "prompt"), wire("wi", "i", "n", "reference")];
  const plain = board({ shapes, nodes: [{ facts: node("n", "image") }], wires });
  const facts = stamped(plain.nodes.get("n")!, plain);
  return { shapes, wires, facts, canvas: board({ shapes, nodes: [{ facts }], wires }) };
};

describe("input fingerprint", () => {
  it("is stable under changes to shapes that feed nothing", () => {
    const { shapes, wires, facts, canvas } = ready();
    const moved = board({ shapes: shapes.map((shape) => (shape.id === "far" ? { ...shape, text: "changed", bounds: { ...shape.bounds, x: 500 } } : shape)), nodes: [{ facts }], wires });
    expect(inputFingerprint(facts, moved)).toBe(inputFingerprint(facts, canvas));
  });

  it.each([
    ["the prompt's text", (c: ReturnType<typeof ready>) => board({ shapes: c.shapes.map((s) => (s.id === "p" ? { ...s, text: "a wolf" } : s)), nodes: [{ facts: c.facts }], wires: c.wires })],
    ["the picture's file", (c: ReturnType<typeof ready>) => board({ shapes: c.shapes.map((s) => (s.id === "i" ? { ...s, file: "wolf.png" } : s)), nodes: [{ facts: c.facts }], wires: c.wires })],
    ["a wire's role", (c: ReturnType<typeof ready>) => board({ shapes: c.shapes, nodes: [{ facts: c.facts }], wires: c.wires.map((w) => (w.id === "wi" ? { ...w, role: "prompt" as const } : w)) })],
    ["the wire order", (c: ReturnType<typeof ready>) => board({ shapes: c.shapes, nodes: [{ facts: c.facts }], wires: c.wires.map((w) => (w.id === "wp" ? { ...w, z: 99999 } : w)) })],
    ["the instruction", (c: ReturnType<typeof ready>) => board({ shapes: c.shapes, nodes: [{ facts: { ...c.facts, instruction: "brighter" } }], wires: c.wires })],
    ["the model", (c: ReturnType<typeof ready>) => board({ shapes: c.shapes, nodes: [{ facts: { ...c.facts, model: "other" } }], wires: c.wires })],
    ["a param", (c: ReturnType<typeof ready>) => board({ shapes: c.shapes, nodes: [{ facts: { ...c.facts, params: { aspect_ratio: "16:9" } } }], wires: c.wires })],
  ])("changes with %s", (_case, change) => {
    const c = ready();
    const changed = change(c);
    expect(inputFingerprint(changed.nodes.get("n")!, changed)).not.toBe(inputFingerprint(c.facts, c.canvas));
  });

  it("changes when an input node's current version changes", () => {
    const up = node("up", "text", { versions: [version("a", { text: "one" }), version("b", { text: "two" })], currentVersionId: "a" });
    const make = (current: string) => board({ nodes: [{ facts: { ...up, currentVersionId: current } }, { facts: node("n", "image") }], wires: [wire("w", "up", "n", "prompt")] });
    expect(inputFingerprint(node("n", "image"), make("a"))).not.toBe(inputFingerprint(node("n", "image"), make("b")));
  });
});

describe("input fingerprint over what the request composes", () => {
  const pictured = (mark: { x: number; props: string }) =>
    board({
      shapes: [prompt("p", "go"), image("i", "fox.png", { x: 0, y: 0, w: 200, h: 200, z: 1 }), { id: "m", kind: "mark", bounds: { x: mark.x, y: 20, w: 20, h: 20 }, z: 2 }],
      nodes: [{ facts: node("n", "image") }],
      wires: [wire("wp", "p", "n", "prompt"), wire("wi", "i", "n", "reference")],
      markProps: { m: mark.props },
    });
  const print = (canvas: NodeCanvas) => inputFingerprint(canvas.nodes.get("n")!, canvas);

  it("changes when a mark drawn on a wired picture changes, is added or moves off it", () => {
    const base = print(pictured({ x: 20, props: "red stroke" }));
    expect(print(pictured({ x: 20, props: "blue stroke" }))).not.toBe(base);
    expect(print(pictured({ x: 900, props: "red stroke" }))).not.toBe(base);
    expect(print(pictured({ x: 20, props: "red stroke" }))).toBe(base);
  });

  it("changes when a wired group's members change their order", () => {
    const grouped = (first: number) =>
      board({
        shapes: [group("g", { x: 0, y: 0 }), image("a", "a.png", { x: 10, y: first, parent: "g" }), image("b", "b.png", { x: 10, y: 150, parent: "g" }), prompt("p", "go")],
        nodes: [{ facts: node("n", "image") }],
        wires: [wire("wp", "p", "n", "prompt"), wire("wg", "g", "n", "reference")],
      });
    expect(print(grouped(10))).not.toBe(print(grouped(300)));
  });
});

describe("node status", () => {
  it("is ready when the current version matches its inputs, and shows no line", () => {
    const { facts, canvas } = ready();
    expect(nodeStatus({ node: facts, canvas })).toEqual({ state: "ready", line: "" });
  });

  it("is out of date once an input changes", () => {
    const c = ready();
    const changed = board({ shapes: c.shapes.map((s) => (s.id === "p" ? { ...s, text: "a wolf" } : s)), nodes: [{ facts: c.facts }], wires: c.wires });
    expect(nodeStatus({ node: c.facts, canvas: changed })).toEqual({ state: "out_of_date", line: OUT_OF_DATE_LINE });
  });

  it("is not run without a current version", () => {
    const canvas = board({ nodes: [{ facts: node("n", "image") }] });
    expect(nodeStatus({ node: canvas.nodes.get("n")!, canvas })).toEqual({ state: "not_run", line: NOT_RUN_LINE });
  });

  it.each([
    ["running beats failed", { run: { runId: "r", chainId: null, startedAt: 0 }, error: "boom" }, { state: "running", line: RUNNING_LINE }],
    ["a queued chain step", { run: { runId: "", chainId: "c", startedAt: 0 } }, { state: "running", line: QUEUED_LINE }],
    ["failed beats out of date", { error: "The model refused." }, { state: "failed", line: "Failed: The model refused." }],
    ["a restart stop reads as it is", { error: RESTART_STOP }, { state: "failed", line: RESTART_STOP }],
    ["an upstream failure waits", { error: "Waiting for @up, which failed." }, { state: "waiting", line: "Waiting for @up, which failed." }],
  ] as const)("%s", (_case, extra, status) => {
    const { facts, canvas } = ready();
    expect(nodeStatus({ node: { ...facts, ...extra }, canvas })).toEqual(status);
  });

  it("a video run reads Rendering with its minutes", () => {
    const canvas = board({ nodes: [{ facts: node("n", "video", { run: { runId: "job", chainId: null, startedAt: 0 } }) }] });
    expect(nodeStatus({ node: canvas.nodes.get("n")!, canvas, now: 3 * 60_000 + 5 })).toEqual({ state: "running", line: "Rendering… (3 min)" });
  });

  it("waits, naming its blocker, before it is not run or out of date", () => {
    const canvas = board({ nodes: [{ facts: node("up", "image") }, { facts: node("n", "image", { instruction: "x" }) }], wires: [wire("w", "up", "n", "reference")] });
    expect(nodeStatus({ node: canvas.nodes.get("n")!, canvas })).toEqual({ state: "waiting", line: "Waiting for @up, which has no result yet." });
    const motion = board({ shapes: [artifact("mo", "motion", {}, "m.html")], nodes: [{ facts: node("n", "video", { instruction: "x" }) }], wires: [wire("w", "mo", "n", "reference")] });
    expect(nodeStatus({ node: motion.nodes.get("n")!, canvas: motion })).toEqual({ state: "waiting", line: "Render @mo first. A motion is an input once it has a render." });
  });
});
