import type { StyleRuleRef } from "../kits/offTokens.ts";

export type StyleDeclaration = {
  readonly property: string;
  readonly value: string;
  readonly important: boolean;
};

export type StyleRule = {
  readonly ref: StyleRuleRef;
  readonly declarations: readonly StyleDeclaration[];
};

export type StyleMatch = boolean | "unknown";

export type VariantCondition = { readonly name: string; readonly value: string | null };

export type StyleOwner =
  | { readonly owner: "inline"; readonly value: string; readonly important: boolean }
  | {
      readonly owner: "rule";
      readonly rule: StyleRuleRef;
      readonly value: string;
      readonly important: boolean;
      readonly variants: readonly VariantCondition[];
    }
  | { readonly owner: "none" }
  | { readonly owner: "script" };

type Candidate = {
  readonly important: boolean;
  readonly inline: boolean;
  readonly specificity: readonly [number, number, number];
  readonly order: number;
  readonly value: string;
  readonly rule?: StyleRuleRef;
};

const compareCandidates = (a: Candidate, b: Candidate): number => {
  const keys = (candidate: Candidate): number[] => [
    candidate.important ? 1 : 0,
    candidate.inline ? 1 : 0,
    ...candidate.specificity,
    candidate.order,
  ];
  const left = keys(a);
  const right = keys(b);
  for (let index = 0; index < left.length; index++) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
};

export const specificity = (selector: string): readonly [number, number, number] => {
  let text = selector.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""').replace(/:where\([^()]*\)/g, " ");
  const ids = (text.match(/#[A-Za-z_-][\w-]*/g) ?? []).length;
  text = text.replace(/#[A-Za-z_-][\w-]*/g, " ");
  const classes = (text.match(/\.[A-Za-z_-][\w-]*/g) ?? []).length;
  text = text.replace(/\.[A-Za-z_-][\w-]*/g, " ");
  const attributes = (text.match(/\[[^\]]*\]/g) ?? []).length + classes;
  text = text.replace(/\[[^\]]*\]/g, " ");
  const pseudoElements = (text.match(/::[A-Za-z-]+/g) ?? []).length;
  text = text.replace(/::[A-Za-z-]+/g, " ");
  const pseudoClasses = (text.match(/:(?!is\(|not\(|has\()[A-Za-z-]+/g) ?? []).length;
  text = text.replace(/:(?!is\(|not\(|has\()[A-Za-z-]+/g, " ").replace(/[>+~,()*]/g, " ");
  const types = text.split(/\s+/).filter((token) => /^[A-Za-z][\w-]*$/.test(token)).length;
  return [ids, attributes + pseudoClasses, types + pseudoElements];
};

export const variantConditions = (selector: string): VariantCondition[] => {
  const conditions: VariantCondition[] = [];
  for (const host of selector.matchAll(/:host\(((?:[^()]|\([^()]*\))*)\)/g)) {
    for (const attribute of (host[1] ?? "").matchAll(/\[\s*([A-Za-z][\w-]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+)))?\s*\]/g)) {
      const value = attribute[2] ?? attribute[3] ?? attribute[4];
      conditions.push({ name: attribute[1]!, value: value ?? null });
    }
  }
  return conditions;
};

export const styleOwner = (
  rules: readonly StyleRule[],
  inline: readonly StyleDeclaration[],
  property: string,
  matches: (selector: string) => StyleMatch,
): StyleOwner => {
  const known: Candidate[] = [];
  const unknown: Candidate[] = [];
  let order = 0;

  inline.forEach((declaration) => {
    if (declaration.property !== property) return;
    known.push({ important: declaration.important, inline: true, specificity: [0, 0, 0], order: order++, value: declaration.value });
  });

  for (const rule of rules) {
    const selector = rule.ref.selector;
    const match: StyleMatch = /:has\(/.test(selector) ? "unknown" : matches(selector);
    const spec = specificity(selector);
    for (const declaration of rule.declarations) {
      order++;
      if (declaration.property !== property) continue;
      const candidate: Candidate = {
        important: declaration.important,
        inline: false,
        specificity: spec,
        order,
        value: declaration.value,
        rule: rule.ref,
      };
      if (match === true) known.push(candidate);
      else if (match === "unknown") unknown.push(candidate);
    }
  }

  let best: Candidate | undefined;
  for (const candidate of known) if (!best || compareCandidates(candidate, best) > 0) best = candidate;
  if (unknown.some((candidate) => !best || compareCandidates(candidate, best!) > 0)) return { owner: "script" };
  if (!best) return { owner: "none" };
  if (best.inline) return { owner: "inline", value: best.value, important: best.important };
  return {
    owner: "rule",
    rule: best.rule!,
    value: best.value,
    important: best.important,
    variants: variantConditions(best.rule!.selector),
  };
};

export type SheetOwnerInput = {
  readonly locked: boolean;
  readonly runtime: boolean;
  readonly token: string | null;
  readonly style: StyleOwner;
};

export type SheetOwner =
  | { readonly owner: "locked" }
  | { readonly owner: "script" }
  | { readonly owner: "token"; readonly token: string }
  | { readonly owner: "style"; readonly style: StyleOwner };

export const sheetOwner = (input: SheetOwnerInput): SheetOwner => {
  if (input.locked) return { owner: "locked" };
  if (input.runtime) return { owner: "script" };
  if (input.token !== null) return { owner: "token", token: input.token };
  return { owner: "style", style: input.style };
};
