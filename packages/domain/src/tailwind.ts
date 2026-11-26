export type TokenKind = "spacing" | "size" | "font-size" | "font-weight" | "radius" | "opacity" | "color" | "line-height" | "tracking" | "align" | "display";

export interface TailwindToken {
  readonly name: string;
  readonly value: string;
  readonly kind: TokenKind;
}

export interface TailwindClass {
  readonly name: string;
  readonly variant: string;
  readonly utility: string;
  readonly sets: readonly string[];
  readonly primary: string;
  readonly value: string;
  readonly kind: TokenKind;
}

const ROOT_PX = 16;

export const FONT_SIZES: Readonly<Record<string, number>> = { xs: 12, sm: 14, base: 16, lg: 18, xl: 20, "2xl": 24, "3xl": 30, "4xl": 36, "5xl": 48, "6xl": 60, "7xl": 72, "8xl": 96, "9xl": 128 };
export const FONT_WEIGHTS: Readonly<Record<string, number>> = { thin: 100, extralight: 200, light: 300, normal: 400, medium: 500, semibold: 600, bold: 700, extrabold: 800, black: 900 };
export const RADII: Readonly<Record<string, number>> = { none: 0, xs: 2, sm: 4, "": 4, md: 6, lg: 8, xl: 12, "2xl": 16, "3xl": 24, "4xl": 32, full: 9999 };
const LEADING: Readonly<Record<string, string>> = { none: "1", tight: "1.25", snug: "1.375", normal: "1.5", relaxed: "1.625", loose: "2" };
const TRACKING: Readonly<Record<string, string>> = { tighter: "-0.05em", tight: "-0.025em", normal: "0em", wide: "0.025em", wider: "0.05em", widest: "0.1em" };
const ALIGN = ["left", "center", "right", "justify", "start", "end"];

const SIDES: Readonly<Record<string, readonly string[]>> = {
  "": ["top", "right", "bottom", "left"],
  x: ["left", "right"],
  y: ["top", "bottom"],
  t: ["top"],
  r: ["right"],
  b: ["bottom"],
  l: ["left"],
};

interface Reader {
  readonly prefix: string;
  readonly sets: readonly string[];
  readonly kind: TokenKind;
  readonly value: (rest: string) => string | undefined;
}

const arbitrary = (rest: string): string | undefined => (/^\[[^\]]+\]$/.test(rest) ? rest.slice(1, -1).replace(/_/g, " ") : undefined);
const remOf = (steps: number): string => (steps === 0 ? "0px" : `${steps * 0.25}rem`);
const spacingValue = (rest: string): string | undefined => {
  const raw = arbitrary(rest);
  if (raw !== undefined) return raw;
  if (rest === "px") return "1px";
  if (/^\d+(\.\d+)?$/.test(rest)) return remOf(Number(rest));
  return undefined;
};
const sizeValue = (rest: string): string | undefined => {
  if (rest === "full") return "100%";
  if (rest === "auto") return "auto";
  if (rest === "screen") return "100vw";
  const fraction = /^(\d+)\/(\d+)$/.exec(rest);
  if (fraction !== null) return `${(Number(fraction[1]) / Number(fraction[2])) * 100}%`;
  return spacingValue(rest);
};
const isColour = (value: string): boolean => /^(#|rgb|hsl|oklch|oklab|lab|lch|color\(|var\(--color)/i.test(value) || /^[a-z]+-\d{2,3}(\/\d+)?$/.test(value) || ["white", "black", "transparent", "current", "inherit"].includes(value);

const READERS: ReadonlyArray<Reader> = [
  ...Object.entries(SIDES).flatMap(([side, sides]) => [
    { prefix: `p${side}`, sets: sides.map((each) => `padding-${each}`), kind: "spacing" as const, value: spacingValue },
    { prefix: `m${side}`, sets: sides.map((each) => `margin-${each}`), kind: "spacing" as const, value: spacingValue },
  ]),
  { prefix: "gap-x", sets: ["column-gap"], kind: "spacing", value: spacingValue },
  { prefix: "gap-y", sets: ["row-gap"], kind: "spacing", value: spacingValue },
  { prefix: "gap", sets: ["row-gap", "column-gap"], kind: "spacing", value: spacingValue },
  { prefix: "size", sets: ["width", "height"], kind: "size", value: sizeValue },
  { prefix: "min-w", sets: ["min-width"], kind: "size", value: sizeValue },
  { prefix: "min-h", sets: ["min-height"], kind: "size", value: sizeValue },
  { prefix: "max-w", sets: ["max-width"], kind: "size", value: sizeValue },
  { prefix: "max-h", sets: ["max-height"], kind: "size", value: sizeValue },
  { prefix: "w", sets: ["width"], kind: "size", value: sizeValue },
  { prefix: "h", sets: ["height"], kind: "size", value: sizeValue },
  {
    prefix: "text",
    sets: ["font-size"],
    kind: "font-size",
    value: (rest) => {
      if (FONT_SIZES[rest] !== undefined) return `${FONT_SIZES[rest]! / ROOT_PX}rem`;
      const raw = arbitrary(rest);
      return raw !== undefined && /^\d/.test(raw) ? raw : undefined;
    },
  },
  { prefix: "text", sets: ["text-align"], kind: "align", value: (rest) => (ALIGN.includes(rest) ? rest : undefined) },
  {
    prefix: "text",
    sets: ["color"],
    kind: "color",
    value: (rest) => {
      const raw = arbitrary(rest) ?? rest;
      return isColour(raw) ? raw : undefined;
    },
  },
  {
    prefix: "bg",
    sets: ["background-color"],
    kind: "color",
    value: (rest) => {
      const raw = arbitrary(rest) ?? rest;
      return isColour(raw) ? raw : undefined;
    },
  },
  {
    prefix: "border",
    sets: ["border-color"],
    kind: "color",
    value: (rest) => {
      const raw = arbitrary(rest) ?? rest;
      return isColour(raw) ? raw : undefined;
    },
  },
  {
    prefix: "font",
    sets: ["font-weight"],
    kind: "font-weight",
    value: (rest) => {
      if (FONT_WEIGHTS[rest] !== undefined) return String(FONT_WEIGHTS[rest]);
      const raw = arbitrary(rest);
      return raw !== undefined && /^\d+$/.test(raw) ? raw : undefined;
    },
  },
  {
    prefix: "rounded",
    sets: ["border-radius"],
    kind: "radius",
    value: (rest) => {
      if (RADII[rest] !== undefined) return `${RADII[rest]}px`;
      return arbitrary(rest);
    },
  },
  {
    prefix: "leading",
    sets: ["line-height"],
    kind: "line-height",
    value: (rest) => LEADING[rest] ?? spacingValue(rest),
  },
  { prefix: "tracking", sets: ["letter-spacing"], kind: "tracking", value: (rest) => TRACKING[rest] ?? arbitrary(rest) },
  {
    prefix: "opacity",
    sets: ["opacity"],
    kind: "opacity",
    value: (rest) => (/^\d+$/.test(rest) ? String(Number(rest) / 100) : arbitrary(rest)),
  },
];

const splitVariant = (name: string): { variant: string; utility: string } => {
  let depth = 0;
  let cut = -1;
  for (let index = 0; index < name.length; index++) {
    const char = name.charAt(index);
    if (char === "[" || char === "(") depth++;
    else if (char === "]" || char === ")") depth--;
    else if (char === ":" && depth === 0) cut = index;
  }
  return cut === -1 ? { variant: "", utility: name } : { variant: name.slice(0, cut + 1), utility: name.slice(cut + 1) };
};

export const readClass = (name: string): TailwindClass | undefined => {
  const { variant, utility: raw } = splitVariant(name);
  const utility = raw.replace(/^!|!$/g, "");
  if (utility === "hidden") return { name, variant, utility, sets: ["display"], primary: "display", value: "none", kind: "display" };
  if (utility === "rounded") return { name, variant, utility, sets: ["border-radius"], primary: "border-radius", value: "4px", kind: "radius" };
  const negative = utility.startsWith("-");
  const bare = negative ? utility.slice(1) : utility;
  const ordered = [...READERS].sort((a, b) => b.prefix.length - a.prefix.length);
  for (const reader of ordered) {
    if (!bare.startsWith(`${reader.prefix}-`)) continue;
    const value = reader.value(bare.slice(reader.prefix.length + 1));
    if (value === undefined) continue;
    return { name, variant, utility, sets: reader.sets, primary: reader.sets.length === 1 ? reader.sets[0]! : "", value: negative ? `-${value}` : value, kind: reader.kind };
  }
  return undefined;
};

export const classNames = (className: string | null | undefined): string[] => (className ?? "").split(/\s+/).filter((name) => name !== "");

export const looksTailwind = (className: string | null | undefined): boolean => classNames(className).some((name) => readClass(name) !== undefined);

export const classesSetting = (className: string | null | undefined, property: string): TailwindClass[] =>
  classNames(className)
    .map(readClass)
    .filter((each): each is TailwindClass => each !== undefined && each.variant === "" && each.sets.includes(property))
    .sort((a, b) => b.sets.length - a.sets.length);

export const classSetting = (className: string | null | undefined, property: string): TailwindClass | undefined => classesSetting(className, property).at(-1);

export const pxOf = (value: string): number | undefined => {
  const match = /^(-?\d*\.?\d+)(px|rem)?$/.exec(value.trim());
  if (match === null) return undefined;
  const number = Number(match[1]);
  return match[2] === "rem" ? number * ROOT_PX : number;
};

const PREFIX_OF: Readonly<Record<string, string>> = {
  "padding-top": "pt",
  "padding-right": "pr",
  "padding-bottom": "pb",
  "padding-left": "pl",
  "margin-top": "mt",
  "margin-right": "mr",
  "margin-bottom": "mb",
  "margin-left": "ml",
  "row-gap": "gap-y",
  "column-gap": "gap-x",
  gap: "gap",
  width: "w",
  height: "h",
  "min-width": "min-w",
  "min-height": "min-h",
  "max-width": "max-w",
  "max-height": "max-h",
};

const hexOf = (value: string): string | undefined => {
  const rgba = parseColour(value);
  if (rgba === undefined) return undefined;
  const hex = rgba
    .slice(0, 3)
    .map((part) => Math.round(part).toString(16).padStart(2, "0"))
    .join("");
  return `#${hex}${rgba[3] < 1 ? Math.round(rgba[3] * 255).toString(16).padStart(2, "0") : ""}`;
};

export const classFor = (property: string, value: string): TailwindToken | undefined => {
  const text = value.trim();
  const prefix = PREFIX_OF[property];
  if (prefix !== undefined) {
    if (text === "auto" && (property === "width" || property === "height")) return { name: `${prefix}-auto`, value: "auto", kind: "size" };
    if (text === "100%" && prefix.length <= 5) return { name: `${prefix}-full`, value: "100%", kind: "size" };
    const px = pxOf(text);
    if (px === undefined) return undefined;
    const kind: TokenKind = prefix.startsWith("p") || prefix.startsWith("m") || prefix.startsWith("gap") ? "spacing" : "size";
    const sign = px < 0 ? "-" : "";
    const size = Math.abs(px);
    if (size === 1) return { name: `${sign}${prefix}-px`, value: `${sign}1px`, kind };
    const steps = size / 4;
    if (Number.isInteger(steps * 2)) return { name: `${sign}${prefix}-${steps}`, value: `${sign}${remOf(steps)}`, kind };
    return { name: `${sign}${prefix}-[${size}px]`, value: `${sign}${size}px`, kind };
  }
  if (property === "font-size") {
    const px = pxOf(text);
    if (px === undefined) return undefined;
    const named = Object.entries(FONT_SIZES).find(([, size]) => size === px);
    return named ? { name: `text-${named[0]}`, value: `${px / ROOT_PX}rem`, kind: "font-size" } : { name: `text-[${px}px]`, value: `${px}px`, kind: "font-size" };
  }
  if (property === "font-weight") {
    const named = Object.entries(FONT_WEIGHTS).find(([, weight]) => String(weight) === text);
    return named ? { name: `font-${named[0]}`, value: text, kind: "font-weight" } : /^\d+$/.test(text) ? { name: `font-[${text}]`, value: text, kind: "font-weight" } : undefined;
  }
  if (property === "border-radius") {
    const px = pxOf(text);
    if (px === undefined) return undefined;
    const named = Object.entries(RADII).find(([key, radius]) => radius === px && key !== "");
    return named ? { name: `rounded-${named[0]}`, value: `${px}px`, kind: "radius" } : { name: `rounded-[${px}px]`, value: `${px}px`, kind: "radius" };
  }
  if (property === "opacity") {
    const number = Number(text);
    if (!Number.isFinite(number)) return undefined;
    const percent = Math.round(number * 100);
    return { name: `opacity-${percent}`, value: String(percent / 100), kind: "opacity" };
  }
  if (property === "text-align") return ALIGN.includes(text) ? { name: `text-${text}`, value: text, kind: "align" } : undefined;
  if (property === "line-height") {
    const named = Object.entries(LEADING).find(([, height]) => height === text);
    if (named) return { name: `leading-${named[0]}`, value: text, kind: "line-height" };
    const px = pxOf(text);
    if (px === undefined || !/px|rem/.test(text)) return undefined;
    return Number.isInteger((px / 4) * 2) ? { name: `leading-${px / 4}`, value: remOf(px / 4), kind: "line-height" } : { name: `leading-[${px}px]`, value: `${px}px`, kind: "line-height" };
  }
  if (property === "letter-spacing") {
    const named = Object.entries(TRACKING).find(([, spacing]) => spacing === text);
    return named ? { name: `tracking-${named[0]}`, value: text, kind: "tracking" } : { name: `tracking-[${text.replace(/\s+/g, "_")}]`, value: text, kind: "tracking" };
  }
  if (property === "color" || property === "background-color" || property === "border-color") {
    const hex = hexOf(text);
    if (hex === undefined) return undefined;
    const prefix = property === "color" ? "text" : property === "background-color" ? "bg" : "border";
    return { name: `${prefix}-[${hex}]`, value: hex, kind: "color" };
  }
  return undefined;
};

export function parseColour(value: string): [number, number, number, number] | undefined {
  const text = value.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3,8})$/.exec(text);
  if (hex !== null) {
    let digits = hex[1]!;
    if (digits.length === 3 || digits.length === 4) digits = [...digits].map((digit) => digit + digit).join("");
    if (digits.length !== 6 && digits.length !== 8) return undefined;
    const parts = [0, 2, 4].map((at) => parseInt(digits.slice(at, at + 2), 16));
    return [parts[0]!, parts[1]!, parts[2]!, digits.length === 8 ? parseInt(digits.slice(6, 8), 16) / 255 : 1];
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(text);
  if (rgb !== null) {
    const alpha = rgb[4] === undefined ? 1 : rgb[4].endsWith("%") ? Number(rgb[4].slice(0, -1)) / 100 : Number(rgb[4]);
    return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), alpha];
  }
  if (text === "white") return [255, 255, 255, 1];
  if (text === "black") return [0, 0, 0, 1];
  if (text === "transparent") return [0, 0, 0, 0];
  return undefined;
}
