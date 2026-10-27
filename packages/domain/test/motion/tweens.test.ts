import { describe, expect, it } from "vitest";
import { motionTimeline } from "../../src/index.ts";

// One motion: a body with two targets, and a script built from the given lines.
const motion = (script: string, head = "") => `<html><head>${head}</head><body>
<div id="root" data-composition-id="main" data-start="0" data-duration="4" data-width="640" data-height="360">
  <div id="c" class="clip" data-start="0" data-duration="4"><div id="a"></div><div id="b"></div></div>
</div>
<script>
window.__timelines = window.__timelines || {};
window.__timelines.main = gsap.timeline({ paused: true });
${script}
</script></body></html>`;

const reading = (script: string, head?: string) => motionTimeline(motion(script, head));
const tween = (script: string, index = 0) => reading(script).tweens[index]!;

describe("motionTimeline: script states", () => {
  it("is none when the file has no timeline script", () => {
    expect(motionTimeline("<html><body><div id=\"root\" data-composition-id=\"main\" data-start=\"0\" data-duration=\"2\"></div></body></html>").script).toBe("none");
  });

  it("is unreadable when the timeline script does not parse", () => {
    expect(reading("window.__timelines.main.to('#a', {x: ;").script).toBe("unreadable");
  });

  it("is ok with the tweens it finds", () => {
    const result = reading("window.__timelines.main.to('#a', { x: 1, duration: 1 }, 0);");
    expect(result.script).toBe("ok");
    expect(result.tweens).toHaveLength(1);
  });
});

describe("motionTimeline: starts", () => {
  it("reads a numeric position as the start", () => {
    expect(tween("window.__timelines.main.to('#a', { x: 1, duration: 1 }, 0.5);").start).toEqual({ kind: "source", value: 0.5 });
  });

  it("is script when the position is missing", () => {
    expect(tween("window.__timelines.main.to('#a', { x: 1, duration: 1 });").start).toEqual({ kind: "script", text: "" });
  });

  it.each(["'+=0.5'", "'<'", "'intro'"])("is script for a relative or label position %s", (position) => {
    expect(tween(`window.__timelines.main.to('#a', { x: 1, duration: 1 }, ${position});`).start.kind).toBe("script");
  });

  it("is a dial when the position is a parameter", () => {
    const script = "unframed.dials('S', {}, function (v) {\n window.__timelines.main.to('#a', { x: 1, duration: 1 }, v.delay);\n});";
    expect(tween(script).start).toEqual({ kind: "dial", path: ["delay"] });
  });
});

describe("motionTimeline: durations and eases", () => {
  it("reads a literal duration", () => {
    expect(tween("window.__timelines.main.to('#a', { x: 1, duration: 2.5 }, 0);").duration).toEqual({ kind: "source", value: 2.5 });
  });

  it("uses GSAP's default duration when none is written", () => {
    expect(tween("window.__timelines.main.to('#a', { x: 1 }, 0);").duration).toEqual({ kind: "source", value: 0.5 });
  });

  it("reads a non-literal duration from its own node, not as unresolved", () => {
    expect(tween("window.__timelines.main.to('#a', { x: 1, duration: d }, 0);").duration).toEqual({ kind: "script", text: "d" });
  });

  it("gives a set no duration", () => {
    expect(tween("window.__timelines.main.set('#a', { x: 1 }, 0);").duration).toEqual({ kind: "source", value: 0 });
  });

  it("reads a written ease as its name", () => {
    expect(tween("window.__timelines.main.to('#a', { x: 1, duration: 1, ease: 'power2.out' }, 0);").ease).toEqual({ kind: "source", value: "power2.out" });
  });

  it("is null when no ease is written", () => {
    expect(tween("window.__timelines.main.to('#a', { x: 1, duration: 1 }, 0);").ease).toBeNull();
  });

  it("reads an ease expression as script and a token call as token", () => {
    expect(tween("window.__timelines.main.to('#a', { x: 1, duration: 1, ease: ease }, 0);").ease).toEqual({ kind: "script", text: "ease" });
    expect(tween("window.__timelines.main.to('#a', { x: 1, duration: 1, ease: unframed.token('ease/fast') }, 0);").ease).toEqual({ kind: "token", name: "ease/fast" });
  });
});

describe("motionTimeline: values at diamonds", () => {
  it("puts a to's values at 1 only", () => {
    const t = tween("window.__timelines.main.to('#a', { x: 10, duration: 1 }, 0);");
    expect(t.method).toBe("to");
    expect(t.keyframes).toEqual([{ at: 1, values: { x: { kind: "source", value: 10 } }, ease: null }]);
  });

  it("puts a from's values at 0 only", () => {
    const t = tween("window.__timelines.main.from('#a', { x: -40, duration: 1 }, 0);");
    expect(t.keyframes).toEqual([{ at: 0, values: { x: { kind: "source", value: -40 } }, ease: null }]);
  });

  it("puts a fromTo's first object at 0 and its second at 1", () => {
    const t = tween("window.__timelines.main.fromTo('#a', { opacity: 0 }, { opacity: 1, duration: 1 }, 0);");
    expect(t.keyframes.map((k) => [k.at, k.values])).toEqual([
      [0, { opacity: { kind: "source", value: 0 } }],
      [1, { opacity: { kind: "source", value: 1 } }],
    ]);
  });

  it("reads a value from its own node: a parameter stays a dial even where the parser keeps raw text", () => {
    const script = "unframed.dials('S', {}, function (v) {\n window.__timelines.main.to('#a', { x: v.toX, duration: 1 }, 0);\n});";
    expect(tween(script).keyframes[0]!.values.x).toEqual({ kind: "dial", path: ["toX"] });
  });

  it("reads a colour, a token and an expression at one diamond", () => {
    const t = tween("window.__timelines.main.to('#a', { color: '#fff', backgroundColor: unframed.token('color/accent'), x: offset, duration: 1 }, 0);");
    expect(t.keyframes[0]!.values).toEqual({
      color: { kind: "source", value: "#fff" },
      backgroundColor: { kind: "token", name: "color/accent" },
      x: { kind: "script", text: "offset" },
    });
  });

  it("does not list configuration keys as values", () => {
    const t = tween("window.__timelines.main.to('#a', { x: 1, duration: 1, ease: 'none', stagger: 0.1, repeat: 1, yoyo: true }, 0);");
    expect(Object.keys(t.keyframes[0]!.values)).toEqual(["x"]);
  });
});

describe("motionTimeline: repeats", () => {
  it("is null with no repeat", () => {
    expect(tween("window.__timelines.main.to('#a', { x: 1, duration: 1 }, 0);").repeat).toBeNull();
  });

  it("reads a count and yoyo", () => {
    expect(tween("window.__timelines.main.to('#a', { x: 1, duration: 1, repeat: 2, yoyo: true }, 0);").repeat).toEqual({ count: 2, yoyo: true });
  });

  it("reads forever as -1", () => {
    expect(tween("window.__timelines.main.to('#a', { x: 1, duration: 1, repeat: -1 }, 0);").repeat).toEqual({ count: -1, yoyo: false });
  });

  it("gives a count of null when it is not a literal", () => {
    expect(tween("window.__timelines.main.to('#a', { x: 1, duration: 1, repeat: n }, 0);").repeat).toEqual({ count: null, yoyo: false });
  });
});

describe("motionTimeline: read-only reasons", () => {
  it.each([
    ["a for loop", "for (var i = 0; i < 2; i++) { window.__timelines.main.to('#a', { x: i }, 0); }", "It runs in a loop."],
    ["an iteration callback", "[1, 2].forEach(function (i) { window.__timelines.main.to('#a', { x: i }, 0); });", "It runs in a loop."],
    ["a helper function", "function reveal(s) { window.__timelines.main.to(s, { x: 1 }, 0); }\nreveal('#a');", "It is built by a helper."],
    ["an IIFE", "(function () { window.__timelines.main.to('#a', { x: 1, duration: 1 }, 0); })();", "It is built by a helper."],
    ["a motion path", "window.__timelines.main.to('#a', { motionPath: { path: '#b' }, duration: 1 }, 0);", "It follows a motion path."],
    ["computed keyframes", "window.__timelines.main.to('#a', { keyframes: makeKeys(), duration: 1 }, 0);", "Its keyframes are computed."],
    ["keyframes with a computed value", "window.__timelines.main.to('#a', { keyframes: { '0%': { x: 0 }, '100%': { x: offset() } }, duration: 1 }, 0);", "Its keyframes are computed."],
  ])("%s", (_name, script, reason) => {
    const t = tween(script);
    expect(t.readOnly).toBe(reason);
  });

  it("is null for a plain literal tween", () => {
    expect(tween("window.__timelines.main.to('#a', { x: 1, duration: 1 }, 0);").readOnly).toBeNull();
  });

  it("is null for a tween inside the dials callback", () => {
    const script = "unframed.dials('S', {}, function (v) {\n window.__timelines.main.to('#a', { x: v.x, duration: 1 }, 0);\n});";
    expect(tween(script).readOnly).toBeNull();
  });

  it("keeps the source of the call, cut to 300 characters", () => {
    const long = `window.__timelines.main.to('#a', { x: 1, duration: 1, label: '${"a".repeat(400)}' }, 0);`;
    const t = tween(long);
    expect(t.source.length).toBeLessThanOrEqual(300);
    expect(t.source.startsWith("window.__timelines.main.to('#a'")).toBe(true);
  });
});

describe("motionTimeline: refs", () => {
  it("numbers tweens in source order and carries the HyperFrames id", () => {
    const result = reading("window.__timelines.main.to('#a', { x: 1, duration: 1 }, 0);\nwindow.__timelines.main.to('#b', { x: 1, duration: 1 }, 2);");
    expect(result.tweens.map((t) => t.ref.index)).toEqual([0, 1]);
    expect(result.tweens[0]!.ref.id).toMatch(/^#a-to-0/);
    expect(result.tweens[1]!.ref.id).toMatch(/^#b-to-2/);
  });
});
