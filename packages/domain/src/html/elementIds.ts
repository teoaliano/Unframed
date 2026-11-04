import { mintHfId, stampHfIdsInPlace } from "@hyperframes/parsers";
import { parse } from "parse5";
import { attr, flatten, isElement, isText, parseSource, scopeRoots, type ChildNode, type Document, type Element } from "./source.ts";

const ID = "data-hf-id";

type Splice = { readonly from: number; readonly to: number; readonly text: string };

const parseMarkup = (html: string): Document => parse(html, { sourceCodeLocationInfo: true, scriptingEnabled: false });

const insideNoscript = (el: Element): boolean => {
  for (let parent = el.parentNode as Element | null; parent !== null; parent = parent.parentNode as Element | null) {
    if (parent.nodeName === "noscript") return true;
  }
  return false;
};

const stripNoscriptIds = (stamped: string): string => {
  const splices: Splice[] = [];
  for (const el of elementsOf(parseMarkup(stamped))) {
    const span = idSpan(el);
    if (span === undefined || !insideNoscript(el)) continue;
    let from = span.from;
    while (from > 0 && /\s/.test(stamped[from - 1]!)) from -= 1;
    splices.push({ from, to: span.to, text: "" });
  }
  return applySplices(stamped, splices);
};

const elementsOf = (doc: Document): Element[] => {
  const walk = (nodes: readonly ChildNode[]): Element[] =>
    nodes.flatMap((node) => (isElement(node) ? [node, ...walk(childrenOf(node))] : []));
  return walk(doc.childNodes);
};

const childrenOf = (el: Element): readonly ChildNode[] =>
  el.nodeName === "template" ? (el as unknown as { content: { childNodes: ChildNode[] } }).content.childNodes : el.childNodes;

const inScope = (doc: Document): Set<Element> => new Set(flatten(scopeRoots(doc)).map((node) => node.el));

const idSpan = (el: Element): { from: number; to: number } | undefined => {
  const loc = el.sourceCodeLocation?.attrs?.[ID];
  return loc === undefined ? undefined : { from: loc.startOffset, to: loc.endOffset };
};

const applySplices = (html: string, splices: readonly Splice[]): string => {
  let out = html;
  for (const { from, to, text } of [...splices].sort((a, b) => b.from - a.from)) out = out.slice(0, from) + text + out.slice(to);
  return out;
};

const isSettled = (html: string): boolean => {
  const doc = parseSource(html);
  const seen = new Set<string>();
  for (const el of inScope(doc)) {
    const id = attr(el, ID);
    if (!id || seen.has(id)) return false;
    seen.add(id);
  }
  return true;
};

const restoreOutOfScope = (source: string, stamped: string): string => {
  if (stamped === source) return stamped;
  const before = elementsOf(parseMarkup(source));
  const doc = parseMarkup(stamped);
  const after = elementsOf(doc);
  if (before.length !== after.length || before.some((el, n) => el.nodeName !== after[n]!.nodeName)) return stripNoscriptIds(stamped);
  const scope = inScope(doc);
  const splices: Splice[] = [];
  after.forEach((el, n) => {
    if (scope.has(el)) return;
    const now = idSpan(el);
    if (now === undefined) return;
    const was = idSpan(before[n]!);
    if (was !== undefined) {
      splices.push({ ...now, text: source.slice(was.from, was.to) });
      return;
    }
    let from = now.from;
    while (from > 0 && /\s/.test(stamped[from - 1]!)) from -= 1;
    splices.push({ from, to: now.to, text: "" });
  });
  return applySplices(stamped, splices);
};

const freshenDuplicates = (html: string): string => {
  const doc = parseMarkup(html);
  const scope = [...inScope(doc)];
  const assigned = new Set(elementsOf(doc).map((el) => attr(el, ID)).filter((id): id is string => !!id));
  const seen = new Set<string>();
  const splices: Splice[] = [];
  for (const el of scope) {
    const id = attr(el, ID);
    if (!id) continue;
    if (!seen.has(id)) {
      seen.add(id);
      continue;
    }
    const fresh = mintHfId(forMint(el), assigned);
    const span = idSpan(el)!;
    const raw = html.slice(span.from, span.to);
    const eq = raw.indexOf("=");
    const quote = /["']/.exec(raw.slice(eq + 1))?.[0] ?? '"';
    splices.push({ ...span, text: `${raw.slice(0, eq)}=${quote}${fresh}${quote}` });
  }
  return applySplices(html, splices);
};

const forMint = (el: Element) =>
  ({
    tagName: el.nodeName,
    attributes: el.attrs.map((a) => ({ name: a.name, value: a.value })),
    childNodes: el.childNodes.map((node: ChildNode) => ({
      nodeType: isText(node) ? 3 : 1,
      nodeValue: isText(node) ? node.value : null,
    })),
  }) as unknown as Parameters<typeof mintHfId>[0];

const hasMissing = (html: string): boolean => [...inScope(parseSource(html))].some((el) => !attr(el, ID));

const stampUnderHtmlTag = (html: string): string | null => {
  const at = /<body[\s>]/i.exec(html)?.index;
  if (at === undefined) return null;
  const tag = "<html>";
  const out = stampHfIdsInPlace(html.slice(0, at) + tag + html.slice(at));
  return out.slice(at, at + tag.length) === tag ? out.slice(0, at) + out.slice(at + tag.length) : null;
};

const stampInPlace = (html: string): string => {
  const stamped = stampHfIdsInPlace(html);
  if (!hasMissing(stamped)) return stamped;
  return stampUnderHtmlTag(html) ?? stamped;
};

export const stampElementIds = (html: string): string => {
  if (isSettled(html)) return html;
  return freshenDuplicates(restoreOutOfScope(html, stampInPlace(html)));
};
