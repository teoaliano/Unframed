/** The presets that ship with the app: the two recipes, built once from the prompt text in assets, verbatim, and the ten styles. */
import { canvasSchema } from "@unframed/contracts";
import { fencedText, STYLE_PRESETS, stylePresets, systemPresets, type Preset } from "@unframed/domain";
import layerizeAsset from "../../../../assets/prompts/preset-layerize-plan.md?raw";
import proseAsset from "../../../../assets/prompts/preset-prose-to-json.md?raw";

let built: ReadonlyArray<Preset> | undefined;

export const builtInPresets = (): ReadonlyArray<Preset> => {
  const schema = canvasSchema().serialize();
  built ??= [...systemPresets({ layerizePlan: fencedText(layerizeAsset), proseToJson: fencedText(proseAsset), schema }), ...stylePresets(schema)];
  return built;
};

// Each DESIGN.md is its own chunk, fetched only when that style is inserted.
const DOCUMENTS = import.meta.glob<string>("../../../../assets/design-md/*/DESIGN.md", { query: "?raw", import: "default" });

/** A shipped style's markdown, as `assets/design-md` holds it. */
export const styleMarkdown = async (presetId: string): Promise<string> => {
  const style = STYLE_PRESETS.find((known) => known.id === presetId);
  const load = style === undefined ? undefined : DOCUMENTS[`../../../../assets/design-md/${style.folder}/DESIGN.md`];
  if (!load) throw new Error("That style is not in this version of the app.");
  return load();
};
