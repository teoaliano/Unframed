import { describe, expect, it } from "vitest";
import {
  AGENT_SYSTEM_PROMPT,
  agentSystemPrompt,
  ALL_FEATURES,
  CANVAS_READ_DESCRIPTION,
  CANVAS_WRITE_DESCRIPTION,
  canvasReadDescription,
  canvasWriteDescription,
  featureList,
  NO_FEATURES,
  readFeatures,
} from "../src/index.ts";

describe("UNFRAMED_FEATURES", () => {
  it.each([
    [undefined, []],
    ["", []],
    ["nodes", ["nodes"]],
    ["element-editing", ["element-editing"]],
    [" Element-Editing , nodes ", ["nodes", "element-editing"]],
    ["all", ["nodes", "element-editing"]],
    ["nodes,all", ["nodes", "element-editing"]],
    ["teleport,nodes,,", ["nodes"]],
    ["teleport", []],
  ])("reads %j as %j", (value, expected) => {
    expect(featureList(readFeatures(value))).toEqual(expected);
  });
});

describe("the agent's text without nodes", () => {
  it("is the assets' text when nodes are on", () => {
    expect(agentSystemPrompt(ALL_FEATURES)).toBe(AGENT_SYSTEM_PROMPT);
    expect(canvasReadDescription(ALL_FEATURES)).toBe(CANVAS_READ_DESCRIPTION);
    expect(canvasWriteDescription(ALL_FEATURES)).toBe(CANVAS_WRITE_DESCRIPTION);
  });

  it("drops the node sentence from the system prompt, and node from the kinds with a ref", () => {
    const prompt = agentSystemPrompt(NO_FEATURES);
    expect(prompt).not.toMatch(/node/i);
    expect(prompt).toContain("Every prompt, image, video, audio, page, motion and group has a `ref`");
    expect(prompt).toContain("read the real id from the result.\nA project may have a kit");
  });

  it("tells canvas_read and canvas_write that nodes and wires are read-only", () => {
    const read = canvasReadDescription(NO_FEATURES);
    expect(read).not.toContain("statusLine");
    expect(read).toContain("A node or a wire made in another build is reported as it is, and is read-only here. Call this before");
    const write = canvasWriteDescription(NO_FEATURES);
    expect(write).not.toContain("node_run");
    expect(write).not.toContain("props.medium");
    expect(write).not.toContain("props.role");
    expect(write).toContain("renames a prompt, image, video, audio, page, motion or group");
    expect(write).toContain("plus that tldraw type's own props). A node or a wire already on the canvas can be moved, resized and deleted, never created or updated. Deleting a shape deletes its wires.");
  });
});
