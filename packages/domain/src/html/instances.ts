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

export const instanceUses = (html: string, tag: string, declaration: Pick<ComponentDeclaration, "variants" | "props">): InstanceUse[] =>
  flatten(scopeRoots(parseSource(html)))
    .filter((node) => node.el.tagName.toLowerCase() === tag)
    .map((node) => useOf(node, declaration));
