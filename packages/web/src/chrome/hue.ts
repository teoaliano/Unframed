import type { CSSProperties } from "react";

const HUES = {
  amber: "var(--color-amber-500)",
  blue: "var(--color-blue-500)",
  orange: "var(--color-orange-500)",
  purple: "var(--color-purple-500)",
  green: "var(--color-green-500)",
  pink: "var(--color-pink-500)",
  teal: "var(--color-teal-500)",
  red: "var(--color-red-500)",
  cyan: "var(--color-cyan-500)",
  yellow: "var(--color-yellow-500)",
  gray: "var(--color-gray-500)",
  neutral: "var(--color-neutral-500)",
} as const;

export type Hue = keyof typeof HUES;

export const labelHue = (hue: Hue): CSSProperties => ({ "--label": HUES[hue] }) as CSSProperties;
