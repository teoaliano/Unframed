import { describe, expect, it } from "vitest";
import {
  NODE_EMPTY_PROMPT,
  nodePromptText,
  nodeRequest,
  PAGE_FILES_REFUSAL,
  PAGE_SEND_REFUSAL,
  type NodeRequest,
  type Slot,
} from "../../src/index.ts";
import { artifact, group, image, mark, prompt, textResult, video } from "../shapes.ts";
import { board, node, version, wire } from "./board.ts";

const ok = (request: NodeRequest) => {
  if (!request.ok) throw new Error(`refused: ${request.message}`);
  return request;
};

const slotOf = (slot: Slot) => `${slot.kind} ${slot.number} ${slot.source.type === "file" ? slot.source.file : slot.source.type}`;

describe("role by source", () => {
  it("a prompt wire sends its text, resolved as spec 03 resolves it", () => {
    const canvas = board({
      shapes: [prompt("subject", "a red fox"), prompt("p", "@subject on a cliff")],
      nodes: [{ facts: node("n", "image") }],
      wires: [wire("w", "p", "n", "prompt")],
    });
    const request = ok(nodeRequest({ node: canvas.nodes.get("n")!, canvas }));
    expect(request.parts).toEqual([{ type: "text", text: "a red fox on a cliff", wireId: "w" }]);
    expect(request.roles).toEqual({ w: "prompt" });
    expect(request.sources).toEqual(["p"]);
  });

  it("an image is a numbered reference; a mark on it is composited onto it", () => {
    const shapes = [image("i", "fox.png", { x: 0, y: 0, w: 200, h: 200, z: 1 }), mark("m", { x: 20, y: 20, z: 2 }), prompt("p", "go", { y: 900 })];
    const canvas = board({ shapes, nodes: [{ facts: node("n", "image") }], wires: [wire("wp", "p", "n", "prompt"), wire("wi", "i", "n", "reference")] });
    const request = ok(nodeRequest({ node: canvas.nodes.get("n")!, canvas }));
    expect(request.references).toEqual([{ kind: "image", number: 1, shapeId: "i", source: { type: "composite", image: "i", file: "fox.png", marks: ["m"], crop: null } }]);
    expect(request.roles.wi).toBe("image 1");
    expect(request.sources).toContain("m");
  });

  it("a loose mark is its own sketch", () => {
    const canvas = board({ shapes: [mark("m", { x: 900 }), prompt("p", "go")], nodes: [{ facts: node("n", "image") }], wires: [wire("wp", "p", "n", "prompt"), wire("wm", "m", "n", "reference")] });
    const request = ok(nodeRequest({ node: canvas.nodes.get("n")!, canvas }));
    expect(request.references[0]!.source.type).toBe("sketch");
    expect(request.references[0]!.shapeId).toBe("wm");
  });

  it("a clip is a numbered video reference", () => {
    const canvas = board({ shapes: [video("v", { file: "clip.mp4" }), prompt("p", "go")], nodes: [{ facts: node("n", "text") }], wires: [wire("wp", "p", "n", "prompt"), wire("wv", "v", "n", "reference")] });
    expect(ok(nodeRequest({ node: canvas.nodes.get("n")!, canvas })).roles.wv).toBe("video 1");
  });

  it("a motion sends its newest render, and waits for one", () => {
    const shapes = [artifact("mo", "motion", {}, "intro.html"), prompt("p", "go")];
    const wires = [wire("wp", "p", "n", "prompt"), wire("wm", "mo", "n", "reference")];
    const without = board({ shapes, nodes: [{ facts: node("n", "video") }], wires });
    const waiting = nodeRequest({ node: without.nodes.get("n")!, canvas: without });
    expect(waiting).toMatchObject({ ok: false, kind: "waiting", message: "Render @mo first. A motion is an input once it has a render." });
    const rendered = board({ shapes, nodes: [{ facts: node("n", "video") }], wires, renders: { "intro.html": "intro.mp4" } });
    expect(ok(nodeRequest({ node: rendered.nodes.get("n")!, canvas: rendered })).references.map(slotOf)).toEqual(["video 1 intro.mp4"]);
  });

  it("a group sends its prompt members' text, or its media members in order", () => {
    const shapes = [group("g", { x: 0, y: 0 }), prompt("a", "one", { x: 10, y: 10, parent: "g" }), image("i1", "1.png", { x: 10, y: 100, parent: "g" }), image("i2", "2.png", { x: 200, y: 100, parent: "g" }), prompt("b", "two", { x: 10, y: 200, parent: "g" })];
    const asPrompt = board({ shapes, nodes: [{ facts: node("n", "image") }], wires: [wire("w", "g", "n", "prompt")] });
    expect(ok(nodeRequest({ node: asPrompt.nodes.get("n")!, canvas: asPrompt })).parts).toEqual([{ type: "text", text: "one\n\ntwo", wireId: "w" }]);
    const asReference = board({ shapes, nodes: [{ facts: node("n", "image", { instruction: "mix" }) }], wires: [wire("w", "g", "n", "reference")] });
    const request = ok(nodeRequest({ node: asReference.nodes.get("n")!, canvas: asReference }));
    expect(request.references.map(slotOf)).toEqual(["image 1 1.png", "image 2 2.png"]);
    expect(request.roles.w).toBe("image 1, image 2");
  });

  it("a node sends its current version: text as a prompt, a picture as a reference or frame", () => {
    const writer = node("writer", "text", { versions: [version("v1", { text: "a moody forest" })], currentVersionId: "v1" });
    const painter = node("painter", "image", { versions: [version("v2", { file: "forest.png" })], currentVersionId: "v2" });
    const canvas = board({
      nodes: [{ facts: writer }, { facts: painter }, { facts: node("n", "video") }],
      wires: [wire("wt", "writer", "n", "prompt"), wire("wf", "painter", "n", "first")],
    });
    const request = ok(nodeRequest({ node: canvas.nodes.get("n")!, canvas, frames: ["first_frame"] }));
    expect(request.parts).toEqual([{ type: "text", text: "a moody forest", wireId: "wt" }]);
    expect(request.frames).toEqual([{ role: "first", wireId: "wf", slot: { kind: "image", number: 0, shapeId: "painter", source: { type: "file", file: "forest.png" } } }]);
    expect(request.references).toEqual([]);
  });

  it("a node with no result makes its input wait", () => {
    const canvas = board({ nodes: [{ facts: node("up", "image") }, { facts: node("n", "image", { instruction: "go" }) }], wires: [wire("w", "up", "n", "reference")] });
    expect(nodeRequest({ node: canvas.nodes.get("n")!, canvas })).toMatchObject({
      ok: false,
      kind: "waiting",
      message: "@up has no result yet. Run it first, or use Run downstream from it.",
      status: "Waiting for @up, which has no result yet.",
    });
    expect(nodeRequest({ node: canvas.nodes.get("n")!, canvas, assume: new Set(["up"]) }).ok).toBe(true);
  });

  it("a page sends its HTML, a picture of it, or both, once both its choices are made", () => {
    const shapes = [artifact("pg", "page", {}, "proto.html")];
    const request = (extra: Parameters<typeof wire>[4]) => {
      const canvas = board({ shapes, nodes: [{ facts: node("n", "text", { instruction: "describe it" }) }], wires: [wire("w", "pg", "n", extra?.role ?? "prompt", extra)] });
      return nodeRequest({ node: canvas.nodes.get("n")!, canvas });
    };
    expect(request({ chosen: false, files: "entry" })).toMatchObject({ ok: false, message: PAGE_SEND_REFUSAL });
    expect(request({})).toMatchObject({ ok: false, message: PAGE_FILES_REFUSAL });
    const html = ok(request({ files: "entry" }));
    expect(html.parts).toEqual([{ type: "page", file: "proto.html", files: "entry", wireId: "w" }]);
    expect(html.references).toEqual([]);
    const picture = ok(request({ role: "reference", files: "linked" }));
    expect(picture.parts).toEqual([]);
    expect(picture.references.map((slot) => slot.source)).toEqual([{ type: "page", file: "proto.html", files: "linked" }]);
    expect(picture.roles.w).toBe("Picture · image 1");
    const both = ok({ ...request({ role: "both", files: "linked" }) } as NodeRequest);
    expect(both.parts).toHaveLength(1);
    expect(both.references.map((slot) => slot.source)).toEqual([{ type: "page", file: "proto.html", files: "linked" }]);
    expect(both.roles.w).toBe("Both · image 1");
  });
});

describe("node request", () => {
  it("joins prompt text in wire order, with the instruction last", () => {
    const shapes = [prompt("a", "first", { y: 500 }), prompt("b", "second", { y: 0 }), textResult("t", "third @a")];
    const canvas = board({
      shapes,
      nodes: [{ facts: node("n", "text", { instruction: "be brief" }) }],
      wires: [wire("w1", "a", "n", "prompt", { z: 1 }), wire("w2", "b", "n", "prompt", { z: 2 }), wire("w3", "t", "n", "prompt", { z: 3 })],
    });
    const request = ok(nodeRequest({ node: canvas.nodes.get("n")!, canvas }));
    expect(nodePromptText(request.parts, request.instruction, () => "")).toBe("first\n\nsecond\n\nthird @a\n\nbe brief");
  });

  it("numbers references by input-list order, not by position on the canvas", () => {
    const shapes = [image("top", "top.png", { y: 0 }), image("low", "low.png", { y: 900 }), prompt("p", "go")];
    const canvas = board({
      shapes,
      nodes: [{ facts: node("n", "image") }],
      wires: [wire("wp", "p", "n", "prompt", { z: 1 }), wire("wl", "low", "n", "reference", { z: 2 }), wire("wt", "top", "n", "reference", { z: 3 })],
    });
    const request = ok(nodeRequest({ node: canvas.nodes.get("n")!, canvas }));
    expect(request.references.map(slotOf)).toEqual(["image 1 low.png", "image 2 top.png"]);
    expect(request.roles).toMatchObject({ wl: "image 1", wt: "image 2" });
  });

  it("attaches a picture the instruction names with @ after the wired references", () => {
    const shapes = [image("wired", "a.png"), image("named", "b.png"), prompt("p", "go")];
    const canvas = board({ shapes, nodes: [{ facts: node("n", "image", { instruction: "in the style of @named" }) }], wires: [wire("wp", "p", "n", "prompt"), wire("wi", "wired", "n", "reference")] });
    const request = ok(nodeRequest({ node: canvas.nodes.get("n")!, canvas }));
    expect(request.instruction).toBe("in the style of image 2");
    expect(request.references.map(slotOf)).toEqual(["image 1 a.png", "image 2 b.png"]);
  });

  it("refuses an empty prompt with the node's sentence", () => {
    const canvas = board({ shapes: [image("i", "a.png")], nodes: [{ facts: node("n", "image") }], wires: [wire("w", "i", "n", "reference")] });
    expect(nodeRequest({ node: canvas.nodes.get("n")!, canvas })).toMatchObject({ ok: false, message: NODE_EMPTY_PROMPT });
  });

  it("refuses more references than the model takes", () => {
    const shapes = [image("a", "a.png"), image("b", "b.png"), prompt("p", "go")];
    const canvas = board({ shapes, nodes: [{ facts: node("n", "image") }], wires: [wire("wp", "p", "n", "prompt"), wire("wa", "a", "n", "reference"), wire("wb", "b", "n", "reference")] });
    expect(nodeRequest({ node: canvas.nodes.get("n")!, canvas, referenceCap: 1, model: "tiny" })).toMatchObject({
      ok: false,
      message: "@n has 2 references, and tiny takes at most 1. Remove a wire, or pick another model.",
    });
  });

  it("a frame role the model does not take is in neither array, marked unused, and refused", () => {
    const shapes = [image("i", "a.png"), prompt("p", "go")];
    const canvas = board({ shapes, nodes: [{ facts: node("n", "video") }], wires: [wire("wp", "p", "n", "prompt"), wire("wf", "i", "n", "last")] });
    const refused = nodeRequest({ node: canvas.nodes.get("n")!, canvas, frames: ["first_frame"], model: "veo" });
    expect(refused).toMatchObject({ ok: false, message: "veo takes no last frame. Change that wire's role.", roles: { wf: "—" } });
  });

  it.each([
    ["prompt", "image", "image"],
    ["reference", "image", "image"],
    ["first", "video", "image"],
    ["last", "video", "image"],
    ["reference", "video", "video"],
  ] as const)("a %s wire lands where the role table says on a %s node", (role, medium, source) => {
    const sourceShape = source === "image" ? image("s", "s.png") : video("s", { file: "s.mp4" });
    const shapes = role === "prompt" ? [prompt("s", "words")] : [sourceShape, prompt("p", "go")];
    const wires = role === "prompt" ? [wire("w", "s", "n", "prompt")] : [wire("wp", "p", "n", "prompt"), wire("w", "s", "n", role)];
    const canvas = board({ shapes, nodes: [{ facts: node("n", medium) }], wires });
    const request = ok(nodeRequest({ node: canvas.nodes.get("n")!, canvas, frames: ["first_frame", "last_frame"] }));
    const inParts = request.parts.some((part) => part.wireId === "w");
    const inReferences = request.references.some((slot) => slot.shapeId === "s");
    const inFrames = request.frames.some((frame) => frame.wireId === "w");
    expect({ inParts, inReferences, inFrames }).toEqual({ inParts: role === "prompt", inReferences: role === "reference", inFrames: role === "first" || role === "last" });
  });
});
