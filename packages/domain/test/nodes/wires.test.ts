import { describe, expect, it } from "vitest";
import {
  AUDIO_SOURCE_REFUSAL,
  COMPONENT_SOURCE_REFUSAL,
  GROUP_FRAME_REFUSAL,
  rolesFor,
  WIRE_TARGET_REFUSAL,
  wireRefusal,
  type WireSource,
} from "../../src/index.ts";
import { group, image, prompt, video } from "../shapes.ts";
import { board, node, wire } from "./board.ts";

const BOTH = ["first_frame", "last_frame"];

describe("rolesFor", () => {
  it.each<[string, Parameters<typeof rolesFor>[0], ReadonlyArray<string>, WireSource, string[]]>([
    ["a prompt into an image node", "image", [], "prompt", ["prompt"]],
    ["a picture into an image node", "image", [], "image", ["reference"]],
    ["a picture into a text node", "text", [], "image", ["reference"]],
    ["a picture into a page node", "page", [], "image", ["reference"]],
    ["a picture into a video node whose model takes both frames", "video", BOTH, "image", ["reference", "first", "last"]],
    ["a picture into a video node whose model takes the first frame only", "video", ["first_frame"], "image", ["reference", "first"]],
    ["a picture into a video node whose model takes no frame", "video", [], "image", ["reference"]],
    ["a clip into a video node takes no frame", "video", BOTH, "video", ["reference"]],
    ["a group takes prompt and reference only", "video", BOTH, "group", ["prompt", "reference"]],
    ["a page offers HTML, Picture and Both", "image", [], "page", ["prompt", "reference", "both"]],
    ["a motion is a reference", "video", BOTH, "motion", ["reference"]],
    ["a mark is a reference", "image", [], "mark", ["reference"]],
    ["an image node's result can be a first frame", "video", BOTH, "node-image", ["reference", "first", "last"]],
    ["a text node's result is a prompt", "image", [], "node-text", ["prompt"]],
    ["a page node's result is a page", "text", [], "node-page", ["prompt", "reference", "both"]],
    ["an audio node takes prompts only", "audio", [], "prompt", ["prompt"]],
    ["an audio node takes no picture", "audio", [], "image", []],
    ["an audio node takes a group's text", "audio", [], "group", ["prompt"]],
    ["audio is never a source", "image", [], "audio", []],
    ["a component is never a source", "image", [], "component", []],
  ])("%s", (_case, medium, frames, source, roles) => {
    expect(rolesFor(medium, frames, source)).toEqual(roles);
  });
});

describe("wireRefusal", () => {
  const shapes = [prompt("p", "a fox"), image("i", "fox.png"), video("v", { file: "clip.mp4" }), group("g")];
  const audioShape = { id: "a", kind: "audio" as const, ref: "a", bounds: { x: 0, y: 0, w: 1, h: 1 }, z: 1, file: "s.mp3" };
  const componentShape = { id: "c", kind: "component" as const, ref: "c", bounds: { x: 0, y: 0, w: 1, h: 1 }, z: 2 };

  it.each([
    ["target not a node", { from: "p", to: "i", role: "prompt" as const }, WIRE_TARGET_REFUSAL],
    ["audio source", { from: "a", to: "img", role: "reference" as const }, AUDIO_SOURCE_REFUSAL],
    ["component source", { from: "c", to: "img", role: "reference" as const }, COMPONENT_SOURCE_REFUSAL],
    ["a group in a frame role", { from: "g", to: "vid", role: "first" as const }, GROUP_FRAME_REFUSAL],
    ["a role the medium does not take", { from: "i", to: "img", role: "first" as const }, "Image nodes take no first."],
    ["a picture into an audio node", { from: "i", to: "aud", role: "reference" as const }, "Audio nodes take no reference."],
    ["a prompt sent as a reference", { from: "p", to: "img", role: "reference" as const }, "A prompt sends no reference. Pick another role for this wire."],
    ["a clip as a frame", { from: "v", to: "vid", role: "first" as const }, "A clip sends no first. Pick another role for this wire."],
    ["a fine prompt", { from: "p", to: "img", role: "prompt" as const }, null],
    ["a fine first frame", { from: "i", to: "vid", role: "first" as const }, null],
  ])("%s", (_case, input, sentence) => {
    const canvas = board({
      shapes: [...shapes, audioShape, componentShape],
      nodes: [{ facts: node("img", "image") }, { facts: node("vid", "video") }, { facts: node("aud", "audio") }],
    });
    expect(wireRefusal({ canvas, ...input })).toBe(sentence);
  });

  it.each([
    ["the first frame wired before", [wire("w1", "i", "vid", "first", { z: 1 })], "i2"],
    ["the first frame wired after", [wire("w1", "i2", "vid", "first", { z: 9 })], "i"],
  ])("a second first frame is refused, with %s", (_case, wires, from) => {
    const canvas = board({ shapes: [image("i", "a.png"), image("i2", "b.png")], nodes: [{ facts: node("vid", "video") }], wires });
    expect(wireRefusal({ canvas, from, to: "vid", role: "first" })).toBe("@vid already has a first wire. Change that wire first.");
    expect(wireRefusal({ canvas, from, to: "vid", role: "last" })).toBeNull();
  });

  it("changing the role of the frame wire itself is not a second frame", () => {
    const canvas = board({ shapes: [image("i", "a.png")], nodes: [{ facts: node("vid", "video") }], wires: [wire("w1", "i", "vid", "first")] });
    expect(wireRefusal({ canvas, from: "i", to: "vid", role: "first", wireId: "w1" })).toBeNull();
  });

  it("refuses a loop through other nodes, and a node feeding itself", () => {
    const canvas = board({
      nodes: [{ facts: node("a", "text") }, { facts: node("b", "text") }, { facts: node("c", "text") }],
      wires: [wire("ab", "a", "b", "prompt"), wire("bc", "b", "c", "prompt")],
    });
    expect(wireRefusal({ canvas, from: "c", to: "a", role: "prompt" })).toBe("That wire would loop back into @c. A node cannot feed itself through other nodes.");
    expect(wireRefusal({ canvas, from: "a", to: "a", role: "prompt" })).toBe("A node cannot feed itself.");
    expect(wireRefusal({ canvas, from: "a", to: "c", role: "prompt" })).toBeNull();
  });
});
