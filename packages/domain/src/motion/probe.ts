import { isTweenConfigKey } from "@hyperframes/parsers/gsap-constants";
import { findTimelineScript, parseGsapScriptAcornForWrite, type TweenCallInfo } from "@hyperframes/parsers/gsap-parser-acorn";
import { dialsCallback, ownerContextFor, ownerOf, FUNCTION_NODES, LOOP_METHODS, LOOP_NODES, keyName, propertiesOf, type OwnerContext, type ScriptNode } from "./owners.ts";
import { inlineScripts } from "./dom.ts";

type OwnerKind = "source" | "dial" | "token" | "script";
type OwnerCounts = Record<OwnerKind, number>;

export interface ProbeCounts {
  readonly tweens: number;
  readonly start: OwnerCounts;
  readonly duration: OwnerCounts;
  readonly values: OwnerCounts;
  readonly stagger: OwnerCounts;
  readonly readOnly: Record<string, number>;
}

type AstNode = { type: string; [key: string]: any };


const count = (): OwnerCounts => ({ source: 0, dial: 0, token: 0, script: 0 });

const ownerKindOf = (node: AstNode | undefined, context: OwnerContext): OwnerKind =>
  node ? ownerOf(node as ScriptNode, context).kind : "script";

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
  const context = ownerContextFor(parsed.ast as ScriptNode, script.textContent);
  const dialsFn = dialsCallback(parsed.ast as ScriptNode)?.fn ?? null;

  for (const { call } of parsed.located) {
    const vars = call.varsArg as AstNode | undefined;
    const props = propertiesOf(vars);
    const keyframesNode = props.find((p) => keyName(p) === "keyframes")?.value as AstNode | undefined;
    counts.tweens += 1;

    const keyframeValues: AstNode[] = [];
    let keyframesComputed = false;
    if (keyframesNode?.type === "ObjectExpression") {
      for (const step of propertiesOf(keyframesNode)) if (step.value.type === "ObjectExpression") keyframeValues.push(...propertiesOf(step.value));
    } else if (keyframesNode) {
      keyframesComputed = true;
    }

    const reason = readOnlyReason(call, keyframesComputed, dialsFn);
    if (reason) counts.readOnly[reason] = (counts.readOnly[reason] ?? 0) + 1;

    const startNode = call.positionArg as AstNode | undefined;
    const isLabel = !startNode || (startNode.type === "Literal" && typeof startNode.value === "string");
    counts.start[isLabel ? "script" : ownerKindOf(startNode, context)] += 1;

    if (call.method !== "set") {
      const durationNode = props.find((p) => keyName(p) === "duration")?.value as AstNode | undefined;
      counts.duration[durationNode ? ownerKindOf(durationNode, context) : "source"] += 1;
    }

    const staggerNode = props.find((p) => keyName(p) === "stagger")?.value as AstNode | undefined;
    if (staggerNode) {
      const kind = staggerNode.type === "ObjectExpression" ? "source" : ownerKindOf(staggerNode, context);
      counts.stagger[kind] += 1;
    }

    const valueProps = [
      ...(call.method === "fromTo" && call.fromArg ? propertiesOf(call.fromArg as AstNode) : []),
      ...(call.method === "from" ? props : []),
      ...(call.method === "to" || call.method === "fromTo" || call.method === "set" ? props : []),
    ].filter((p) => !isTweenConfigKey(keyName(p) ?? "") && keyName(p) !== "keyframes" && keyName(p) !== "motionPath");
    for (const value of [...valueProps, ...keyframeValues]) {
      if (!value.value || isConfigKey(keyName(value))) continue;
      counts.values[ownerKindOf(value.value, context)] += 1;
    }
  }
  return counts;
}

const isConfigKey = (name: string | null): boolean => name !== null && (isTweenConfigKey(name) || name === "keyframes" || name === "motionPath" || name === "ease");
