import type { SourceEdit } from "@unframed/contracts";
import { applyMotionEdits, isMotionEdit, type MotionEditOptions } from "../motion/edits.ts";
import type { ArtifactKind } from "../artifacts/artifactRules.ts";
import type { ComponentDeclaration } from "../components/sheet.ts";
import { setPin } from "../components/pins.ts";
import { DESIGN_FIELDS, styleValueRefusal } from "../designFields.ts";
import { parseStylesheet, type CssRule } from "../kits/css.ts";
import { kitCssNames } from "../kits/rules.ts";
import { cssName } from "../kits/runtime.ts";
import { TEXT_STYLE_SUFFIX, type Kit } from "../kits/types.ts";
import {
  attr,
  type Element,
  findById,
  HIDE_DECLARATION,
  inPictureWithSources,
  isHideDeclaration,
  isText,
  isTextOnly,
  parseSource,
  type ChildNode,
  type Declaration,
  type Document,
} from "./source.ts";
import { sourceTreeOf } from "./sourceTree.ts";

export type InstanceDeclarations = ReadonlyMap<string, { readonly title: string; readonly declaration: ComponentDeclaration }>;

const TEXT_PROPERTY_MAX = 500;

type SourceEditResult =
  | { readonly ok: true; readonly html: string; readonly summary: string[] }
  | { readonly ok: false; readonly refusal: string };

const SUMMARY_LINES = 20;

const NAME_MAX = 60;

const IMAGE_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}\.(png|jpe?g|webp|gif|svg)$/i;

type Step = { readonly html: string; readonly line: string } | { readonly refusal: string };

export const applySourceEdits = (
  html: string,
  edits: readonly SourceEdit[],
  kind: ArtifactKind = "page",
  kit: Kit | null = null,
  instances: InstanceDeclarations = new Map(),
  options: MotionEditOptions = {},
): SourceEditResult => {
  let current = html;
  const lines: string[] = [];
  for (const edit of edits) {
    if (isMotionEdit(edit)) continue;
    const step = applyEdit(current, edit, kind, kit, instances);
    if ("refusal" in step) return { ok: false, refusal: step.refusal };
    current = step.html;
    lines.push(step.line);
  }
  const motion = edits.filter(isMotionEdit);
  if (motion.length > 0) {
    if (kind !== "motion") return { ok: false, refusal: `This ${kind} has no timeline.` };
    const result = applyMotionEdits(current, motion, options);
    if (!result.ok) return { ok: false, refusal: result.refusal };
    current = result.html;
    lines.push(...result.summary);
  }
  const updates = edits.filter((edit) => edit.type === "componentUpdate").length;
  if (updates > 1) {
    const elementEdits = edits.filter((edit) => !isMotionEdit(edit));
    let merged = false;
    const folded = lines.flatMap((line, index) => {
      if (elementEdits[index]?.type !== "componentUpdate") return [line];
      if (merged) return [];
      merged = true;
      return [`Updated ${updates} components`];
    });
    return { ok: true, html: current, summary: summaryLines(folded) };
  }
  return { ok: true, html: current, summary: summaryLines(lines) };
};

export const summaryLines = (lines: readonly string[]): string[] => {
  const unique = [...new Set(lines)];
  const shown = unique.slice(0, SUMMARY_LINES);
  const rest = unique.length - shown.length;
  return rest > 0 ? [...shown, `and ${rest} more`] : shown;
};

const applyEdit = (html: string, edit: Exclude<SourceEdit, { readonly type: "tween-time" | "tween-ease" | "tween-stagger" | "tween-value" | "clip-time" | "composition-duration" }>, kind: ArtifactKind, kit: Kit | null, instances: InstanceDeclarations): Step => {
  if (edit.type === "token") return applyToken(html, edit, kind, kit);
  if (edit.type === "componentRule") return applyComponentRule(html, edit, kit);
  if (edit.type === "componentUpdate") return { html: setPin(html, edit.tag, edit.to), line: `Updated ${instances.get(edit.tag)?.title ?? edit.tag}` };
  const before = sourceTreeOf(html).find((entry) => entry.id === edit.elementId);
  const target = findById(parseSource(html), edit.elementId);
  if (before === undefined || target === undefined) return { refusal: `There is no element ${edit.elementId} in this ${kind} any more.` };
  const id = edit.elementId;
  const el = target.el;
  const after = (next: string): string => sourceTreeOf(next).find((entry) => entry.id === id)?.name ?? before.name;

  switch (edit.type) {
    case "text": {
      if (!isTextOnly(el)) return { refusal: `${before.name} holds more than text, so its text cannot be edited here.` };
      const next = setText(html, el, edit.text);
      return { html: next, line: `Text · ${after(next)}` };
    }
    case "style": {
      const field = DESIGN_FIELDS.find((candidate) => candidate.property === edit.property);
      if (field === undefined) return { refusal: `${edit.property} cannot be edited here.` };
      const value = edit.value === null ? null : edit.value.trim();
      if (value !== null) {
        const refusal = styleValueRefusal(edit.property, value, kit === null ? [] : kitCssNames(kit));
        if (refusal !== null) return { refusal };
      }
      const next = setDeclaration(html, id, edit.property, value);
      return { html: next, line: `${field.label} · ${after(next)}` };
    }
    case "attribute": {
      const instance = instances.get(el.tagName.toLowerCase());
      if (edit.name !== "data-uf-name") {
        if (instance === undefined) return { refusal: `The attribute ${edit.name} cannot be edited here.` };
        return instanceAttribute(html, id, instance, edit.name, edit.value, after);
      }
      const value = edit.value === null ? "" : edit.value.trim().slice(0, NAME_MAX);
      const next = setAttribute(html, id, "data-uf-name", value === "" ? null : renderAttribute("data-uf-name", value));
      return { html: next, line: `Name · ${after(next)}` };
    }
    case "hide": {
      const next = setHidden(html, id, edit.hidden);
      return { html: next, line: `${edit.hidden ? "Hidden" : "Shown"} · ${after(next)}` };
    }
    case "image": {
      if (!isImageFile(edit.file)) return { refusal: `${edit.file} is not an image this ${kind} can show.` };
      if (edit.target === "src") {
        if (el.tagName.toLowerCase() !== "img") return { refusal: "This element has no picture to replace." };
        if (inPictureWithSources(el)) return { refusal: "This picture chooses its file from a list of sources. Ask the agent to change it." };
        let next = setAttribute(html, id, "src", renderAttribute("src", edit.file));
        next = setAttribute(next, id, "srcset", null);
        next = setAttribute(next, id, "sizes", null);
        return { html: next, line: `Image · ${after(next)}` };
      }
      const next = setDeclaration(html, id, "background-image", `url("${edit.file}")`);
      return { html: next, line: `Image · ${after(next)}` };
    }
  }
};

const instanceAttribute = (
  html: string,
  id: string,
  instance: { readonly title: string; readonly declaration: ComponentDeclaration },
  name: string,
  value: string | null,
  after: (next: string) => string,
): Step => {
  const { declaration, title } = instance;
  const label = name.charAt(0).toUpperCase() + name.slice(1);
  if (Object.hasOwn(declaration.variants, name)) {
    const values = declaration.variants[name]!;
    if (value !== null && !values.includes(value)) return { refusal: `${value} is not a ${name} of ${title}.` };
    if (value === null || value === values[0]) {
      const next = setAttribute(html, id, name, null);
      return { html: next, line: `${label} · ${after(next)}` };
    }
    const next = setAttribute(html, id, name, renderAttribute(name, value));
    return { html: next, line: `${label} · ${after(next)}` };
  }
  if (!Object.hasOwn(declaration.props, name)) return { refusal: `The attribute ${name} cannot be edited here.` };
  const type = declaration.props[name]!;
  if (value === null) {
    const next = setAttribute(html, id, name, null);
    return { html: next, line: `${label} · ${after(next)}` };
  }
  if (type === "boolean" && value !== "") return { refusal: `${name} is on or off, so it takes no value.` };
  if (type === "text" && value.length > TEXT_PROPERTY_MAX) return { refusal: `${name} is at most ${TEXT_PROPERTY_MAX} characters.` };
  if (type === "image" && !isImageFile(value)) return { refusal: `${value} is not an image this component can show.` };
  const next = setAttribute(html, id, name, renderAttribute(name, value));
  return { html: next, line: `${label} · ${after(next)}` };
};

const applyToken = (html: string, edit: Extract<SourceEdit, { type: "token" }>, kind: ArtifactKind, kit: Kit | null): Step => {
  if ((edit.elementId === undefined) === (edit.rule === undefined)) return { refusal: "A token goes to one element or one style rule." };
  const token = kit?.tokens.find((candidate) => candidate.path === edit.token);
  if (token === undefined) return { refusal: `There is no token ${edit.token} in the kit.` };
  if (!DESIGN_FIELDS.some((candidate) => candidate.property === edit.property)) return { refusal: `${edit.property} cannot be edited here.` };
  const name = cssName(token.path);

  if (edit.elementId !== undefined) {
    const id = edit.elementId;
    const before = sourceTreeOf(html).find((entry) => entry.id === id);
    if (before === undefined || findById(parseSource(html), id) === undefined) return { refusal: `There is no element ${id} in this ${kind} any more.` };
    let next = html;
    if (token.type === "textStyle") {
      for (const suffix of Object.values(TEXT_STYLE_SUFFIX)) next = setDeclaration(next, id, suffix, `var(${name}-${suffix})`);
    } else {
      next = setDeclaration(next, id, edit.property, `var(${name})`);
    }
    return { html: next, line: `Token · ${sourceTreeOf(next).find((entry) => entry.id === id)?.name ?? before.name}` };
  }

  const ref = edit.rule!;
  const textProperty = Object.values(TEXT_STYLE_SUFFIX).find((candidate) => candidate === edit.property);
  if (token.type === "textStyle" && textProperty === undefined) return { refusal: `${edit.property} cannot be edited here.` };
  const value = token.type === "textStyle" ? `var(${name}-${textProperty})` : `var(${name})`;
  const next = replaceRuleValue(html, ref, edit.property, value);
  if (next === null) return { refusal: "That style changed. Pick the value again." };
  return { html: next, line: `Token · In styles: ${ref.selector}` };
};

const applyComponentRule = (html: string, edit: Extract<SourceEdit, { type: "componentRule" }>, kit: Kit | null): Step => {
  const field = DESIGN_FIELDS.find((candidate) => candidate.property === edit.property);
  if (field === undefined) return { refusal: `${edit.property} cannot be edited here.` };
  const value = edit.value.trim();
  const refusal = styleValueRefusal(edit.property, value, kit === null ? [] : kitCssNames(kit));
  if (refusal !== null) return { refusal };
  const found = findRule(html, edit.rule);
  if (found === null) return { refusal: "That style rule is no longer in this component." };
  const declaration = found.rule.declarations.filter((candidate) => candidate.property === edit.property).at(-1);
  const next = declaration === undefined ? addDeclaration(html, found.block.start, found.rule, edit.property, value) : html.slice(0, found.block.start + declaration.start) + value + html.slice(found.block.start + declaration.end);
  return { html: next, line: `${field.label} · ${edit.rule.selector}` };
};

const styleBlocks = (doc: Document): Array<{ start: number; end: number }> => {
  const found: Array<{ start: number; end: number }> = [];
  const walk = (nodes: readonly ChildNode[]) => {
    for (const node of nodes) {
      if (!("tagName" in node)) continue;
      if (node.tagName.toLowerCase() === "style") {
        const location = node.sourceCodeLocation;
        if (location?.startTag !== undefined) found.push({ start: location.startTag.endOffset, end: location.endTag?.startOffset ?? location.endOffset });
      }
      walk(node.childNodes);
    }
  };
  walk(doc.childNodes);
  return found;
};

const addDeclaration = (html: string, blockStart: number, rule: CssRule, property: string, value: string): string => {
  const open = blockStart + rule.body.open;
  let at = blockStart + rule.body.close;
  while (at > open && /\s/.test(html.charAt(at - 1))) at -= 1;
  const before = html.slice(open, at).trimEnd();
  const lead = before === "" || before.endsWith(";") ? " " : "; ";
  return html.slice(0, at) + `${lead}${property}: ${value};` + html.slice(at);
};

const findRule = (html: string, ref: { block: number; selector: string; occurrence: number }): { rule: CssRule; block: { start: number; end: number } } | null => {
  const block = styleBlocks(parseSource(html))[ref.block];
  if (block === undefined) return null;
  const text = html.slice(block.start, block.end);
  let seen = 0;
  for (const rule of parseStylesheet(text)) {
    if (rule.selector !== ref.selector) continue;
    const occurrence = seen;
    seen += 1;
    if (occurrence === ref.occurrence) return { rule, block };
  }
  return null;
};

const replaceRuleValue = (html: string, ref: { block: number; selector: string; occurrence: number }, property: string, value: string): string | null => {
  const found = findRule(html, ref);
  const declaration = found?.rule.declarations.filter((candidate) => candidate.property === property).at(-1);
  if (found === null || declaration === undefined) return null;
  return html.slice(0, found.block.start + declaration.start) + value + html.slice(found.block.start + declaration.end);
};

const isImageFile = (file: string): boolean => IMAGE_FILE.test(file);

const escapeText = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const escapeAttribute = (value: string): string => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

const renderAttribute = (name: string, value: string): string => `${name}="${escapeAttribute(value)}"`;

const setText = (html: string, el: Element, text: string): string => {
  const startTag = el.sourceCodeLocation?.startTag;
  if (startTag === undefined) return html;
  const escaped = escapeText(text);
  const textNodes = el.childNodes.filter(isText);
  const pieces: Splice[] = [];
  if (textNodes.length === 0) {
    if (text !== "") pieces.push({ start: startTag.endOffset, end: startTag.endOffset, text: escaped });
  } else {
    textNodes.forEach((node, index) => {
      const location = node.sourceCodeLocation;
      if (location === null || location === undefined) return;
      pieces.push({ start: location.startOffset, end: location.endOffset, text: index === 0 ? escaped : "" });
    });
  }
  return splice(html, pieces);
};

interface Splice {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

const splice = (html: string, pieces: readonly Splice[]): string =>
  [...pieces]
    .sort((a, b) => b.start - a.start)
    .reduce((acc, piece) => acc.slice(0, piece.start) + piece.text + acc.slice(piece.end), html);

const setAttribute = (html: string, id: string, name: string, rendered: string | null): string => {
  const el = findById(parseSource(html), id)?.el;
  const location = el?.sourceCodeLocation;
  if (el === undefined || location === undefined || location === null) return html;
  const existing = location.attrs?.[name];
  if (rendered === null) {
    if (existing === undefined) return html;
    let start = existing.startOffset;
    while (start > 0 && /\s/.test(html.charAt(start - 1))) start -= 1;
    return html.slice(0, start) + html.slice(existing.endOffset);
  }
  if (existing !== undefined) return html.slice(0, existing.startOffset) + rendered + html.slice(existing.endOffset);
  const startTag = location.startTag;
  if (startTag === undefined) return html;
  let at = startTag.endOffset - 1;
  if (html.charAt(at - 1) === "/") at -= 1;
  const lead = /\s/.test(html.charAt(at - 1)) ? "" : " ";
  return html.slice(0, at) + lead + rendered + html.slice(at);
};

type RawDeclaration = Declaration & { readonly start: number; readonly end: number };

interface StyleSpan {
  readonly start: number;
  readonly end: number;
  readonly quote: string;
  readonly attrStart: number;
  readonly attrEnd: number;
}

const rawDeclarations = (raw: string): RawDeclaration[] => {
  const masked = raw
    .replace(/&(?:quot|#0*34|#x0*22);/gi, (m) => `"${" ".repeat(m.length - 1)}`)
    .replace(/&(?:apos|#0*39|#x0*27);/gi, (m) => `'${" ".repeat(m.length - 1)}`)
    .replace(/&[#A-Za-z0-9]+;/g, (m) => " ".repeat(m.length));
  const cuts: Array<[number, number]> = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < masked.length; i++) {
    const c = masked.charAt(i);
    if (quote !== null) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === "(") depth++;
    else if (c === ")") depth = Math.max(0, depth - 1);
    else if (c === ";" && depth === 0) {
      cuts.push([start, i]);
      start = i + 1;
    }
  }
  cuts.push([start, masked.length]);
  return cuts.flatMap(([from, to]) => {
    const piece = raw.slice(from, to);
    const text = piece.trim();
    const colon = text.indexOf(":");
    const property = colon < 0 ? "" : text.slice(0, colon).trim().toLowerCase();
    if (text === "" || property === "") return [];
    const begin = from + piece.indexOf(text);
    return [{ text, property, value: text.slice(colon + 1).trim(), start: begin, end: begin + text.length }];
  });
};

const styleSpan = (html: string, id: string): StyleSpan | null => {
  const location = findById(parseSource(html), id)?.el.sourceCodeLocation;
  const attrLocation = location?.attrs?.style;
  if (attrLocation === undefined) return null;
  const { startOffset: attrStart, endOffset: attrEnd } = attrLocation;
  const eq = html.indexOf("=", attrStart);
  if (eq < 0 || eq >= attrEnd) return null;
  let valueStart = eq + 1;
  while (valueStart < attrEnd && /\s/.test(html.charAt(valueStart))) valueStart += 1;
  const opening = html.charAt(valueStart);
  if (opening === '"' || opening === "'") return { start: valueStart + 1, end: attrEnd - 1, quote: opening, attrStart, attrEnd };
  return { start: valueStart, end: attrEnd, quote: "", attrStart, attrEnd };
};

const styleDeclarations = (html: string, id: string): RawDeclaration[] => {
  const span = styleSpan(html, id);
  return span === null ? [] : rawDeclarations(html.slice(span.start, span.end));
};

const escapeStyle = (text: string, quote: string): string => {
  const escaped = escapeAttribute(text);
  return quote === "'" ? escaped.replace(/'/g, "&#39;") : escaped;
};

const editStyle = (html: string, id: string, change: (raw: string, decls: readonly RawDeclaration[], quote: string) => string): string => {
  const span = styleSpan(html, id);
  if (span === null) {
    const text = change("", [], '"');
    return text === "" ? html : setAttribute(html, id, "style", `style="${text}"`);
  }
  const raw = html.slice(span.start, span.end);
  const next = change(raw, rawDeclarations(raw), span.quote === "'" ? "'" : '"');
  if (next === raw) return html;
  if (next.trim() === "") return setAttribute(html, id, "style", null);
  if (span.quote === "") return setAttribute(html, id, "style", `style="${next}"`);
  return html.slice(0, span.start) + next + html.slice(span.end);
};

const removeAt = (raw: string, decls: readonly RawDeclaration[], index: number): string => {
  if (decls.length === 1) return "";
  const at = decls[index]!;
  if (index > 0) return raw.slice(0, decls[index - 1]!.end) + raw.slice(at.end);
  return raw.slice(0, at.start) + raw.slice(decls[1]!.start);
};

const insertAt = (raw: string, decls: readonly RawDeclaration[], text: string, quote: string): string => {
  const escaped = escapeStyle(text, quote);
  if (decls.length === 0) return escaped;
  const separator = decls.length >= 2 ? raw.slice(decls[0]!.end, decls[1]!.start) : "; ";
  const hide = decls.find(isHideDeclaration);
  if (hide !== undefined) return raw.slice(0, hide.start) + escaped + separator + raw.slice(hide.start);
  const last = decls[decls.length - 1]!;
  return raw.slice(0, last.end) + separator + escaped + raw.slice(last.end);
};

const removeDeclarations = (html: string, id: string, matches: (declaration: Declaration) => boolean): string => {
  let next = html;
  let index = styleDeclarations(next, id).findIndex(matches);
  while (index >= 0) {
    const at = index;
    next = editStyle(next, id, (raw, decls) => removeAt(raw, decls, at));
    index = styleDeclarations(next, id).findIndex(matches);
  }
  return next;
};

const setDeclaration = (html: string, id: string, property: string, value: string | null): string => {
  if (value === null) return removeDeclarations(html, id, (declaration) => declaration.property === property);
  const text = `${property}: ${value}`;
  return editStyle(html, id, (raw, decls, quote) => {
    const index = decls.map((declaration) => declaration.property).lastIndexOf(property);
    const old = decls[index];
    if (old === undefined) return insertAt(raw, decls, text, quote);
    const important = /!\s*important$/i.test(old.value);
    return raw.slice(0, old.start) + escapeStyle(`${text}${important ? " !important" : ""}`, quote) + raw.slice(old.end);
  });
};

const setHidden = (html: string, id: string, hidden: boolean): string => {
  const el = findById(parseSource(html), id)?.el;
  if (el === undefined) return html;
  const isHidden = attr(el, "data-uf-hidden") !== undefined;
  const hasHideDeclaration = styleDeclarations(html, id).some(isHideDeclaration);
  if (hidden) {
    if (isHidden && hasHideDeclaration) return html;
    const withAttribute = isHidden ? html : setAttribute(html, id, "data-uf-hidden", "data-uf-hidden");
    if (hasHideDeclaration) return withAttribute;
    return editStyle(withAttribute, id, (raw, decls, quote) => insertAt(raw, decls, HIDE_DECLARATION, quote));
  }
  if (!isHidden && !hasHideDeclaration) return html;
  const withoutAttribute = isHidden ? setAttribute(html, id, "data-uf-hidden", null) : html;
  return removeDeclarations(withoutAttribute, id, isHideDeclaration);
};
