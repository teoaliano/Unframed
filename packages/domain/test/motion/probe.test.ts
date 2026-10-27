import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { probeMotion, type ProbeCounts } from "../../src/index.ts";

const root = join(import.meta.dirname, "../../../../assets/fixtures");
const sample = (name: string) => readFileSync(join(root, "motion-samples", name), "utf8");
const fixture = (name: string) => {
  const scenario = JSON.parse(readFileSync(join(root, `${name}.json`), "utf8"));
  const motions = scenario.turns.flatMap((turn: { tools?: { name: string; input: { html?: string } }[] }) =>
    (turn.tools ?? []).filter((tool) => tool.name === "motion_write" && tool.input.html).map((tool) => tool.input.html!),
  );
  return motions as string[];
};

const none = { source: 0, dial: 0, token: 0, script: 0 };

// Counts the file is written to produce. A row per file; the owner counts are for the start,
// duration, every value at a diamond, and every stagger. Read-only reasons count per tween.
const expected: [string, ProbeCounts][] = [
  ["01-literal-two-clips.html", { tweens: 2, start: { ...none, source: 2 }, duration: { ...none, source: 2 }, values: { ...none, source: 6 }, stagger: none, readOnly: {} }],
  ["02-dial-timing.html", { tweens: 1, start: { ...none, dial: 1 }, duration: { ...none, dial: 1 }, values: { ...none, dial: 2 }, stagger: none, readOnly: {} }],
  ["03-token-ease.html", { tweens: 2, start: { ...none, source: 1, script: 1 }, duration: { ...none, source: 2 }, values: { ...none, source: 2, token: 1 }, stagger: none, readOnly: {} }],
  ["04-stagger.html", { tweens: 2, start: { ...none, source: 2 }, duration: { ...none, source: 2 }, values: { ...none, source: 5 }, stagger: { ...none, source: 2 }, readOnly: {} }],
  ["05-loop.html", { tweens: 2, start: { ...none, source: 1, script: 1 }, duration: { ...none, source: 2 }, values: { ...none, source: 3 }, stagger: none, readOnly: { loop: 1 } }],
  ["06-helper.html", { tweens: 1, start: { ...none, script: 1 }, duration: { ...none, source: 1 }, values: { ...none, source: 2 }, stagger: none, readOnly: { helper: 1 } }],
  ["07-keyframes-set-from.html", { tweens: 3, start: { ...none, source: 3 }, duration: { ...none, source: 2 }, values: { ...none, source: 8 }, stagger: none, readOnly: {} }],
];

describe("motion probe over the committed samples", () => {
  it.each(expected)("%s", (name, counts) => {
    expect(probeMotion(sample(name))).toEqual(counts);
  });

  it("does not read tweens made on a local alias of the timeline", () => {
    // The parser locates calls on window.__timelines.main only. dials-timeline.md's example uses `tl`,
    // so a file that follows the example reads as having no tweens (spec 21, Further Notes).
    const aliased = `window.__timelines = window.__timelines || {};
var tl = window.__timelines.main = gsap.timeline({ paused: true });
tl.fromTo('#box', { opacity: 0 }, { opacity: 1, duration: 1 }, 0);`;
    expect(probeMotion(aliased).tweens).toBe(0);
  });

  it("counts the scripted agent's motion writes", () => {
    // dials: one literal fromTo; the other fixtures write no tween.
    const dials = fixture("dials").map(probeMotion);
    expect(dials).toEqual([
      { tweens: 1, start: { ...none, source: 1 }, duration: { ...none, source: 1 }, values: { ...none, source: 2 }, stagger: none, readOnly: {} },
    ]);
    for (const name of ["revise", "stitch", "bad-shape"]) {
      for (const html of fixture(name)) expect(probeMotion(html).tweens).toBe(0);
    }
  });
});
