/**
 * Source edits (spec 18): each typed change to an artifact's HTML, spliced into the file so
 * that only the bytes it changes move. All or nothing: the first refusal stops the list.
 */
import type { SourceEdit } from "@unframed/contracts";
import { applyMotionEdits, isMotionEdit, type MotionEditOptions } from "../motion/edits.ts";
import type { ArtifactKind } from "../artifacts/artifactRules.ts";
import { DESIGN_FIELDS, styleValueRefusal } from "../designFields.ts";
import { parseStylesheet } from "../kits/css.ts";
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
  parseDeclarations,
  parseSource,
  type ChildNode,
  type Declaration,
  type Document,
} from "./source.ts";
import { sourceTreeOf } from "./sourceTree.ts";

export type SourceEditResult =
  | { readonly ok: true; readonly html: string; readonly summary: string[] }
  | { readonly ok: false; readonly refusal: string };

/** The summary holds at most this many lines, then `and {n} more`. */
const SUMMARY_LINES = 20;

/** A layer name is at most this many characters. */
const NAME_MAX = 60;

const IMAGE_FILE = /\.(png|jpe?g|webp|gif|svg)$/i;

type Step = { readonly html: string; readonly line: string } | { readonly refusal: string };

/**
 * Applies `edits` and returns the new source with its summary lines, or the first refusal (and no
 * source). Element edits go in order, then the motion edits (spec 21) in one pass: the two kinds
 * touch different bytes, so their order does not change the result. `kind` only words the
 * refusals. `kit` is the project kit (spec 19): a token edit needs it, and a style value may use
 * its custom properties. `options` carries the artifact's locks and token kinds to the motion edits.
 */
export const applySourceEdits = (
  html: string,
  edits: readonly SourceEdit[],
  kind: ArtifactKind = "page",
  kit: Kit | null = null,
  options: MotionEditOptions = {},
): SourceEditResult => {
  let current = html;
  const lines: string[] = [];
  for (const edit of edits) {
    if (isMotionEdit(edit)) continue;
    const step = applyEdit(current, edit, kind, kit);
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
  return { ok: true, html: current, summary: summaryLines(lines) };
};

/** Each line once, at most 20 of them, then `and {n} more` for the rest. */
export const summaryLines = (lines: readonly string[]): string[] => {
  const unique = [...new Set(lines)];
  const shown = unique.slice(0, SUMMARY_LINES);
  const rest = unique.length - shown.length;
  return rest > 0 ? [...shown, `and ${rest} more`] : shown;
};

const applyEdit = (html: string, edit: Exclude<SourceEdit, { readonly type: "tween-time" | "tween-ease" | "tween-stagger" | "tween-value" | "clip-time" | "composition-duration" }>, kind: ArtifactKind, kit: Kit | null): Step => {
  if (edit.type === "token") return applyToken(html, edit, kind, kit);
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
      if (edit.name !== "data-uf-name") return { refusal: `The attribute ${edit.name} cannot be edited here.` };
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

/**
 * A token edit (spec 19): sets a design property to a kit token's custom property, on an element's
 * inline style or on the declaration of one style rule. A text style writes its five longhands.
 */
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
  // A text style's field takes its own custom property (`--type-font-size`); any other property cannot take a text style.
  const textProperty = Object.values(TEXT_STYLE_SUFFIX).find((candidate) => candidate === edit.property);
  if (token.type === "textStyle" && textProperty === undefined) return { refusal: `${edit.property} cannot be edited here.` };
  const value = token.type === "textStyle" ? `var(${name}-${textProperty})` : `var(${name})`;
  const next = replaceRuleValue(html, ref, edit.property, value);
  if (next === null) return { refusal: "That style changed. Pick the value again." };
  return { html: next, line: `Token · In styles: ${ref.selector}` };
};

/** The `<style>` elements of a source in document order, each with the offsets of its text. A block without a location is left out. */
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

/**
 * Replaces the value of the last `property` declaration of the rule `ref` names, keeping every
 * other byte. Null when the rule, or its declaration of that property, is gone.
 */
const replaceRuleValue = (html: string, ref: { block: number; selector: string; occurrence: number }, property: string, value: string): string | null => {
  const block = styleBlocks(parseSource(html))[ref.block];
  if (block === undefined) return null;
  const text = html.slice(block.start, block.end);
  let seen = 0;
  for (const rule of parseStylesheet(text)) {
    if (rule.selector !== ref.selector) continue;
    const occurrence = seen;
    seen += 1;
    if (occurrence !== ref.occurrence) continue;
    const declaration = rule.declarations.filter((candidate) => candidate.property === property).at(-1);
    if (declaration === undefined) return null;
    return html.slice(0, block.start + declaration.start) + value + html.slice(block.start + declaration.end);
  }
  return null;
};

const isImageFile = (file: string): boolean =>
  IMAGE_FILE.test(file) && file !== "" && !file.includes("/") && !file.includes("\\") && !file.includes("..");

const escapeText = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const escapeAttribute = (value: string): string => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

const renderAttribute = (name: string, value: string): string => `${name}="${escapeAttribute(value)}"`;

/** Replaces the text of a text-only element. The comments stay where they are. */
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

/**
 * Sets an attribute to `rendered` (a whole `name="value"` or a bare name), or removes it when
 * `rendered` is null. An existing attribute is replaced where it stands; a new one goes before
 * the tag's closing bracket.
 */
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

const writeDeclarations = (html: string, id: string, declarations: readonly string[]): string =>
  setAttribute(html, id, "style", declarations.length === 0 ? null : renderAttribute("style", declarations.join("; ")));

const declarationsOf = (html: string, id: string): Declaration[] => {
  const el = findById(parseSource(html), id)?.el;
  return parseDeclarations(el === undefined ? "" : (attr(el, "style") ?? ""));
};

/**
 * Sets one declaration of the element's style attribute, or removes it when `value` is null.
 * An existing declaration is replaced in place and keeps its `!important`; a new one goes
 * after the others and before the hide declaration.
 */
const setDeclaration = (html: string, id: string, property: string, value: string | null): string => {
  const declarations = declarationsOf(html, id);
  const index = declarations.map((declaration) => declaration.property).lastIndexOf(property);
  if (value === null) {
    if (index < 0) return html;
    return writeDeclarations(html, id, declarations.filter((d) => d.property !== property).map((d) => d.text));
  }
  if (index >= 0) {
    const old = declarations[index];
    const important = old !== undefined && /!\s*important$/i.test(old.value);
    const text = `${property}: ${value}${important ? " !important" : ""}`;
    return writeDeclarations(html, id, declarations.map((d, i) => (i === index ? text : d.text)));
  }
  const text = `${property}: ${value}`;
  const hideAt = declarations.findIndex(isHideDeclaration);
  const texts = declarations.map((d) => d.text);
  if (hideAt >= 0) texts.splice(hideAt, 0, text);
  else texts.push(text);
  return writeDeclarations(html, id, texts);
};

/** Adds or removes `data-uf-hidden` and its hide declaration, and nothing else. */
const setHidden = (html: string, id: string, hidden: boolean): string => {
  const el = findById(parseSource(html), id)?.el;
  if (el === undefined) return html;
  const isHidden = attr(el, "data-uf-hidden") !== undefined;
  const hasHideDeclaration = declarationsOf(html, id).some(isHideDeclaration);
  if (hidden) {
    if (isHidden && hasHideDeclaration) return html;
    const withAttribute = isHidden ? html : setAttribute(html, id, "data-uf-hidden", "data-uf-hidden");
    const texts = declarationsOf(withAttribute, id).map((d) => d.text);
    if (!hasHideDeclaration) texts.push(HIDE_DECLARATION);
    return writeDeclarations(withAttribute, id, texts);
  }
  if (!isHidden && !hasHideDeclaration) return html;
  const withoutAttribute = isHidden ? setAttribute(html, id, "data-uf-hidden", null) : html;
  return writeDeclarations(withoutAttribute, id, declarationsOf(withoutAttribute, id).filter((d) => !isHideDeclaration(d)).map((d) => d.text));
};
