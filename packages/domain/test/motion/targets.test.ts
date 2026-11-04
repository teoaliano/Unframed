import { describe, expect, it } from "vitest";
import { motionTimeline, staggerOffsets, type Tween } from "../../src/motion/index.ts";

const stage = `<div id="root" data-composition-id="main" data-start="0" data-duration="4" data-width="640" data-height="360">
  <div id="c" class="clip" data-start="0" data-duration="4">
    <div id="a" class="tile"></div><div id="b" class="tile"></div><div class="tile"></div>
  </div>
</div>`;

const motion = (script: string) => `<html><body>${stage}
<script>
window.__timelines = window.__timelines || {};
window.__timelines.main = gsap.timeline({ paused: true });
${script}
</script></body></html>`;

const tween = (script: string, index = 0): Tween => motionTimeline(motion(script)).tweens[index]!;

describe("motionTimeline: targets", () => {
  it("resolves an id selector to its data-hf-id", () => {
    const t = tween("window.__timelines.main.to('#a', { x: 1, duration: 1 }, 0);");
    expect(t.targets).toHaveLength(1);
    expect(t.targets[0]).toMatch(/^hf-/);
  });

  it("lists every class match, each with its own data-hf-id", () => {
    const t = motionTimeline(motion("window.__timelines.main.to('.tile', { x: 1, duration: 1 }, 0);")).tweens[0]!;
    expect(t.targets).toHaveLength(3);
    expect(new Set(t.targets).size).toBe(3);
  });

  it("is read-only when the target does not resolve in the source", () => {
    expect(tween("window.__timelines.main.to('#missing', { x: 1, duration: 1 }, 0);").readOnly).toBe("Its target is found while the motion runs.");
  });

  it("is read-only for a computed selector", () => {
    expect(tween("window.__timelines.main.to('#' + name, { x: 1, duration: 1 }, 0);").readOnly).toBe("Its target is found while the motion runs.");
  });

  it("keeps a loop reason ahead of an unresolved target", () => {
    expect(tween("for (var i = 0; i < 2; i++) window.__timelines.main.to('#missing', { x: 1 }, 0);").readOnly).toBe("It runs in a loop.");
  });
});

describe("motionTimeline: groups", () => {
  it.each([
    ["position", "x: 1", ["position"]],
    ["scale", "scale: 2", ["scale"]],
    ["size", "width: 10", ["size"]],
    ["rotation", "rotation: 90", ["rotation"]],
    ["visual", "opacity: 0", ["visual"]],
    ["visual colour", "color: '#fff'", ["visual"]],
    ["visual background", "backgroundColor: '#fff'", ["visual"]],
    ["visual border colour", "borderColor: '#fff'", ["visual"]],
    ["other", "boxShadow: '0 0 1px #000'", ["other"]],
  ])("classifies %s", (_name, prop, groups) => {
    expect(tween(`window.__timelines.main.to('#a', { ${prop}, duration: 1 }, 0);`).groups).toEqual(groups);
  });

  it("lists every group a mixed tween animates, in the lane order", () => {
    expect(tween("window.__timelines.main.to('#a', { color: '#fff', x: 1, opacity: 0, duration: 1 }, 0);").groups).toEqual(["position", "visual"]);
  });

  it("lists the other group after the visual one when a tween also animates a shadow", () => {
    expect(tween("window.__timelines.main.to('#a', { backgroundColor: '#fff', boxShadow: '0 0 1px #000', duration: 1 }, 0);").groups).toEqual(["visual", "other"]);
  });

  it("reads the groups of keyframed values", () => {
    expect(tween("window.__timelines.main.to('#a', { keyframes: { '0%': { x: 0 }, '100%': { rotation: 10 } }, duration: 1 }, 0);").groups).toEqual(["position", "rotation"]);
  });
});

describe("motionTimeline: keyframes", () => {
  it("gives each percentage step its own diamond", () => {
    const t = tween("window.__timelines.main.to('#a', { keyframes: { '0%': { x: 0 }, '50%': { x: 10 }, '100%': { x: 20 } }, duration: 1 }, 0);");
    expect(t.keyframes.map((k) => k.at)).toEqual([0, 0.5, 1]);
  });

  it("gives each object-array step an even place", () => {
    const t = tween("window.__timelines.main.to('#a', { keyframes: [{ x: 0 }, { x: 5 }, { x: 10 }], duration: 1 }, 0);");
    expect(t.keyframes.map((k) => k.at)).toEqual([0, 0.5, 1]);
  });

  it("reads a step's own ease", () => {
    const t = tween("window.__timelines.main.to('#a', { keyframes: { '0%': { x: 0, ease: 'none' }, '100%': { x: 1 } }, duration: 1 }, 0);");
    expect(t.keyframes[0]!.ease).toEqual({ kind: "source", value: "none" });
    expect(t.keyframes[1]!.ease).toBeNull();
  });
});

describe("motionTimeline: staggers", () => {
  it("reads a number as the spacing", () => {
    const t = tween("window.__timelines.main.to('.tile', { x: 1, duration: 1, stagger: 0.1 }, 0);");
    expect(t.stagger).toEqual({ kind: "source", value: 0.1 });
    expect(staggerOffsets(t)).toEqual([0, 0.1, 0.2]);
  });

  it("reads an each object as the spacing", () => {
    const t = tween("window.__timelines.main.to('.tile', { x: 1, duration: 1, stagger: { each: 0.05 } }, 0);");
    expect(staggerOffsets(t)).toEqual([0, 0.05, 0.1]);
  });

  it("spreads an amount over the targets", () => {
    const t = tween("window.__timelines.main.to('.tile', { x: 1, duration: 1, stagger: { amount: 1 } }, 0);");
    expect(staggerOffsets(t)).toEqual([0, 0.5, 1]);
  });

  it("draws every target at the start for any other stagger option, and that amount is read-only", () => {
    const t = tween("window.__timelines.main.to('.tile', { x: 1, duration: 1, stagger: { each: 0.1, from: 'end' } }, 0);");
    expect(t.stagger?.kind).toBe("script");
    expect(staggerOffsets(t)).toEqual([0, 0, 0]);
  });

  it("is null without a stagger", () => {
    const t = tween("window.__timelines.main.to('.tile', { x: 1, duration: 1 }, 0);");
    expect(t.stagger).toBeNull();
    expect(staggerOffsets(t)).toEqual([0, 0, 0]);
  });
});
