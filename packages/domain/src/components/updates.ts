import type { ComponentDeclaration } from "./sheet.ts";

export type InstanceUse = {
  readonly variants: Readonly<Record<string, string>>;
  readonly props: readonly string[];
  readonly slots: readonly string[];
};

type Shape = Pick<ComponentDeclaration, "variants" | "props" | "slots">;

const instances = (count: number): string => (count === 1 ? "1 instance" : `${count} instances`);

export const updateImpact = (from: Shape, to: Shape, uses: readonly InstanceUse[], title: string): string[] => {
  const sentences: string[] = [];

  for (const variant of Object.keys(from.variants)) {
    const kept = to.variants[variant];
    if (!kept) {
      const count = uses.filter((use) => Object.hasOwn(use.variants, variant)).length;
      sentences.push(`${title} no longer has the variant ${variant}. ${instances(count)} will ignore it.`);
      continue;
    }
    const fromDefault = from.variants[variant]?.[0] ?? "";
    const toDefault = kept[0] ?? "";
    for (const value of from.variants[variant] ?? []) {
      if (kept.includes(value)) continue;
      const count = uses.filter((use) => (Object.hasOwn(use.variants, variant) ? use.variants[variant] : fromDefault) === value).length;
      sentences.push(`${title} no longer has ${variant} "${value}". ${instances(count)} will show "${toDefault}".`);
    }
  }

  for (const name of Object.keys(from.props)) {
    if (Object.hasOwn(to.props, name)) continue;
    const count = uses.filter((use) => use.props.includes(name)).length;
    const lose = count === 1 ? `its ${name}` : `their ${name}`;
    sentences.push(`${title} no longer has the property ${name}. ${count === 1 ? "1 instance loses" : `${count} instances lose`} ${lose}.`);
  }

  for (const slot of from.slots) {
    if (to.slots.includes(slot)) continue;
    const count = uses.filter((use) => use.slots.includes(slot)).length;
    const named = slot === "" ? "the default slot" : `the slot ${slot}`;
    sentences.push(`${title} no longer has ${named}. Content in it will not show on ${instances(count)}.`);
  }

  return sentences;
};
