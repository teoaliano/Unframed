/** The two presets that ship with the app, built once from the prompt text in assets, verbatim. */
import { canvasSchema } from "@unframed/contracts";
import { fencedText, systemPresets, type Preset } from "@unframed/domain";
import layerizeAsset from "../../../../assets/prompts/preset-layerize-plan.md?raw";
import proseAsset from "../../../../assets/prompts/preset-prose-to-json.md?raw";

let built: ReadonlyArray<Preset> | undefined;

export const builtInPresets = (): ReadonlyArray<Preset> => {
  built ??= systemPresets({ layerizePlan: fencedText(layerizeAsset), proseToJson: fencedText(proseAsset), schema: canvasSchema().serialize() });
  return built;
};
