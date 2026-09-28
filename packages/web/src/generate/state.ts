import type { Medium, ResultRecipe } from "@unframed/contracts";
import { atom, type Atom, type Editor } from "tldraw";

/** Whether the selection toolbar shows its bar, or has grown into the composer with one of its trays. */
export type ComposerMode = "bar" | "generate" | "agent";

/** The composer opened over a result by Recipe: it sends the recorded selection prompt and references. */
export interface RecipeMode {
  readonly shapeId: string;
  readonly recipe: ResultRecipe;
  /** The selection when recipe mode began; any change to it leaves recipe mode. */
  readonly selection: ReadonlyArray<string>;
}

export interface ComposerState {
  readonly mode: ComposerMode;
  readonly medium: Medium;
  readonly recipe?: RecipeMode | undefined;
}

const states = new WeakMap<Editor, Atom<ComposerState>>();

/** The composer's state for one canvas: what the toolbar, the badges and the tether read. */
export const composerState = (editor: Editor): Atom<ComposerState> => {
  let state = states.get(editor);
  if (!state) {
    state = atom<ComposerState>("composer", { mode: "bar", medium: "image" });
    states.set(editor, state);
  }
  return state;
};

export const openComposer = (editor: Editor, mode: Exclude<ComposerMode, "bar">, recipe?: RecipeMode) =>
  composerState(editor).update((state) => ({ ...state, mode, recipe, ...(recipe ? { medium: recipe.recipe.medium } : {}) }));

export const closeComposer = (editor: Editor) => composerState(editor).update((state) => ({ ...state, mode: "bar", recipe: undefined }));

export const setMedium = (editor: Editor, medium: Medium) => composerState(editor).update((state) => ({ ...state, medium }));

export const leaveRecipeMode = (editor: Editor) => composerState(editor).update((state) => (state.recipe ? { ...state, recipe: undefined } : state));
