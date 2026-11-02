import { describe, expect, it } from "vitest";
import { EASE_NAMES } from "../../src/index.ts";
import { applyMotionEdits, motionTimeline, type MotionEdit, type MotionEditOptions, type Tween } from "../../src/motion/index.ts";

const stage = `<div id="root" data-composition-id="main" data-start="0" data-duration="6" data-width="640" data-height="360">
  <div id="c" class="clip" data-start="0" data-duration="6">
    <div id="title">Launch</div><div class="tile" id="t1"></div><div class="tile" id="t2"></div><div class="tile" id="t3"></div><div id="ring"></div><div id="logo"></div>
  </div>
</div>`;

const SCRIPT = `window.__timelines = window.__timelines || {};
window.__timelines.main = gsap.timeline({ paused: true });
window.__timelines.main.fromTo('#title', { opacity: 0 }, { opacity: 1, duration: 0.8, ease: 'power2.out' }, 0.2);
window.__timelines.main.to('.tile', { x: 40, duration: 0.5, stagger: 0.1 }, 1);
window.__timelines.main.to('.tile', { y: 4, duration: 0.5, stagger: { amount: 0.4 } }, 2);
window.__timelines.main.to('#ring', { keyframes: { '0%': { scale: 0.8 }, '100%': { scale: 1 } }, duration: 1, ease: 'sine.inOut' }, 3);
window.__timelines.main.to('#logo', { x: 4, duration: 0.5, ease: unframed.token('ease/fast') }, 4);
unframed.dials('S', { ease: { ease: 'expo.out' } }, function (v) {
  window.__timelines.main.to('#title', { x: 1, duration: 0.5, ease: v.ease }, 5);
});`;

const html = (script = SCRIPT) => `<html><body>${stage}\n<script>\n${script}\n</script></body></html>`;
const reading = (source = html()) => motionTimeline(source);
const tween = (source: string, index: number): Tween => reading(source).tweens[index]!;
const kit = (name: string) => (name === "ease/fast" ? "easing" : name === "color/accent" ? "colour" : undefined);
const options = (extra: Partial<MotionEditOptions> = {}): MotionEditOptions => ({ tokenKind: kit, ...extra });
const ok = (edits: MotionEdit[], source = html(), extra: Partial<MotionEditOptions> = {}) => {
  const result = applyMotionEdits(source, edits, options(extra));
  if (!result.ok) throw new Error(result.refusal);
  return result;
};

describe("EASE_NAMES", () => {
  it("holds the 31 eases: linear, then three forms of each of ten families", () => {
    expect(EASE_NAMES).toHaveLength(31);
    expect(EASE_NAMES[0]).toBe("none");
    expect(EASE_NAMES).toContain("power1.inOut");
    expect(EASE_NAMES).toContain("bounce.out");
    expect(EASE_NAMES).not.toContain("quad.out");
  });
});

describe("tween-ease", () => {
  it("writes a catalogue ease and reads it back", () => {
    const title = tween(html(), 0);
    const result = ok([{ type: "tween-ease", tween: title.ref, ease: "expo.inOut" }]);
    expect(tween(result.html, 0).ease).toEqual({ kind: "source", value: "expo.inOut" });
    expect(result.summary).toEqual(["Eased title visual with expo.inOut"]);
  });

  it("writes linear as none", () => {
    const title = tween(html(), 0);
    expect(tween(ok([{ type: "tween-ease", tween: title.ref, ease: "none" }]).html, 0).ease).toEqual({ kind: "source", value: "none" });
  });

  it("refuses a name outside the catalogue", () => {
    const title = tween(html(), 0);
    expect(applyMotionEdits(html(), [{ type: "tween-ease", tween: title.ref, ease: "quad.out" }], options())).toEqual({
      ok: false,
      refusal: "quad.out is not an ease the timeline offers.",
    });
  });

  it("accepts the ease already written as a no-op", () => {
    const title = tween(html(), 0);
    const result = ok([{ type: "tween-ease", tween: title.ref, ease: "power2.out" }]);
    expect(tween(result.html, 0).ease).toEqual({ kind: "source", value: "power2.out" });
    expect(result.summary).toEqual([]);
  });

  it("keeps applying the edits after an ease no-op", () => {
    const title = tween(html(), 0);
    const result = ok([
      { type: "tween-ease", tween: title.ref, ease: "power2.out" },
      { type: "tween-stagger", tween: tween(html(), 1).ref, each: 0.2 },
    ]);
    expect(tween(result.html, 1).stagger).toEqual({ kind: "source", value: 0.2 });
    expect(result.summary).toEqual(["Spaced the t1 stagger 0.2 s apart"]);
  });

  it("writes easeEach on a keyframed tween, as the writer does", () => {
    const ring = tween(html(), 3);
    const result = ok([{ type: "tween-ease", tween: ring.ref, ease: "back.out" }]);
    expect(result.html).toContain("easeEach");
    expect(tween(result.html, 3).ease).toEqual({ kind: "source", value: "sine.inOut" });
  });

  it("writes a token as an expression, and reads it back as the token", () => {
    const title = tween(html(), 0);
    const result = ok([{ type: "tween-ease", tween: title.ref, ease: { token: "ease/fast" } }]);
    expect(result.html).toContain('ease: unframed.token("ease/fast")');
    expect(tween(result.html, 0).ease).toEqual({ kind: "token", name: "ease/fast" });
  });

  it("refuses a token that is not an easing token of the kit", () => {
    const title = tween(html(), 0);
    expect(applyMotionEdits(html(), [{ type: "tween-ease", tween: title.ref, ease: { token: "color/accent" } }], options())).toEqual({
      ok: false,
      refusal: "color/accent is not an easing token of this project's kit.",
    });
  });

  it("refuses an ease the agent's code sets", () => {
    const title = tween(html(), 5);
    expect(applyMotionEdits(html(), [{ type: "tween-ease", tween: title.ref, ease: "none" }], options())).toEqual({
      ok: false,
      refusal: "title's ease is set by the agent's code.",
    });
  });
});

describe("tween-stagger", () => {
  it("writes a number stagger in place", () => {
    const tiles = tween(html(), 1);
    const result = ok([{ type: "tween-stagger", tween: tiles.ref, each: 0.25 }]);
    expect(tween(result.html, 1).stagger).toEqual({ kind: "source", value: 0.25 });
    expect(tween(result.html, 1).staggerForm).toBe("number");
    expect(result.summary).toEqual(["Spaced the t1 stagger 0.25 s apart"]);
  });

  it("writes an each object as each", () => {
    const tiles = tween(html(), 1);
    const eachForm = ok([{ type: "tween-stagger", tween: tiles.ref, each: 0.2 }], html(SCRIPT.replace("stagger: 0.1", "stagger: { each: 0.1 }")));
    expect(tween(eachForm.html, 1).stagger).toEqual({ kind: "source", value: 0.2 });
    expect(tween(eachForm.html, 1).staggerForm).toBe("each");
  });

  it("spreads an amount over the targets, converted back from the spacing", () => {
    const tiles = tween(html(), 2);
    const result = ok([{ type: "tween-stagger", tween: tiles.ref, each: 0.25 }]);
    expect(tween(result.html, 2).stagger).toEqual({ kind: "source", value: 0.5 });
    expect(tween(result.html, 2).staggerForm).toBe("amount");
  });

  it("refuses a stagger with other options, which is read-only", () => {
    const tiles = tween(html(SCRIPT.replace("stagger: 0.1", "stagger: { each: 0.1, from: 'end' }")), 1);
    expect(applyMotionEdits(html(SCRIPT.replace("stagger: 0.1", "stagger: { each: 0.1, from: 'end' }")), [{ type: "tween-stagger", tween: tiles.ref, each: 0.2 }], options())).toEqual({
      ok: false,
      refusal: "t1's stagger is set by the agent's code.",
    });
  });

  it("refuses a tween with no stagger", () => {
    const title = tween(html(), 0);
    expect(applyMotionEdits(html(), [{ type: "tween-stagger", tween: title.ref, each: 0.2 }], options())).toEqual({
      ok: false,
      refusal: "title has no stagger to space.",
    });
  });
});
