import { designPatched, designValueRefusal, displayKeyOf, isDesignableType, shapeDesignOf, type DesignableType, type DesignKey, type DesignPatch } from "@unframed/domain";
import { getDisplayValues, useValue, type Editor, type StyleProp, type TLShape } from "tldraw";
import { hexOf } from "../design/controls.tsx";
import { showError } from "../toasts.tsx";
import { metaWithDesign, nextShapeDesign, patchNextShapeDesign, TOOL_TYPES } from "./nextShapeDesign.ts";

const TLDRAW_FONTS: Readonly<Record<string, string>> = { draw: "Draw", sans: "Sans", serif: "Serif", mono: "Mono" };
export const FONT_NAMES = Object.values(TLDRAW_FONTS);
export const DASHES = ["draw", "solid", "dashed", "dotted"];
export const FILLED: readonly DesignableType[] = ["geo", "draw"];
export const ALIGN_OPTIONS = [
  { value: "left", label: "Left" },
  { value: "center", label: "Centre" },
  { value: "right", label: "Right" },
];
export const DASH_OPTIONS = [
  { value: "draw", label: "Draw" },
  { value: "solid", label: "Solid" },
  { value: "dashed", label: "Dash" },
  { value: "dotted", label: "Dot" },
];
export const STROKE_WIDTH_RANGE = { min: 0, max: 20, step: 0.5 } as const;
export const SIZE_RANGE = { min: 4, max: 200, step: 1 } as const;

const ALIGN_PROP: Readonly<Record<string, string>> = { left: "start", center: "middle", right: "end" };
const ALIGN_NAME: Readonly<Record<string, string>> = { start: "left", middle: "center", end: "right", "start-legacy": "left", "middle-legacy": "center", "end-legacy": "right" };

export interface Subject {
  readonly type: DesignableType;
  readonly shape: TLShape;
}

export interface DesignTarget {
  readonly subjects: readonly Subject[];
  readonly next: boolean;
}

export interface DesignChange {
  readonly design?: DesignPatch;
  readonly props?: (subject: Subject) => Record<string, unknown> | undefined;
  readonly opacity?: number;
}

export const props = (shape: TLShape) => shape.props as Record<string, unknown>;

export const toHex = (value: unknown): string => {
  const text = String(value ?? "").trim();
  if (/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(text)) return text.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(text)) return `#${[...text.slice(1)].map((digit) => digit + digit).join("")}`.toLowerCase();
  const p3 = /^color\(display-p3\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(text);
  if (p3 !== null) return hexOf(`rgb(${p3.slice(1, 4).map((channel) => Number(channel) * 255).join(",")})`);
  if (text.startsWith("rgb")) return hexOf(text);
  return "";
};

export const weightOf = (value: unknown): string => {
  const text = String(value ?? "");
  if (text === "normal" || text === "") return "400";
  if (text === "bold") return "700";
  return text;
};

const nextShapeOf = (editor: Editor, type: DesignableType): TLShape => {
  const util = editor.getShapeUtil(type);
  const initial = { ...util.getDefaultProps() } as unknown as Record<string, unknown>;
  for (const [style, key] of editor.styleProps[type] ?? []) initial[key] = editor.getStyleForNextShape(style);
  return { id: "shape:next", typeName: "shape", type, x: 0, y: 0, rotation: 0, index: "a1", parentId: editor.getCurrentPageId(), isLocked: false, opacity: editor.getInstanceState().opacityForNextShape, props: initial, meta: { unframed: { design: nextShapeDesign(editor) } } } as unknown as TLShape;
};

const styleNamed = (editor: Editor, type: DesignableType, key: string): StyleProp<unknown> | undefined => {
  for (const [style, propKey] of editor.styleProps[type] ?? []) if (propKey === key) return style;
  return undefined;
};

export const toolType = (editor: Editor): DesignableType | undefined => TOOL_TYPES[editor.getCurrentToolId()];

export const toolTarget = (editor: Editor): DesignTarget => {
  const type = toolType(editor);
  return { subjects: type === undefined ? [] : [{ type, shape: nextShapeOf(editor, type) }], next: true };
};

export const selectionTarget = (editor: Editor): DesignTarget => ({
  subjects: editor
    .getSelectedShapes()
    .filter((shape) => isDesignableType(shape.type))
    .map((shape) => ({ type: shape.type as DesignableType, shape })),
  next: false,
});

export const panelTarget = (editor: Editor): DesignTarget => (toolType(editor) === undefined ? selectionTarget(editor) : toolTarget(editor));

export const useDesignTarget = (editor: Editor, pick: (editor: Editor) => DesignTarget): DesignTarget => {
  useValue(
    "design subjects",
    () => {
      const { subjects, next } = pick(editor);
      return `${next}\n${editor.getColorMode()}\n${subjects.map(({ shape }) => JSON.stringify([shape.id, shape.opacity, shape.props, shape.meta])).join("\n")}`;
    },
    [editor, pick],
  );
  return pick(editor);
};

export const designValue = (editor: Editor, subject: Subject, key: DesignKey): unknown => {
  const set = shapeDesignOf(subject.shape.meta)[key];
  if (set !== undefined) return set;
  const target = displayKeyOf(subject.type, key);
  if (target === undefined) return undefined;
  const util = editor.getShapeUtil(subject.type) as unknown as Parameters<typeof getDisplayValues>[0];
  return (getDisplayValues(util, subject.shape) as Record<string, unknown>)[target];
};

export const shared = (values: readonly string[]): { readonly value: string; readonly mixed: boolean } => ({
  value: values[0] ?? "",
  mixed: values.some((value) => value !== values[0]),
});

const mergeableMeta = (before: TLShape["meta"], after: TLShape["meta"]): TLShape["meta"] => ("unframed" in before && !("unframed" in after) ? { ...after, unframed: {} } : after);

const BURST_MS = 800;
let lastBurst: { readonly key: string; readonly at: number } | undefined;

export const writeDesign = (editor: Editor, { subjects, next }: DesignTarget, change: DesignChange, burst?: string): boolean => {
  const refusal = Object.entries(change.design ?? {})
    .map(([key, value]) => (value === null ? null : designValueRefusal(key as DesignKey, value)))
    .find((text) => text !== null);
  if (refusal !== undefined && refusal !== null) {
    showError(refusal);
    return false;
  }
  if (next) {
    const [subject] = subjects;
    if (change.design !== undefined) patchNextShapeDesign(editor, change.design);
    if (change.opacity !== undefined) editor.setOpacityForNextShapes(change.opacity);
    for (const [key, value] of Object.entries((subject && change.props?.(subject)) ?? {})) {
      const style = subject === undefined ? undefined : styleNamed(editor, subject.type, key);
      if (style !== undefined) editor.setStyleForNextShapes(style, value);
    }
    return true;
  }
  const now = Date.now();
  const key = `${burst ?? ""}:${subjects.map(({ shape }) => shape.id).join(",")}`;
  if (burst === undefined || lastBurst?.key !== key || now - lastBurst.at > BURST_MS) editor.markHistoryStoppingPoint("design");
  lastBurst = burst === undefined ? undefined : { key, at: now };
  editor.updateShapes(
    subjects.map(({ shape, ...subject }) => {
      const extra = change.props?.({ shape, ...subject });
      return {
        id: shape.id,
        type: shape.type,
        ...(change.opacity === undefined ? {} : { opacity: change.opacity }),
        ...(change.design === undefined ? {} : { meta: mergeableMeta(shape.meta, metaWithDesign(shape.meta, designPatched(shapeDesignOf(shape.meta), change.design))) }),
        ...(extra === undefined ? {} : { props: extra }),
      };
    }),
  );
  return true;
};

export const fontOf = (subject: Subject): string => shapeDesignOf(subject.shape.meta).fontFamily ?? TLDRAW_FONTS[String(props(subject.shape).font)] ?? "";

export const alignOf = (subject: Subject): string => ALIGN_NAME[String(props(subject.shape)[subject.type === "text" ? "textAlign" : "align"])] ?? "left";

export const fontChange = (typed: string): DesignChange => {
  const named = Object.entries(TLDRAW_FONTS).find(([, name]) => name.toLowerCase() === typed.toLowerCase())?.[0];
  return named !== undefined ? { design: { fontFamily: null }, props: () => ({ font: named }) } : { design: { fontFamily: typed } };
};

export const alignChange = (align: string): DesignChange | undefined => {
  const prop = ALIGN_PROP[align];
  return prop === undefined ? undefined : { props: (subject) => ({ [subject.type === "text" ? "textAlign" : "align"]: prop }) };
};

export const fillChange = (hex: string | null): DesignChange =>
  hex === null ? { design: { fillColor: null }, props: (subject) => (FILLED.includes(subject.type) ? { fill: "none" } : undefined) } : { design: { fillColor: hex }, props: (subject) => (FILLED.includes(subject.type) ? { fill: "solid" } : undefined) };

export const fillOf = (editor: Editor, subjects: readonly Subject[]): { readonly value: string; readonly mixed: boolean; readonly none: boolean } => {
  const nones = subjects.map((subject) => FILLED.includes(subject.type) && props(subject.shape).fill === "none");
  if (nones.some(Boolean)) return { value: "", mixed: !nones.every(Boolean), none: nones.every(Boolean) };
  return { ...shared(subjects.map((subject) => toHex(designValue(editor, subject, "fillColor")))), none: false };
};
