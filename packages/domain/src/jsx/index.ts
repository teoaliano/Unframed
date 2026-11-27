import type { ScreenCva, ScreenJsx, ScreenWriteKind } from "@unframed/contracts";
import { parse } from "@babel/parser";

export interface JsxChange {
  readonly kind: ScreenWriteKind;
  readonly property: string;
  readonly before: string | null;
  readonly after: string | null;
  readonly move?: { readonly from: number; readonly to: number; readonly count: number } | undefined;
}

export interface JsxPlace {
  readonly line: number;
  readonly col: number;
  readonly tag?: string | undefined;
}

export interface SpanEdit {
  readonly start: number;
  readonly end: number;
  readonly before: string;
  readonly after: string;
}

export type JsxWrite = { readonly ok: true; readonly text: string; readonly edits: ReadonlyArray<SpanEdit>; readonly line: number } | { readonly ok: false; readonly reason: string };

export type JsxInspect = Omit<ScreenJsx, "file">;

type Node = { type: string; start: number; end: number; loc: { start: { line: number; column: number }; end: { line: number; column: number } }; [key: string]: any };

const CLASS_HELPERS = ["cn", "clsx", "cx", "classNames", "classnames", "twMerge", "twJoin"];
const SKIP = new Set(["loc", "leadingComments", "trailingComments", "innerComments", "extra", "range"]);

const parseFile = (source: string, file: string): Node | undefined => {
  const typescript = !/\.(jsx?|mjs|cjs)$/.test(file);
  for (const plugins of typescript ? [["jsx", "typescript"], ["typescript"], ["jsx"]] : [["jsx"], ["jsx", "typescript"]]) {
    try {
      return parse(source, { sourceType: "module", plugins: plugins as never, errorRecovery: true }) as unknown as Node;
    } catch {
      continue;
    }
  }
  return undefined;
};

const walk = (node: Node, visit: (node: Node, parents: ReadonlyArray<Node>) => void, parents: Node[] = []): void => {
  visit(node, parents);
  const inside = [...parents, node];
  for (const key of Object.keys(node)) {
    if (SKIP.has(key)) continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const child of value) if (child !== null && typeof child === "object" && typeof child.type === "string") walk(child, visit, inside);
    } else if (value !== null && typeof value === "object" && typeof value.type === "string") walk(value, visit, inside);
  }
};

const tagOf = (name: Node): string => {
  if (name.type === "JSXIdentifier") return name.name;
  if (name.type === "JSXMemberExpression") return `${tagOf(name.object)}.${tagOf(name.property)}`;
  if (name.type === "JSXNamespacedName") return `${name.namespace.name}:${name.name.name}`;
  return "";
};

interface Found {
  readonly element: Node;
  readonly parents: ReadonlyArray<Node>;
}

const elementsOf = (ast: Node): Found[] => {
  const found: Found[] = [];
  walk(ast, (node, parents) => {
    if (node.type === "JSXElement") found.push({ element: node, parents });
  });
  return found;
};

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
const tokenAt = (text: string, token: string): RegExpExecArray | null => new RegExp(`(^|\\s)${escapeRegExp(token)}(?=\\s|$)`).exec(text);
const hasToken = (text: string, token: string): boolean => tokenAt(text, token) !== null;

const classAttr = (element: Node): Node | undefined =>
  element.openingElement.attributes.find((attr: Node) => attr.type === "JSXAttribute" && attr.name.type === "JSXIdentifier" && (attr.name.name === "className" || attr.name.name === "class"));

const literalsOf = (value: Node | null | undefined): Node[] | "computed" => {
  if (value === null || value === undefined) return [];
  if (value.type === "StringLiteral") return [value];
  if (value.type !== "JSXExpressionContainer") return "computed";
  const expression = value.expression;
  if (expression.type === "StringLiteral") return [expression];
  if (expression.type === "TemplateLiteral") return expression.quasis;
  if (expression.type === "CallExpression" && expression.callee.type === "Identifier" && CLASS_HELPERS.includes(expression.callee.name)) {
    return expression.arguments.flatMap((arg: Node) => (arg.type === "StringLiteral" ? [arg] : arg.type === "TemplateLiteral" ? arg.quasis : []));
  }
  return "computed";
};

const innerOf = (literal: Node): { start: number; end: number } =>
  literal.type === "TemplateElement" ? { start: literal.start, end: literal.end } : { start: literal.start + 1, end: literal.end - 1 };

const locate = (ast: Node, source: string, place: JsxPlace, change?: JsxChange): Found | string => {
  const all = elementsOf(ast);
  const at = (found: Found) => found.element.openingElement.loc.start;
  const tagged = (found: Found) => place.tag === undefined || tagOf(found.element.openingElement.name).toLowerCase() === place.tag.toLowerCase();
  const exact = all.filter((found) => at(found).line === place.line && Math.abs(at(found).column + 1 - place.col) <= 1 && tagged(found));
  if (exact.length > 0) return exact.sort((a, b) => Math.abs(at(a).column + 1 - place.col) - Math.abs(at(b).column + 1 - place.col))[0]!;
  const onLine = all.filter((found) => at(found).line === place.line && tagged(found));
  if (onLine.length === 1) return onLine[0]!;
  if (change?.kind === "class" && change.before !== null && place.tag !== undefined) {
    const withClass = all.filter((found) => {
      if (!tagged(found)) return false;
      const literals = literalsOf(classAttr(found.element)?.value);
      return literals !== "computed" && literals.some((literal) => hasToken(source.slice(innerOf(literal).start, innerOf(literal).end), change.before!));
    });
    if (withClass.length === 1) return withClass[0]!;
  }
  return `No JSX element starts at line ${place.line}, column ${place.col}.`;
};

const fail = (reason: string): JsxWrite => ({ ok: false, reason });

const addAfterName = (element: Node, text: string): SpanEdit[] => {
  const at = element.openingElement.name.end;
  return [{ start: at, end: at, before: "", after: ` ${text}` }];
};

const classEdit = (source: string, element: Node, change: JsxChange): SpanEdit[] | string => {
  const attr = classAttr(element);
  if (attr === undefined) {
    if (change.before !== null) return `The class ${change.before} is not written on this element; it comes from a prop or a variant.`;
    if (change.after === null) return [];
    return addAfterName(element, `className="${change.after}"`);
  }
  const literals = literalsOf(attr.value);
  if (literals === "computed") return "The className is computed, so its classes cannot be changed in place.";
  if (change.before !== null) {
    for (const literal of literals) {
      const inner = innerOf(literal);
      const text = source.slice(inner.start, inner.end);
      const match = tokenAt(text, change.before);
      if (match === null) continue;
      const start = inner.start + match.index + match[1]!.length;
      const end = start + change.before.length;
      if (change.after !== null) return [{ start, end, before: change.before, after: change.after }];
      const leading = match[1]!.length > 0 ? 1 : 0;
      const trailing = leading === 0 && /\s/.test(text.charAt(end - inner.start)) ? 1 : 0;
      return [{ start: start - leading, end: end + trailing, before: source.slice(start - leading, end + trailing), after: "" }];
    }
    return `The class ${change.before} is not in a literal here; it comes from a prop or a variant.`;
  }
  if (change.after === null) return [];
  const first = literals.find((literal) => literal.type !== "TemplateElement") ?? literals[0];
  if (first === undefined) return "The className has no literal to add a class to.";
  const inner = innerOf(first);
  const text = source.slice(inner.start, inner.end);
  if (hasToken(text, change.after)) return [];
  const glue = text === "" || /\s$/.test(text) ? "" : " ";
  return [{ start: inner.end, end: inner.end, before: "", after: `${glue}${change.after}` }];
};

const collapse = (text: string): string => text.replace(/\s+/g, " ").trim();

const jsxText = (text: string): string => (/[{}<>]/.test(text) ? `{${JSON.stringify(text)}}` : text);

const textEdit = (source: string, element: Node, change: JsxChange): SpanEdit[] | string => {
  if (change.after === null) return "Removing text is left to the agent.";
  const meaningful = element.children.filter((child: Node) => !(child.type === "JSXText" && child.value.trim() === ""));
  if (meaningful.length !== 1) return meaningful.length === 0 ? "The element has no text of its own in the code." : "The element holds more than its text in the code.";
  const child = meaningful[0] as Node;
  if (child.type === "JSXText") {
    const raw = source.slice(child.start, child.end);
    if (change.before !== null && collapse(raw) !== collapse(change.before)) return "The text in the code is not the text the page shows; it is computed.";
    const lead = raw.length - raw.trimStart().length;
    const trail = raw.length - raw.trimEnd().length;
    return [{ start: child.start + lead, end: child.end - trail, before: raw.slice(lead, raw.length - trail), after: jsxText(change.after) }];
  }
  if (child.type === "JSXExpressionContainer" && child.expression.type === "StringLiteral") {
    if (change.before !== null && collapse(child.expression.value) !== collapse(change.before)) return "The text in the code is not the text the page shows; it is computed.";
    return [{ start: child.expression.start, end: child.expression.end, before: source.slice(child.expression.start, child.expression.end), after: JSON.stringify(change.after) }];
  }
  return "The text is computed, so it cannot be replaced in place.";
};

const attrEdit = (source: string, element: Node, change: JsxChange): SpanEdit[] | string => {
  const attr = element.openingElement.attributes.find((each: Node) => each.type === "JSXAttribute" && tagOf(each.name) === change.property);
  if (attr === undefined) {
    if (change.after === null) return [];
    return addAfterName(element, `${change.property}=${JSON.stringify(change.after)}`);
  }
  if (change.after === null) {
    let start = attr.start;
    while (start > 0 && /\s/.test(source.charAt(start - 1))) start--;
    return [{ start, end: attr.end, before: source.slice(start, attr.end), after: "" }];
  }
  const value = attr.value?.type === "JSXExpressionContainer" ? attr.value.expression : attr.value;
  if (value === null || value === undefined) return [{ start: attr.end, end: attr.end, before: "", after: `=${JSON.stringify(change.after)}` }];
  if (value.type !== "StringLiteral") return `The ${change.property} attribute is computed.`;
  return [{ start: value.start, end: value.end, before: source.slice(value.start, value.end), after: JSON.stringify(change.after) }];
};

const camel = (property: string): string => (property.startsWith("--") ? property : property.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase()));

const styleEdit = (source: string, element: Node, change: JsxChange): SpanEdit[] | string => {
  const key = camel(change.property);
  const keyText = /^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key);
  const attr = element.openingElement.attributes.find((each: Node) => each.type === "JSXAttribute" && tagOf(each.name) === "style");
  if (attr === undefined) {
    if (change.after === null) return [];
    return addAfterName(element, `style={{ ${keyText}: ${JSON.stringify(change.after)} }}`);
  }
  const object = attr.value?.type === "JSXExpressionContainer" ? attr.value.expression : undefined;
  if (object === undefined || object.type !== "ObjectExpression") return "The style is computed, so it cannot be changed in place.";
  const found = object.properties.find((each: Node) => each.type === "ObjectProperty" && !each.computed && ((each.key.type === "Identifier" && each.key.name === key) || (each.key.type === "StringLiteral" && each.key.value === key)));
  if (found !== undefined) {
    if (change.after === null) {
      const index = object.properties.indexOf(found);
      const next = object.properties[index + 1] as Node | undefined;
      const end = next === undefined ? found.end : next.start;
      let start = found.start;
      if (next === undefined && index > 0) start = (object.properties[index - 1] as Node).end;
      return [{ start, end, before: source.slice(start, end), after: "" }];
    }
    if (found.value.type !== "StringLiteral" && found.value.type !== "NumericLiteral") return `The ${change.property} style is computed.`;
    return [{ start: found.value.start, end: found.value.end, before: source.slice(found.value.start, found.value.end), after: JSON.stringify(change.after) }];
  }
  if (change.after === null) return [];
  const last = object.properties.at(-1) as Node | undefined;
  if (last === undefined) return [{ start: object.start + 1, end: object.end - 1, before: source.slice(object.start + 1, object.end - 1), after: ` ${keyText}: ${JSON.stringify(change.after)} ` }];
  return [{ start: last.end, end: last.end, before: "", after: `, ${keyText}: ${JSON.stringify(change.after)}` }];
};

const NOT_A_CHILD = "The element is not one of a JSX element's children (it is returned, mapped or computed), so the change is left to the agent.";

const childList = (found: Found): Node[] | string => {
  const parent = found.parents.at(-1);
  if (parent === undefined || (parent.type !== "JSXElement" && parent.type !== "JSXFragment")) return NOT_A_CHILD;
  return parent.children as Node[];
};

const meaningful = (children: ReadonlyArray<Node>): Node[] => children.filter((child) => !(child.type === "JSXText" && child.value.trim() === "") && !(child.type === "JSXExpressionContainer" && child.expression.type === "JSXEmptyExpression"));

const reorderEdit = (source: string, found: Found, change: JsxChange): SpanEdit[] | string => {
  const move = change.move;
  if (move === undefined) return "The move has no positions.";
  const children = childList(found);
  if (typeof children === "string") return children;
  const items = meaningful(children);
  if (items.some((child) => child.type !== "JSXElement")) return "The children include an expression or text, so their order on the page is not the order in the code; the move is left to the agent.";
  if (items.length !== move.count) return `The page shows ${move.count} items here and the code writes ${items.length}; the move is left to the agent.`;
  if (items.indexOf(found.element) !== move.from) return "The element's position on the page is not its position in the code; the move is left to the agent.";
  if (move.to < 0 || move.to >= items.length) return "The move goes outside the list.";
  if (move.to === move.from) return [];
  const order = items.filter((_, index) => index !== move.from);
  order.splice(move.to, 0, found.element);
  const low = Math.min(move.from, move.to);
  const high = Math.max(move.from, move.to);
  let text = "";
  for (let index = low; index <= high; index++) {
    text += source.slice(order[index]!.start, order[index]!.end);
    if (index < high) text += source.slice(items[index]!.end, items[index + 1]!.start);
  }
  const start = items[low]!.start;
  const end = items[high]!.end;
  return [{ start, end, before: source.slice(start, end), after: text }];
};

const ownLine = (source: string, at: number): { readonly lineStart: number; readonly indent: string } | undefined => {
  const lineStart = source.lastIndexOf("\n", at - 1) + 1;
  const indent = source.slice(lineStart, at);
  return /^[ \t]*$/.test(indent) ? { lineStart, indent } : undefined;
};

const duplicateEdit = (source: string, found: Found): SpanEdit[] | string => {
  const children = childList(found);
  if (typeof children === "string") return children;
  const element = found.element;
  const span = source.slice(element.start, element.end);
  const line = ownLine(source, element.start);
  const after = line === undefined ? span : `\n${line.indent}${span}`;
  return [{ start: element.end, end: element.end, before: "", after }];
};

const deleteEdit = (source: string, found: Found): SpanEdit[] | string => {
  const children = childList(found);
  if (typeof children === "string") return children;
  const element = found.element;
  const line = ownLine(source, element.start);
  const start = line !== undefined && line.lineStart > 0 ? line.lineStart - 1 : element.start;
  return [{ start, end: element.end, before: source.slice(start, element.end), after: "" }];
};

type Literal = string | number | boolean | null;

const literalOf = (text: string | null): Literal | undefined => {
  if (text === null) return undefined;
  try {
    const value: unknown = JSON.parse(text);
    return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? value : undefined;
  } catch {
    return undefined;
  }
};

const attrValueOf = (attr: Node): Literal | undefined | "expression" => {
  if (attr.value === null || attr.value === undefined) return true;
  const value = attr.value.type === "JSXExpressionContainer" ? attr.value.expression : attr.value;
  if (value.type === "StringLiteral") return value.value;
  if (value.type === "NumericLiteral") return value.value;
  if (value.type === "BooleanLiteral") return value.value;
  if (value.type === "NullLiteral") return null;
  if (value.type === "TemplateLiteral" && value.expressions.length === 0) return value.quasis[0]?.value?.cooked ?? "";
  return "expression";
};

const attrText = (name: string, value: Literal): string =>
  typeof value === "string" ? (/["\n\\{}]/.test(value) ? `${name}={${JSON.stringify(value)}}` : `${name}="${value}"`) : `${name}={${JSON.stringify(value)}}`;

const propEdit = (source: string, element: Node, change: JsxChange): SpanEdit[] | string => {
  if (!/^[A-Za-z_$][\w$:-]*$/.test(change.property)) return "The prop name is not a plain name.";
  const after = change.after === "null" ? null : literalOf(change.after);
  if (after === undefined) return `The new value of ${change.property} is not a literal; it is left to the agent.`;
  const before = change.before === null ? undefined : literalOf(change.before);
  const attrs = element.openingElement.attributes as Node[];
  const attr = attrs.find((each) => each.type === "JSXAttribute" && tagOf(each.name) === change.property);
  if (attr === undefined) {
    if (after === null) return [];
    const at = attrs.at(-1)?.end ?? element.openingElement.name.end;
    return [{ start: at, end: at, before: "", after: ` ${attrText(change.property, after)}` }];
  }
  const current = attrValueOf(attr);
  if (current === "expression") return `The ${change.property} prop is an expression at the callsite, so it is left to the agent.`;
  if (change.before !== null && before !== current) return `The code's ${change.property} is not the value the page reported; it may come from elsewhere.`;
  if (after === null) {
    let start = attr.start;
    while (start > 0 && /[ \t]/.test(source.charAt(start - 1))) start--;
    return [{ start, end: attr.end, before: source.slice(start, attr.end), after: "" }];
  }
  return [{ start: attr.start, end: attr.end, before: source.slice(attr.start, attr.end), after: attrText(change.property, after) }];
};

const hideEdit = (source: string, element: Node): SpanEdit[] | string => {
  const tag = tagOf(element.openingElement.name);
  if (classAttr(element) === undefined && !/^[a-z]/.test(tag)) return `<${tag}> has no className here and may not take one, so hiding it is left to the agent.`;
  return classEdit(source, element, { kind: "class", property: "display", before: null, after: "hidden" });
};

export const applySpans = (source: string, edits: ReadonlyArray<SpanEdit>): string => {
  let text = source;
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) text = text.slice(0, edit.start) + edit.after + text.slice(edit.end);
  return text;
};

const editsFor = (source: string, found: Found, change: JsxChange): SpanEdit[] | string => {
  const element = found.element;
  switch (change.kind) {
    case "class":
      return classEdit(source, element, change);
    case "text":
      return textEdit(source, element, change);
    case "attr":
      return attrEdit(source, element, change);
    case "style":
      return styleEdit(source, element, change);
    case "reorder":
      return reorderEdit(source, found, change);
    case "duplicate":
      return duplicateEdit(source, found);
    case "delete":
      return deleteEdit(source, found);
    case "props":
      return propEdit(source, element, change);
    case "hide":
      return hideEdit(source, element);
    case "wrap":
      return "Wrapping an element in a new one is left to the agent.";
  }
};

export const writeJsx = (source: string, file: string, place: JsxPlace, change: JsxChange): JsxWrite => {
  const ast = parseFile(source, file);
  if (ast === undefined) return fail("The file could not be parsed.");
  const found = locate(ast, source, place, change);
  if (typeof found === "string") return fail(found);
  const element = found.element;
  const edits = editsFor(source, found, change);
  if (typeof edits === "string") return fail(edits);
  const text = applySpans(source, edits);
  const first = edits.length === 0 ? element.start : Math.min(...edits.map((edit) => edit.start));
  return { ok: true, text, edits, line: source.slice(0, first).split("\n").length };
};

const componentOf = (parents: ReadonlyArray<Node>): string | null => {
  for (let index = parents.length - 1; index >= 0; index--) {
    const node = parents[index]!;
    if ((node.type === "FunctionDeclaration" || node.type === "ClassDeclaration") && node.id?.name && /^[A-Z]/.test(node.id.name)) return node.id.name;
    if (node.type === "VariableDeclarator" && node.id?.type === "Identifier" && /^[A-Z]/.test(node.id.name)) return node.id.name;
  }
  return null;
};

const keyName = (key: Node): string | null => (key.type === "Identifier" ? key.name : key.type === "StringLiteral" ? key.value : key.type === "NumericLiteral" ? String(key.value) : null);

const cvaOf = (ast: Node): ScreenCva[] => {
  const found: ScreenCva[] = [];
  walk(ast, (node, parents) => {
    if (node.type !== "CallExpression" || node.callee.type !== "Identifier" || node.callee.name !== "cva") return;
    const config = node.arguments[1] as Node | undefined;
    if (config?.type !== "ObjectExpression") return;
    const property = (name: string) => config.properties.find((each: Node) => each.type === "ObjectProperty" && keyName(each.key) === name)?.value as Node | undefined;
    const variants = property("variants");
    const defaults = property("defaultVariants");
    if (variants?.type !== "ObjectExpression") return;
    const parent = parents.at(-1);
    const name = parent?.type === "VariableDeclarator" && parent.id.type === "Identifier" ? parent.id.name : "cva";
    found.push({
      name,
      variants: variants.properties
        .filter((each: Node) => each.type === "ObjectProperty" && each.value.type === "ObjectExpression")
        .map((each: Node) => {
          const axis = keyName(each.key) ?? "";
          const chosen = defaults?.type === "ObjectExpression" ? defaults.properties.find((entry: Node) => entry.type === "ObjectProperty" && keyName(entry.key) === axis)?.value : undefined;
          return {
            name: axis,
            options: each.value.properties.map((option: Node) => keyName(option.key)).filter((option: string | null): option is string => option !== null),
            default: chosen?.type === "StringLiteral" ? chosen.value : chosen?.type === "BooleanLiteral" ? String(chosen.value) : null,
          };
        }),
    });
  });
  return found;
};

export const inspectJsx = (source: string, file: string, place: JsxPlace): JsxInspect | undefined => {
  const ast = parseFile(source, file);
  if (ast === undefined) return undefined;
  const found = locate(ast, source, place);
  if (typeof found === "string") return undefined;
  const element = found.element;
  const attr = classAttr(element);
  const value = attr?.value;
  const literal = value?.type === "StringLiteral" ? value : value?.type === "JSXExpressionContainer" && value.expression.type === "StringLiteral" ? value.expression : undefined;
  return {
    line: element.loc.start.line,
    col: element.loc.start.column + 1,
    endLine: element.loc.end.line,
    endCol: element.loc.end.column + 1,
    tag: tagOf(element.openingElement.name),
    span: source.slice(element.start, element.end),
    className: literal !== undefined ? literal.value : value ? source.slice(value.start, value.end) : null,
    classLiteral: literal !== undefined,
    component: componentOf(found.parents),
    cva: cvaOf(ast),
  };
};

export const worktreeFile = (reported: string, worktree: string): string | undefined => {
  let path = reported.trim();
  try {
    if (/^https?:\/\//.test(path)) path = new URL(path).pathname;
  } catch {
    return undefined;
  }
  path = path.replace(/[?#].*$/, "");
  if (/^webpack(-internal)?:/.test(path)) {
    const dot = path.indexOf("/./");
    path = dot === -1 ? path.replace(/^webpack(-internal)?:\/+[^/]*\//, "") : path.slice(dot + 1);
  }
  path = path.replace(/^file:\/\//, "");
  try {
    path = decodeURIComponent(path);
  } catch {
    return undefined;
  }
  path = path.replace(/^\/@fs\//, "/");
  const root = worktree.replace(/\/+$/, "");
  if (path.startsWith(`${root}/`)) path = path.slice(root.length + 1);
  else if (path.startsWith("/")) path = path.slice(1);
  path = path.replace(/^\.\//, "");
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") return undefined;
    parts.push(part);
  }
  return parts.length === 0 ? undefined : parts.join("/");
};
