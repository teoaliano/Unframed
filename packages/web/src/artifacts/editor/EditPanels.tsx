/** Helpers the editor's Design and Layers tabs share (spec 18). */
import type { SourceTreeElement } from "@unframed/contracts";

/** The chain of an element's ancestors in the source, the element first. */
export const chainOf = (elements: readonly SourceTreeElement[], id: string): string[] => {
  const chain: string[] = [];
  let current: string | null = id;
  while (current !== null && chain.length < 1000) {
    chain.push(current);
    current = elements.find((element) => element.id === current)?.parent ?? null;
  }
  return chain;
};
