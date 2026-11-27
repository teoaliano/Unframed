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

export const designPick = (input: DesignPickInput): string[] => [...input.selection];

export const selectParent = (selection: ReadonlyArray<string>, _tree: LayerTree): string[] => [...selection];

export const selectChildren = (selection: ReadonlyArray<string>, _tree: LayerTree): string[] => [...selection];

export const ancestorsOf = (_id: string, _tree: LayerTree): string[] => [];

export const depthOf = (id: string, tree: LayerTree): number => ancestorsOf(id, tree).length;
