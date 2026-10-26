/**
 * The source tree (spec 18): an artifact's elements that carry an element id, read from the
 * file as the engine wrote it, with what the Design and Layers tabs need.
 */
import { attr, collapse, type Element, inPictureWithSources, isTextOnly, ownText, parseDeclarations, parseSource, type ScopeNode, scopeRoots } from "./source.ts";

export type SourceTreeElement = {
  id: string;
  tag: string;
  /** The nearest ancestor with an element id, or null. */
  parent: string | null;
  /** Position among the siblings that carry an element id. */
  index: number;
  /** `data-uf-name`, else the derived label. */
  name: string;
  /** True when `data-uf-name` is set. */
  named: boolean;
  /** Its text when its children are text only (entities decoded), else null. */
  text: string | null;
  /** Its inline declarations: property lowercased, value as written. */
  style: Record<string, string>;
  /** `data-uf-hidden` is present. */
  hidden: boolean;
  /** An `<img>`'s `src` attribute. */
  src?: string;
  /** An `<img>` inside a `<picture>` that has `<source>` children. */
  inPicture?: boolean;
};

const LABEL_TEXT_MAX = 32;

/**
 * The label a person sees for an element without a layer name: the text of a text-only element
 * (cut to 32 characters, then `…`), the `alt` of an image, the id, the first class, the tag.
 */
export const derivedLabel = (el: Element, text: string | null): string => {
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
  if (el.tagName.toLowerCase() === "img") {
    const src = attr(el, "src");
    if (src !== undefined) result.src = src;
    result.inPicture = inPictureWithSources(el);
  }
  return result;
};

/**
 * Every element of the artifact's source that has an element id, document order. An element
 * without an id is looked through: its children keep the nearest id'd ancestor as their parent.
 */
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
