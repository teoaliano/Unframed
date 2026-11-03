import { parse, type DefaultTreeAdapterMap } from "parse5";

export type Element = DefaultTreeAdapterMap["element"];
export type ChildNode = DefaultTreeAdapterMap["childNode"];
export type Document = DefaultTreeAdapterMap["document"];

const EXCLUDED = new Set(["script", "style", "template", "meta", "link", "noscript", "base"]);

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

const isVoid = (el: Element): boolean => VOID.has(el.tagName.toLowerCase());

export const parseSource = (html: string): Document => parse(html, { sourceCodeLocationInfo: true });

export const isElement = (node: ChildNode): node is Element => "tagName" in node;
export const isText = (node: ChildNode): node is DefaultTreeAdapterMap["textNode"] => node.nodeName === "#text";
export const isComment = (node: ChildNode): node is DefaultTreeAdapterMap["commentNode"] => node.nodeName === "#comment";

export const attr = (el: Element, name: string): string | undefined => el.attrs.find((a) => a.name === name)?.value;

const childElements = (el: Element): Element[] => {
  const nodes = el.nodeName === "template" ? (el as unknown as { content: { childNodes: ChildNode[] } }).content.childNodes : el.childNodes;
  return nodes.filter(isElement);
};

const isCompositionTemplate = (el: Element): boolean =>
  attr(el, "data-composition-id") !== undefined || childElements(el).some((child) => attr(child, "data-composition-id") !== undefined);

export interface ScopeNode {
  readonly el: Element;
  readonly parent: ScopeNode | null;
  readonly kids: ScopeNode[];
}

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

export const flatten = (nodes: readonly ScopeNode[]): ScopeNode[] => nodes.flatMap((node) => [node, ...flatten(node.kids)]);

export const findById = (doc: Document, id: string): ScopeNode | undefined =>
  flatten(scopeRoots(doc)).find((node) => attr(node.el, "data-hf-id") === id);

const splitDeclarations = (value: string): string[] => {
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
  readonly text: string;
  readonly property: string;
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

export const HIDE_DECLARATION = "display: none !important";

export const isHideDeclaration = (declaration: Declaration): boolean =>
  declaration.property === "display" && /^none\s*!\s*important$/i.test(declaration.value);

export const inPictureWithSources = (el: Element): boolean => {
  const parent = el.parentNode as Element | null;
  return parent !== null && parent.nodeName === "picture" && parent.childNodes.some((node) => isElement(node) && node.nodeName === "source");
};

export const ownText = (el: Element): string =>
  el.childNodes.filter(isText).map((node) => node.value).join("");

export const isTextOnly = (el: Element): boolean =>
  !isVoid(el) && el.childNodes.every((node) => isText(node) || isComment(node));

export const collapse = (text: string): string => text.replace(/\s+/g, " ").trim();
