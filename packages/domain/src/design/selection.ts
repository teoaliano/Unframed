export interface LayerTree {
  readonly parentOf: (id: string) => string | null;
  readonly childrenOf: (id: string) => ReadonlyArray<string>;
}

export interface DesignPickInput {
  readonly levels: ReadonlyArray<{ readonly id: string | null }>;
  readonly selection: ReadonlyArray<string>;
  readonly depth: number | null;
  readonly clicks: number;
  readonly deepest: boolean;
  readonly additive: boolean;
}

export const designPick = (input: DesignPickInput): string[] => {
  const ids = input.levels.map((level) => level.id).filter((id): id is string => id !== null);
  if (ids.length === 0) return input.additive ? [...input.selection] : [];
  let at = -1;
  ids.forEach((id, index) => {
    if (input.selection.includes(id)) at = index;
  });
  const last = ids.length - 1;
  const index = input.deepest ? last : input.clicks >= 2 ? Math.min(at >= 0 ? at + 1 : input.depth === null ? 0 : input.depth + 1, last) : at >= 0 ? at : Math.min(input.depth ?? 0, last);
  const target = ids[index]!;
  if (!input.additive) return [target];
  return input.selection.includes(target) ? input.selection.filter((id) => id !== target) : [...input.selection, target];
};

const unique = (ids: ReadonlyArray<string>): string[] => [...new Set(ids)];

export const selectParent = (selection: ReadonlyArray<string>, tree: LayerTree): string[] => unique(selection.map((id) => tree.parentOf(id) ?? id));

export const selectChildren = (selection: ReadonlyArray<string>, tree: LayerTree): string[] =>
  unique(
    selection.flatMap((id) => {
      const children = tree.childrenOf(id);
      return children.length === 0 ? [id] : children;
    }),
  );

export const ancestorsOf = (id: string, tree: LayerTree): string[] => {
  const out: string[] = [];
  const seen = new Set([id]);
  let next = tree.parentOf(id);
  while (next !== null && !seen.has(next)) {
    out.push(next);
    seen.add(next);
    next = tree.parentOf(next);
  }
  return out;
};

export const depthOf = (id: string, tree: LayerTree): number => ancestorsOf(id, tree).length;
