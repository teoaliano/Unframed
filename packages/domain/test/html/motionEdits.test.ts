import { describe, expect, it } from "vitest";
import { applySourceEdits } from "../../src/html/index.ts";
import { motionTimeline, type MotionEdit } from "../../src/motion/index.ts";

// The motion edits join spec 18's source edits in one list (spec 21, tasks 14 to 16): element
// edits and motion edits apply in one call, and each kind keeps its own refusals and summaries.
const stage = `<div id="root" data-composition-id="main" data-start="0" data-duration="6" data-width="640" data-height="360">
  <div id="c" class="clip" data-start="0" data-duration="6">
    <div data-hf-id="title1" id="title">Launch</div><div data-hf-id="logo1" id="logo"></div>
  </div>
</div>`;
const SCRIPT = `window.__timelines = window.__timelines || {};
window.__timelines.main = gsap.timeline({ paused: true });
window.__timelines.main.fromTo('#title', { opacity: 0 }, { opacity: 1, duration: 0.8 }, 0.2);
window.__timelines.main.to('#logo', { x: 4, duration: 0.5 }, 1);`;
const motion = `<html><body>${stage}\n<script>\n${SCRIPT}\n</script></body></html>`;
const page = `<html><body><h1 data-hf-id="h1">Hi</h1></body></html>`;

describe("applySourceEdits with motion edits", () => {
  it("applies a text edit and a tween move in one list and summarises both", () => {
    const reading = motionTimeline(motion);
    const title = reading.tweens[0]!;
    const result = applySourceEdits(
      motion,
      [
        { type: "text", elementId: "title1", text: "Hello" },
        { type: "tween-time", tween: title.ref, start: 0.5 },
      ],
      "motion",
    );
    if (!result.ok) throw new Error(result.refusal);
    expect(result.html).toContain(">Hello</div>");
    expect(motionTimeline(result.html).tweens[0]!.start).toEqual({ kind: "source", value: 0.5 });
    expect(result.summary).toContain("Moved title visual to 0.5 s");
  });

  it("refuses a motion edit on a page, since a page has no timeline", () => {
    const result = applySourceEdits(page, [{ type: "composition-duration", seconds: 3 }], "page");
    expect(result).toEqual({ ok: false, refusal: "This page has no timeline." });
  });

  it("passes the locked elements through, so a locked tween refuses with the lock sentence", () => {
    const title = motionTimeline(motion).tweens[0]!;
    const edit: MotionEdit = { type: "tween-time", tween: title.ref, start: 1 };
    const result = applySourceEdits(motion, [edit], "motion", null, new Map(), { lockedElements: new Set(["title1"]) });
    expect(result).toEqual({ ok: false, refusal: "title is locked. Unlock it in Layers to edit it." });
  });
});
