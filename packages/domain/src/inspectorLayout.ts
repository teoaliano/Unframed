import type { ScaleToken, TokenScale } from "@unframed/contracts";
import { classForToken, tokensFor } from "./design/tokens.ts";
import type { SizeMode } from "./screenDrafts.ts";
import { classNames } from "./tailwind.ts";

const FILL: Readonly<Record<"width" | "height", readonly string[]>> = {
  width: ["w-full", "flex-1", "grow", "flex-grow", "flex-auto", "w-screen"],
  height: ["h-full", "h-screen", "self-stretch"],
};
const HUG: Readonly<Record<"width" | "height", readonly string[]>> = {
  width: ["w-fit", "w-auto", "w-max", "w-min"],
  height: ["h-fit", "h-auto", "h-max", "h-min"],
};

export const sizeModeOf = (axis: "width" | "height", className: string | null | undefined, inline: string | null | undefined): SizeMode => {
  const text = (inline ?? "").trim();
  if (text === "100%") return "fill";
  if (/^(fit-content|auto|max-content|min-content)$/.test(text)) return "hug";
  if (/^-?\d/.test(text)) return "fixed";
  const names = classNames(className);
  if (names.some((name) => FILL[axis].includes(name))) return "fill";
  if (names.some((name) => HUG[axis].includes(name))) return "hug";
  const prefix = axis === "width" ? "w-" : "h-";
  if (names.some((name) => name.startsWith(prefix) || name.startsWith("size-"))) return "fixed";
  return "hug";
};

export const sizeModeValue = (mode: SizeMode, px: number): string => (mode === "fill" ? "100%" : mode === "hug" ? "fit-content" : `${Math.round(px * 100) / 100}px`);

export const SIZE_MODE_LABEL: Readonly<Record<SizeMode, string>> = { fixed: "Fixed", hug: "Hug", fill: "Fill" };

export type AlignSpot = 0 | 1 | 2;

const SPOT: Readonly<Record<string, AlignSpot>> = { normal: 0, start: 0, "flex-start": 0, left: 0, stretch: 0, baseline: 0, center: 1, end: 2, "flex-end": 2, right: 2 };
const KEYWORD: readonly string[] = ["flex-start", "center", "flex-end"];

export const alignmentOf = (direction: string, justify: string, align: string): { readonly row: AlignSpot; readonly column: AlignSpot } => {
  const main = SPOT[justify] ?? 0;
  const cross = SPOT[align] ?? 0;
  return direction.startsWith("column") ? { row: main, column: cross } : { row: cross, column: main };
};

export const alignmentWrite = (direction: string, row: AlignSpot, column: AlignSpot): { readonly "justify-content": string; readonly "align-items": string } =>
  direction.startsWith("column") ? { "justify-content": KEYWORD[row]!, "align-items": KEYWORD[column]! } : { "justify-content": KEYWORD[column]!, "align-items": KEYWORD[row]! };

const ROWS = ["top", "middle", "bottom"];
const COLUMNS = ["left", "center", "right"];

export const alignLabel = (row: AlignSpot, column: AlignSpot): string => (row === 1 && column === 1 ? "Align center" : `Align ${ROWS[row]} ${COLUMNS[column]}`.replace("middle center", "center"));

export interface PresetGroup {
  readonly group: string;
  readonly items: ReadonlyArray<{ readonly name: string; readonly px: number; readonly note: string; readonly token: ScaleToken }>;
}

export const spacingPresets = (scale: TokenScale, property: string): PresetGroup[] => {
  const tokens = tokensFor(scale, property).filter((token) => token.px !== null && token.category === "spacing");
  const semantic = tokens
    .filter((token) => token.origin === "custom")
    .map((token) => ({ name: token.chain.length > 1 ? `${token.name} → ${token.chain.at(-1)!.slice(2)}` : token.name, px: token.px!, note: String(token.px), token }));
  const steps = tokens.flatMap((token) => {
    if (token.origin === "custom") return [];
    const name = classForToken(property, token);
    return name === undefined ? [] : [{ name, px: token.px!, note: String(token.px), token }];
  });
  return [...(semantic.length > 0 ? [{ group: "Semantic", items: semantic }] : []), ...(steps.length > 0 ? [{ group: "Scale", items: steps }] : [])];
};

export interface ShadowLayer {
  readonly inset: boolean;
  readonly x: number;
  readonly y: number;
  readonly blur: number;
  readonly spread: number;
  readonly colour: string;
}

const splitTop = (value: string): string[] => {
  const parts: string[] = [];
  let depth = 0;
  let from = 0;
  for (let index = 0; index <= value.length; index++) {
    const char = value.charAt(index);
    if (char === "(") depth++;
    else if (char === ")") depth--;
    else if ((char === "," && depth === 0) || index === value.length) {
      parts.push(value.slice(from, index).trim());
      from = index + 1;
    }
  }
  return parts.filter((part) => part !== "");
};

export const shadowLayers = (value: string | undefined): ShadowLayer[] => {
  const text = (value ?? "").trim();
  if (text === "" || text === "none") return [];
  return splitTop(text).map((layer) => {
    const colour = /(#[0-9a-f]{3,8}|(?:rgba?|hsla?|oklch|oklab)\([^()]*\))/i.exec(layer)?.[1] ?? "rgba(0, 0, 0, 0.25)";
    const lengths = layer
      .replace(colour, " ")
      .replace(/\binset\b/, " ")
      .split(/\s+/)
      .filter((word) => word !== "")
      .map((word) => Number.parseFloat(word))
      .filter((number) => Number.isFinite(number));
    return { inset: /\binset\b/.test(layer), x: lengths[0] ?? 0, y: lengths[1] ?? 0, blur: lengths[2] ?? 0, spread: lengths[3] ?? 0, colour };
  });
};

export const shadowValue = (layers: readonly ShadowLayer[]): string =>
  layers.length === 0 ? "none" : layers.map((layer) => `${layer.inset ? "inset " : ""}${layer.x}px ${layer.y}px ${layer.blur}px ${layer.spread}px ${layer.colour}`).join(", ");

export const DROP_SHADOW: ShadowLayer = { inset: false, x: 0, y: 4, blur: 4, spread: 0, colour: "#00000040" };
export const INNER_SHADOW: ShadowLayer = { inset: true, x: 0, y: 4, blur: 4, spread: 0, colour: "#00000040" };

export const blurOf = (value: string | undefined): number | undefined => {
  const match = /blur\(\s*(-?[\d.]+)px\s*\)/.exec(value ?? "");
  return match === null ? undefined : Number(match[1]);
};

export const shadowSummary = (token: ScaleToken): string => {
  const layers = token.layers ?? 0;
  return `${layers} ${layers === 1 ? "layer" : "layers"}${token.blur === null ? "" : ` · ${token.blur} blur`}`;
};
