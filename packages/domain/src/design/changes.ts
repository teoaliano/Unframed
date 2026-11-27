import type { ScreenWrite } from "@unframed/contracts";
import { propertyLabel, type DraftChange, type DraftElement, type DraftNeighbour, type PropValue } from "../screenDrafts.ts";
import { parseColour, pxOf } from "../tailwind.ts";
import type { Sides } from "./gestures.ts";

export type StructuralEdit =
  | { readonly type: "reorder"; readonly from: number; readonly to: number; readonly siblings: ReadonlyArray<DraftNeighbour>; readonly parent: DraftNeighbour | null }
  | { readonly type: "duplicate"; readonly parent: DraftNeighbour | null }
  | { readonly type: "delete"; readonly parent: DraftNeighbour | null }
  | { readonly type: "wrap" }
  | { readonly type: "hide" }
  | { readonly type: "props"; readonly props: Readonly<Record<string, PropValue>>; readonly before: Readonly<Record<string, PropValue>> };

export const STRUCTURAL_PROPERTY = { reorder: "#order", duplicate: "#duplicate", delete: "#delete", wrap: "#wrap", hide: "display", props: "#props" } as const;

export const structuralDraftOf = (edit: StructuralEdit, context: { readonly id: string; readonly element: DraftElement }): DraftChange => {
  const base = { id: context.id, element: context.element, scope: "all" as const, kind: edit.type, property: STRUCTURAL_PROPERTY[edit.type], before: null, after: null, shownBefore: "", asked: null };
  if (edit.type === "reorder") return { ...base, move: { from: edit.from, to: edit.to, siblings: edit.siblings }, parent: edit.parent };
  if (edit.type === "duplicate" || edit.type === "delete") return { ...base, parent: edit.parent };
  if (edit.type === "hide") return { ...base, after: "hidden", asked: "none" };
  if (edit.type === "props") return { ...base, props: edit.props, propsBefore: edit.before };
  return base;
};

export const movedOrder = <T>(items: ReadonlyArray<T>, from: number, to: number): T[] => {
  const rest = items.filter((_, index) => index !== from);
  const moved = items[from];
  if (moved === undefined) return [...items];
  rest.splice(Math.max(0, Math.min(to, rest.length)), 0, moved);
  return rest;
};

const LABELS: Readonly<Record<string, string>> = {
  gap: "Gap",
  "column-gap": "Gap",
  "row-gap": "Gap",
  "border-radius": "Corner radius",
  "font-size": "Size",
  color: "Text colour",
  "background-color": "Fill",
  "border-color": "Stroke",
  "font-weight": "Weight",
  "font-style": "Italic",
  "text-decoration-line": "Decoration",
  rotate: "Rotation",
  left: "X",
  top: "Y",
  "box-shadow": "Shadow",
  "justify-content": "Alignment",
  "align-items": "Alignment",
};

const WEIGHTS: Readonly<Record<string, string>> = { "100": "Thin", "200": "Extra light", "300": "Light", "400": "Regular", "500": "Medium", "600": "Semibold", "700": "Bold", "800": "Extra bold", "900": "Black" };
const DECORATIONS: Readonly<Record<string, string>> = { none: "None", underline: "Underline", "line-through": "Strikethrough", overline: "Overline" };
const TEXT_ALIGN: Readonly<Record<string, string>> = { start: "Left", left: "Left", center: "Center", right: "Right", end: "Right", justify: "Justify" };
const ALIGNMENT: Readonly<Record<string, string>> = { normal: "left", start: "left", "flex-start": "left", left: "left", center: "center", end: "right", "flex-end": "right", right: "right", "space-between": "space between", "space-around": "space around", "space-evenly": "space evenly", stretch: "stretch", baseline: "baseline" };

const number = (value: number): string => String(Math.round(value * 100) / 100);

export const hexLabel = (value: string): string | undefined => {
  const rgba = parseColour(value);
  if (rgba === undefined) return undefined;
  const hex = rgba
    .slice(0, 3)
    .map((part) => Math.round(part).toString(16).padStart(2, "0"))
    .join("");
  return `#${hex}${rgba[3] < 1 ? Math.round(rgba[3] * 255).toString(16).padStart(2, "0") : ""}`.toUpperCase();
};

const shadowLabel = (value: string): string => {
  if (value.trim() === "none" || value.trim() === "") return "none";
  const layers: string[] = [];
  let depth = 0;
  let from = 0;
  for (let index = 0; index <= value.length; index++) {
    const char = value.charAt(index);
    if (char === "(") depth++;
    else if (char === ")") depth--;
    else if ((char === "," && depth === 0) || index === value.length) {
      layers.push(value.slice(from, index).trim());
      from = index + 1;
    }
  }
  return layers
    .map((layer) => {
      const inset = /\binset\b/.test(layer);
      const colour = /(#[0-9a-f]{3,8}|(?:rgba?|hsla?|oklch)\([^()]*\))/i.exec(layer)?.[1];
      const lengths = layer
        .replace(/\binset\b/, " ")
        .replace(colour ?? "\u0000", " ")
        .split(/\s+/)
        .filter((word) => word !== "")
        .map((word) => pxOf(word))
        .filter((px): px is number => px !== undefined);
      while (lengths.length < 4) lengths.push(0);
      return `${inset ? "Inner" : "Drop"} ${lengths.map(number).join(" ")}${colour === undefined ? "" : ` ${hexLabel(colour) ?? colour}`}`;
    })
    .join(", ");
};

const ellipsis = (text: string, most = 40): string => (text.length > most ? `${text.slice(0, most - 1)}…` : text);

export const valueLabel = (property: string, value: string | null): string => {
  const text = (value ?? "").trim();
  if (text === "") return "none";
  if (text.startsWith("var(")) return text;
  if (/(^|-)color$|^fill$|^stroke$/.test(property)) return hexLabel(text) ?? text;
  if (property === "opacity") return Number.isFinite(Number(text)) ? `${Math.round(Number(text) * 100)}%` : text;
  if (property === "letter-spacing") {
    if (text === "normal") return "0%";
    const em = /^(-?\d*\.?\d+)em$/.exec(text);
    return em === null ? text : `${number(Number(em[1]) * 100)}%`;
  }
  if (property === "text-align") return TEXT_ALIGN[text] ?? text;
  if (property === "font-weight") return WEIGHTS[text] ?? text;
  if (property === "font-style") return text === "italic" || text === "oblique" ? "on" : "off";
  if (property === "text-decoration-line") return DECORATIONS[text] ?? text;
  if (property === "rotate") return text === "none" ? "0°" : text.replace(/deg$/, "°");
  if (property === "box-shadow") return shadowLabel(text);
  if (property === "justify-content" || property === "align-items") return ALIGNMENT[text] ?? text;
  const px = pxOf(text);
  if (px !== undefined) return /width|height/.test(property) ? String(Math.round(px)) : number(px);
  return text;
};

const MODES: Readonly<Record<string, string>> = { fill: "Fill", hug: "Hug", fixed: "" };

const styleLine = (change: DraftChange): string => {
  if (change.property === "display" && (change.kind === "class" || change.kind === "style")) return change.asked === "none" ? "Hidden" : "Shown";
  const label = LABELS[change.property] ?? propertyLabel(change.property);
  const before = valueLabel(change.property, change.shownBefore || change.before);
  const afterRaw = change.kind === "class" ? (change.token?.value ?? change.asked ?? change.after) : change.after;
  const after = valueLabel(change.property, afterRaw);
  const token = change.token === undefined ? "" : ` ${change.token.label ?? change.token.name}`;
  const mode = change.mode === undefined ? "" : MODES[change.mode]!;
  if (mode !== "" && before === after) return `${label} ${mode} → Fixed ${after}${token}`;
  return `${label}${mode === "" ? "" : ` ${mode}`} ${before} → ${after}${token}`;
};

const propLabel = (value: PropValue | undefined): string => (value === undefined || value === null ? "none" : value === true ? "on" : value === false ? "off" : String(value));

export const changeLine = (change: DraftChange): string => {
  switch (change.kind) {
    case "text":
      return `Text “${ellipsis(change.before ?? "")}” → “${ellipsis(change.after ?? "")}”`;
    case "reorder": {
      const move = change.move;
      if (move === undefined) return "Moved";
      const order = movedOrder(move.siblings, move.from, move.to);
      const to = order.indexOf(move.siblings[move.from]!);
      return to <= 0 ? `Moved before ${order[1]?.label ?? "the rest"}` : `Moved after ${order[to - 1]!.label}`;
    }
    case "duplicate":
      return "Duplicated (the copy right after it)";
    case "delete":
      return "Deleted";
    case "wrap":
      return "Wrapped it in a new frame (flexbox, column)";
    case "hide":
      return "Hidden";
    case "props":
      return Object.entries(change.props ?? {})
        .map(([name, value]) => `${name} ${propLabel(change.propsBefore?.[name])} → ${propLabel(value)}`)
        .join(" · ");
    case "attr":
      return `${change.property} ${change.before ?? "none"} → ${change.after ?? "none"}`;
    default:
      return styleLine(change);
  }
};

const SIDES = ["top", "right", "bottom", "left"] as const;

export const paddingLine = (before: Sides, after: Sides, token?: { readonly name: string; readonly label?: string }): string => {
  const changed = SIDES.filter((side) => before[side] !== after[side]);
  if (changed.length === 4) return `Padding ${SIDES.map((side) => number(before[side])).join(" · ")} → ${SIDES.map((side) => number(after[side])).join(" · ")}`;
  const suffix = token !== undefined && changed.length === 1 ? ` ${token.label ?? token.name}` : "";
  return `Padding ${changed.map((side) => `${side} ${number(before[side])} → ${number(after[side])}`).join(" · ")}${suffix}`;
};

export const groupLine = (changes: ReadonlyArray<DraftChange>): string => {
  const padding = changes.every((change) => /^padding-(top|right|bottom|left)$/.test(change.property) && (change.kind === "style" || change.kind === "class"));
  if (padding && changes.length > 1) {
    const before = { top: 0, right: 0, bottom: 0, left: 0 };
    const after = { top: 0, right: 0, bottom: 0, left: 0 };
    for (const change of changes) {
      const side = change.property.slice("padding-".length) as keyof Sides;
      before[side] = pxOf(change.shownBefore || change.before || "0") ?? 0;
      after[side] = pxOf((change.kind === "class" ? (change.token?.value ?? change.asked) : change.after) ?? "0") ?? 0;
    }
    if (changes.length < 4) {
      const parts = SIDES.filter((side) => changes.some((change) => change.property === `padding-${side}`)).map((side) => `${side} ${number(before[side])} → ${number(after[side])}`);
      return `Padding ${parts.join(" · ")}`;
    }
    return paddingLine(before, after);
  }
  return changes.map(changeLine).join(" · ");
};

export const screenWritesOf = (change: DraftChange): ScreenWrite[] => {
  const source = change.element.source;
  if (source === null) return [];
  const base = { id: change.id, kind: change.kind, property: change.property, before: change.before, after: change.after, file: source.file, line: source.line, col: source.col, tag: change.element.tag };
  if (change.kind === "reorder" && change.move !== undefined) return [{ ...base, move: { from: change.move.from, to: change.move.to, count: change.move.siblings.length } }];
  if (change.kind === "props") {
    const entries = Object.entries(change.props ?? {});
    return entries.map(([name, value]) => {
      const before = change.propsBefore?.[name];
      return { ...base, id: entries.length === 1 ? change.id : `${change.id}:${name}`, property: name, before: before === undefined ? null : JSON.stringify(before), after: JSON.stringify(value) };
    });
  }
  return [base];
};
