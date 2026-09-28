/**
 * The medium registry: the Generate tray reads its media from here. Each medium supplies
 * its label, catalogue, props, estimate, warnings and send. This spec registers `image`;
 * specs 04 and 05 register `video` and `text` the same way.
 */
import type { Medium, ModelEntry, ResultRecipe } from "@unframed/contracts";
import type { Composition, ModelParams } from "@unframed/domain";
import type { Editor } from "tldraw";
import type { EngineConnection, Payload } from "../rpc/engine.ts";
import type { RecipeMode } from "./state.ts";

export type PropValue = string | number | boolean;
export type TrayProps = Readonly<Record<string, PropValue>>;

/** What a tray has chosen for its medium. `model` is undefined until a catalogue or a choice names one. */
export interface TrayValues {
  readonly model: string | undefined;
  /** The person picked the model in the model dialog (or it came back from last-used values). */
  readonly picked: boolean;
  readonly props: TrayProps;
}

export interface TrayStatus {
  /** Status lines that do not stop the run. */
  readonly warnings: ReadonlyArray<string>;
  /** Lines that disable send. */
  readonly blockers: ReadonlyArray<string>;
}

/** What the run is made from: the live selection, or a result's recorded recipe. */
export type RunSource =
  | { readonly kind: "selection"; readonly composition: Composition; readonly selected: ReadonlyArray<string> }
  /** `instruction` is the box's text resolved like a prompt's; `error` is its circular reference. */
  | { readonly kind: "recipe"; readonly recipe: RecipeMode; readonly instruction: string; readonly error?: string | undefined };

export interface SendInput {
  readonly editor: Editor;
  readonly engine: EngineConnection;
  readonly project: string;
  readonly values: TrayValues;
  readonly source: RunSource;
}

export interface MediumDefinition {
  readonly medium: Medium;
  /** The medium switch's lowercase label. */
  readonly label: string;
  /** Which `models.list` catalogue the model dialog shows. */
  readonly catalogue: Payload<"models.list">["medium"];
  readonly dialogTitle: string;
  readonly browseUrl: string;
  /** The props this model declares, with exactly its values. */
  readonly params: (entry: ModelEntry | undefined) => ModelParams;
  readonly defaults: (params: ModelParams) => Record<string, PropValue>;
  /** The tray after a model change. */
  readonly reset: (props: TrayProps, params: ModelParams) => Record<string, PropValue>;
  /** Stored or recorded props, kept only where the model supports them. */
  readonly keep: (props: TrayProps, params: ModelParams) => Record<string, PropValue>;
  /** The model's pricing, which the tray caches per model for the session. */
  readonly pricing: (engine: EngineConnection, model: string) => Promise<unknown>;
  /** The price beside the send button, when it is exact. `pricing` is what `pricing` answered, once it has. */
  readonly estimate: (input: { readonly pricing: unknown; readonly props: TrayProps; readonly source: RunSource }) => string | undefined;
  readonly status: (input: { readonly source: RunSource; readonly hasKey: boolean }) => TrayStatus;
  readonly sendLabel: (values: TrayValues) => string;
  /** Renders, uploads and starts the run. Resolves once the engine acknowledged it. */
  readonly send: (input: SendInput) => Promise<void>;
  /** The tray's values from a recipe, for recipe mode. */
  readonly fromRecipe: (recipe: ResultRecipe) => TrayProps;
}

const registry: MediumDefinition[] = [];

export const registerMedium = (definition: MediumDefinition): void => {
  if (!registry.some((each) => each.medium === definition.medium)) registry.push(definition);
};

/** The registered media, in the order the medium switch shows them. */
export const registeredMedia = (): ReadonlyArray<MediumDefinition> => {
  const order: Medium[] = ["image", "video", "text"];
  return [...registry].sort((a, b) => order.indexOf(a.medium) - order.indexOf(b.medium));
};

export const mediumDefinition = (medium: Medium): MediumDefinition | undefined => registry.find((each) => each.medium === medium);
