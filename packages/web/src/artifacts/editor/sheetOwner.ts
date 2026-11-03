/**
 * Sheet owners (spec 20): which rule of a component sheet sets a Design field on a picked board
 * copy. The bridge reports the rules that reach the copy in its cell; `styleOwner` picks the winner.
 */
import { styleOwner, type StyleDeclaration, type StyleRule, type StyleRuleRef } from "@unframed/domain";

/** A rule that reaches a board copy, as the bridge reports it. `unknown` marks a `:has()` rule the bridge cannot test. */
export interface SheetRuleReport {
  readonly ref: StyleRuleRef;
  readonly declarations: ReadonlyArray<StyleDeclaration>;
  readonly unknown: boolean;
}

/** What a Design field of a board copy is: the variants its value covers and, when a rule sets it, the rule. */
export type SheetField =
  | { readonly kind: "variants"; readonly chip: string; readonly rule?: StyleRuleRef }
  | { readonly kind: "token"; readonly name: string; readonly rule: StyleRuleRef }
  | { readonly kind: "script" };

/** The longhands a shorthand sets, so a rule's `padding: 8px` answers `padding-top`. */
const LONGHANDS: Readonly<Record<string, readonly string[]>> = {
  padding: ["padding-top", "padding-right", "padding-bottom", "padding-left"],
  margin: ["margin-top", "margin-right", "margin-bottom", "margin-left"],
  background: ["background-color"],
  border: ["border-width", "border-style", "border-color"],
  font: ["font-family", "font-size", "font-weight", "line-height"],
};

/** Values a Design field cannot show or edit: a function that computes at run time. */
const COMPUTED = /\b(calc|min|max|clamp)\(/;

/** The chip of a rule's variant conditions: `All variants` for none, else `kind: secondary`. */
const chipOf = (conditions: ReadonlyArray<{ readonly name: string; readonly value: string | null }>): string =>
  conditions.length === 0 ? "All variants" : conditions.map((condition) => (condition.value === null ? condition.name : `${condition.name}: ${condition.value}`)).join(", ");

/**
 * The owner of one property of a board copy. `null` for an element with no sheet rules to ask (a page's
 * element). Inline and no owner are the template's own style, so every variant: the `All variants` chip.
 */
export const sheetFieldOf = (
  rules: ReadonlyArray<SheetRuleReport> | undefined,
  inline: Readonly<Record<string, string | null>>,
  property: string,
  expand: (shorthand: string, value: string, longhand: string) => string,
  kitNames: readonly string[] = [],
): SheetField | null => {
  if (rules === undefined) return null;
  const expanded: StyleRule[] = rules.map((rule) => ({
    ref: rule.ref,
    declarations: rule.declarations.flatMap((declaration) => [
      declaration,
      ...(LONGHANDS[declaration.property] ?? []).flatMap((longhand) => {
        // A value with var() cannot be expanded by the browser until the kit resolves it, so it stands for the longhand as written.
        const value = /var\(/.test(declaration.value) ? declaration.value : expand(declaration.property, declaration.value, longhand);
        return value === "" ? [] : [{ property: longhand, value, important: declaration.important }];
      }),
    ]),
  }));
  const unknown = new Set(rules.filter((rule) => rule.unknown).map((rule) => rule.ref.selector));
  const declared: StyleDeclaration[] = Object.entries(inline).flatMap(([name, value]) => (value === null ? [] : [{ property: name, value, important: false }]));
  const owner = styleOwner(expanded, declared, property, (selector) => (unknown.has(selector) ? "unknown" : true));
  if (owner.owner === "script") return { kind: "script" };
  if (owner.owner !== "rule") return { kind: "variants", chip: "All variants" };
  if (COMPUTED.test(owner.value)) return { kind: "script" };
  const token = /^var\((--[A-Za-z0-9_-]+)(?:\s*,[\s\S]*)?\)$/.exec(owner.value.trim());
  if (token !== null && kitNames.includes(token[1]!)) return { kind: "token", name: token[1]!, rule: owner.rule };
  return { kind: "variants", chip: chipOf(owner.variants), rule: owner.rule };
};
