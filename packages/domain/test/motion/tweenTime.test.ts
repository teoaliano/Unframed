import { describe, expect, it } from "vitest";
import { applyMotionEdits, motionTimeline, type MotionEdit, type MotionEditOptions, type Tween } from "../../src/motion/index.ts";

const stage = `<div id="root" data-composition-id="main" data-start="0" data-duration="6" data-width="640" data-height="360">
  <div id="c" class="clip" data-start="0" data-duration="6">
    <div id="title">Launch</div><div id="logo"></div><div id="dot"></div><div id="inner"></div>
  </div>
</div>`;

// title: literal fromTo; logo: dial duration; dot: loop-free keyframed to; inner sits in a helper; set on logo.
const SCRIPT = `window.__timelines = window.__timelines || {};
window.__timelines.main = gsap.timeline({ paused: true });
window.__timelines.main.fromTo('#title', { opacity: 0 }, { opacity: 1, duration: 0.8 }, 0.2);
unframed.dials('S', { dur: [1, 0.5, 2] }, function (v) {
  window.__timelines.main.to('#logo', { x: 10, duration: v.dur }, 1);
});
window.__timelines.main.to('#dot', { keyframes: { '0%': { x: 0 }, '100%': { x: 50 } }, duration: 2 }, 3);
window.__timelines.main.set('#logo', { opacity: 0 }, 0);`;

const html = (script = SCRIPT) => `<html><body>${stage}\n<script>\n${script}\n</script></body></html>`;

const read = (source = html()) => motionTimeline(source);
const tweenOn = (reading: ReturnType<typeof read>, id: string): Tween => reading.tweens.find((t) => t.targets.length && reading.elements[t.targets[0]!]?.name === id)!;

const apply = (edits: MotionEdit[], source = html(), options: MotionEditOptions = {}) => applyMotionEdits(source, edits, options);

describe("tween-time", () => {
  it("moves a literal tween's start and reads it back", () => {
    const base = read();
    const title = tweenOn(base, "title");
    const result = apply([{ type: "tween-time", tween: title.ref, start: 1.5 }]);
    if (!result.ok) throw new Error(result.refusal);
    const after = read(result.html);
    expect(tweenOn(after, "title").start).toEqual({ kind: "source", value: 1.5 });
    expect(tweenOn(after, "title").duration).toEqual({ kind: "source", value: 0.8 });
  });

  it("stretches a literal tween's duration", () => {
    const base = read();
    const title = tweenOn(base, "title");
    const result = apply([{ type: "tween-time", tween: title.ref, duration: 1.25 }]);
    if (!result.ok) throw new Error(result.refusal);
    expect(tweenOn(read(result.html), "title").duration).toEqual({ kind: "source", value: 1.25 });
  });

  it("rounds to the millisecond and keeps a start at least 0", () => {
    const title = tweenOn(read(), "title");
    const rounded = apply([{ type: "tween-time", tween: title.ref, start: 1.23456 }]);
    if (!rounded.ok) throw new Error(rounded.refusal);
    expect(tweenOn(read(rounded.html), "title").start).toEqual({ kind: "source", value: 1.235 });
    const negative = apply([{ type: "tween-time", tween: title.ref, start: -1 }]);
    if (!negative.ok) throw new Error(negative.refusal);
    expect(tweenOn(read(negative.html), "title").start).toEqual({ kind: "source", value: 0 });
  });

  it("keeps a duration at least one frame", () => {
    const title = tweenOn(read(), "title");
    const result = apply([{ type: "tween-time", tween: title.ref, duration: 0 }]);
    if (!result.ok) throw new Error(result.refusal);
    expect(tweenOn(read(result.html), "title").duration).toEqual({ kind: "source", value: 0.033 });
  });

  it("moves a keyframed tween's window and keeps its steps at their percentages", () => {
    const dot = tweenOn(read(), "dot");
    const result = apply([{ type: "tween-time", tween: dot.ref, start: 2, duration: 4 }]);
    if (!result.ok) throw new Error(result.refusal);
    const after = tweenOn(read(result.html), "dot");
    expect(after.start).toEqual({ kind: "source", value: 2 });
    expect(after.duration).toEqual({ kind: "source", value: 4 });
    expect(after.keyframes.map((k) => k.at)).toEqual([0, 1]);
    expect(after.keyframes[1]!.values.x).toEqual({ kind: "source", value: 50 });
  });

  it("applies several edits to one tween in order, each after the id they changed", () => {
    const title = tweenOn(read(), "title");
    const result = apply([
      { type: "tween-time", tween: title.ref, start: 1 },
      { type: "tween-time", tween: title.ref, start: 2, duration: 0.5 },
    ]);
    if (!result.ok) throw new Error(result.refusal);
    const after = tweenOn(read(result.html), "title");
    expect(after.start).toEqual({ kind: "source", value: 2 });
    expect(after.duration).toEqual({ kind: "source", value: 0.5 });
  });

  it("writes the start of a set and refuses a duration on it", () => {
    const logo = read().tweens.find((t) => t.method === "set")!;
    const moved = apply([{ type: "tween-time", tween: logo.ref, start: 0.5 }]);
    if (!moved.ok) throw new Error(moved.refusal);
    expect(read(moved.html).tweens.find((t) => t.method === "set")!.start).toEqual({ kind: "source", value: 0.5 });
    expect(apply([{ type: "tween-time", tween: logo.ref, duration: 1 }])).toEqual({
      ok: false,
      refusal: "A set has no duration to change.",
    });
  });

  it("writes nothing and refuses when the tween's id no longer matches", () => {
    const title = tweenOn(read(), "title");
    const stale = { ...title.ref, id: "#title-stale" };
    expect(apply([{ type: "tween-time", tween: stale, start: 1 }])).toEqual({
      ok: false,
      refusal: "The tween on title changed since this edit began.",
    });
  });

  it("refuses a duration owned by the agent's code, naming the target and field", () => {
    const logo = tweenOn(read(), "logo");
    expect(apply([{ type: "tween-time", tween: logo.ref, duration: 2 }])).toEqual({
      ok: false,
      refusal: "logo's duration is set by the agent's code.",
    });
  });

  it("refuses an edit to a read-only tween", () => {
    const source = html(`window.__timelines = window.__timelines || {};
window.__timelines.main = gsap.timeline({ paused: true });
for (var i = 0; i < 2; i++) { window.__timelines.main.to('#dot', { x: i }, 0); }`);
    const dot = read(source).tweens[0]!;
    expect(apply([{ type: "tween-time", tween: dot.ref, start: 1 }], source)).toEqual({
      ok: false,
      refusal: "dot's start is set by the agent's code.",
    });
  });

  it("refuses a locked target, and an element inside a locked one", () => {
    const title = tweenOn(read(), "title");
    expect(apply([{ type: "tween-time", tween: title.ref, start: 1 }], html(), { lockedElements: new Set([title.targets[0]!]) })).toEqual({
      ok: false,
      refusal: "title is locked. Unlock it in Layers to edit it.",
    });
    const clip = read().elements[title.targets[0]!]!.parent;
    expect(clip).not.toBeNull();
    expect(apply([{ type: "tween-time", tween: title.ref, start: 1 }], html(), { lockedElements: new Set([clip!]) })).toEqual({
      ok: false,
      refusal: "c is locked. Unlock it in Layers to edit it.",
    });
  });

  it("refuses when the writer leaves the script unchanged", () => {
    const title = tweenOn(read(), "title");
    expect(apply([{ type: "tween-time", tween: title.ref, start: 0.2 }])).toEqual({
      ok: false,
      refusal: "The edit to title could not be applied.",
    });
  });

  it("gives one summary line per edit, in sentence case", () => {
    const title = tweenOn(read(), "title");
    const result = apply([
      { type: "tween-time", tween: title.ref, start: 1.5 },
      { type: "tween-time", tween: title.ref, duration: 1.25 },
    ]);
    if (!result.ok) throw new Error(result.refusal);
    expect(result.summary).toEqual(["Moved title visual to 1.5 s", "Set title duration to 1.25 s"]);
  });
});

describe("tween-time: duration tokens (spec 21, The values panel, a token-owned duration)", () => {
  const kind = (name: string) => (name === "duration/fast" ? "duration" : name === "color/accent" ? "colour" : undefined);
  const withTokens = { tokenKind: kind };

  it("writes a duration token as an expression, reads it back as a token, and keeps the start", () => {
    const title = tweenOn(read(), "title");
    const result = apply([{ type: "tween-time", tween: title.ref, start: 0.4, duration: { token: "duration/fast" } }], html(), withTokens);
    if (!result.ok) throw new Error(result.refusal);
    expect(result.html).toContain('unframed.token("duration/fast")');
    const after = tweenOn(read(result.html), "title");
    expect(after.duration).toEqual({ kind: "token", name: "duration/fast" });
    expect(after.start).toEqual({ kind: "source", value: 0.4 });
  });

  it("refuses a token that is not a duration", () => {
    const title = tweenOn(read(), "title");
    expect(apply([{ type: "tween-time", tween: title.ref, duration: { token: "color/accent" } }], html(), withTokens)).toEqual({
      ok: false,
      refusal: "color/accent is not a token of a matching type.",
    });
  });

  it("detaches a token duration as a number", () => {
    const title = tweenOn(read(), "title");
    const tokened = apply([{ type: "tween-time", tween: title.ref, duration: { token: "duration/fast" } }], html(), withTokens);
    if (!tokened.ok) throw new Error(tokened.refusal);
    const detached = apply([{ type: "tween-time", tween: tweenOn(read(tokened.html), "title").ref, duration: 0.6 }], tokened.html, withTokens);
    if (!detached.ok) throw new Error(detached.refusal);
    expect(tweenOn(read(detached.html), "title").duration).toEqual({ kind: "source", value: 0.6 });
  });
});

describe("tween-time: the summary names the duration", () => {
  it("says Set <element> duration to <n> s", () => {
    const dot = `window.__timelines.main.to('#box', { x: 10, duration: 1 }, 1);`;
    const source = `<html><body><div id="root" data-composition-id="main" data-start="0" data-duration="6" data-width="640" data-height="360"><div id="c" class="clip" data-start="0" data-duration="6"><div id="box" data-uf-name="Dot 1"></div></div></div>\n<script>\nwindow.__timelines = {};\nwindow.__timelines.main = gsap.timeline({ paused: true });\n${dot}\n</script></body></html>`;
    const result = applyMotionEdits(source, [{ type: "tween-time", tween: motionTimeline(source).tweens[0]!.ref, duration: 2 }]);
    expect(result.ok && result.summary).toEqual(["Set Dot 1 duration to 2 s"]);
  });
});
