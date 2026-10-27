/**
 * The motion editability probe (spec 21, task 3). It counts a motion's tweens by the owner of
 * each value and by the reason a tween is read-only, so the build can see how much of what the
 * agent writes the timeline may edit. It reads the file with HyperFrames' write parser and uses
 * a first version of the owner rules; `ownerOf` (task 5) takes this over.
 */
import { isTweenConfigKey } from "@hyperframes/parsers/gsap-constants";
import { findTimelineScript, parseGsapScriptAcornForWrite, type TweenCallInfo } from "@hyperframes/parsers/gsap-parser-acorn";

export type OwnerKind = "source" | "dial" | "token" | "script";
export type OwnerCounts = Record<OwnerKind, number>;

export interface ProbeCounts {
  readonly tweens: number;
  readonly start: OwnerCounts;
  /** Tweens with a duration. A `set` has none and is not counted. */
  readonly duration: OwnerCounts;
  /** Every value at a diamond: from-values, to-values and each keyframe step. */
  readonly values: OwnerCounts;
  readonly stagger: OwnerCounts;
  /** Reason counts, keyed by the reason's first word. */
  readonly readOnly: Record<string, number>;
}

type AstNode = { type: string; [key: string]: any };

const LOOP_NODES = new Set(["ForStatement", "ForInStatement", "ForOfStatement", "WhileStatement", "DoWhileStatement"]);
const LOOP_METHODS = new Set(["forEach", "map", "filter", "reduce", "some", "every"]);
const FUNCTION_NODES = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);

const count = (): OwnerCounts => ({ source: 0, dial: 0, token: 0, script: 0 });

/** Inline scripts only, as the timeline finder reads them. */
const inlineScripts = (html: string): { textContent: string }[] =>
  [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)]
    .filter((match) => !/\bsrc\s*=/i.test(match[1]!))
    .map((match) => ({ textContent: match[2]! }));

/** The name of the first parameter of the `unframed.dials` apply function, if it has one. */
const dialParam = (ast: AstNode): string | null => {
  let apply: AstNode | null = null;
  walk(ast, (node) => {
    if (isDialsCall(node)) apply = node.arguments[2] ?? null;
  });
  if (!apply) return null;
  const fn = apply as AstNode;
  if (!FUNCTION_NODES.has(fn.type)) return null;
  const first = fn.params?.[0];
  return first?.type === "Identifier" ? first.name : null;
};

const isDialsCall = (node: AstNode): boolean =>
  node.type === "CallExpression" &&
  node.callee.type === "MemberExpression" &&
  node.callee.object.type === "Identifier" &&
  node.callee.object.name === "unframed" &&
  node.callee.property.name === "dials";

const walk = (node: unknown, visit: (node: AstNode) => void): void => {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) return node.forEach((child) => walk(child, visit));
  const current = node as AstNode;
  if (typeof current.type === "string") visit(current);
  for (const key of Object.keys(current)) {
    if (key === "start" || key === "end") continue;
    const child = current[key];
    if (child && typeof child === "object") walk(child, visit);
  }
};

/** First version of the owner rule: a literal, a dial path, a token call, or anything else. */
const ownerKindOf = (node: AstNode | undefined, param: string | null, relativeIsScript: boolean): OwnerKind => {
  if (!node) return "script";
  if (isNumber(node)) return "source";
  if (node.type === "Literal" && typeof node.value === "string") {
    return relativeIsScript && /^\s*([+\-*/]=|<|>)|random\(/.test(node.value) ? "script" : "source";
  }
  if (node.type === "MemberExpression" && param) {
    let root: AstNode = node;
    while (root.type === "MemberExpression") root = root.object;
    if (root.type === "Identifier" && root.name === param) return "dial";
  }
  if (
    node.type === "CallExpression" &&
    node.callee.type === "MemberExpression" &&
    node.callee.object.type === "Identifier" &&
    node.callee.object.name === "unframed" &&
    node.callee.property.name === "token"
  ) {
    return "token";
  }
  return "script";
};

const isNumber = (node: AstNode): boolean =>
  (node.type === "Literal" && typeof node.value === "number") ||
  (node.type === "UnaryExpression" && node.operator === "-" && node.argument.type === "Literal" && typeof node.argument.value === "number");

const propertyEntries = (object: AstNode | undefined): AstNode[] =>
  object?.type === "ObjectExpression" ? object.properties.filter((p: AstNode) => p.type === "Property") : [];

const keyName = (property: AstNode): string | null => {
  if (property.computed) return null;
  if (property.key.type === "Identifier") return property.key.name;
  if (property.key.type === "Literal") return String(property.key.value);
  return null;
};

/** A reason the tween is read-only in the first version: loops, helpers, and computed keyframes. */
const readOnlyReason = (call: TweenCallInfo, keyframesComputed: boolean, dialsFn: AstNode | null): string | null => {
  const ancestors = call.ancestors as AstNode[];
  if (ancestors.some((node) => LOOP_NODES.has(node.type))) return "loop";
  if (ancestors.some((node) => node.type === "CallExpression" && node.callee.type === "MemberExpression" && LOOP_METHODS.has(node.callee.property.name))) return "loop";
  if (ancestors.some((node) => FUNCTION_NODES.has(node.type) && node !== dialsFn)) return "helper";
  if (keyframesComputed) return "keyframes";
  return null;
};

export function probeMotion(html: string): ProbeCounts {
  const counts = { tweens: 0, start: count(), duration: count(), values: count(), stagger: count(), readOnly: {} as Record<string, number> };
  const script = findTimelineScript(inlineScripts(html));
  if (!script) return { ...counts, readOnly: {} };
  const parsed = parseGsapScriptAcornForWrite(script.textContent);
  if (!parsed) return { ...counts, readOnly: {} };
  const param = dialParam(parsed.ast);
  const dialsFn = dialsFunction(parsed.ast);

  for (const { call } of parsed.located) {
    const vars = call.varsArg as AstNode | undefined;
    const props = propertyEntries(vars);
    const keyframesNode = props.find((p) => keyName(p) === "keyframes")?.value as AstNode | undefined;
    counts.tweens += 1;

    const keyframeValues: AstNode[] = [];
    let keyframesComputed = false;
    if (keyframesNode?.type === "ObjectExpression") {
      for (const step of propertyEntries(keyframesNode)) if (step.value.type === "ObjectExpression") keyframeValues.push(...propertyEntries(step.value));
    } else if (keyframesNode) {
      keyframesComputed = true;
    }

    const reason = readOnlyReason(call, keyframesComputed, dialsFn);
    if (reason) counts.readOnly[reason] = (counts.readOnly[reason] ?? 0) + 1;

    const startNode = call.positionArg as AstNode | undefined;
    const isLabel = !startNode || (startNode.type === "Literal" && typeof startNode.value === "string");
    counts.start[isLabel ? "script" : ownerKindOf(startNode, param, true)] += 1;

    if (call.method !== "set") {
      const durationNode = props.find((p) => keyName(p) === "duration")?.value as AstNode | undefined;
      counts.duration[durationNode ? ownerKindOf(durationNode, param, false) : "source"] += 1;
    }

    const staggerNode = props.find((p) => keyName(p) === "stagger")?.value as AstNode | undefined;
    if (staggerNode) {
      const kind = staggerNode.type === "ObjectExpression" ? "source" : ownerKindOf(staggerNode, param, false);
      counts.stagger[kind] += 1;
    }

    const valueProps = [
      ...(call.method === "fromTo" && call.fromArg ? propertyEntries(call.fromArg as AstNode) : []),
      ...(call.method === "from" ? props : []),
      ...(call.method === "to" || call.method === "fromTo" || call.method === "set" ? props : []),
    ].filter((p) => !isTweenConfigKey(keyName(p) ?? "") && keyName(p) !== "keyframes" && keyName(p) !== "motionPath");
    for (const value of [...valueProps, ...keyframeValues]) {
      if (!value.value || isConfigKey(keyName(value))) continue;
      counts.values[ownerKindOf(value.value, param, true)] += 1;
    }
  }
  return counts;
}

const isConfigKey = (name: string | null): boolean => name !== null && (isTweenConfigKey(name) || name === "keyframes" || name === "motionPath" || name === "ease");

const dialsFunction = (ast: AstNode): AstNode | null => {
  let apply: AstNode | null = null;
  walk(ast, (node) => {
    if (isDialsCall(node)) apply = node.arguments[2] ?? null;
  });
  return apply;
};
