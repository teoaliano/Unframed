import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { EASES, EASE_CSS, easeLabel, isEaseName, cubicBezierOf } from "../../src/kits/easings.ts";

const require = createRequire(import.meta.url);
const gsapModule = require("gsap");
const gsap = gsapModule.default ?? gsapModule;

describe("the ease catalogue", () => {
  it("holds exactly 31 named eases in the order the dialog shows them", () => {
    const names = EASES.map((ease) => ease.name);
    expect(names).toHaveLength(31);
    expect(names[0]).toBe("none");
    expect(names.slice(1, 4)).toEqual(["sine.in", "sine.out", "sine.inOut"]);
    expect(names.slice(-3)).toEqual(["bounce.in", "bounce.out", "bounce.inOut"]);
    expect(new Set(names).size).toBe(31);
  });

  it("labels none as Linear and the rest as family then In, Out or In-out", () => {
    expect(easeLabel("none")).toBe("Linear");
    expect(easeLabel("power2.out")).toBe("Power2 · Out");
    expect(easeLabel("power3.inOut")).toBe("Power3 · In-out");
    expect(easeLabel("elastic.in")).toBe("Elastic · In");
    expect(easeLabel("back.inOut")).toBe("Back · In-out");
    expect(EASES.find((ease) => ease.name === "none")!.label).toBe("Linear");
  });

  it("carries 24 samples per ease, equal to GSAP's own curve at i / 23", () => {
    for (const ease of EASES) {
      expect(ease.samples).toHaveLength(24);
      const parsed = gsap.parseEase(ease.name);
      ease.samples.forEach((sample, i) => {
        expect(Math.abs(sample - parsed(i / 23))).toBeLessThan(1e-5);
      });
      expect(ease.samples[0]).toBeCloseTo(0, 5);
      expect(ease.samples[23]).toBeCloseTo(1, 5);
    }
  });

  it("uses GSAP's default overshoot for back and amplitude and period for elastic", () => {
    const back = EASES.find((ease) => ease.name === "back.out")!;
    expect(Math.max(...back.samples)).toBeGreaterThan(1.05);
    expect(back.samples[23]).toBeCloseTo(1, 5);
  });

  it("answers whether a name is in the catalogue", () => {
    expect(isEaseName("power2.out")).toBe(true);
    expect(isEaseName("power2")).toBe(false);
    expect(isEaseName("rough")).toBe(false);
  });
});

describe("the easing table for CSS", () => {
  it("has a CSS form for every catalogue name", () => {
    for (const ease of EASES) expect(EASE_CSS[ease.name]).toBeTypeOf("string");
  });

  it("writes the usual cubic bezier for power, sine, expo, circ and back, and linear for none", () => {
    expect(EASE_CSS["none"]).toBe("linear");
    expect(EASE_CSS["power2.out"]).toBe("cubic-bezier(0.33, 1, 0.68, 1)");
    expect(EASE_CSS["sine.in"]).toBe("cubic-bezier(0.12, 0, 0.39, 0)");
    expect(EASE_CSS["expo.inOut"]).toBe("cubic-bezier(0.87, 0, 0.13, 1)");
    expect(EASE_CSS["back.out"]).toBe("cubic-bezier(0.34, 1.56, 0.64, 1)");
    expect(cubicBezierOf("power2.out")).toEqual([0.33, 1, 0.68, 1]);
    expect(cubicBezierOf("elastic.out")).toBeUndefined();
  });

  it("samples elastic and bounce as a 40-point linear() function", () => {
    for (const name of ["elastic.in", "elastic.out", "elastic.inOut", "bounce.in", "bounce.out", "bounce.inOut"]) {
      const css = EASE_CSS[name]!;
      expect(css.startsWith("linear(")).toBe(true);
      expect(css.split(",")).toHaveLength(40);
    }
  });
});
