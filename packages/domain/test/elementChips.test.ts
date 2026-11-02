import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ElementChip } from "@unframed/contracts";
import { ELEMENT_CONTEXT_ARTIFACT, ELEMENT_CONTEXT_CHIP, ELEMENT_CONTEXT_INTRO, elementChip, elementContext } from "../src/index.ts";

const stamped = {
  elementId: "hf-ab12",
  liveSelector: "div > h1:nth-of-type(1)",
  tag: "h1",
  label: "Hero title",
  startTag: '<h1 data-hf-id="hf-ab12" class="big">',
  text: "Welcome",
  hasChildren: false,
};

describe("elementChip: a stamped element", () => {
  it("selects by its element id and excerpts its start tag, text and end tag", () => {
    expect(elementChip(stamped, { shapeId: "s1" })).toEqual({
      shapeId: "s1",
      elementId: "hf-ab12",
      selector: '[data-hf-id="hf-ab12"]',
      tag: "h1",
      label: "Hero title",
      excerpt: '<h1 data-hf-id="hf-ab12" class="big">Welcome</h1>',
    });
  });

  it("marks children with an ellipsis before the end tag", () => {
    const chip = elementChip({ ...stamped, text: "", hasChildren: true }, { shapeId: "s1" });
    expect(chip.excerpt).toBe('<h1 data-hf-id="hf-ab12" class="big">…</h1>');
  });

  it("cuts its own text to 80 characters", () => {
    const chip = elementChip({ ...stamped, text: "x".repeat(100) }, { shapeId: "s1" });
    expect(chip.excerpt).toBe(`<h1 data-hf-id="hf-ab12" class="big">${"x".repeat(80)}</h1>`);
  });

  it("cuts the whole excerpt to 240 characters", () => {
    const long = { ...stamped, startTag: `<div data-hf-id="hf-ab12" data-x="${"y".repeat(300)}">`, tag: "div", text: "" };
    const chip = elementChip(long, { shapeId: "s1" });
    expect(chip.excerpt).toHaveLength(240);
  });

  it("writes no end tag for a void element", () => {
    const img = { ...stamped, tag: "img", startTag: '<img data-hf-id="hf-ab12" src="a.png">', text: "", hasChildren: false };
    expect(elementChip(img, { shapeId: "s1" }).excerpt).toBe('<img data-hf-id="hf-ab12" src="a.png">');
  });
});

describe("elementChip: a runtime element", () => {
  it("uses its live selector and a null element id", () => {
    const runtime = { ...stamped, elementId: null, startTag: '<p class="live">', tag: "p", text: "made", liveSelector: "#root > p:nth-of-type(2)" };
    expect(elementChip(runtime, { shapeId: "s2" })).toMatchObject({
      elementId: null,
      selector: "#root > p:nth-of-type(2)",
      excerpt: '<p class="live">made</p>',
    });
  });
});

describe("elementContext", () => {
  const chip = (shapeId: string, elementId: string, excerpt: string): ElementChip => ({
    shapeId,
    elementId,
    selector: `[data-hf-id="${elementId}"]`,
    tag: "h1",
    label: "Title",
    excerpt,
  });

  it("is empty when no chip's artifact is listed", () => {
    expect(elementContext([chip("s1", "hf-ab12", "<h1>a</h1>")], [])).toBe("");
    expect(elementContext([], [{ shapeId: "s1", kind: "page", label: "Hero" }])).toBe("");
  });

  it("groups chips under their artifact, in the order of the artifacts, with the intro once", () => {
    const text = elementContext(
      [chip("s2", "hf-cc11", "<p>b</p>"), chip("s1", "hf-ab12", "<h1>a</h1>"), chip("s1", "hf-dd22", "<h2>c</h2>")],
      [
        { shapeId: "s1", kind: "page", label: "Hero" },
        { shapeId: "s2", kind: "motion", label: "Intro" },
      ],
    );
    expect(text).toBe(
      [
        ELEMENT_CONTEXT_INTRO,
        'Page "Hero" (shape s1):\n- [data-hf-id="hf-ab12"]: <h1>a</h1>\n- [data-hf-id="hf-dd22"]: <h2>c</h2>',
        'Motion "Intro" (shape s2):\n- [data-hf-id="hf-cc11"]: <p>b</p>',
      ].join("\n\n"),
    );
  });

  it("leaves out a chip whose shape is gone", () => {
    const text = elementContext([chip("gone", "hf-ab12", "<h1>a</h1>")], [{ shapeId: "s1", kind: "page", label: "Hero" }]);
    expect(text).toBe("");
  });

  it("uses the wording of the asset", () => {
    const asset = readFileSync(new URL("../../../assets/prompts/element-context.md", import.meta.url), "utf8");
    expect(asset).toContain(ELEMENT_CONTEXT_INTRO);
    expect(asset).toContain(ELEMENT_CONTEXT_ARTIFACT.replace("{Kind}", "{Kind}"));
    expect(asset).toContain(ELEMENT_CONTEXT_CHIP);
  });
});
