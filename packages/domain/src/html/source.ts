/**
 * Reading an artifact's source for the element rules (spec 18): one parse with source offsets,
 * the elements that take part in element editing, and the small CSS and attribute helpers the
 * rules share. Only the engine calls these, through `@unframed/domain/html`.
 */
import { parse, type DefaultTreeAdapterMap } from "parse5";

export type Element = DefaultTreeAdapterMap["element"];
export type ChildNode = DefaultTreeAdapterMap["childNode"];
export type Document = DefaultTreeAdapterMap["document"];

/** Tags that never take an element id, nor their children (spec 18, Which elements). */
const EXCLUDED = new Set(["script", "style", "template", "meta", "link", "noscript", "base"]);

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

export const isVoid = (el: Element): boolean => VOID.has(el.tagName.toLowerCase());

export const parseSource = (html: string): Document => parse(html, { sourceCodeLocationInfo: true });

export const isElement = (node: ChildNode): node is Element => "tagName" in node;
export const isText = (node: ChildNode): node is DefaultTreeAdapterMap["textNode"] => node.nodeName === "#text";
export const isComment = (node: ChildNode): node is DefaultTreeAdapterMap["commentNode"] => node.nodeName === "#comment";

export const attr = (el: Element, name: string): string | undefined => el.attrs.find((a) => a.name === name)?.value;

/** The element's child elements, looking inside a composition template's content. */
const childElements = (el: Element): Element[] => {
  const nodes = el.nodeName === "template" ? (el as unknown as { content: { childNodes: ChildNode[] } }).content.childNodes : el.childNodes;
  return nodes.filter(isElement);
};

/** A composition template is one whose own tag or one of whose children carries `data-composition-id`. */
const isCompositionTemplate = (el: Element): boolean =>
  attr(el, "data-composition-id") !== undefined || childElements(el).some((child) => attr(child, "data-composition-id") !== undefined);

/** One element that takes part in element editing, with its parent in the same scope. */
export interface ScopeNode {
  readonly el: Element;
  readonly parent: ScopeNode | null;
  readonly kids: ScopeNode[];
}

/**
 * Every element inside `<body>` that takes part, at any depth, in document order by sibling.
 * A plain template's content is skipped; a composition template's content is walked as if it were
 * in place of the template.
 */
export const scopeRoots = (doc: Document): ScopeNode[] => {
  const html = doc.childNodes.find(isElement);
  const body = html?.childNodes.filter(isElement).find((el) => el.nodeName === "body");
  const roots: ScopeNode[] = [];
  if (body !== undefined) collect(body.childNodes, null, roots);
  return roots;
};

const collect = (nodes: readonly ChildNode[], parent: ScopeNode | null, siblings: ScopeNode[]): void => {
  for (const node of nodes) {
    if (!isElement(node)) continue;
    const name = node.tagName.toLowerCase();
    if (name === "template") {
      if (isCompositionTemplate(node)) collect((node as unknown as { content: { childNodes: ChildNode[] } }).content.childNodes, parent, siblings);
      continue;
    }
    if (EXCLUDED.has(name)) continue;
    const scoped: { el: Element; parent: ScopeNode | null; kids: ScopeNode[] } = { el: node, parent, kids: [] };
    siblings.push(scoped);
    collect(node.childNodes, scoped, scoped.kids);
  }
};

/** Every scope node, document order, depth first. */
export const flatten = (nodes: readonly ScopeNode[]): ScopeNode[] => nodes.flatMap((node) => [node, ...flatten(node.kids)]);

/** The first scope element whose `data-hf-id` is `id`. */
export const findById = (doc: Document, id: string): ScopeNode | undefined =>
  flatten(scopeRoots(doc)).find((node) => attr(node.el, "data-hf-id") === id);

/** Splits a style attribute on the semicolons that are not inside quotes or parentheses; empty pieces are dropped. */
export const splitDeclarations = (value: string): string[] => {
  const pieces: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (quote !== null) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === "(") depth++;
    else if (c === ")") depth = Math.max(0, depth - 1);
    else if (c === ";" && depth === 0) {
      pieces.push(value.slice(start, i));
      start = i + 1;
    }
  }
  pieces.push(value.slice(start));
  return pieces.map((piece) => piece.trim()).filter((piece) => piece !== "");
};

export interface Declaration {
  /** The declaration as written, trimmed. */
  readonly text: string;
  /** The property, lowercased. */
  readonly property: string;
  /** The value, trimmed, `!important` included when written. */
  readonly value: string;
}

export const parseDeclarations = (value: string): Declaration[] =>
  splitDeclarations(value).flatMap((text) => {
    const colon = text.indexOf(":");
    if (colon < 0) return [];
    const property = text.slice(0, colon).trim().toLowerCase();
    if (property === "") return [];
    return [{ text, property, value: text.slice(colon + 1).trim() }];
  });

/** The hide declaration (spec 18, Source edits): `display: none !important`, as a declaration. */
export const HIDE_DECLARATION = "display: none !important";

export const isHideDeclaration = (declaration: Declaration): boolean =>
  declaration.property === "display" && /^none\s*!\s*important$/i.test(declaration.value);

/** An `<img>` inside a `<picture>` that has `<source>` children: its file is chosen by a list. */
export const inPictureWithSources = (el: Element): boolean => {
  const parent = el.parentNode as Element | null;
  return parent !== null && parent.nodeName === "picture" && parent.childNodes.some((node) => isElement(node) && node.nodeName === "source");
};

/** The text of an element's own text nodes (not its descendants'), decoded. */
export const ownText = (el: Element): string =>
  el.childNodes.filter(isText).map((node) => node.value).join("");

/** Whether every child is a text node or a comment (spec 18: text-only). Void elements are never text-only. */
export const isTextOnly = (el: Element): boolean =>
  !isVoid(el) && el.childNodes.every((node) => isText(node) || isComment(node));

export const collapse = (text: string): string => text.replace(/\s+/g, " ").trim();
