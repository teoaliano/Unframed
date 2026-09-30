import type { ShapeKind } from "./canvasShapes.ts";
import type { RunsValue } from "./runsValue.ts";

/** The facts of a result's meta the toolbar reads. */
export interface ResultFacts {
  readonly batchId: string;
  readonly cost: number | null;
  readonly batchExtraCost?: number | undefined;
}

/** One selected shape, as the toolbar sees it. */
export interface ToolbarShape {
  readonly id: string;
  readonly kind: ShapeKind;
  /** A group's name. */
  readonly ref?: string | undefined;
  /** A page's or motion's file. */
  readonly file?: string | undefined;
  /** Present on a result: a shape with result meta. */
  readonly result?: ResultFacts | undefined;
  /** The shape carries a run marker. */
  readonly generating?: boolean | undefined;
  readonly textResult?: boolean | undefined;
  /** Present on a group with a standing recipe (spec 06): how many outputs it makes. */
  readonly recipe?: { readonly runs: RunsValue } | undefined;
}

export interface ToolbarInput {
  /** The selection as tldraw counts it: a group is one shape. */
  readonly selected: ReadonlyArray<ToolbarShape>;
  /** From the composition of the selection. */
  readonly usable: boolean;
  /** Every result on the canvas, for the batch hint. */
  readonly results: ReadonlyArray<ToolbarShape>;
}

export type ToolbarState =
  | { readonly kind: "none" }
  /** Regenerate (primary), Vary, Recipe. A result whose own run marker is set is `generating` instead. */
  | { readonly kind: "result"; readonly shapeId: string; readonly vary: boolean }
  | { readonly kind: "generating"; readonly shapeId: string }
  | { readonly kind: "open"; readonly shapeId: string }
  | { readonly kind: "generate"; readonly hint: string }
  /** Spec 06: exactly one recipe group among the selection. Its Generate runs the recipe at once. */
  | { readonly kind: "recipe"; readonly groupId: string; readonly name: string; readonly runs: RunsValue }
  | { readonly kind: "agent" };

/** The one recipe group among `selected`, when there is exactly one: its recipe applies to the run. */
export const recipeGroupOf = (selected: ReadonlyArray<ToolbarShape>): ToolbarShape | undefined => {
  const groups = selected.filter((shape) => shape.kind === "group" && shape.recipe !== undefined);
  return groups.length === 1 ? groups[0] : undefined;
};

export const formatCost = (cost: number): string => `$${cost.toFixed(4)}`;

/**
 * What a selection is called on the toolbar and above the composer's box: `@<name>` for
 * exactly one group, `<n> images · $<total>` for exactly every member of one batch of two
 * or more, otherwise `<n> selected`.
 */
export const selectionHint = (selected: ReadonlyArray<ToolbarShape>, results: ReadonlyArray<ToolbarShape>): string => {
  const [only] = selected;
  if (selected.length === 1 && only?.kind === "group" && only.ref !== undefined) return `@${only.ref}`;
  return batchHint(selected, results) ?? `${selected.length} selected`;
};

/**
 * `<n> images · $<total>` when the selection is exactly every result on the canvas sharing
 * one batch id, and there are at least two: the members' costs plus the batch's extra cost
 * (a Free batch's repair call) once. Without any known cost, `<n> images`.
 */
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

/** The selection toolbar's buttons, decided from the selection. */
export const toolbarState = (input: ToolbarInput): ToolbarState => {
  const { selected } = input;
  if (selected.length === 0) return { kind: "none" };
  const [only] = selected;
  if (selected.length === 1 && only) {
    if (only.result) {
      if (only.generating) return { kind: "generating", shapeId: only.id };
      return { kind: "result", shapeId: only.id, vary: !only.textResult };
    }
    if ((only.kind === "page" || only.kind === "motion") && only.file) return { kind: "open", shapeId: only.id };
  }
  const recipeGroup = recipeGroupOf(selected);
  if (recipeGroup?.recipe) return { kind: "recipe", groupId: recipeGroup.id, name: recipeGroup.ref ?? "", runs: recipeGroup.recipe.runs };
  if (input.usable) return { kind: "generate", hint: selectionHint(selected, input.results) };
  return { kind: "agent" };
};

/** The model slug after its first `/`: how a model is named on chips, rows and result lines. */
export const modelPart = (model: string): string => {
  const slash = model.indexOf("/");
  return slash < 0 ? model : model.slice(slash + 1);
};

/** The line under a selected result: `<model part> · <W>×<H> · $<cost>`, missing parts left out. */
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
