
type DesignSection = "Text" | "Fill" | "Shape" | "Spacing" | "Layout" | "Visibility" | "Image";

export type DesignValueKind = "length" | "number" | "opacity" | "weight" | "color" | "keyword" | "family" | "shadow";

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
  shadow: /^(?:none|[-+.\dA-Za-z#%(),'"/\s]*\d[-+.\dA-Za-z#%(),'"/\s]*)$/,
};

const SIGNED_PROPERTIES: ReadonlySet<string> = new Set(["margin-top", "margin-right", "margin-bottom", "margin-left", "letter-spacing"]);

const valueFits = (field: DesignField, value: string): boolean => {
  if (value === "" || FORBIDDEN.some((re) => re.test(value))) return false;
  if (value.startsWith("-") && !SIGNED_PROPERTIES.has(field.property) && (field.kind === "length" || field.kind === "number")) return false;
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
