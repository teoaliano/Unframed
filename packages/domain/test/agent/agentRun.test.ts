import { describe, expect, it } from "vitest";
import { planAgentRun, SKETCH_REFUSAL, unsupportedParam, type CanvasShape } from "../../src/index.ts";

const box = (x: number, y: number, w = 100, h = 100) => ({ x, y, w, h });
const prompt = (id: string, text: string, y = 0): CanvasShape => ({ id, kind: "prompt", bounds: box(0, y, 200, 40), z: 0, text });
const picture = (id: string, file: string, y = 200, z = 1): CanvasShape => ({ id, kind: "image", bounds: box(0, y), z, file });
const mark = (id: string, x: number, y: number, z: number): CanvasShape => ({ id, kind: "mark", bounds: box(x, y, 20, 20), z });

describe("an agent's run plan", () => {
  it("plans a prompt with a picture: the prompt, the picture as a file reference, the sources in order", () => {
    const shapes = [prompt("p1", "a red fox"), picture("i1", "fox.png")];
    const plan = planAgentRun({ shapes, sources: ["p1", "i1"], instruction: "in snow", medium: "image" });
    expect(plan).toMatchObject({
      ok: true,
      prompt: "a red fox\n\nin snow",
      selectionPrompt: "a red fox",
      instruction: "in snow",
      references: [{ kind: "image", file: "fox.png" }],
      sources: ["p1", "i1"],
    });
  });

  it("plans a clip link as a video reference with its url", () => {
    const shapes: CanvasShape[] = [prompt("p1", "motion"), { id: "v1", kind: "video", bounds: box(0, 200), z: 1, link: "https://example.com/a.mp4" }];
    const plan = planAgentRun({ shapes, sources: ["p1", "v1"], instruction: "", medium: "video" });
    expect(plan).toMatchObject({ ok: true, references: [{ kind: "video", url: "https://example.com/a.mp4" }] });
  });

  it("refuses a loose mark, since a sketch needs the app", () => {
    const shapes = [prompt("p1", "sketch this"), mark("m1", 500, 500, 2)];
    expect(planAgentRun({ shapes, sources: ["p1", "m1"], instruction: "", medium: "image" })).toEqual({ ok: false, message: SKETCH_REFUSAL });
  });

  it("refuses a marked picture, since a composite needs the app", () => {
    const shapes = [picture("i1", "fox.png", 0, 0), mark("m1", 10, 10, 1), prompt("p1", "fox")];
    expect(planAgentRun({ shapes, sources: ["i1", "m1", "p1"], instruction: "", medium: "image" })).toEqual({ ok: false, message: SKETCH_REFUSAL });
  });

  it("names a source the canvas does not hold, without its shape: prefix", () => {
    const shapes = [prompt("p1", "a fox")];
    expect(planAgentRun({ shapes, sources: ["shape:gone"], instruction: "", medium: "image" })).toEqual({
      ok: false,
      message: 'There is no shape "gone" on this canvas. Call canvas_read for the ids.',
    });
  });

  it("refuses a selection with nothing to make, with the composer's sentence", () => {
    const shapes = [prompt("p1", "   ")];
    expect(planAgentRun({ shapes, sources: ["p1"], instruction: "", medium: "image" })).toEqual({
      ok: false,
      message: "Nothing says what to make. Select a prompt, or type an instruction.",
    });
  });
});

describe("unsupportedParam", () => {
  const supported = (key: string, value: unknown) => key === "resolution" && value === "2K";

  it("answers nothing when every parameter is taken", () => {
    expect(unsupportedParam("m/one", { resolution: "2K" }, supported)).toBeUndefined();
    expect(unsupportedParam("m/one", {}, supported)).toBeUndefined();
  });

  it("names the first parameter the model does not take, in the agent's words", () => {
    expect(unsupportedParam("m/one", { resolution: "8K" }, supported)).toBe('Model "m/one" does not take resolution "8K". Leave it out for the model\'s default.');
    expect(unsupportedParam("m/one", { tint: true }, supported)).toBe('Model "m/one" does not take tint "true". Leave it out for the model\'s default.');
  });
});
