/**
 * The instances of a component tag in a document (spec 20), as the update warnings read them: the
 * variant values and property attributes each instance sets, and the slots it fills.
 */
import type { ComponentDeclaration } from "../components/sheet.ts";
import type { InstanceUse } from "../components/updates.ts";
import { attr, flatten, isText, parseSource, scopeRoots, type ScopeNode } from "./source.ts";

const useOf = (node: ScopeNode, declaration: Pick<ComponentDeclaration, "variants" | "props">): InstanceUse => {
  const variants: Record<string, string> = {};
  for (const name of Object.keys(declaration.variants)) {
    const value = attr(node.el, name);
    if (value !== undefined) variants[name] = value;
  }
  const props = Object.keys(declaration.props).filter((name) => attr(node.el, name) !== undefined);
  const slots = new Set<string>();
  if (node.el.childNodes.some((child) => isText(child) && child.value.trim() !== "")) slots.add("");
  for (const kid of node.kids) slots.add(attr(kid.el, "slot") ?? "");
  return { variants, props, slots: [...slots] };
};

/** Every instance of `tag` in the document, as the uses its declaration's update warnings count. */
export const instanceUses = (html: string, tag: string, declaration: Pick<ComponentDeclaration, "variants" | "props">): InstanceUse[] =>
  flatten(scopeRoots(parseSource(html)))
    .filter((node) => node.el.tagName.toLowerCase() === tag)
    .map((node) => useOf(node, declaration));
