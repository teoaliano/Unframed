import type { ArtifactKind } from "../artifacts/artifactRules.ts";
import { attr, type ChildNode, type Element, flatten, isComment, isElement, isText, parseSource, scopeRoots } from "./source.ts";
import type { SourceTreeElement } from "./sourceTree.ts";
import { parseHTML } from "linkedom";

const EXACT_TEXT = new Set(["pre", "textarea", "script", "style"]);

const normalisedStyle = (value: string): string =>
  value
    .split(";")
    .map((declaration) => declaration.trim())
    .filter((declaration) => declaration !== "")
    .map((declaration) => {
      const colon = declaration.indexOf(":");
      if (colon < 0) return declaration;
      return `${declaration.slice(0, colon).trim().toLowerCase()}:${declaration.slice(colon + 1).trim()}`;
    })
    .join(";");

const canonical = (node: ChildNode, exact: boolean): unknown => {
  if (isComment(node)) return null;
  if (isText(node)) {
    if (exact) return node.value;
    const collapsed = node.value.replace(/\s+/g, " ");
    return collapsed.trim() === "" ? null : collapsed;
  }
  if (!isElement(node)) return null;
  const childExact = exact || EXACT_TEXT.has(node.tagName.toLowerCase());
  const attrs = [...node.attrs]
    .map((a) => [a.name.toLowerCase(), a.name.toLowerCase() === "style" ? normalisedStyle(a.value) : a.value] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const children = node.nodeName === "template" ? (node as unknown as { content: { childNodes: ChildNode[] } }).content.childNodes : node.childNodes;
  const kids = children.map((child) => canonical(child, childExact)).filter((child) => child !== null);
  return [node.tagName.toLowerCase(), attrs, kids];
};

const firstById = (html: string): Map<string, Element> => {
  const found = new Map<string, Element>();
  for (const node of flatten(scopeRoots(parseSource(html)))) {
    const id = attr(node.el, "data-hf-id");
    if (id !== undefined && !found.has(id)) found.set(id, node.el);
  }
  return found;
};

export const ruleLockHit = (html: string, selector: string, locked: readonly string[]): string | null => {
  if (locked.length === 0) return null;
  let reach = selector.replace(/:host(?:\([^()]*\))?/g, "").trim();
  if (reach === "") return null;
  if (/^[>+~]/.test(reach)) reach = `* ${reach}`;
  type DomElement = { getAttribute(name: string): string | null; parentElement: DomElement | null; querySelectorAll(selector: string): ArrayLike<DomElement> };
  const { document } = parseHTML(html) as unknown as { document: { querySelector(selector: string): DomElement | null; querySelectorAll(selector: string): ArrayLike<DomElement> } };
  const root = document.querySelector("[data-uf-template]");
  if (root === null) return null;
  let matches: ArrayLike<DomElement>;
  try {
    matches = root.querySelectorAll(reach);
  } catch {
    return locked[0] ?? null;
  }
  for (const match of Array.from(matches)) {
    for (let node: DomElement | null = match; node !== null && node !== root; node = node.parentElement) {
      const id = node.getAttribute("data-hf-id");
      if (id !== null && locked.includes(id)) return id;
    }
  }
  return null;
};

interface LockCheck {
  readonly current: string;
  readonly next: string;
  readonly locked: readonly string[];
  readonly tree: readonly SourceTreeElement[];
  readonly kind?: ArtifactKind;
}

export const lockRefusal = (check: LockCheck): string | null => {
  const kind = check.kind ?? "page";
  const hits: { readonly id: string; readonly verb: "changes" | "removes" }[] = [];
  const currentById = firstById(check.current);
  const nextById = firstById(check.next);
  for (const id of check.locked) {
    const before = currentById.get(id);
    if (before === undefined) continue;
    const after = nextById.get(id);
    if (after === undefined) hits.push({ id, verb: "removes" });
    else if (JSON.stringify(canonical(before, false)) !== JSON.stringify(canonical(after, false))) hits.push({ id, verb: "changes" });
  }
  const first = hits[0];
  if (first === undefined) return null;
  const name = check.tree.find((entry) => entry.id === first.id)?.name ?? first.id;
  const readTool = kind === "motion" ? "motion_read" : kind === "component" ? "component_read" : "page_read";
  const more = hits.length > 1 ? ` ${hits.length - 1} more locked elements are changed too.` : "";
  return `The element data-hf-id="${first.id}" ("${name}") is locked by the person, and this write ${first.verb} it. Keep that element exactly as it is in the current file (${readTool} shows it), or ask the person to unlock it in the editor's Layers tab.${more}`;
};

