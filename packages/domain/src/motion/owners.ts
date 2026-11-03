/**
 * Value owners (spec 21, task 5): who owns one value of a motion's timeline script. Spec 18's
 * owner names, for a tween value: `source` (a literal in the file), `dial` (a parameter read
 * straight from the `unframed.dials` callback), `token` (`unframed.token("name")`), or `script`
 * (anything else, read-only). `ownerOf` is the one place that decides it.
 */

export type Owner =
  | { readonly kind: "source"; readonly value: number | string }
  | { readonly kind: "dial"; readonly path: readonly string[] }
  | { readonly kind: "token"; readonly name: string }
  | { readonly kind: "script"; readonly text: string };

/** The `unframed.dials` apply function's first parameter, as far as an owner rule can tell. */
export interface DialScope {
  /** The parameter's name, or null when the callback has none or destructures it. */
  readonly param: string | null;
  readonly reassigned: boolean;
  readonly destructured: boolean;
}

export interface OwnerContext {
  /** The script as written. Owners quote expressions from it, cut to 120 characters. */
  readonly source: string;
  /** Null outside any dials callback. */
  readonly dial: DialScope | null;
}

/** One AST node of the script, as acorn gives it. */
export type ScriptNode = { readonly type: string; readonly start: number; readonly end: number; readonly [key: string]: any };

const SCRIPT_CUT = 120;
const RELATIVE = /^\s*(\+=|-=|\*=|\/=|<|>)/;
const RANDOM = /random\(/;

const cut = (text: string, length: number) => (text.length > length ? `${text.slice(0, length - 1)}…` : text);

/** A number, a negative number, or arithmetic on numbers alone; null otherwise. */
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

/** `v.speed`, `v.scene.speed`, `v["speed"]`: the path under the parameter, or null. */
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

/** `unframed.token("name")` with one string literal. */
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

/** The apply function of the last `unframed.dials` call in a script, and its parameter. */
export interface DialsCallback {
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

const FUNCTIONS = new Set(["FunctionExpression", "ArrowFunctionExpression", "FunctionDeclaration"]);

/** Every node under `node`, depth first, in source order. */
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
  if (apply && FUNCTIONS.has(apply.type)) fn = apply;
  if (apply?.type === "Identifier") {
    each(ast, (node) => {
      if (node.type === "FunctionDeclaration" && node.id?.name === apply.name) fn = node;
      if (node.type === "VariableDeclarator" && node.id?.name === apply.name && node.init && FUNCTIONS.has(node.init.type)) fn = node.init;
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

/** The owner context for one script: its source and the dials scope the callback gives. */
export function ownerContextFor(ast: ScriptNode, source: string): OwnerContext {
  const callback = dialsCallback(ast);
  return { source, dial: callback?.scope ?? null };
}
