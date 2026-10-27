import { describe, expect, it } from "vitest";
import { carryFor, motionTimeline, type MotionTimeline, type RuntimeClips } from "../../src/index.ts";

// Clips a, b and c sit in the root; d is a clip nested in c; the tweens say who owns what.
const html = (script: string, root = 'data-start="0" data-duration="6"', clips = "") => `<html><body>
<div id="root" data-composition-id="main" data-width="640" data-height="360" ${root}>
  <div id="a" class="clip" data-start="0" data-duration="2"><div id="ta"></div></div>
  <div id="b" class="clip" data-start="2" data-duration="2" data-track-index="1"><div id="tb"></div></div>
  <div id="c" class="clip" data-start="4" data-duration="2"><div id="tc"></div><div id="d" class="clip" data-start="4.5" data-duration="1"><div id="td"></div></div></div>
  ${clips}
</div>
<script>
window.__timelines = window.__timelines || {};
window.__timelines.main = gsap.timeline({ paused: true });
${script}
</script></body></html>`;

const read = (script: string, root?: string, clips?: string, runtime?: RuntimeClips) =>
  motionTimeline(html(script, root, clips), runtime ? { runtime } : {}) as MotionTimeline;
const clip = (reading: MotionTimeline, id: string) => reading.clips.find((c) => c.id === id)!;

describe("motionTimeline: clips", () => {
  it("lists one clip per timed element in the root, in document order, with its track", () => {
    const reading = read("");
    expect(reading.clips.map((c) => c.id)).toEqual(["a", "b", "c", "d"]);
    expect(clip(reading, "b").track).toBe(1);
    expect(clip(reading, "a").track).toBe(0);
  });

  it("reads literal timing as source", () => {
    const b = clip(read(""), "b");
    expect(b.start).toEqual({ kind: "source", value: 2 });
    expect(b.duration).toEqual({ kind: "source", value: 2 });
  });

  it("is script when data-start names another clip", () => {
    const reading = motionTimeline(html("", undefined, '<div id="e" class="clip" data-start="intro" data-duration="1"></div>'));
    expect(clip(reading as MotionTimeline, "e").start).toEqual({ kind: "script", text: "intro" });
  });

  it("is script when the runtime moved the clip from its literal", () => {
    const b = clip(read("", undefined, undefined, { b: { start: 2.5, duration: 2 } }), "b");
    expect(b.start).toEqual({ kind: "script", text: "2" });
    expect(b.duration).toEqual({ kind: "source", value: 2 });
  });

  it("reads the root's length", () => {
    expect(read("").length).toEqual({ kind: "source", value: 6 });
  });
});

describe("carryFor", () => {
  it("carries the tweens whose every target sits in the clip with no nearer clip", () => {
    const reading = read("window.__timelines.main.to('#ta', { x: 1, duration: 1 }, 0);\nwindow.__timelines.main.to('#tb', { x: 1, duration: 1 }, 2);");
    expect(carryFor(reading, clip(reading, "a").hfId)).toEqual({ tweens: [{ index: 0, id: expect.any(String) }], dials: [] });
  });

  it("does not carry a tween on an element inside a nested clip", () => {
    const reading = read("window.__timelines.main.to('#td', { x: 1, duration: 1 }, 4.5);");
    expect(carryFor(reading, clip(reading, "c").hfId)).toEqual({ tweens: [], dials: [] });
    expect(carryFor(reading, clip(reading, "d").hfId)).toEqual({ tweens: [{ index: 0, id: expect.any(String) }], dials: [] });
  });

  it("carries a tween on the clip itself", () => {
    const reading = read("window.__timelines.main.to('#b', { x: 1, duration: 1 }, 2);");
    expect(carryFor(reading, clip(reading, "b").hfId)).toEqual({ tweens: [{ index: 0, id: expect.any(String) }], dials: [] });
  });

  it("refuses when a carried tween's start is the agent's", () => {
    const reading = read("window.__timelines.main.to('#ta', { x: 1, duration: 1 }, '+=0.5');");
    expect(carryFor(reading, clip(reading, "a").hfId)).toEqual({
      refused: "This clip can't move: the position tween on ta is timed by the agent's code.",
    });
  });

  it("carries a dial that times a carried tween, and refuses when that dial also times one outside", () => {
    const script = "unframed.dials('S', {}, function (v) {\n window.__timelines.main.to('#ta', { x: 1, duration: v.dur }, 0);\n window.__timelines.main.to('#tb', { x: 1, duration: v.dur }, 2);\n});";
    const reading = read(script);
    expect(carryFor(reading, clip(reading, "a").hfId)).toEqual({
      refused: "This clip can't move: the parameter dur also times a tween outside it.",
    });
  });

  it("carries a dial whose tweens are all inside the clip", () => {
    const script = "unframed.dials('S', {}, function (v) {\n window.__timelines.main.to('#ta', { x: 1, duration: v.dur }, v.delay);\n});";
    const reading = read(script);
    expect(carryFor(reading, clip(reading, "a").hfId)).toEqual({ tweens: [{ index: 0, id: expect.any(String) }], dials: [["delay"], ["dur"]] });
  });

  it("refuses when another clip's start names this one", () => {
    const reading = motionTimeline(html("", undefined, '<div id="e" class="clip" data-start="a" data-duration="1"></div>')) as MotionTimeline;
    expect(carryFor(reading, clip(reading, "a").hfId)).toEqual({ refused: "This clip can't move: e starts relative to it." });
  });

  it("refuses when the clip's own start or duration is the agent's", () => {
    const reading = motionTimeline(html("", undefined, '<div id="e" class="clip" data-start="a" data-duration="1"></div>')) as MotionTimeline;
    expect(carryFor(reading, clip(reading, "e").hfId)).toEqual({ refused: "Set by the agent's code." });
  });

  it("refuses a stretch whose carried duration is the agent's, and lets a move through", () => {
    const reading = read("window.__timelines.main.to('#ta', { x: 1, duration: d }, 0);");
    const a = clip(reading, "a").hfId;
    expect(carryFor(reading, a)).toEqual({ tweens: [{ index: 0, id: expect.any(String) }], dials: [] });
    expect(carryFor(reading, a, { stretch: true })).toEqual({
      refused: "This clip can't move: the position tween on ta is timed by the agent's code.",
    });
  });
});
