import { attr, collapse, type Element, inPictureWithSources, isTextOnly, ownText, parseDeclarations, parseSource, type ScopeNode, scopeRoots } from "./source.ts";

export type SourceTreeElement = {
  id: string;
  tag: string;
  parent: string | null;
  index: number;
  name: string;
  named: boolean;
  text: string | null;
  style: Record<string, string>;
  hidden: boolean;
  src?: string;
  inPicture?: boolean;
  attributes?: Record<string, string>;
};

const LABEL_TEXT_MAX = 32;

const derivedLabel = (el: Element, text: string | null): string => {
  const collapsed = text === null ? "" : collapse(text);
  if (collapsed !== "") return collapsed.length > LABEL_TEXT_MAX ? `${collapsed.slice(0, LABEL_TEXT_MAX)}…` : collapsed;
  const alt = attr(el, "alt")?.trim() ?? "";
  if (el.tagName.toLowerCase() === "img" && alt !== "") return alt;
  const id = attr(el, "id")?.trim() ?? "";
  if (id !== "") return id;
  const firstClass = (attr(el, "class") ?? "").trim().split(/\s+/)[0] ?? "";
  if (firstClass !== "") return firstClass;
  return el.tagName;
};

const entry = (node: ScopeNode, id: string, parent: string | null, index: number): SourceTreeElement => {
  const el = node.el;
  const layerName = (attr(el, "data-uf-name") ?? "").trim();
  const text = isTextOnly(el) ? ownText(el) : null;
  const style: Record<string, string> = {};
  for (const declaration of parseDeclarations(attr(el, "style") ?? "")) style[declaration.property] = declaration.value;
  const result: SourceTreeElement = {
    id,
    tag: el.tagName,
    parent,
    index,
    name: layerName !== "" ? layerName : derivedLabel(el, text),
    named: layerName !== "",
    text,
    style,
    hidden: attr(el, "data-uf-hidden") !== undefined,
  };
  if (el.tagName.includes("-")) {
    result.attributes = Object.fromEntries(el.attrs.map((a) => [a.name, a.value]));
  }
  if (el.tagName.toLowerCase() === "img") {
    const src = attr(el, "src");
    if (src !== undefined) result.src = src;
    result.inPicture = inPictureWithSources(el);
  }
  return result;
};

export const sourceTreeOf = (html: string): SourceTreeElement[] => {
  const out: SourceTreeElement[] = [];
  const visit = (nodes: readonly ScopeNode[], parentId: string | null, counter: { n: number }): void => {
    for (const node of nodes) {
      const id = (attr(node.el, "data-hf-id") ?? "").trim();
      if (id !== "") {
        out.push(entry(node, id, parentId, counter.n));
        counter.n += 1;
        visit(node.kids, id, { n: 0 });
      } else {
        visit(node.kids, parentId, counter);
      }
    }
  };
  visit(scopeRoots(parseSource(html)), null, { n: 0 });
  return out;
};
