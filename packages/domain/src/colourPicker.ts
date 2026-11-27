import type { ScaleToken, TokenGroup, TokenScale } from "@unframed/contracts";
import { hexLabel } from "./design/changes.ts";
import { classForToken, tokenOf } from "./design/tokens.ts";
import { parseColour } from "./tailwind.ts";

export interface Hsva {
  readonly h: number;
  readonly s: number;
  readonly v: number;
  readonly a: number;
}

export const hsvaOf = (value: string): Hsva | undefined => {
  const rgba = parseColour(value);
  if (rgba === undefined) return undefined;
  const [r, g, b] = rgba.slice(0, 3).map((part) => part / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
  }
  return { h: Math.round(((h * 60 + 360) % 360) * 100) / 100, s: max === 0 ? 0 : delta / max, v: max, a: rgba[3] };
};

const pair = (channel: number): string => Math.round(Math.min(255, Math.max(0, channel))).toString(16).padStart(2, "0").toUpperCase();

export const hexOfHsva = ({ h, s, v, a }: Hsva): string => {
  const chroma = v * s;
  const sector = (((h % 360) + 360) % 360) / 60;
  const second = chroma * (1 - Math.abs((sector % 2) - 1));
  const [r, g, b] = sector < 1 ? [chroma, second, 0] : sector < 2 ? [second, chroma, 0] : sector < 3 ? [0, chroma, second] : sector < 4 ? [0, second, chroma] : sector < 5 ? [second, 0, chroma] : [chroma, 0, second];
  const base = v - chroma;
  return `#${pair((r + base) * 255)}${pair((g + base) * 255)}${pair((b + base) * 255)}${a < 1 ? pair(a * 255) : ""}`;
};

export const withAlpha = (value: string, percent: number): string | undefined => {
  const hsva = hsvaOf(value);
  return hsva === undefined ? undefined : hexOfHsva({ ...hsva, a: Math.min(100, Math.max(0, percent)) / 100 });
};

export const alphaPercent = (value: string): number => Math.round((parseColour(value)?.[3] ?? 1) * 100);

export const hexAndAlpha = (value: string): { readonly hex: string; readonly alpha: number } => {
  const label = hexLabel(value);
  return { hex: label === undefined ? "" : label.slice(1, 7), alpha: alphaPercent(value) };
};

export interface ColourGroup {
  readonly name: string;
  readonly count: number;
  readonly tokens: readonly ScaleToken[];
}

const CLASS_PREFIX = /^(text|bg|border|fill|stroke|outline|decoration|ring)-/;

const matches = (token: ScaleToken, query: string): boolean => {
  const text = query.trim().toLowerCase().replace(/^#/, "");
  if (text === "") return true;
  const bare = text.replace(CLASS_PREFIX, "").replace(/^\(--|^--|\)$/g, "");
  const hex = (token.hex ?? "").toLowerCase().replace(/^#/, "");
  return token.name.toLowerCase().includes(bare) || (/^[0-9a-f]{3,8}$/.test(text) && hex.startsWith(text));
};

export const colourGroups = (scale: TokenScale, query: string, onPage: readonly string[] = []): ColourGroup[] => {
  const byName = new Map(scale.colors.map((token) => [token.name, token]));
  const page = scale.colors.filter((token) => token.hex !== null && onPage.some((value) => hexLabel(value) === token.hex)).filter((token) => matches(token, query));
  const groups = scale.colorGroups.flatMap((group: TokenGroup): ColourGroup[] => {
    const tokens = group.tokens.flatMap((name) => byName.get(name) ?? []).filter((token) => matches(token, query));
    return tokens.length === 0 ? [] : [{ name: group.name, count: tokens.length, tokens }];
  });
  return page.length === 0 ? groups : [{ name: "On this page", count: page.length, tokens: page }, ...groups];
};

export const currentColourToken = (scale: TokenScale, property: string, className: string | null, authored: string | null): ScaleToken | undefined => {
  const bound = tokenOf(scale, property, { computed: "", className, authored });
  return bound?.token !== null && bound?.token?.category === "color" ? bound.token : undefined;
};

export const sameColourToken = (scale: TokenScale, value: string): ScaleToken | undefined => {
  const hex = hexLabel(value);
  if (hex === undefined) return undefined;
  const same = scale.colors.filter((token) => token.hex === hex);
  return same.find((token) => token.origin === "custom") ?? same[0];
};

export const colourWrite = (property: string, token: ScaleToken): { readonly value: string; readonly className: string | undefined } => ({
  value: token.variable === null ? token.resolved : `var(${token.variable})`,
  className: classForToken(property, token),
});
