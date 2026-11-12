export const DESIGNABLE_TYPES = ["text", "geo", "note", "arrow", "draw", "line", "highlight"] as const;
export type DesignableType = (typeof DESIGNABLE_TYPES)[number];

export const isDesignableType = (type: string): type is DesignableType => (DESIGNABLE_TYPES as readonly string[]).includes(type);

export interface ShapeDesign {
  readonly fontFamily?: string;
  readonly fontSize?: number;
  readonly fontWeight?: string;
  readonly lineHeight?: number;
  readonly textColor?: string;
  readonly fillColor?: string;
  readonly strokeColor?: string;
  readonly strokeWidth?: number;
  readonly cornerRadius?: number;
}

export type DesignKey = keyof ShapeDesign;

export type DesignPatch = { readonly [K in DesignKey]?: ShapeDesign[K] | null };

const LABEL = { fontFamily: "labelFontFamily", fontSize: "labelFontSize", lineHeight: "labelLineHeight", textColor: "labelColor" } as const;

const DISPLAY_KEYS: Record<DesignableType, Partial<Record<DesignKey, string>>> = {
  text: { fontFamily: "fontFamily", fontSize: "fontSize", fontWeight: "fontWeight", lineHeight: "lineHeight", textColor: "color" },
  geo: { ...LABEL, fontWeight: "labelFontWeight", fillColor: "fillColor", strokeColor: "strokeColor", strokeWidth: "strokeWidth", cornerRadius: "strokeRoundness" },
  note: { fontFamily: "labelFontFamily", fontSize: "labelFontSize", lineHeight: "labelLineHeight", fontWeight: "labelFontWeight", fillColor: "noteBackgroundColor", strokeColor: "borderColor", strokeWidth: "borderWidth" },
  arrow: { ...LABEL, strokeColor: "strokeColor", strokeWidth: "strokeWidth" },
  draw: { fillColor: "fillColor", strokeColor: "strokeColor", strokeWidth: "strokeWidth" },
  line: { strokeColor: "strokeColor", strokeWidth: "strokeWidth" },
  highlight: { strokeColor: "strokeColor", strokeWidth: "strokeWidth" },
};

export const displayKeyOf = (type: DesignableType, key: DesignKey): string | undefined => DISPLAY_KEYS[type][key];

export const designKeysOf = (type: DesignableType): readonly DesignKey[] => Object.keys(DISPLAY_KEYS[type]) as DesignKey[];

const COLOUR = /^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FAMILY = /^[A-Za-z0-9 ,'"_.-]{1,120}$/;
const WEIGHT = /^[1-9]00$/;

const RANGES: Partial<Record<DesignKey, readonly [number, number]>> = {
  fontSize: [1, 1000],
  lineHeight: [0.5, 10],
  strokeWidth: [0, 200],
  cornerRadius: [0, 1000],
};

const COLOUR_KEYS: readonly DesignKey[] = ["textColor", "fillColor", "strokeColor"];

const validValue = (key: DesignKey, value: unknown): boolean => {
  const range = RANGES[key];
  if (range !== undefined) return typeof value === "number" && Number.isFinite(value) && value >= range[0] && value <= range[1];
  if (typeof value !== "string") return false;
  if (COLOUR_KEYS.includes(key)) return COLOUR.test(value);
  if (key === "fontWeight") return WEIGHT.test(value);
  return FAMILY.test(value) && value.trim() !== "";
};

const DESIGN_KEYS: readonly DesignKey[] = ["fontFamily", "fontSize", "fontWeight", "lineHeight", "textColor", "fillColor", "strokeColor", "strokeWidth", "cornerRadius"];

export const shapeDesignOf = (meta: unknown): ShapeDesign => {
  const design = (meta as { unframed?: { design?: unknown } } | null | undefined)?.unframed?.design;
  if (typeof design !== "object" || design === null || Array.isArray(design)) return {};
  const kept: Record<string, unknown> = {};
  for (const key of DESIGN_KEYS) {
    const value = (design as Record<string, unknown>)[key];
    if (validValue(key, value)) kept[key] = typeof value === "string" ? value.trim() : value;
  }
  return kept as ShapeDesign;
};

export const designValueRefusal = (key: DesignKey, value: unknown): string | null =>
  validValue(key, value) ? null : `That is not a value the ${key} field takes.`;

export const designPatched = (design: ShapeDesign, patch: DesignPatch): ShapeDesign => {
  const next: Record<string, unknown> = { ...design };
  for (const key of Object.keys(patch) as DesignKey[]) {
    const value = patch[key];
    if (value === null || value === undefined) delete next[key];
    else if (validValue(key, value)) next[key] = value;
  }
  return next as ShapeDesign;
};

export const cssFamily = (family: string): string => {
  const trimmed = family.trim();
  if (/[,'"]/.test(trimmed) || !trimmed.includes(" ")) return trimmed;
  return `"${trimmed}"`;
};

const luminance = (hex: string): number => {
  const channel = (offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
};

export const readableTextOn = (hex: string): "#000000" | "#ffffff" => (luminance(hex) > 0.35 ? "#000000" : "#ffffff");

export const designDisplayValues = (type: DesignableType, design: ShapeDesign): Record<string, string | number> => {
  const values: Record<string, string | number> = {};
  for (const key of designKeysOf(type)) {
    const value = design[key];
    const target = DISPLAY_KEYS[type][key];
    if (value === undefined || target === undefined) continue;
    values[target] = key === "fontFamily" ? cssFamily(String(value)) : value;
  }
  if (type === "note" && design.fillColor !== undefined) values.labelColor = readableTextOn(design.fillColor);
  return values;
};
