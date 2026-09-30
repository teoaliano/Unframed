/**
 * The medium registry: the Generate tray reads its media from here. Each medium supplies
 * its label, catalogue, props, estimate, warnings and send. This spec registers `image`;
 * specs 04 and 05 register `video` and `text` the same way.
 */
import type { Medium, ModelEntry, ResultRecipe } from "@unframed/contracts";
import type { CanvasShape, Composition, ModelParams } from "@unframed/domain";
import type { ComponentType } from "react";
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
  | {
      readonly kind: "selection";
      readonly composition: Composition;
      readonly selected: ReadonlyArray<string>;
      /** The canvas the composition read, for rules that recompose it (spec 05's Free). */
      readonly shapes: ReadonlyArray<CanvasShape>;
      /** The box's text as typed, before resolution. */
      readonly instruction: string;
      /**
       * Recipe mode over an imported result (spec 11), which runs from its live sources: the
       * result the run answers for. Its outputs land beside it, and Free is not offered.
       */
      readonly answersFor?: string | undefined;
    }
  /** `instruction` is the box's text resolved like a prompt's; `error` is its circular reference. */
  | { readonly kind: "recipe"; readonly recipe: RecipeMode; readonly instruction: string; readonly error?: string | undefined };

export interface SendInput {
  readonly editor: Editor;
  readonly engine: EngineConnection;
  readonly project: string;
  readonly values: TrayValues;
  readonly source: RunSource;
  /** False for a run that is not the composer's (spec 06's recipe group run): the last-used values stay as they were. */
  readonly remember?: boolean;
}

/**
 * What a send started: the batch whose events report its progress, or the shapes that
 * hold its work (spec 04's render placeholder). `"stay"` when nothing was sent yet.
 */
export type SendOutcome = void | "stay" | { readonly batchId?: string; readonly shapeIds?: ReadonlyArray<string> };

/** What a medium's own status band shows: its status, the last send failure, and a way to change the tray. */
export interface MediumStatusProps {
  readonly status: TrayStatus;
  readonly failure: string | undefined;
  readonly values: TrayValues;
  readonly source: RunSource;
  readonly entry: ModelEntry | undefined;
  readonly setProps: (props: Record<string, PropValue>) => void;
}

export interface MediumDefinition {
  readonly medium: Medium;
  /** The medium switch's lowercase label. */
  readonly label: string;
  /** Which `models.list` catalogue the model dialog shows. */
  readonly catalogue: Payload<"models.list">["medium"];
  readonly dialogTitle: string;
  readonly browseUrl: string;
  /** The props this model declares, with exactly its values. `props` is the tray's current values (spec 04: a stored input mode). */
  readonly params: (entry: ModelEntry | undefined, props?: TrayProps) => ModelParams;
  readonly defaults: (params: ModelParams) => Record<string, PropValue>;
  /** The tray after a model change. */
  readonly reset: (props: TrayProps, params: ModelParams) => Record<string, PropValue>;
  /** Stored or recorded props, kept only where the model supports them. */
  readonly keep: (props: TrayProps, params: ModelParams) => Record<string, PropValue>;
  /** The model's pricing, which the tray caches per model for the session. */
  readonly pricing: (engine: EngineConnection, model: string) => Promise<unknown>;
  /** The price beside the send button, when it is exact. `pricing` is what `pricing` answered, once it has. */
  readonly estimate: (input: { readonly pricing: unknown; readonly props: TrayProps; readonly source: RunSource; readonly entry?: ModelEntry | undefined }) => string | undefined;
  /** `props` are the tray's, once it has values; `entry` is its model's catalogue entry (spec 04). */
  readonly status: (input: { readonly source: RunSource; readonly hasKey: boolean; readonly props?: TrayProps | undefined; readonly entry?: ModelEntry | undefined }) => TrayStatus;
  readonly sendLabel: (values: TrayValues) => string;
  /** The send button's label while the engine acknowledges a send (spec 04: `Starting…`). */
  readonly sendingLabel?: string;
  /** The value "+ add prop" offers a prop with. The image rule when absent. */
  readonly addable?: (params: ModelParams, key: string, props: TrayProps) => PropValue | undefined;
  /** Renders the status band itself, in place of the plain lines (spec 04: the share block sits among them). */
  readonly Status?: ComponentType<MediumStatusProps>;
  /** Badge text by shape id, over the composition's own roles (spec 04: first, last, unused). */
  readonly roles?: (input: { readonly composition: Composition; readonly props: TrayProps; readonly entry: ModelEntry | undefined }) => Readonly<Record<string, string>>;
  /** The tray's props corrected once the catalogue is known (spec 04: a stored input mode the model cannot honour), or undefined when nothing changes. */
  readonly heal?: (input: { readonly props: TrayProps; readonly entry: ModelEntry | undefined; readonly loaded: boolean }) => Record<string, PropValue> | undefined;
  /**
   * Renders, uploads and starts the run. Resolves once the engine acknowledged it, or with
   * `"stay"` when nothing was sent yet and the composer stays open (spec 05's final prompt).
   */
  readonly send: (input: SendInput) => Promise<SendOutcome>;
  /** The tray's values from a recipe, for recipe mode. */
  readonly fromRecipe: (recipe: ResultRecipe) => TrayProps;
  /** Tray props the model does not drive (spec 05's Runs), after the model's own. */
  readonly trayProps?: ReadonlyArray<TrayPropDefinition>;
  /** Rendered inside the tray, for a medium's own dialogs (spec 05's final prompt). */
  readonly Overlay?: ComponentType<TrayOverlayProps>;
}

/** A tray prop that is not a model trait, so a model change leaves it. It draws its own chip and popup. */
export interface TrayPropDefinition {
  readonly key: string;
  readonly label: string;
  /** Whether its chip shows. While its popup is open it shows regardless. */
  readonly inTray: (props: TrayProps) => boolean;
  /** The value `+ add prop` lists it with. */
  readonly addValue: (props: TrayProps) => string;
  /** The props once `+ add prop` adds it. */
  readonly add: (props: TrayProps) => Record<string, PropValue>;
  readonly Chip: ComponentType<TrayPropChipProps>;
}

export interface TrayPropChipProps {
  readonly props: TrayProps;
  readonly onChange: (props: Record<string, PropValue>) => void;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

export interface TrayOverlayProps {
  readonly project: string;
  /** The run was acknowledged: the composer collapses back to the bar. */
  readonly onSent: () => void;
  /** Whether a dialog of the overlay is open, so the shell leaves Esc and the send key to it. */
  readonly onMenuOpen: (key: string, open: boolean) => void;
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
