
export type Owner =
  | { readonly kind: "source"; readonly value: number | string }
  | { readonly kind: "dial"; readonly path: readonly string[] }
  | { readonly kind: "token"; readonly name: string }
  | { readonly kind: "script"; readonly text: string };

interface DialScope {
  readonly param: string | null;
  readonly reassigned: boolean;
  readonly destructured: boolean;
}

export interface OwnerContext {
  readonly source: string;
  readonly dial: DialScope | null;
}

export type AnyNode = { readonly type: string; readonly [key: string]: any };
export type ScriptNode = AnyNode & { readonly start: number; readonly end: number };

export const LOOP_NODES = new Set(["ForStatement", "ForInStatement", "ForOfStatement", "WhileStatement", "DoWhileStatement"]);
export const LOOP_METHODS = new Set(["forEach", "map", "filter", "reduce", "some", "every"]);
export const FUNCTION_NODES = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);

export const propertiesOf = (node: AnyNode | undefined | null): ScriptNode[] => (node?.type === "ObjectExpression" ? node.properties.filter((p: ScriptNode) => p.type === "Property") : []);

export const keyName = (property: AnyNode): string | null => {
  if (property.computed) return null;
  if (property.key.type === "Identifier") return property.key.name;
  if (property.key.type === "Literal") return String(property.key.value);
  return null;
};

const SCRIPT_CUT = 120;
const RELATIVE = /^\s*(\+=|-=|\*=|\/=|<|>)/;
const RANDOM = /random\(/;

const cut = (text: string, length: number) => (text.length > length ? `${text.slice(0, length - 1)}…` : text);

export const constantNumber = (node: ScriptNode | null | undefined): number | null => {
  if (!node) return null;
  if (node.type === "Literal" && typeof node.value === "number") return node.value;
  if (node.type === "UnaryExpression" && (node.operator === "-" || node.operator === "+")) {
    const inner = constantNumber(node.argument);
    if (inner === null) return null;
    return node.operator === "-" ? -inner : inner;
  }
  if (node.type === "BinaryExpression") {
    const left = constantNumber(node.left);
    const right = constantNumber(node.right);
    if (left === null || right === null) return null;
    switch (node.operator) {
      case "+": return left + right;
      case "-": return left - right;
      case "*": return left * right;
      case "/": return right === 0 ? null : left / right;
      default: return null;
    }
  }
  return null;
};

const dialPath = (node: ScriptNode, scope: DialScope | null): string[] | null => {
  if (!scope || !scope.param || scope.reassigned || scope.destructured) return null;
  const steps: string[] = [];
  let current: ScriptNode = node;
  while (current.type === "MemberExpression") {
    const property: ScriptNode = current.property;
    if (current.computed) {
      if (property.type !== "Literal" || typeof property.value !== "string") return null;
      steps.unshift(property.value);
    } else {
      if (property.type !== "Identifier") return null;
      steps.unshift(property.name);
    }
    current = current.object;
  }
  if (current.type !== "Identifier" || current.name !== scope.param || steps.length === 0) return null;
  return steps;
};

const tokenName = (node: ScriptNode): string | null => {
  if (node.type !== "CallExpression" || node.arguments.length !== 1) return null;
  const callee: ScriptNode = node.callee;
  if (callee.type !== "MemberExpression" || callee.computed) return null;
  if (callee.object.type !== "Identifier" || callee.object.name !== "unframed") return null;
  if (callee.property.name !== "token") return null;
  const [argument] = node.arguments as ScriptNode[];
  return argument?.type === "Literal" && typeof argument.value === "string" ? argument.value : null;
};

export function ownerOf(node: ScriptNode | null | undefined, context: OwnerContext): Owner {
  const text = () => (node ? cut(context.source.slice(node.start, node.end), SCRIPT_CUT) : "");
  if (!node) return { kind: "script", text: "" };
  const number = constantNumber(node);
  if (number !== null) return { kind: "source", value: number };
  if (node.type === "Literal" && typeof node.value === "string") {
    if (RELATIVE.test(node.value) || RANDOM.test(node.value)) return { kind: "script", text: text() };
    return { kind: "source", value: node.value };
  }
  const path = dialPath(node, context.dial);
  if (path) return { kind: "dial", path };
  const token = tokenName(node);
  if (token !== null) return { kind: "token", name: token };
  return { kind: "script", text: text() };
}

interface DialsCallback {
  readonly call: ScriptNode;
  readonly fn: ScriptNode;
  readonly scope: DialScope;
}

const isDialsCall = (node: ScriptNode): boolean =>
  node.type === "CallExpression" &&
  node.callee.type === "MemberExpression" &&
  node.callee.object.type === "Identifier" &&
  node.callee.object.name === "unframed" &&
  node.callee.property.name === "dials";


const each = (node: unknown, visit: (node: ScriptNode) => void): void => {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) each(child, visit);
    return;
  }
  const current = node as ScriptNode;
  if (typeof current.type !== "string") return;
  visit(current);
  for (const key of Object.keys(current)) {
    if (key === "start" || key === "end") continue;
    const child = current[key];
    if (child && typeof child === "object") each(child, visit);
  }
};

const assignsTo = (fn: ScriptNode, name: string): boolean => {
  let found = false;
  each(fn.body, (node) => {
    if (node.type === "AssignmentExpression" && node.left.type === "Identifier" && node.left.name === name) found = true;
    if (node.type === "UpdateExpression" && node.argument.type === "Identifier" && node.argument.name === name) found = true;
  });
  return found;
};

export function dialsCallback(ast: ScriptNode): DialsCallback | null {
  let call: ScriptNode | null = null;
  each(ast, (node) => {
    if (isDialsCall(node) && (!call || node.start > call.start)) call = node;
  });
  if (!call) return null;
  const apply: ScriptNode | undefined = (call as ScriptNode).arguments[2];
  let fn: ScriptNode | null = null;
  if (apply && FUNCTION_NODES.has(apply.type)) fn = apply;
  if (apply?.type === "Identifier") {
    each(ast, (node) => {
      if (node.type === "FunctionDeclaration" && node.id?.name === apply.name) fn = node;
      if (node.type === "VariableDeclarator" && node.id?.name === apply.name && node.init && FUNCTION_NODES.has(node.init.type)) fn = node.init;
    });
  }
  if (!fn) return null;
  const first: ScriptNode | undefined = (fn as ScriptNode).params[0];
  const param = first?.type === "Identifier" ? first.name : null;
  const destructured = first !== undefined && first.type !== "Identifier";
  return {
    call,
    fn,
    scope: { param, destructured, reassigned: param !== null && assignsTo(fn, param) },
  };
}

export function ownerContextFor(ast: ScriptNode, source: string): OwnerContext {
  const callback = dialsCallback(ast);
  return { source, dial: callback?.scope ?? null };
}
