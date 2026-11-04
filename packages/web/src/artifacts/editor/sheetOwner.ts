import {
  styleOwner,
  variantConditions,
  type StyleDeclaration,
  type StyleRule,
  type StyleRuleRef,
  type VariantCondition,
} from "@unframed/domain";

export interface SheetRuleReport {
  readonly ref: StyleRuleRef;
  readonly declarations: ReadonlyArray<StyleDeclaration>;
  readonly unknown: boolean;
}

export type SheetField =
  | {
      readonly kind: "variants";
      readonly chip: string;
      readonly rule?: StyleRuleRef;
    }
  | {
      readonly kind: "token";
      readonly name: string;
      readonly rule: StyleRuleRef;
    }
  | { readonly kind: "script" };

const LONGHANDS: Readonly<Record<string, readonly string[]>> = {
  padding: ["padding-top", "padding-right", "padding-bottom", "padding-left"],
  margin: ["margin-top", "margin-right", "margin-bottom", "margin-left"],
  background: ["background-color"],
  border: ["border-width", "border-style", "border-color"],
  font: ["font-family", "font-size", "font-weight", "line-height"],
};

const COMPUTED = /\b(calc|min|max|clamp)\(/;

const conditionsText = (conditions: readonly VariantCondition[]): string =>
  conditions
    .map((condition) =>
      condition.value === null
        ? condition.name
        : `${condition.name}: ${condition.value}`,
    )
    .join(", ");

const chipOf = (
  conditions: readonly VariantCondition[],
  exceptions: readonly VariantCondition[],
): string => {
  if (conditions.length > 0) return conditionsText(conditions);
  return exceptions.length === 0
    ? "All variants"
    : `All variants, except ${conditionsText(exceptions)}`;
};

const expandRules = (
  rules: ReadonlyArray<SheetRuleReport>,
  expand: (shorthand: string, value: string, longhand: string) => string,
): StyleRule[] =>
  rules.map((rule) => ({
    ref: rule.ref,
    declarations: rule.declarations.flatMap((declaration) => [
      declaration,
      ...(LONGHANDS[declaration.property] ?? []).flatMap((longhand) => {
        const value = /var\(/.test(declaration.value)
          ? declaration.value
          : expand(declaration.property, declaration.value, longhand);
        return value === ""
          ? []
          : [{ property: longhand, value, important: declaration.important }];
      }),
    ]),
  }));

export const sheetFieldOf = (
  rules: ReadonlyArray<SheetRuleReport> | undefined,
  inline: Readonly<Record<string, string | null>>,
  property: string,
  expand: (shorthand: string, value: string, longhand: string) => string,
  kitNames: readonly string[] = [],
  overrides: ReadonlyArray<SheetRuleReport> = [],
): SheetField | null => {
  if (rules === undefined) return null;
  const expanded = expandRules(rules, expand);
  const unknown = new Set(
    rules.filter((rule) => rule.unknown).map((rule) => rule.ref.selector),
  );
  const declared: StyleDeclaration[] = Object.entries(inline).flatMap(
    ([name, value]) =>
      value === null ? [] : [{ property: name, value, important: false }],
  );
  const owner = styleOwner(expanded, declared, property, (selector) =>
    unknown.has(selector) ? "unknown" : true,
  );
  if (owner.owner === "script") return { kind: "script" };
  if (owner.owner !== "rule") return { kind: "variants", chip: "All variants" };
  if (COMPUTED.test(owner.value)) return { kind: "script" };
  const token = /^var\((--[A-Za-z0-9_-]+)(?:\s*,[\s\S]*)?\)$/.exec(
    owner.value.trim(),
  );
  if (token !== null && kitNames.includes(token[1]!))
    return { kind: "token", name: token[1]!, rule: owner.rule };
  const exceptions =
    owner.variants.length > 0
      ? []
      : takenOver(
          owner.rule,
          property,
          expanded,
          declared,
          expandRules(overrides, expand),
        );
  return {
    kind: "variants",
    chip: chipOf(owner.variants, exceptions),
    rule: owner.rule,
  };
};

const takenOver = (
  base: StyleRuleRef,
  property: string,
  rules: readonly StyleRule[],
  declared: readonly StyleDeclaration[],
  overrides: readonly StyleRule[],
): VariantCondition[] =>
  overrides
    .filter((override) =>
      override.declarations.some(
        (declaration) => declaration.property === property,
      ),
    )
    .filter((override) => {
      const won = styleOwner(
        [...rules, override],
        declared,
        property,
        () => true,
      );
      return (
        won.owner === "rule" &&
        won.rule.selector === override.ref.selector &&
        won.rule.occurrence === override.ref.occurrence &&
        base.selector !== override.ref.selector
      );
    })
    .flatMap((override) => variantConditions(override.ref.selector));
