import type { ShapeKind } from "./canvasShapes.ts";
import type { RunsValue } from "./runsValue.ts";

export interface ResultFacts {
  readonly batchId: string;
  readonly cost: number | null;
  readonly batchExtraCost?: number | undefined;
}

export interface ToolbarShape {
  readonly id: string;
  readonly kind: ShapeKind;
  readonly ref?: string | undefined;
  readonly file?: string | undefined;
  readonly result?: ResultFacts | undefined;
  readonly generating?: boolean | undefined;
  readonly recipe?: { readonly runs: RunsValue } | undefined;
}

export interface ToolbarInput {
  readonly selected: ReadonlyArray<ToolbarShape>;
  readonly usable: boolean;
  readonly results: ReadonlyArray<ToolbarShape>;
}

export type ToolbarState =
  | { readonly kind: "none" }
  | { readonly kind: "result"; readonly shapeId: string; readonly generate: boolean }
  | { readonly kind: "generating"; readonly shapeId: string }
  | { readonly kind: "open"; readonly shapeId: string }
  | { readonly kind: "generate"; readonly hint: string }
  | { readonly kind: "recipe"; readonly groupId: string; readonly name: string; readonly runs: RunsValue }
  | { readonly kind: "agent" };

export const recipeGroupOf = (selected: ReadonlyArray<ToolbarShape>): ToolbarShape | undefined => {
  const groups = selected.filter((shape) => shape.kind === "group" && shape.recipe !== undefined);
  return groups.length === 1 ? groups[0] : undefined;
};

export const formatCost = (cost: number): string => `$${cost.toFixed(4)}`;

export const selectionHint = (selected: ReadonlyArray<ToolbarShape>, results: ReadonlyArray<ToolbarShape>): string => {
  const [only] = selected;
  if (selected.length === 1 && only?.kind === "group" && only.ref !== undefined) return `@${only.ref}`;
  return batchHint(selected, results) ?? `${selected.length} selected`;
};

export const batchHint = (selected: ReadonlyArray<ToolbarShape>, results: ReadonlyArray<ToolbarShape>): string | undefined => {
  const batchId = selected[0]?.result?.batchId;
  if (selected.length < 2 || batchId === undefined || !selected.every((shape) => shape.result?.batchId === batchId)) return undefined;
  const members = results.filter((shape) => shape.result?.batchId === batchId);
  const chosen = new Set(selected.map((shape) => shape.id));
  if (members.length !== selected.length || !members.every((shape) => chosen.has(shape.id))) return undefined;
  const costs = selected.map((shape) => shape.result!.cost).filter((cost): cost is number => cost !== null);
  const extra = selected.find((shape) => shape.result?.batchExtraCost !== undefined)?.result?.batchExtraCost ?? 0;
  if (costs.length === 0) return `${selected.length} images`;
  return `${selected.length} images · ${formatCost(costs.reduce((sum, cost) => sum + cost, 0) + extra)}`;
};

export const toolbarState = (input: ToolbarInput): ToolbarState => {
  const { selected } = input;
  if (selected.length === 0) return { kind: "none" };
  const [only] = selected;
  if (selected.length === 1 && only) {
    if (only.result) {
      if (only.generating) return { kind: "generating", shapeId: only.id };
      return { kind: "result", shapeId: only.id, generate: input.usable };
    }
    if ((only.kind === "page" || only.kind === "motion" || only.kind === "component") && only.file) return { kind: "open", shapeId: only.id };
  }
  const recipeGroup = recipeGroupOf(selected);
  if (recipeGroup?.recipe) return { kind: "recipe", groupId: recipeGroup.id, name: recipeGroup.ref ?? "", runs: recipeGroup.recipe.runs };
  if (input.usable) return { kind: "generate", hint: selectionHint(selected, input.results) };
  return { kind: "agent" };
};

export const modelPart = (model: string): string => {
  const slash = model.indexOf("/");
  return slash < 0 ? model : model.slice(slash + 1);
};

export const resultLine = (facts: {
  readonly model: string;
  readonly width?: number | undefined;
  readonly height?: number | undefined;
  readonly cost: number | null;
}): string =>
  [
    modelPart(facts.model),
    ...(facts.width !== undefined && facts.height !== undefined ? [`${facts.width}×${facts.height}`] : []),
    ...(facts.cost === null ? [] : [formatCost(facts.cost)]),
  ].join(" · ");
