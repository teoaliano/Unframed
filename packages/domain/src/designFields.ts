
type DesignSection = "Text" | "Fill" | "Shape" | "Spacing" | "Layout" | "Visibility" | "Image" | "Size" | "Position" | "Effects";

export type DesignValueKind = "length" | "number" | "opacity" | "weight" | "color" | "keyword" | "family" | "shadow" | "size" | "angle" | "filter";

type DesignUnit = "px" | "unitless" | "percent" | "none";

interface DesignField {
  readonly section: DesignSection;
  readonly label: string;
  readonly property: string;
  readonly kind: DesignValueKind;
  readonly keywords: readonly string[];
  readonly unit: DesignUnit;
}

const keyword = (section: DesignSection, label: string, property: string, keywords: readonly string[]): DesignField =>
  ({ section, label, property, kind: "keyword", keywords, unit: "none" });

export const DESIGN_FIELDS: readonly DesignField[] = [
  { section: "Text", label: "Font", property: "font-family", kind: "family", keywords: [], unit: "none" },
  { section: "Text", label: "Font size", property: "font-size", kind: "length", keywords: [], unit: "px" },
  { section: "Text", label: "Weight", property: "font-weight", kind: "weight", keywords: [], unit: "unitless" },
  { section: "Text", label: "Line height", property: "line-height", kind: "number", keywords: [], unit: "unitless" },
  { section: "Text", label: "Letter spacing", property: "letter-spacing", kind: "length", keywords: [], unit: "px" },
  keyword("Text", "Align", "text-align", ["left", "center", "right", "justify"]),
  { section: "Text", label: "Colour", property: "color", kind: "color", keywords: [], unit: "none" },
  { section: "Fill", label: "Background", property: "background-color", kind: "color", keywords: [], unit: "none" },
  { section: "Shape", label: "Border width", property: "border-width", kind: "length", keywords: [], unit: "px" },
  keyword("Shape", "Border style", "border-style", ["none", "solid", "dashed", "dotted"]),
  { section: "Shape", label: "Border colour", property: "border-color", kind: "color", keywords: [], unit: "none" },
  { section: "Shape", label: "Corner radius", property: "border-radius", kind: "length", keywords: [], unit: "px" },
  { section: "Shape", label: "Opacity", property: "opacity", kind: "opacity", keywords: [], unit: "percent" },
  { section: "Shape", label: "Shadow", property: "box-shadow", kind: "shadow", keywords: [], unit: "none" },
  { section: "Spacing", label: "Padding top", property: "padding-top", kind: "length", keywords: [], unit: "px" },
  { section: "Spacing", label: "Padding right", property: "padding-right", kind: "length", keywords: [], unit: "px" },
  { section: "Spacing", label: "Padding bottom", property: "padding-bottom", kind: "length", keywords: [], unit: "px" },
  { section: "Spacing", label: "Padding left", property: "padding-left", kind: "length", keywords: [], unit: "px" },
  { section: "Spacing", label: "Margin top", property: "margin-top", kind: "length", keywords: [], unit: "px" },
  { section: "Spacing", label: "Margin right", property: "margin-right", kind: "length", keywords: [], unit: "px" },
  { section: "Spacing", label: "Margin bottom", property: "margin-bottom", kind: "length", keywords: [], unit: "px" },
  { section: "Spacing", label: "Margin left", property: "margin-left", kind: "length", keywords: [], unit: "px" },
  { section: "Spacing", label: "Gap", property: "gap", kind: "length", keywords: [], unit: "px" },
  keyword("Layout", "Direction", "flex-direction", ["row", "column", "row-reverse", "column-reverse"]),
  keyword("Layout", "Align items", "align-items", ["flex-start", "center", "flex-end", "stretch", "baseline"]),
  keyword("Layout", "Justify", "justify-content", ["flex-start", "center", "flex-end", "space-between", "space-around", "space-evenly"]),
  keyword("Layout", "Wrap", "flex-wrap", ["nowrap", "wrap"]),
  keyword("Layout", "Display", "display", ["block", "flex", "inline-flex", "grid", "inline-grid", "inline", "inline-block", "none"]),
  keyword("Layout", "Clip content", "overflow", ["visible", "hidden", "clip", "auto", "scroll"]),
  { section: "Spacing", label: "Row gap", property: "row-gap", kind: "length", keywords: [], unit: "px" },
  { section: "Spacing", label: "Column gap", property: "column-gap", kind: "length", keywords: [], unit: "px" },
  keyword("Text", "Italic", "font-style", ["normal", "italic"]),
  keyword("Text", "Decoration", "text-decoration-line", ["none", "underline", "line-through"]),
  keyword("Text", "Case", "text-transform", ["none", "uppercase", "lowercase", "capitalize"]),
  keyword("Text", "Wrap style", "text-wrap", ["wrap", "pretty", "balance", "nowrap"]),
  keyword("Text", "Number spacing", "font-variant-numeric", ["normal", "tabular-nums", "proportional-nums"]),
  keyword("Text", "Truncate text", "text-overflow", ["clip", "ellipsis"]),
  keyword("Text", "White space", "white-space", ["normal", "nowrap", "pre", "pre-wrap", "pre-line"]),
  { section: "Size", label: "Width", property: "width", kind: "size", keywords: [], unit: "px" },
  { section: "Size", label: "Height", property: "height", kind: "size", keywords: [], unit: "px" },
  { section: "Size", label: "Min width", property: "min-width", kind: "size", keywords: [], unit: "px" },
  { section: "Size", label: "Max width", property: "max-width", kind: "size", keywords: [], unit: "px" },
  { section: "Size", label: "Min height", property: "min-height", kind: "size", keywords: [], unit: "px" },
  { section: "Size", label: "Max height", property: "max-height", kind: "size", keywords: [], unit: "px" },
  keyword("Size", "Flex grow", "flex-grow", ["0", "1"]),
  keyword("Size", "Align self", "align-self", ["auto", "flex-start", "center", "flex-end", "stretch"]),
  keyword("Position", "Position", "position", ["static", "relative", "absolute", "fixed", "sticky"]),
  { section: "Position", label: "X", property: "left", kind: "size", keywords: [], unit: "px" },
  { section: "Position", label: "Y", property: "top", kind: "size", keywords: [], unit: "px" },
  { section: "Position", label: "Rotation", property: "rotate", kind: "angle", keywords: [], unit: "none" },
  { section: "Shape", label: "Border top width", property: "border-top-width", kind: "length", keywords: [], unit: "px" },
  { section: "Shape", label: "Border right width", property: "border-right-width", kind: "length", keywords: [], unit: "px" },
  { section: "Shape", label: "Border bottom width", property: "border-bottom-width", kind: "length", keywords: [], unit: "px" },
  { section: "Shape", label: "Border left width", property: "border-left-width", kind: "length", keywords: [], unit: "px" },
  { section: "Shape", label: "Top left radius", property: "border-top-left-radius", kind: "length", keywords: [], unit: "px" },
  { section: "Shape", label: "Top right radius", property: "border-top-right-radius", kind: "length", keywords: [], unit: "px" },
  { section: "Shape", label: "Bottom right radius", property: "border-bottom-right-radius", kind: "length", keywords: [], unit: "px" },
  { section: "Shape", label: "Bottom left radius", property: "border-bottom-left-radius", kind: "length", keywords: [], unit: "px" },
  keyword("Effects", "Blend mode", "mix-blend-mode", ["normal", "darken", "multiply", "plus-darker", "color-burn", "lighten", "screen", "plus-lighter", "color-dodge", "overlay", "soft-light", "hard-light", "difference", "exclusion", "hue", "saturation", "color", "luminosity"]),
  { section: "Effects", label: "Layer blur", property: "filter", kind: "filter", keywords: [], unit: "none" },
  { section: "Effects", label: "Background blur", property: "backdrop-filter", kind: "filter", keywords: [], unit: "none" },
];

const FORBIDDEN: readonly RegExp[] = [/[;{}<>\\]/, /!\s*important/i, /url\(/i, /expression\(/i, /var\(/i];

const NUMBER = "(?:\\d+\\.?\\d*|\\.\\d+)";

const PATTERNS: Partial<Record<DesignValueKind, RegExp>> = {
  length: new RegExp(`^(?:-?${NUMBER}(?:px|em|rem|%)|0)$`),
  number: new RegExp(`^-?${NUMBER}(?:px)?$`),
  opacity: /^(?:0|1|0?\.\d+|1\.0*)$/,
  weight: /^[1-9]00$/,
  color: /^(?:#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|[a-z]+\([^()]*\)|[a-z]+)$/i,
  family: /^[A-Za-z0-9 ,'"_.-]+$/,
  size: new RegExp(`^(?:-?${NUMBER}(?:px|em|rem|%|vw|vh)|0|auto|fit-content|max-content|min-content|none)$`),
  angle: new RegExp(`^(?:-?${NUMBER}deg|0|none)$`),
  filter: new RegExp(`^(?:none|blur\\(${NUMBER}px\\))$`),
  shadow: /^(?:none|[-+.\dA-Za-z#%(),'"/\s]*\d[-+.\dA-Za-z#%(),'"/\s]*)$/,
};

const SIGNED_PROPERTIES: ReadonlySet<string> = new Set(["margin-top", "margin-right", "margin-bottom", "margin-left", "letter-spacing", "left", "top", "rotate"]);

const valueFits = (field: DesignField, value: string): boolean => {
  if (value === "" || FORBIDDEN.some((re) => re.test(value))) return false;
  if (value.startsWith("-") && !SIGNED_PROPERTIES.has(field.property) && (field.kind === "length" || field.kind === "number" || field.kind === "size" || field.kind === "angle")) return false;
  if (field.kind === "keyword") return field.keywords.includes(value);
  if (field.kind === "weight") {
    const pattern = PATTERNS.weight;
    return pattern !== undefined && pattern.test(value) && Number(value) >= 100 && Number(value) <= 900;
  }
  const pattern = PATTERNS[field.kind];
  return pattern !== undefined && pattern.test(value);
};

const KIT_VAR = /^var\((--[A-Za-z0-9_-]+)(?:\s*,\s*(.*))?\)$/s;

export const styleValueRefusal = (property: string, value: string, kitNames: readonly string[] = []): string | null => {
  const field = DESIGN_FIELDS.find((candidate) => candidate.property === property);
  if (field === undefined) return `${property} cannot be edited here.`;
  const trimmed = value.trim();
  const kitVar = KIT_VAR.exec(trimmed);
  if (kitVar !== null && kitNames.includes(kitVar[1]!)) {
    const fallback = kitVar[2]?.trim();
    if (fallback === undefined || valueFits(field, fallback)) return null;
    return `${field.label} cannot be "${trimmed}".`;
  }
  return valueFits(field, trimmed) ? null : `${field.label} cannot be "${trimmed}".`;
};
