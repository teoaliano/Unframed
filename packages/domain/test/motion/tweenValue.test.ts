import { describe, expect, it } from "vitest";
import { applyMotionEdits, motionTimeline, type MotionEdit, type MotionEditOptions, type Tween } from "../../src/motion/index.ts";

const stage = `<div id="root" data-composition-id="main" data-start="0" data-duration="6" data-width="640" data-height="360">
  <div id="c" class="clip" data-start="0" data-duration="6">
    <div id="title">Launch</div><div id="box"></div><div id="ring"></div><div id="logo"></div><div id="pill"></div>
  </div>
</div>`;

const SCRIPT = `window.__timelines = window.__timelines || {};
window.__timelines.main = gsap.timeline({ paused: true });
window.__timelines.main.fromTo('#title', { opacity: 0, x: 0 }, { opacity: 1, x: 12, duration: 0.8 }, 0.2);
window.__timelines.main.to('#box', { x: '120px', color: '#abc', duration: 1 }, 1);
window.__timelines.main.to('#ring', { keyframes: { '0%': { scale: 0.8 }, '50%': { scale: 1.1 }, '100%': { scale: 1 } }, duration: 1.2 }, 2);
window.__timelines.main.from('#pill', { x: -40, duration: 0.4 }, 3);
unframed.dials('S', { lift: [4, 0, 9] }, function (v) {
  window.__timelines.main.to('#logo', { y: v.lift, duration: 0.5 }, 4);
});
window.__timelines.main.to('#box', { backgroundColor: unframed.token('color/accent'), duration: 0.5 }, 5);`;

const html = (script = SCRIPT) => `<html><body>${stage}\n<script>\n${script}\n</script></body></html>`;
const tween = (source: string, index: number): Tween => motionTimeline(source).tweens[index]!;
const kit = (name: string) => (name === "color/accent" ? "colour" : name === "duration/fast" ? "duration" : undefined);
const options = (extra: Partial<MotionEditOptions> = {}): MotionEditOptions => ({ tokenKind: kit, ...extra });
const value = (edits: MotionEdit[], source = html(), extra: Partial<MotionEditOptions> = {}) => applyMotionEdits(source, edits, options(extra));
const done = (edits: MotionEdit[], source = html(), extra: Partial<MotionEditOptions> = {}) => {
  const result = value(edits, source, extra);
  if (!result.ok) throw new Error(result.refusal);
  return result;
};
const at = (source: string, index: number, pct: number) => tween(source, index).keyframes.find((k) => k.at === pct)!.values;

describe("tween-value: numbers", () => {
  it("writes a to-value at 1 and reads it back", () => {
    const title = tween(html(), 0);
    const result = done([{ type: "tween-value", tween: title.ref, at: 1, property: "x", value: 15 }]);
    expect(at(result.html, 0, 1).x).toEqual({ kind: "source", value: 15 });
    expect(at(result.html, 0, 1).opacity).toEqual({ kind: "source", value: 1 });
    expect(result.summary).toEqual(["Set title x to 15"]);
  });

  it("writes a from-value at 0 of a fromTo", () => {
    const title = tween(html(), 0);
    const result = done([{ type: "tween-value", tween: title.ref, at: 0, property: "opacity", value: 0.5 }]);
    expect(at(result.html, 0, 0).opacity).toEqual({ kind: "source", value: 0.5 });
    expect(at(result.html, 0, 1).opacity).toEqual({ kind: "source", value: 1 });
  });

  it("writes the vars of a from at 0", () => {
    const pill = tween(html(), 3);
    const result = done([{ type: "tween-value", tween: pill.ref, at: 0, property: "x", value: -10 }]);
    expect(at(result.html, 3, 0).x).toEqual({ kind: "source", value: -10 });
  });

  it("refuses a value at 1 on a from, which has none", () => {
    const pill = tween(html(), 3);
    expect(value([{ type: "tween-value", tween: pill.ref, at: 1, property: "x", value: 0 }])).toEqual({
      ok: false,
      refusal: "pill has no end value to set.",
    });
  });

  it("writes a keyframe step at its percentage", () => {
    const ring = tween(html(), 2);
    const result = done([{ type: "tween-value", tween: ring.ref, at: 0.5, property: "scale", value: 1.2 }]);
    expect(at(result.html, 2, 0.5).scale).toEqual({ kind: "source", value: 1.2 });
    expect(at(result.html, 2, 1).scale).toEqual({ kind: "source", value: 1 });
  });

  it("keeps the unit of the literal it replaces", () => {
    const box = tween(html(), 1);
    const result = done([{ type: "tween-value", tween: box.ref, at: 1, property: "x", value: 150 }]);
    expect(at(result.html, 1, 1).x).toEqual({ kind: "source", value: "150px" });
    expect(result.summary).toEqual(["Set box x to 150px"]);
  });

  it("keeps the other properties at the diamond as they were", () => {
    const box = tween(html(), 1);
    const result = done([{ type: "tween-value", tween: box.ref, at: 1, property: "color", value: "#fff" }]);
    expect(at(result.html, 1, 1)).toEqual({ x: { kind: "source", value: "120px" }, color: { kind: "source", value: "#fff" } });
  });

  it("refuses a property the diamond does not have, since properties are added by asking the agent", () => {
    const box = tween(html(), 1);
    expect(value([{ type: "tween-value", tween: box.ref, at: 1, property: "scale", value: 2 }])).toEqual({
      ok: false,
      refusal: "box has no scale at this diamond.",
    });
  });
});

describe("tween-value: colours", () => {
  it.each([
    ["a hex colour", "#abcdef"],
    ["a short hex colour", "#abc"],
    ["an eight-digit hex colour", "#abcdef80"],
    ["an rgb colour", "rgb(1, 2, 3)"],
    ["an rgba colour", "rgba(1, 2, 3, 0.5)"],
    ["an hsl colour", "hsl(10 20% 30%)"],
    ["an hsla colour", "hsla(10, 20%, 30%, 0.5)"],
    ["an oklch colour", "oklch(70% 0.1 200)"],
    ["a named colour", "rebeccapurple"],
  ])("writes %s", (_name, colour) => {
    const box = tween(html(), 1);
    const result = done([{ type: "tween-value", tween: box.ref, at: 1, property: "color", value: colour }]);
    expect(at(result.html, 1, 1).color).toEqual({ kind: "source", value: colour });
  });

  it("refuses a string that is neither a colour nor a number with a unit", () => {
    const box = tween(html(), 1);
    expect(value([{ type: "tween-value", tween: box.ref, at: 1, property: "color", value: "notacolour" }])).toEqual({
      ok: false,
      refusal: "notacolour is not a colour or a number.",
    });
  });
});

describe("tween-value: tokens and detach", () => {
  it("writes a token of a matching type as an expression and reads it back", () => {
    const box = tween(html(), 1);
    const result = done([{ type: "tween-value", tween: box.ref, at: 1, property: "color", value: { token: "color/accent" } }]);
    expect(result.html).toContain('unframed.token("color/accent")');
    expect(at(result.html, 1, 1).color).toEqual({ kind: "token", name: "color/accent" });
  });

  it("refuses a token of the wrong type", () => {
    const box = tween(html(), 1);
    expect(value([{ type: "tween-value", tween: box.ref, at: 1, property: "color", value: { token: "duration/fast" } }])).toEqual({
      ok: false,
      refusal: "duration/fast is not a token of a matching type.",
    });
  });

  it("detaches a token as a plain value", () => {
    const token = tween(html(), 5);
    const result = done([{ type: "tween-value", tween: token.ref, at: 1, property: "backgroundColor", value: "#112233" }]);
    expect(at(result.html, 5, 1).backgroundColor).toEqual({ kind: "source", value: "#112233" });
  });
});

describe("tween-value: owners and locks", () => {
  it("refuses a value a parameter sets, naming the target and property", () => {
    const logo = tween(html(), 4);
    expect(value([{ type: "tween-value", tween: logo.ref, at: 1, property: "y", value: 2 }])).toEqual({
      ok: false,
      refusal: "logo's y is set by the agent's code.",
    });
  });

  it("refuses a locked target", () => {
    const box = tween(html(), 1);
    expect(value([{ type: "tween-value", tween: box.ref, at: 1, property: "x", value: 3 }], html(), { lockedElements: new Set([box.targets[0]!]) })).toEqual({
      ok: false,
      refusal: "box is locked. Unlock it in Layers to edit it.",
    });
  });
});

describe("tween-value: a value cannot break out of the script", () => {
  it.each([
    ["a script close tag", "rgb(</script><script>alert(1)</script>)"],
    ["a lone angle bracket", "rgb(1, 2, 3)<"],
    ["a close sequence", "rgb(1, 2, 3)</"],
  ])("refuses a colour with %s", (_name, colour) => {
    const box = tween(html(), 1);
    const result = value([{ type: "tween-value", tween: box.ref, at: 1, property: "color", value: colour }]);
    expect(result).toEqual({ ok: false, refusal: "A value cannot contain <." });
  });

  it("refuses a number-like value with an angle bracket", () => {
    const box = tween(html(), 1);
    expect(value([{ type: "tween-value", tween: box.ref, at: 1, property: "x", value: "<120px" as unknown as number }])).toEqual({
      ok: false,
      refusal: "A value cannot contain <.",
    });
  });
});

describe("tween-value: the rest of the file is left as it was", () => {
  const dollars = html(`window.__timelines = {};
window.__timelines.main = gsap.timeline({ paused: true });
window.__timelines.main.to('#box', { x: 10, color: '#abc', content: "a$$b", label: "a$&b", tail: "x$'y", duration: 1 }, 1);`);

  it("keeps $ patterns in sibling properties when another property is edited", () => {
    const box = tween(dollars, 0);
    const result = done([{ type: "tween-value", tween: box.ref, at: 1, property: "x", value: 99 }], dollars);
    expect(result.html).toContain(`content: "a$$b"`);
    expect(result.html).toContain(`label: "a$&b"`);
    expect(result.html).toContain(`tail: "x$'y"`);
    expect(at(result.html, 0, 1).x).toEqual({ kind: "source", value: 99 });
  });

  it("keeps $ patterns in a token expression written beside them", () => {
    const box = tween(dollars, 0);
    const result = done([{ type: "tween-value", tween: box.ref, at: 1, property: "x", value: 5 }, { type: "tween-value", tween: box.ref, at: 1, property: "color", value: { token: "color/accent" } }], dollars);
    expect(result.html).toContain(`content: "a$$b"`);
    expect(result.html).toContain('unframed.token("color/accent")');
  });

  it("keeps the property order of the diamond when a value is edited", () => {
    const ordered = html(`window.__timelines = {};
window.__timelines.main = gsap.timeline({ paused: true });
window.__timelines.main.to('#box', { x: 10, color: '#abc', duration: 1, ease: 'power1.out' }, 1);`);
    const box = tween(ordered, 0);
    const result = done([{ type: "tween-value", tween: box.ref, at: 1, property: "color", value: "#fff" }], ordered);
    expect(result.html).toContain(`to('#box', { x: 10, color: "#fff", duration: 1, ease: 'power1.out' }, 1)`);
  });

  it("keeps the order of a from-value's and a keyframe step's properties", () => {
    const steps = html(`window.__timelines = {};
window.__timelines.main = gsap.timeline({ paused: true });
window.__timelines.main.fromTo('#box', { x: 0, y: 4 }, { x: 10, y: 4, duration: 1 }, 1);`);
    const box = tween(steps, 0);
    const result = done([{ type: "tween-value", tween: box.ref, at: 0, property: "y", value: 2 }], steps);
    expect(result.html).toContain(`fromTo('#box', { x: 0, y: 2 }, { x: 10, y: 4, duration: 1 }, 1)`);
  });
});
