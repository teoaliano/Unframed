import type { CSSProperties } from "react";

const HUES = {
  amber: "var(--label-hue-amber)",
  blue: "var(--label-hue-blue)",
  orange: "var(--label-hue-orange)",
  purple: "var(--label-hue-purple)",
  green: "var(--label-hue-green)",
  pink: "var(--label-hue-pink)",
  teal: "var(--label-hue-teal)",
  red: "var(--label-hue-red)",
  cyan: "var(--label-hue-cyan)",
  yellow: "var(--label-hue-yellow)",
  gray: "var(--label-hue-gray)",
  neutral: "var(--label-hue-neutral)",
} as const;

export type Hue = keyof typeof HUES;

export const labelHue = (hue: Hue): CSSProperties => ({ "--label": HUES[hue] }) as CSSProperties;
