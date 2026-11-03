/**
 * The ease catalogue (spec 19): the 31 GSAP named eases in the order the dialog lists them,
 * their labels, their 24 curve samples, and the CSS form each one takes in a custom property.
 * The GSAP name is the source of truth; the CSS forms are a table for the browser.
 */
import { EASE_LINEAR_SAMPLES, EASE_SAMPLES } from "./easingSamples.ts";

export interface Ease {
  /** The GSAP name, such as `power2.out`, or `none`. */
  readonly name: string;
  /** `Linear` for none; otherwise the family and the direction, such as `Power2 · Out`. */
  readonly label: string;
  /** 24 values of the curve at i / 23. */
  readonly samples: ReadonlyArray<number>;
}

const FAMILIES = ["sine", "power1", "power2", "power3", "power4", "expo", "circ", "back", "elastic", "bounce"] as const;
const FAMILY_LABEL: Readonly<Record<string, string>> = {
  sine: "Sine",
  power1: "Power1",
  power2: "Power2",
  power3: "Power3",
  power4: "Power4",
  expo: "Expo",
  circ: "Circ",
  back: "Back",
  elastic: "Elastic",
  bounce: "Bounce",
};
const DIRECTION_LABEL: Readonly<Record<string, string>> = { in: "In", out: "Out", inOut: "In-out" };

export const EASE_NAMES: ReadonlyArray<string> = ["none", ...FAMILIES.flatMap((family) => [`${family}.in`, `${family}.out`, `${family}.inOut`])];

export const labelOf = (name: string): string => {
  if (name === "none") return "Linear";
  const [family, direction] = name.split(".");
  return `${FAMILY_LABEL[family!]} · ${DIRECTION_LABEL[direction!]}`;
};

/** The catalogue, in order. */
export const EASES: ReadonlyArray<Ease> = EASE_NAMES.map((name) => ({ name, label: labelOf(name), samples: EASE_SAMPLES[name]! }));

export const easeLabel = (name: string): string => labelOf(name);

export const isEaseName = (name: string): boolean => EASE_NAMES.includes(name);

/** The usual CSS cubic beziers (the easings.net values) for power, sine, expo, circ and back. */
const BEZIERS: Readonly<Record<string, readonly [number, number, number, number]>> = {
  "sine.in": [0.12, 0, 0.39, 0],
  "sine.out": [0.61, 1, 0.88, 1],
  "sine.inOut": [0.37, 0, 0.63, 1],
  "power1.in": [0.11, 0, 0.5, 0],
  "power1.out": [0.5, 1, 0.89, 1],
  "power1.inOut": [0.45, 0, 0.55, 1],
  "power2.in": [0.32, 0, 0.67, 0],
  "power2.out": [0.33, 1, 0.68, 1],
  "power2.inOut": [0.65, 0, 0.35, 1],
  "power3.in": [0.5, 0, 0.75, 0],
  "power3.out": [0.25, 1, 0.5, 1],
  "power3.inOut": [0.76, 0, 0.24, 1],
  "power4.in": [0.64, 0, 0.78, 0],
  "power4.out": [0.22, 1, 0.36, 1],
  "power4.inOut": [0.83, 0, 0.17, 1],
  "expo.in": [0.7, 0, 0.84, 0],
  "expo.out": [0.16, 1, 0.3, 1],
  "expo.inOut": [0.87, 0, 0.13, 1],
  "circ.in": [0.55, 0, 1, 0.45],
  "circ.out": [0, 0.55, 0.45, 1],
  "circ.inOut": [0.85, 0, 0.15, 1],
  "back.in": [0.36, 0, 0.66, -0.56],
  "back.out": [0.34, 1.56, 0.64, 1],
  "back.inOut": [0.68, -0.6, 0.32, 1.6],
};

const fmt = (n: number) => String(Number(n.toFixed(4)));

/** The CSS form of each catalogue name: a cubic bezier, linear() for elastic and bounce, linear for none. */
export const EASE_CSS: Readonly<Record<string, string>> = Object.fromEntries(
  EASE_NAMES.map((name) => {
    if (name === "none") return [name, "linear"];
    const bezier = BEZIERS[name];
    if (bezier) return [name, `cubic-bezier(${bezier.map(fmt).join(", ")})`];
    return [name, `linear(${EASE_LINEAR_SAMPLES[name]!.map(fmt).join(", ")})`];
  }),
);

/** The four coordinates of a catalogue name's cubic bezier, or undefined for the sampled ones. */
export const cubicBezierOf = (name: string): [number, number, number, number] | undefined => {
  const bezier = BEZIERS[name];
  return bezier ? [...bezier] : undefined;
};
