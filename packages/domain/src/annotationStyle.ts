import type { DesignableType } from "./shapeDesign.ts";

const STYLE_CONTROLS = ["fill", "stroke", "strokeWidth", "dash", "font", "size", "bold", "align", "textColor"] as const;
export type StyleControl = (typeof STYLE_CONTROLS)[number];

const CONTROLS: Readonly<Record<DesignableType, readonly StyleControl[]>> = {
  text: ["font", "size", "bold", "align", "textColor"],
  note: ["fill", "font", "size", "bold", "align", "textColor"],
  geo: ["fill", "stroke", "strokeWidth", "font", "size"],
  arrow: ["stroke", "strokeWidth", "dash"],
  draw: ["stroke", "strokeWidth", "dash"],
  line: ["stroke", "strokeWidth", "dash"],
  highlight: ["stroke", "strokeWidth"],
};

export const styleControlsFor = (types: readonly DesignableType[]): readonly StyleControl[] =>
  types.length === 0 ? [] : STYLE_CONTROLS.filter((control) => types.every((type) => CONTROLS[type].includes(control)));

export interface AnnotationSwatch {
  readonly name: string;
  readonly hex: string;
}

export const ANNOTATION_SWATCHES: readonly AnnotationSwatch[] = [
  { name: "Grey", hex: "#8b8d98" },
  { name: "Red", hex: "#e5484d" },
  { name: "Orange", hex: "#f76b15" },
  { name: "Amber", hex: "#ffb224" },
  { name: "Yellow", hex: "#ffe066" },
  { name: "Lime", hex: "#99d52a" },
  { name: "Green", hex: "#30a46c" },
  { name: "Teal", hex: "#12a594" },
  { name: "Blue", hex: "#3e63dd" },
  { name: "Violet", hex: "#8e4ec6" },
  { name: "Pink", hex: "#d6409f" },
  { name: "Brown", hex: "#ad7f58" },
];

export interface DesignPanelPreference {
  readonly open: boolean;
}

export const designPanelPreference = (value: unknown): DesignPanelPreference => ({
  open: typeof value === "object" && value !== null && (value as { open?: unknown }).open === true,
});
