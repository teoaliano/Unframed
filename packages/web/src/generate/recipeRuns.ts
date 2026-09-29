/**
 * A recipe group's one-click run (spec 06): the recipe's medium, model, params and runs,
 * the expanded selection as sources, no instruction. It is an ordinary run through the same
 * medium send as the composer, except that it leaves the last-used values alone. Its bar
 * counts what has settled from spec 03's run events.
 */
import { runMarkerOf } from "@unframed/contracts";
import { composeSelection, trayFromRecipe, type GroupRecipe } from "@unframed/domain";
import { atom, type Atom, type Editor, type TLShapeId } from "tldraw";
import type { EngineConnection } from "../rpc/engine.ts";
import { loadCatalogue } from "./catalogue.ts";
import { canvasShapes } from "./facts.ts";
import { stagedFree } from "./free.ts";
import { mediumDefinition, type RunSource, type TrayValues } from "./mediumRegistry.ts";
import { openComposer, setMedium } from "./state.ts";
import { VIEW_FINAL_PROMPT_KEY } from "./runsProp.tsx";

/** One batch's progress, from `run.subscribe`. */
export interface BatchProgress {
  readonly count: number;
  readonly settled: number;
  readonly finished: boolean;
}

const progress = new WeakMap<Editor, Atom<ReadonlyMap<string, BatchProgress>>>();

/** Every batch this canvas has seen start, by batch id. */
export const batchProgress = (editor: Editor): Atom<ReadonlyMap<string, BatchProgress>> => {
  let value = progress.get(editor);
  if (!value) {
    value = atom<ReadonlyMap<string, BatchProgress>>("batch progress", new Map());
    progress.set(editor, value);
  }
  return value;
};

/** Keeps `batchProgress` from the project's run events, for as long as the canvas is open. */
export const watchRunProgress = (editor: Editor, engine: EngineConnection, project: string): (() => void) => {
  const batchOf = new Map<string, string>();
  const change = (batchId: string, next: (current: BatchProgress) => BatchProgress) =>
    batchProgress(editor).update((all) => {
      const current = all.get(batchId);
      if (!current) return all;
      return new Map(all).set(batchId, next(current));
    });
  return engine.subscribe("run.subscribe", { project }, (event) => {
    if (event.type === "started") {
      batchOf.set(event.runId, event.batchId);
      batchProgress(editor).update((all) => new Map(all).set(event.batchId, { count: event.count, settled: 0, finished: false }));
      return;
    }
    const batchId = batchOf.get(event.runId);
    if (batchId === undefined) return;
    if (event.type === "output") change(batchId, (current) => ({ ...current, settled: Math.min(current.count, current.settled + 1) }));
    if (event.type === "finished") {
      batchOf.delete(event.runId);
      change(batchId, (current) => ({ ...current, settled: current.count, finished: true }));
    }
  });
};

/** What a recipe group's last one-click run started: a batch, or render placeholders (video). */
export type RecipeRun = { readonly batchId: string } | { readonly shapeIds: ReadonlyArray<string> };

const runs = new WeakMap<Editor, Atom<ReadonlyMap<string, RecipeRun>>>();

export const recipeRuns = (editor: Editor): Atom<ReadonlyMap<string, RecipeRun>> => {
  let value = runs.get(editor);
  if (!value) {
    value = atom<ReadonlyMap<string, RecipeRun>>("recipe runs", new Map());
    runs.set(editor, value);
  }
  return value;
};

/** `{ settled, total }` while the run group `groupId` started from its bar is going; otherwise undefined. */
export const recipeRunProgress = (editor: Editor, groupId: string): { readonly settled: number; readonly total: number } | undefined => {
  const run = recipeRuns(editor).get().get(groupId);
  if (!run) return undefined;
  if ("batchId" in run) {
    const batch = batchProgress(editor).get().get(run.batchId);
    return batch && !batch.finished ? { settled: batch.settled, total: batch.count } : undefined;
  }
  const pending = run.shapeIds.filter((id) => {
    const shape = editor.getShape(id as TLShapeId);
    return shape !== undefined && runMarkerOf(shape) !== undefined;
  }).length;
  return pending > 0 ? { settled: run.shapeIds.length - pending, total: run.shapeIds.length } : undefined;
};

/** The tray a recipe makes, through the same path the composer reopens a recipe with: props the model no longer declares are dropped. */
export const recipeValues = async (engine: EngineConnection, recipe: GroupRecipe): Promise<TrayValues> => {
  const definition = mediumDefinition(recipe.medium);
  if (!definition) throw new Error(`There is no ${recipe.medium} medium.`);
  const catalogue = await loadCatalogue(engine, definition.catalogue);
  const entry = catalogue.models.find((model) => model.id === recipe.model);
  const { props } = trayFromRecipe(recipe);
  return { model: recipe.model === "" ? undefined : recipe.model, picked: false, props: definition.keep(props, definition.params(entry, props)) };
};

/**
 * Runs `recipe` over the selection at once. A Free recipe stops at the final prompt
 * dialog, so nothing is spent until it is confirmed there.
 */
export const runGroupRecipe = async (input: {
  readonly editor: Editor;
  readonly engine: EngineConnection;
  readonly project: string;
  readonly groupId: string;
  readonly recipe: GroupRecipe;
  readonly hasKey: boolean;
}): Promise<void> => {
  const { editor, engine, project, groupId, recipe } = input;
  const definition = mediumDefinition(recipe.medium);
  if (!definition) throw new Error(`There is no ${recipe.medium} medium.`);
  const tray = await recipeValues(engine, recipe);
  const values: TrayValues = recipe.runs === "free" ? { ...tray, props: { ...tray.props, [VIEW_FINAL_PROMPT_KEY]: true } } : tray;
  const entry = (await loadCatalogue(engine, definition.catalogue)).models.find((model) => model.id === recipe.model);
  const selected = editor.getSelectedShapeIds();
  const shapes = canvasShapes(editor);
  const composition = composeSelection({ shapes, selected, instruction: "", medium: recipe.medium, referenceCap: definition.params(entry, values.props).referenceCap });
  const source: RunSource = { kind: "selection", composition, selected, shapes, instruction: "" };
  const [blocker] = definition.status({ source, hasKey: input.hasKey, props: values.props, entry }).blockers;
  if (blocker !== undefined) throw new Error(blocker);
  const outcome = await definition.send({ editor, engine, project, values, source, remember: false });
  const staged = outcome === "stay" ? stagedFree(editor).get()?.batchId : undefined;
  const run: RecipeRun | undefined =
    staged !== undefined ? { batchId: staged } : outcome && outcome !== "stay" ? (outcome.batchId !== undefined ? { batchId: outcome.batchId } : outcome.shapeIds ? { shapeIds: outcome.shapeIds } : undefined) : undefined;
  if (run) recipeRuns(editor).update((all) => new Map(all).set(groupId, run));
};

/** Opens the composer on group `groupId`'s recipe: the group selected, the tray on the recipe's medium. */
export const openOnRecipe = (editor: Editor, groupId: TLShapeId, recipe: GroupRecipe): void => {
  if (!editor.getSelectedShapeIds().includes(groupId)) editor.select(groupId);
  setMedium(editor, recipe.medium);
  openComposer(editor, "generate");
};
