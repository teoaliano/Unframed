import { parse } from "@babel/parser";

export type JsxChangeKind = "class" | "text" | "attr" | "style";

export interface JsxChange {
  readonly kind: JsxChangeKind;
  readonly property: string;
  readonly before: string | null;
  readonly after: string | null;
}

export interface JsxPlace {
  readonly line: number;
  readonly col: number;
  readonly tag?: string;
}

export interface SpanEdit {
  readonly start: number;
  readonly end: number;
  readonly before: string;
  readonly after: string;
}

export type JsxWrite = { readonly ok: true; readonly text: string; readonly edits: ReadonlyArray<SpanEdit>; readonly line: number } | { readonly ok: false; readonly reason: string };

export interface CvaVariants {
  readonly name: string;
  readonly variants: ReadonlyArray<{ readonly name: string; readonly options: ReadonlyArray<string>; readonly default: string | null }>;
}

export interface JsxInspect {
  readonly line: number;
  readonly col: number;
  readonly endLine: number;
  readonly endCol: number;
  readonly tag: string;
  readonly span: string;
  readonly className: string | null;
  readonly classLiteral: boolean;
  readonly component: string | null;
  readonly cva: ReadonlyArray<CvaVariants>;
}

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
const hasToken = (text: string, token: string): boolean => new RegExp(`(^|\\s)${escapeRegExp(token)}(?=\\s|$)`).test(text);

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
  const exact = all.filter((found) => at(found).line === place.line && Math.abs(at(found).column + 1 - place.col) <= 1);
  if (exact.length > 0) return exact.sort((a, b) => Math.abs(at(a).column + 1 - place.col) - Math.abs(at(b).column + 1 - place.col))[0]!;
  const tagged = (found: Found) => place.tag === undefined || tagOf(found.element.openingElement.name) === place.tag;
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

const classEdit = (source: string, element: Node, change: JsxChange): SpanEdit[] | string => {
  const attr = classAttr(element);
  if (attr === undefined) {
    if (change.before !== null) return `The class ${change.before} is not written on this element; it comes from a prop or a variant.`;
    if (change.after === null) return [];
    const at = element.openingElement.name.end;
    return [{ start: at, end: at, before: "", after: ` className="${change.after}"` }];
  }
  const literals = literalsOf(attr.value);
  if (literals === "computed") return "The className is computed, so its classes cannot be changed in place.";
  if (change.before !== null) {
    for (const literal of literals) {
      const inner = innerOf(literal);
      const text = source.slice(inner.start, inner.end);
      const match = new RegExp(`(^|\\s)${escapeRegExp(change.before)}(?=\\s|$)`).exec(text);
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
    const at = element.openingElement.name.end;
    return [{ start: at, end: at, before: "", after: ` ${change.property}=${JSON.stringify(change.after)}` }];
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
    const at = element.openingElement.name.end;
    return [{ start: at, end: at, before: "", after: ` style={{ ${keyText}: ${JSON.stringify(change.after)} }}` }];
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

export const applySpans = (source: string, edits: ReadonlyArray<SpanEdit>): string => {
  let text = source;
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) text = text.slice(0, edit.start) + edit.after + text.slice(edit.end);
  return text;
};

export const writeJsx = (source: string, file: string, place: JsxPlace, change: JsxChange): JsxWrite => {
  const ast = parseFile(source, file);
  if (ast === undefined) return fail("The file could not be parsed.");
  const found = locate(ast, source, place, change);
  if (typeof found === "string") return fail(found);
  const element = found.element;
  const edits =
    change.kind === "class"
      ? classEdit(source, element, change)
      : change.kind === "text"
        ? textEdit(source, element, change)
        : change.kind === "attr"
          ? attrEdit(source, element, change)
          : styleEdit(source, element, change);
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

const cvaOf = (ast: Node): CvaVariants[] => {
  const found: CvaVariants[] = [];
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
