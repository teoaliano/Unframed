import type { SourceTreeElement } from "@unframed/contracts";

export const chainOf = (elements: readonly SourceTreeElement[], id: string): string[] => {
  const chain: string[] = [];
  let current: string | null = id;
  while (current !== null && chain.length < 1000) {
    chain.push(current);
    current = elements.find((element) => element.id === current)?.parent ?? null;
  }
  return chain;
};
