import { classSetting, readClass } from "./tailwind.ts";

export const SCRUB_RATE = 0.5;

export interface NumberBounds {
  readonly min?: number | undefined;
  readonly max?: number | undefined;
}

const clamp = (value: number, bounds: NumberBounds): number => Math.min(bounds.max ?? Infinity, Math.max(bounds.min ?? -Infinity, value));

export const scrubbed = (start: number, dx: number, bounds: NumberBounds = {}): number => clamp(Math.round(start + dx * SCRUB_RATE), bounds);

export const stepped = (value: number, up: boolean, shift: boolean, bounds: NumberBounds = {}): number => clamp(value + (up ? 1 : -1) * (shift ? 10 : 1), bounds);

export interface ClassStep {
  readonly name: string;
  readonly step: string;
}

const WHOLE = new Set(["size"]);

export const stepOfClass = (name: string): ClassStep | undefined => {
  const read = readClass(name);
  if (read === undefined || read.variant !== "") return undefined;
  const utility = read.utility.replace(/^-/, "");
  if (/\[[^\]]*\]$/.test(utility)) return undefined;
  const dash = utility.indexOf("-");
  if (dash === -1) return { name, step: utility };
  const prefix = utility.slice(0, dash);
  const rest = utility.slice(dash + 1);
  if (WHOLE.has(prefix)) return { name, step: utility };
  if (rest === "full" && prefix === "rounded") return { name, step: "Full" };
  return { name, step: rest };
};

export const classStep = (className: string | null | undefined, property: string): ClassStep | undefined => {
  const found = classSetting(className, property);
  return found === undefined ? undefined : stepOfClass(found.name);
};

export const fieldAria = (label: string, bound: ClassStep | undefined, raw: string): string => (bound === undefined ? label : `${label}: ${bound.name} (${raw})`);

export const pairShown = (a: string, b: string): string => (a === b ? a : `${a}, ${b}`);

export interface ScalePreset {
  readonly name: string;
  readonly px: number;
  readonly note?: string;
}

export interface TypeStep {
  readonly name: string;
  readonly size: number;
  readonly leading: number;
}

export const DEFAULT_TYPE_SCALE: readonly TypeStep[] = [
  { name: "text-xs", size: 12, leading: 16 },
  { name: "text-sm", size: 14, leading: 20 },
  { name: "text-base", size: 16, leading: 24 },
  { name: "text-lg", size: 18, leading: 28 },
  { name: "text-xl", size: 20, leading: 28 },
  { name: "text-2xl", size: 24, leading: 32 },
  { name: "text-3xl", size: 30, leading: 36 },
  { name: "text-4xl", size: 36, leading: 40 },
  { name: "text-5xl", size: 48, leading: 48 },
  { name: "text-6xl", size: 60, leading: 60 },
  { name: "text-7xl", size: 72, leading: 72 },
  { name: "text-8xl", size: 96, leading: 96 },
  { name: "text-9xl", size: 128, leading: 128 },
];

export const DEFAULT_LEADING: readonly ScalePreset[] = [3, 4, 5, 6, 7, 8, 9, 10].map((step) => ({ name: `leading-${step}`, px: step * 4 }));

export const DEFAULT_SPACING: readonly ScalePreset[] = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 20, 24, 28, 32, 36, 40, 44, 48].map((step) => ({ name: String(step), px: step * 4 }));

export const textStyleOf = (scale: readonly TypeStep[], className: string | null | undefined): TypeStep | undefined => {
  const step = classStep(className, "font-size");
  return step === undefined ? undefined : scale.find((each) => each.name === step.name);
};

export const WEIGHT_STYLES: ReadonlyArray<{ readonly label: string; readonly weight: string; readonly name: string }> = [
  { label: "Thin", weight: "100", name: "font-thin" },
  { label: "ExtraLight", weight: "200", name: "font-extralight" },
  { label: "Light", weight: "300", name: "font-light" },
  { label: "Regular", weight: "400", name: "font-normal" },
  { label: "Medium", weight: "500", name: "font-medium" },
  { label: "SemiBold", weight: "600", name: "font-semibold" },
  { label: "Bold", weight: "700", name: "font-bold" },
  { label: "ExtraBold", weight: "800", name: "font-extrabold" },
  { label: "Black", weight: "900", name: "font-black" },
];

export const weightLabel = (weight: string, italic: boolean): string => {
  const found = WEIGHT_STYLES.find((each) => each.weight === weight)?.label ?? weight;
  if (!italic) return found;
  return found === "Regular" ? "Italic" : `${found} Italic`;
};

const pxNumber = (value: string | undefined): number | undefined => {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? parsed : undefined;
};

export const trackingPercent = (letterSpacing: string | undefined, fontSize: string | undefined): number => {
  const spacing = pxNumber(letterSpacing);
  const size = pxNumber(fontSize);
  if (spacing === undefined || size === undefined || size === 0) return 0;
  return Math.round((spacing / size) * 1000) / 10;
};

export const trackingValue = (percent: number): string => `${Math.round(percent * 10) / 1000}em`;
