import { isTweenConfigKey } from "@hyperframes/parsers/gsap-constants";
import { ensureHfIds } from "@hyperframes/parsers/hf-ids";
import { findTimelineScript, parseGsapScriptAcornForWrite, type TweenCallInfo } from "@hyperframes/parsers/gsap-parser-acorn";
import { parseHTML } from "linkedom";
import { carryOf, type Carry } from "./carry.ts";
import { groupOfKey, type Clip, type ElementInfo, type KeyframeValues, type MotionTimeline, type MotionTimelineOptions, type PropertyGroup, type RuntimeClips, type StaggerForm, type Tween, type TweenMethod, type TweenRef } from "./types.ts";

export * from "./types.ts";
import { dialsCallback, ownerOf, constantNumber, type Owner, type OwnerContext, type ScriptNode } from "./owners.ts";

const GROUP_ORDER: readonly PropertyGroup[] = ["position", "scale", "size", "rotation", "visual", "other"];
const SOURCE_CUT = 300;
const LOOP_METHODS = new Set(["forEach", "map", "filter", "reduce", "some", "every"]);
const LOOP_NODES = new Set(["ForStatement", "ForInStatement", "ForOfStatement", "WhileStatement", "DoWhileStatement"]);
const FUNCTION_NODES = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);
const NOT_VALUES = new Set(["keyframes", "motionPath", "ease", "duration", "delay"]);

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
  unresolved: boolean,
): string | null => {
  const ancestors = call.ancestors as ScriptNode[];
  if (ancestors.some((node) => LOOP_NODES.has(node.type))) return "It runs in a loop.";
  if (ancestors.some((node) => node.type === "CallExpression" && node.callee.type === "MemberExpression" && LOOP_METHODS.has(node.callee.property.name))) {
    return "It runs in a loop.";
  }
  if (ancestors.some((node) => FUNCTION_NODES.has(node.type) && node !== dialsFn)) return "It is built by a helper.";
  if (unresolved) return "Its target is found while the motion runs.";
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

const staggerOf = (vars: ScriptNode | undefined, context: OwnerContext): { owner: Owner | null; form: StaggerForm | null } => {
  const node = propertiesOf(vars).find((p) => keyOf(p) === "stagger")?.value as ScriptNode | undefined;
  if (!node) return { owner: null, form: null };
  if (node.type !== "ObjectExpression") {
    return { owner: ownerOf(node, context), form: constantNumber(node) === null && ownerOf(node, context).kind !== "source" ? "other" : "number" };
  }
  const keys = propertiesOf(node).map(keyOf);
  const spacing = propertiesOf(node).find((p) => keyOf(p) === "each" || keyOf(p) === "amount");
  const timingOnly = keys.length === 1 && spacing !== undefined;
  if (!timingOnly) return { owner: { kind: "script", text: context.source.slice(node.start, node.end) }, form: "other" };
  const form: StaggerForm = keyOf(spacing!) === "amount" ? "amount" : "each";
  const owner = ownerOf(spacing!.value, context);
  return owner.kind === "source" ? { owner, form } : { owner, form: "other" };
};

export function staggerOffsets(tween: Tween, targetCount = tween.targets.length): number[] {
  const offsets = Array.from({ length: targetCount }, () => 0);
  const owner = tween.stagger;
  if (!owner || owner.kind !== "source" || typeof owner.value !== "number" || tween.staggerForm === null || tween.staggerForm === "other") return offsets;
  const value = owner.value;
  return offsets.map((_, index) => {
    if (tween.staggerForm === "amount") return targetCount > 1 ? (index * value) / (targetCount - 1) : 0;
    return index * value;
  });
}

const groupsOf = (keyframes: readonly KeyframeValues[]): PropertyGroup[] => {
  const seen = new Set<PropertyGroup>();
  for (const step of keyframes) for (const key of Object.keys(step.values)) seen.add(groupOfKey(key));
  return GROUP_ORDER.filter((group) => seen.has(group));
};

const tweenOf = (
  call: TweenCallInfo,
  index: number,
  id: string,
  context: OwnerContext,
  source: string,
  dialsFn: ScriptNode | null,
  targets: readonly string[],
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

  const stagger = staggerOf(vars, context);
  return {
    ref: { index, id },
    method: call.method,
    targets,
    groups: groupsOf(keyframes),
    start: startOwner,
    duration: durationOwner,
    ease: easeNode ? ownerOf(easeNode, context) : null,
    stagger: stagger.owner,
    staggerForm: stagger.form,
    repeat: repeatOf(vars),
    keyframes,
    readOnly: readOnlyReason(call, keyframesNode, steps, dialsFn, targets.length === 0),
    source: sourceOf(call, source),
  };
};

const startOf = (node: ScriptNode, context: OwnerContext): Owner => {
  const owner = ownerOf(node, context);
  if (owner.kind === "source" && typeof owner.value !== "number") return { kind: "script", text: context.source.slice(node.start, node.end) };
  return owner;
};

const targetsOf = (document: Doc, selector: string, partial: boolean): string[] => {
  if (partial || !selector || selector.startsWith("__")) return [];
  try {
    return [...document.querySelectorAll(selector)].map((element) => element.getAttribute("data-hf-id") ?? "").filter((id) => id !== "");
  } catch {
    return [];
  }
};

const NUMBER_TEXT = /^-?\d+(\.\d+)?$/;

const attributeOwner = (text: string | null): Owner => {
  const value = text ?? "";
  return NUMBER_TEXT.test(value.trim()) ? { kind: "source", value: Number(value) } : { kind: "script", text: value };
};

interface El {
  readonly id: string;
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
  readonly parentElement: El | null;
}
interface Doc {
  querySelector(selector: string): El | null;
  querySelectorAll(selector: string): El[];
}

const ancestorsOf = (element: El): El[] => {
  const chain: El[] = [];
  let current: El | null = element;
  while (current) {
    chain.push(current);
    current = current.parentElement ?? null;
  }
  return chain;
};

const compositionOf = (document: Doc, options: MotionTimelineOptions) => {
  const root = document.querySelector("[data-composition-id]");
  const elements: Record<string, ElementInfo> = {};
  const clipElements = root
    ? [...document.querySelectorAll("[data-start]")].filter((el) => el !== root && ancestorsOf(el).includes(root))
    : [];
  const isClip = new Set(clipElements);
  const idOf = (element: El) => element.getAttribute("data-hf-id") ?? "";
  for (const element of document.querySelectorAll("[data-hf-id]")) {
    const chain = ancestorsOf(element as El).slice(1);
    const parent = chain.find((ancestor) => ancestor.hasAttribute("data-hf-id"));
    const clip = [element as El, ...chain].find((candidate) => isClip.has(candidate));
    elements[idOf(element as El)] = {
      name: ((element as El).getAttribute("data-uf-name") ?? "").trim() || (element as El).id || idOf(element as El),
      parent: parent ? idOf(parent) : null,
      clip: clip ? idOf(clip) : null,
    };
  }
  const clips = clipElements.map((element): Omit<Clip, "carry"> => {
    const hfId = idOf(element);
    const id = element.id || hfId;
    const start = attributeOwner(element.getAttribute("data-start"));
    const duration = attributeOwner(element.getAttribute("data-duration"));
    const runtime = options.runtime?.[id];
    const sourceStart = start.kind === "source" && typeof start.value === "number" ? start.value : null;
    const sourceDuration = duration.kind === "source" && typeof duration.value === "number" ? duration.value : null;
    return {
      hfId,
      id,
      track: Number(element.getAttribute("data-track-index") ?? 0) || 0,
      start: runtime && sourceStart !== null && runtime.start !== sourceStart ? { kind: "script", text: String(sourceStart) } : start,
      duration: runtime && sourceDuration !== null && runtime.duration !== sourceDuration ? { kind: "script", text: String(sourceDuration) } : duration,
    };
  });
  const length = root ? attributeOwner(root.getAttribute("data-duration")) : { kind: "script" as const, text: "" };
  return { elements, clips, length, root: root ? idOf(root) : null };
};

export function motionTimeline(html: string, options: MotionTimelineOptions = {}): MotionTimeline {
  const file = options.file ?? "";
  const stamped = ensureHfIds(html);
  const document = (parseHTML(stamped) as unknown as { document: Doc }).document;
  const { elements, clips: bareClips, length, root: rootId } = compositionOf(document, options);
  const script = findTimelineScript(inlineScripts(html));
  const parsed = script ? parseGsapScriptAcornForWrite(script.textContent) : null;
  let tweens: Tween[] = [];
  let state: MotionTimeline["script"] = "none";
  if (script && !parsed) state = "unreadable";
  if (script && parsed) {
    state = "ok";
    const text = script.textContent;
    const callback = dialsCallback(parsed.ast as ScriptNode);
    const context: OwnerContext = { source: text, dial: callback?.scope ?? null };
    const dialsFn = callback?.fn ?? null;
    tweens = parsed.located.map((entry, index) =>
      tweenOf(entry.call, index, entry.id, context, text, dialsFn, targetsOf(document, entry.call.selector, entry.call.selectorPartial === true)),
    );
  }
  const placeholder: Carry = { tweens: [], dials: [] };
  const unfinished: Clip[] = bareClips.map((clip) => ({ ...clip, carry: placeholder }));
  const model = { clips: unfinished, tweens, elements };
  const clips = unfinished.map((clip) => ({ ...clip, carry: carryOf(model, clip) }));
  return { file, script: state, length, clips, tweens, elements, root: rootId };
}

