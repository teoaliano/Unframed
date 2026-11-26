import type { SourceEdit } from "@unframed/contracts";
import { classFor, classSetting, looksTailwind, parseColour, pxOf, type TailwindToken } from "./tailwind.ts";

export interface DraftSource {
  readonly file: string;
  readonly line: number;
  readonly col: number;
  readonly endLine?: number;
  readonly endCol?: number;
}

export interface DraftElement {
  readonly stamp: string;
  readonly selector: string;
  readonly name: string;
  readonly tag: string;
  readonly key: string | null;
  readonly source: DraftSource | null;
  readonly component: string | null;
  readonly instanceIndex: number;
  readonly instanceCount: number;
  readonly selfMapped: boolean;
}

export type DraftKind = "style" | "class" | "text" | "attr";
export type DraftScope = "all" | "one";

export interface DraftChange {
  readonly id: string;
  readonly kind: DraftKind;
  readonly property: string;
  readonly before: string | null;
  readonly after: string | null;
  readonly shownBefore: string;
  readonly asked: string | null;
  readonly token?: TailwindToken;
  readonly element: DraftElement;
  readonly scope: DraftScope;
  readonly edit: SourceEdit;
}

export interface DraftContext {
  readonly id: string;
  readonly element: DraftElement;
  readonly className: string | null;
  readonly computed: Readonly<Record<string, string>>;
  readonly text: string | null;
}

const shortValue = (value: string | null): string => {
  if (value === null || value === "") return "none";
  const px = pxOf(value);
  if (px !== undefined && /rem|px/.test(value)) return String(Math.round(px * 100) / 100);
  return value;
};

const KINDS: Readonly<Record<string, string>> = {
  header: "Header",
  footer: "Footer",
  nav: "Navigation",
  main: "Main",
  aside: "Aside",
  section: "Section",
  article: "Article",
  h1: "Heading",
  h2: "Heading",
  h3: "Heading",
  h4: "Heading",
  h5: "Heading",
  h6: "Heading",
  p: "Text",
  span: "Text",
  label: "Label",
  a: "Link",
  button: "Button",
  img: "Image",
  svg: "Icon",
  input: "Input",
  textarea: "Input",
  select: "Select",
  ul: "List",
  ol: "List",
  li: "List item",
  form: "Form",
  table: "Table",
  div: "Frame",
};

export const elementKind = (tag: string): string => KINDS[tag.toLowerCase()] ?? tag.toLowerCase();

export const elementLabel = (input: { readonly tag: string; readonly owner: string | null; readonly w: number; readonly h: number }): string =>
  `${elementKind(input.tag)}${input.owner === null ? "" : ` · in ${input.owner}`} ${Math.round(input.w)}×${Math.round(input.h)}`;

export const propertyLabel = (property: string): string => {
  if (property === "#text") return "Text";
  const words = property.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

export const draftOf = (edit: SourceEdit, context: DraftContext): DraftChange | undefined => {
  const base = { id: context.id, element: context.element, scope: "all" as DraftScope, edit };
  if (edit.type === "text") return { ...base, kind: "text", property: "#text", before: context.text, after: edit.text, shownBefore: context.text ?? "", asked: edit.text };
  if (edit.type === "hide") {
    if (looksTailwind(context.className))
      return edit.hidden
        ? { ...base, kind: "class", property: "display", before: null, after: "hidden", shownBefore: context.computed.display ?? "", asked: "none", token: { name: "hidden", value: "none", kind: "display" } }
        : { ...base, kind: "class", property: "display", before: "hidden", after: null, shownBefore: "none", asked: null };
    return { ...base, kind: "style", property: "display", before: context.computed.display ?? null, after: edit.hidden ? "none" : null, shownBefore: context.computed.display ?? "", asked: edit.hidden ? "none" : null };
  }
  if (edit.type !== "style") return undefined;
  const shownBefore = context.computed[edit.property] ?? "";
  if (edit.value !== null && looksTailwind(context.className)) {
    const token = classFor(edit.property, edit.value);
    if (token !== undefined) {
      const current = classSetting(context.className, edit.property);
      const exact = current !== undefined && current.primary === edit.property ? current.name : null;
      return { ...base, kind: "class", property: edit.property, before: exact, after: token.name, shownBefore, asked: token.value, token };
    }
  }
  return { ...base, kind: "style", property: edit.property, before: shownBefore === "" ? null : shownBefore, after: edit.value, shownBefore, asked: edit.value };
};

export const draftLine = (change: DraftChange): string => {
  const label = propertyLabel(change.property);
  if (change.kind === "text") return `${label} "${change.before ?? ""}" → "${change.after ?? ""}"`;
  if (change.property === "display") return change.asked === "none" ? "Hidden" : "Shown";
  const before = shortValue(change.shownBefore || change.before);
  const after = shortValue(change.token?.value ?? change.after);
  return `${label} ${before} → ${after}${change.token ? ` · ${change.token.name}` : ""}`;
};

const sameTarget = (a: DraftChange, b: DraftChange): boolean => a.element.stamp === b.element.stamp && a.property === b.property;

export const addDraft = (list: ReadonlyArray<DraftChange>, next: DraftChange): DraftChange[] => {
  const earlier = list.find((each) => sameTarget(each, next));
  if (earlier === undefined) return [...list, next];
  const merged: DraftChange = { ...next, id: earlier.id, before: earlier.before, shownBefore: earlier.shownBefore, scope: earlier.scope };
  return list.map((each) => (each === earlier ? merged : each));
};

export const dropDraft = (list: ReadonlyArray<DraftChange>, id: string): DraftChange[] => list.filter((each) => each.id !== id);

export const scopeDraft = (list: ReadonlyArray<DraftChange>, id: string, scope: DraftScope): DraftChange[] => list.map((each) => (each.id === id ? { ...each, scope } : each));

export interface PickInput {
  readonly levels: ReadonlyArray<{ readonly id: string | null }>;
  readonly selection: ReadonlyArray<string>;
  readonly clicks: number;
  readonly deepest: boolean;
  readonly additive: boolean;
}

export const pickTarget = (input: PickInput): string[] => {
  const ids = input.levels.map((level) => level.id).filter((id): id is string => id !== null);
  if (ids.length === 0) return input.additive ? [...input.selection] : [];
  let at = -1;
  ids.forEach((id, index) => {
    if (input.selection.includes(id)) at = index;
  });
  const last = ids.length - 1;
  const index = input.deepest ? last : input.clicks >= 2 ? Math.min(at + 1, last) : at >= 0 ? at : 0;
  const target = ids[index]!;
  if (!input.additive) return [target];
  return input.selection.includes(target) ? input.selection.filter((id) => id !== target) : [...input.selection, target];
};

export interface Measured {
  readonly found: boolean;
  readonly computed: Readonly<Record<string, string>>;
  readonly text: string | null;
  readonly attributes?: Readonly<Record<string, string | null>>;
}

const collapse = (text: string | null): string => (text ?? "").replace(/\s+/g, " ").trim();

const sameValue = (asked: string, shown: string): boolean => {
  if (asked.trim() === shown.trim()) return true;
  const a = pxOf(asked);
  const b = pxOf(shown);
  if (a !== undefined && b !== undefined) return Math.abs(a - b) < 0.5;
  const colourA = parseColour(asked);
  const colourB = parseColour(shown);
  if (colourA !== undefined && colourB !== undefined) return colourA.every((part, index) => Math.abs(part - colourB[index]!) < (index === 3 ? 0.02 : 1.5));
  return false;
};

export const changeTook = (change: DraftChange, measured: Measured): boolean => {
  if (!measured.found) return false;
  if (change.kind === "text") return collapse(measured.text) === collapse(change.after);
  if (change.kind === "attr") return (measured.attributes?.[change.property] ?? null) === change.after;
  const shown = measured.computed[change.property] ?? "";
  if (change.asked === null) return shown !== "none" && shown !== "";
  return sameValue(change.asked, shown);
};

export const NO_SOURCE = "Unframed found no React source for this element.";
export const NOT_SELF_MAPPED = "The element is not written as JSX of its own; the nearest JSX is named.";
export const ONLY_THIS_ONE = "Only this instance should change, which needs a prop or a wrapper at its callsite.";
export const DID_NOT_TAKE = "The page did not show it after the write.";

export const SCREEN_DRAFTS_TEMPLATE =
  'Make these changes in the app shown by the Screen <shape> on the branch "<branch>", at <state>. The person made them by hand in the Screen editor, and Unframed could not write them into the code itself. Each line names the JSX that renders the element, the change, and why it was left to you:\n\n<changes>\n\nWork in the Instance\'s worktree at <worktree>, and nowhere else. Make each change at the place named, the way the project already styles its components, so that the Screen shows it. Leave the change uncommitted.';

const whereOf = (element: DraftElement): string => {
  const source = element.source;
  if (source === null) return `CSS path ${element.selector}`;
  const end = source.endLine === undefined ? "" : `–${source.endLine}:${source.endCol ?? 0}`;
  return `${source.file}:${source.line}:${source.col}${end}${element.selfMapped ? "" : ` (the nearest JSX; the element itself is ${element.selector})`}`;
};

export const draftInstructionLine = (change: DraftChange, reason: string): string => {
  const element = change.element;
  const component = element.component === null ? "" : ` in ${element.component}`;
  const instances = element.instanceCount > 1 ? `, instance ${element.instanceIndex + 1} of ${element.instanceCount}${change.scope === "one" ? ", change only this one" : ", change every one"}` : "";
  const token = change.token === undefined ? "" : ` (${change.token.name}, ${change.token.value})`;
  const value = change.kind === "class" ? `class ${change.before ?? "(none)"} → ${change.after ?? "(none)"}${token}` : `${change.property} ${JSON.stringify(change.shownBefore || change.before || "")} → ${JSON.stringify(change.after ?? "")}`;
  return `- ${elementKind(element.tag)}${component} at ${whereOf(element)}${instances}: ${value}. ${reason}`;
};

export const screenDraftInstruction = (input: {
  readonly shape: string;
  readonly branch: string;
  readonly state: string;
  readonly worktree: string;
  readonly changes: ReadonlyArray<{ readonly change: DraftChange; readonly reason: string }>;
}): string =>
  SCREEN_DRAFTS_TEMPLATE.replace("<shape>", () => input.shape)
    .replace("<branch>", () => input.branch)
    .replace("<state>", () => input.state)
    .replace("<worktree>", () => input.worktree)
    .replace("<changes>", () => input.changes.map(({ change, reason }) => draftInstructionLine(change, reason)).join("\n"));
