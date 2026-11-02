import { describe, expect, it } from "vitest";
import { applyMotionEdits, motionTimeline, type MotionEdit, type MotionEditOptions, type MotionTimeline } from "../../src/motion/index.ts";

const SCRIPT = `window.__timelines = window.__timelines || {};
window.__timelines.main = gsap.timeline({ paused: true });
window.__timelines.main.fromTo('#ta', { opacity: 0 }, { opacity: 1, duration: 1 }, 0.5);
window.__timelines.main.to('#tb', { x: 40, duration: 1 }, 2.5);
window.__timelines.main.to('#tc', { x: 10, duration: 0.5 }, 4);`;

// The root holds three clips. `extra` goes inside the root, `script` replaces the timeline script.
const html = (extra = "", script = SCRIPT, duration = "6") => `<html><body>
<div id="root" data-composition-id="main" data-start="0" data-duration="${duration}" data-width="640" data-height="360">
  <div id="a" class="clip" data-start="0" data-duration="2"><div id="ta"></div></div>
  <div id="b" class="clip" data-start="2" data-duration="2"><div id="tb"></div></div>
  <div id="c" class="clip" data-start="4" data-duration="2"><div id="tc"></div></div>
  ${extra}
</div>
<script>
${script}
</script></body></html>`;

const reading = (source = html()) => motionTimeline(source) as MotionTimeline;
const clipOf = (source: string, id: string) => reading(source).clips.find((clip) => clip.id === id)!;
const tweenOn = (source: string, name: string) => {
  const model = reading(source);
  return model.tweens.find((t) => t.targets.length > 0 && model.elements[t.targets[0]!]?.name === name)!;
};
const ok = (edits: MotionEdit[], source = html(), options: MotionEditOptions = {}) => {
  const result = applyMotionEdits(source, edits, options);
  if (!result.ok) throw new Error(result.refusal);
  return result;
};

describe("clip-time", () => {
  it("moves a clip and carries its tween with it, in one edit", () => {
    const b = clipOf(html(), "b");
    const result = ok([{ type: "clip-time", clip: b.hfId, start: 2.5 }]);
    expect(clipOf(result.html, "b").start).toEqual({ kind: "source", value: 2.5 });
    expect(tweenOn(result.html, "tb").start).toEqual({ kind: "source", value: 3 });
    expect(result.summary).toEqual(["Moved clip b to 2.5 s"]);
  });

  it("stretches a clip and scales its carried tween from the old span onto the new one", () => {
    const b = clipOf(html(), "b");
    const result = ok([{ type: "clip-time", clip: b.hfId, duration: 4 }]);
    expect(clipOf(result.html, "b").duration).toEqual({ kind: "source", value: 4 });
    expect(tweenOn(result.html, "tb").duration).toEqual({ kind: "source", value: 2 });
    expect(result.summary).toEqual(["Set clip b to 4 s long"]);
  });

  it("refuses a move whose carried tween's start the agent's code sets, with the carry sentence", () => {
    const source = html("", SCRIPT.replace("to('#tb', { x: 40, duration: 1 }, 2.5)", "to('#tb', { x: 40, duration: 1 }, '+=0.5')"));
    const b = clipOf(source, "b");
    expect(applyMotionEdits(source, [{ type: "clip-time", clip: b.hfId, start: 3 }])).toEqual({
      ok: false,
      refusal: "This clip can't move: the position tween on tb is timed by the agent's code.",
    });
  });

  it("refuses a clip that another clip's start names, with the carry sentence", () => {
    const source = html('<div id="d" class="clip" data-start="b" data-duration="1"></div>');
    const b = clipOf(source, "b");
    expect(applyMotionEdits(source, [{ type: "clip-time", clip: b.hfId, start: 3 }])).toEqual({
      ok: false,
      refusal: "This clip can't move: d starts relative to it.",
    });
  });

  it("refuses a clip whose own start the agent's code sets", () => {
    const source = html('<div id="d" class="clip" data-start="intro" data-duration="1"></div>');
    const d = clipOf(source, "d");
    expect(applyMotionEdits(source, [{ type: "clip-time", clip: d.hfId, start: 1 }])).toEqual({
      ok: false,
      refusal: "Set by the agent's code.",
    });
  });

  it("refuses when a carried tween's target is locked, naming that element", () => {
    const source = html();
    const b = clipOf(source, "b");
    const tb = tweenOn(source, "tb");
    expect(applyMotionEdits(source, [{ type: "clip-time", clip: b.hfId, start: 3 }], { lockedElements: new Set([tb.targets[0]!]) })).toEqual({
      ok: false,
      refusal: "tb is locked. Unlock it in Layers to edit it.",
    });
  });

  it("refuses a clip that is not in the motion", () => {
    expect(applyMotionEdits(html(), [{ type: "clip-time", clip: "hf-nope", start: 1 }])).toEqual({
      ok: false,
      refusal: "No clip hf-nope in this motion.",
    });
  });

  it("writes the clip's own attributes and leaves the rest of the file alone", () => {
    const b = clipOf(html(), "b");
    const result = ok([{ type: "clip-time", clip: b.hfId, start: 2.25 }]);
    expect(result.html).toContain('data-start="2.25"');
    expect(result.html).toContain('id="ta"');
  });
});

describe("composition-duration", () => {
  it("writes the root's data-duration and gives a summary line", () => {
    const result = ok([{ type: "composition-duration", seconds: 8 }]);
    expect(reading(result.html).length).toEqual({ kind: "source", value: 8 });
    expect(result.summary).toEqual(["Set the length to 8 s"]);
  });

  it("keeps the length at least one frame and rounds it to the millisecond", () => {
    expect(reading(ok([{ type: "composition-duration", seconds: 0 }]).html).length).toEqual({ kind: "source", value: 0.033 });
    expect(reading(ok([{ type: "composition-duration", seconds: 7.12345 }]).html).length).toEqual({ kind: "source", value: 7.123 });
  });

  it("refuses a length the agent's code sets", () => {
    expect(applyMotionEdits(html("", SCRIPT, "auto"), [{ type: "composition-duration", seconds: 3 }])).toEqual({
      ok: false,
      refusal: "The length is set by the agent's code.",
    });
  });

  it("refuses a locked root", () => {
    const source = html();
    expect(applyMotionEdits(source, [{ type: "composition-duration", seconds: 3 }], { lockedElements: new Set([reading(source).root!]) })).toEqual({
      ok: false,
      refusal: "root is locked. Unlock it in Layers to edit it.",
    });
  });
});
