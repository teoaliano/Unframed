/**
 * The timeline reading (spec 21): what the editor may change in one motion file, read once from
 * its timeline script with HyperFrames' write parser. Each value is read from its own node and
 * given an owner by `ownerOf`; anything the timeline cannot edit carries a sentence saying why.
 * This module answers questions only. Edits are `applyMotionEdits` (task 10 onward).
 */
import { isTweenConfigKey, type PropertyGroupName } from "@hyperframes/parsers/gsap-constants";
import { findTimelineScript, parseGsapScriptAcornForWrite, type TweenCallInfo } from "@hyperframes/parsers/gsap-parser-acorn";
import { dialsCallback, ownerOf, type Owner, type OwnerContext, type ScriptNode } from "./owners.ts";

export type PropertyGroup = PropertyGroupName;
export type TweenMethod = "to" | "from" | "fromTo" | "set";

export interface TweenRef {
  /** Source order in the timeline script. Value edits do not change it. */
  readonly index: number;
  /** HyperFrames' animation id as the file has it now. */
  readonly id: string;
}

export interface KeyframeValues {
  /** Where the diamond sits, 0 to 1 within the tween. */
  readonly at: number;
  readonly values: Readonly<Record<string, Owner>>;
  readonly ease: Owner | null;
}

export interface Tween {
  readonly ref: TweenRef;
  readonly method: TweenMethod;
  /** `data-hf-id` of each target in document order. Filled from the document in task 7. */
  readonly targets: readonly string[];
  readonly groups: readonly PropertyGroup[];
  readonly start: Owner;
  readonly duration: Owner;
  readonly ease: Owner | null;
  readonly stagger: Owner | null;
  readonly repeat: { readonly count: number | null; readonly yoyo: boolean } | null;
  readonly keyframes: readonly KeyframeValues[];
  readonly readOnly: string | null;
  /** The call as written, cut to 300 characters. */
  readonly source: string;
}

export interface MotionTimeline {
  readonly file: string;
  readonly script: "ok" | "none" | "unreadable";
  readonly tweens: readonly Tween[];
}

export interface MotionTimelineOptions {
  readonly file?: string;
}

const SOURCE_CUT = 300;
const LOOP_METHODS = new Set(["forEach", "map", "filter", "reduce", "some", "every"]);
const LOOP_NODES = new Set(["ForStatement", "ForInStatement", "ForOfStatement", "WhileStatement", "DoWhileStatement"]);
const FUNCTION_NODES = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);
const NOT_VALUES = new Set(["keyframes", "motionPath", "ease", "duration", "delay"]);

/** Inline scripts only, in document order, as the timeline finder reads them. */
const inlineScripts = (html: string): { textContent: string }[] =>
  [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)]
    .filter((match) => !/\bsrc\s*=/i.test(match[1]!))
    .map((match) => ({ textContent: match[2]! }));

const isValueKey = (key: string | null): key is string => key !== null && !isTweenConfigKey(key) && !NOT_VALUES.has(key);

const keyOf = (property: ScriptNode): string | null => {
  if (property.computed) return property.key.type === "Literal" ? String(property.key.value) : null;
  if (property.key.type === "Identifier") return property.key.name;
  if (property.key.type === "Literal") return String(property.key.value);
  return null;
};

const propertiesOf = (node: ScriptNode | undefined | null): ScriptNode[] =>
  node?.type === "ObjectExpression" ? node.properties.filter((p: ScriptNode) => p.type === "Property") : [];

/** The value owners of an object's own properties, configuration keys left out. */
const valuesOf = (node: ScriptNode | undefined | null, context: OwnerContext): Record<string, Owner> => {
  const values: Record<string, Owner> = {};
  for (const property of propertiesOf(node)) {
    const key = keyOf(property);
    if (isValueKey(key)) values[key] = ownerOf(property.value, context);
  }
  return values;
};

const percentage = (key: string): number | null => {
  const match = /^(\d+(?:\.\d+)?)%$/.exec(key);
  return match ? Number(match[1]) / 100 : null;
};

/** A keyframes object or array, as one entry per step. Null when it is not a literal shape. */
const keyframeSteps = (node: ScriptNode, context: OwnerContext): KeyframeValues[] | null => {
  if (node.type === "ObjectExpression") {
    const steps: KeyframeValues[] = [];
    for (const property of propertiesOf(node)) {
      const at = percentage(keyOf(property) ?? "");
      if (at === null || property.value.type !== "ObjectExpression") return null;
      steps.push(stepOf(property.value, at, context));
    }
    return steps;
  }
  if (node.type === "ArrayExpression") {
    const count = node.elements.length;
    return node.elements.map((element: ScriptNode, index: number) => {
      if (element.type !== "ObjectExpression") return null;
      return stepOf(element, count > 1 ? index / (count - 1) : 1, context);
    }).filter((step: KeyframeValues | null): step is KeyframeValues => step !== null);
  }
  return null;
};

const stepOf = (node: ScriptNode, at: number, context: OwnerContext): KeyframeValues => {
  const ease = propertiesOf(node).find((p) => keyOf(p) === "ease");
  return { at, values: valuesOf(node, context), ease: ease ? ownerOf(ease.value, context) : null };
};

const ownersAreFixed = (steps: readonly KeyframeValues[]): boolean =>
  steps.every((step) => Object.values(step.values).every((owner) => owner.kind !== "script"));

const sourceOf = (call: TweenCallInfo, source: string): string => {
  const node = call.node as ScriptNode;
  return source.slice(node.start, node.end).slice(0, SOURCE_CUT);
};

const readOnlyReason = (
  call: TweenCallInfo,
  keyframes: ScriptNode | undefined,
  steps: KeyframeValues[] | null,
  dialsFn: ScriptNode | null,
): string | null => {
  const ancestors = call.ancestors as ScriptNode[];
  if (ancestors.some((node) => LOOP_NODES.has(node.type))) return "It runs in a loop.";
  if (ancestors.some((node) => node.type === "CallExpression" && node.callee.type === "MemberExpression" && LOOP_METHODS.has(node.callee.property.name))) {
    return "It runs in a loop.";
  }
  if (ancestors.some((node) => FUNCTION_NODES.has(node.type) && node !== dialsFn)) return "It is built by a helper.";
  if (keyframes && (steps === null || !ownersAreFixed(steps))) return "Its keyframes are computed.";
  const vars = call.varsArg as ScriptNode | undefined;
  if (propertiesOf(vars).some((p) => keyOf(p) === "motionPath")) return "It follows a motion path.";
  return null;
};

type Repeat = { readonly count: number | null; readonly yoyo: boolean } | null;

const repeatOf = (vars: ScriptNode | undefined): Repeat => {
  const props = propertiesOf(vars);
  const repeat = props.find((p) => keyOf(p) === "repeat")?.value as ScriptNode | undefined;
  const yoyo = props.find((p) => keyOf(p) === "yoyo")?.value as ScriptNode | undefined;
  if (!repeat && !yoyo) return null;
  let count: number | null = null;
  if (repeat?.type === "Literal" && typeof repeat.value === "number") count = repeat.value;
  if (repeat?.type === "UnaryExpression" && repeat.operator === "-" && repeat.argument.type === "Literal" && typeof repeat.argument.value === "number") {
    count = -repeat.argument.value;
  }
  return { count, yoyo: yoyo?.type === "Literal" && yoyo.value === true };
};

const tweenOf = (
  call: TweenCallInfo,
  index: number,
  id: string,
  context: OwnerContext,
  source: string,
  dialsFn: ScriptNode | null,
): Tween => {
  const vars = call.varsArg as ScriptNode | undefined;
  const props = propertiesOf(vars);
  const find = (name: string) => props.find((p) => keyOf(p) === name)?.value as ScriptNode | undefined;
  const keyframesNode = find("keyframes");
  const steps = keyframesNode ? keyframeSteps(keyframesNode, context) : null;

  let keyframes: KeyframeValues[];
  if (keyframesNode) {
    keyframes = steps ?? [];
  } else if (call.method === "fromTo") {
    keyframes = [
      { at: 0, values: valuesOf(call.fromArg as ScriptNode, context), ease: null },
      { at: 1, values: valuesOf(vars, context), ease: null },
    ];
  } else if (call.method === "from") {
    keyframes = [{ at: 0, values: valuesOf(vars, context), ease: null }];
  } else {
    keyframes = [{ at: 1, values: valuesOf(vars, context), ease: null }];
  }

  const durationNode = find("duration");
  const durationOwner: Owner = call.method === "set"
    ? { kind: "source", value: 0 }
    : durationNode
      ? ownerOf(durationNode, context)
      : { kind: "source", value: 0.5 };
  const positionNode = call.positionArg as ScriptNode | undefined;
  const startOwner: Owner = positionNode ? startOf(positionNode, context) : { kind: "script", text: "" };
  const easeNode = find("ease");

  return {
    ref: { index, id },
    method: call.method,
    targets: [],
    groups: [],
    start: startOwner,
    duration: durationOwner,
    ease: easeNode ? ownerOf(easeNode, context) : null,
    stagger: null,
    repeat: repeatOf(vars),
    keyframes,
    readOnly: readOnlyReason(call, keyframesNode, steps, dialsFn),
    source: sourceOf(call, source),
  };
};

/** A start is a number. A label or a string is not a value the timeline can move, so it is script. */
const startOf = (node: ScriptNode, context: OwnerContext): Owner => {
  const owner = ownerOf(node, context);
  if (owner.kind === "source" && typeof owner.value !== "number") return { kind: "script", text: context.source.slice(node.start, node.end) };
  return owner;
};

export function motionTimeline(html: string, options: MotionTimelineOptions = {}): MotionTimeline {
  const file = options.file ?? "";
  const script = findTimelineScript(inlineScripts(html));
  if (!script) return { file, script: "none", tweens: [] };
  const parsed = parseGsapScriptAcornForWrite(script.textContent);
  if (!parsed) return { file, script: "unreadable", tweens: [] };
  const text = script.textContent;
  const callback = dialsCallback(parsed.ast as ScriptNode);
  const context: OwnerContext = { source: text, dial: callback?.scope ?? null };
  const dialsFn = callback?.fn ?? null;
  const tweens = parsed.located.map((entry, index) => tweenOf(entry.call, index, entry.id, context, text, dialsFn));
  return { file, script: "ok", tweens };
}

