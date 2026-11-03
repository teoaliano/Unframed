/** The kits that ship with the app (spec 19): each DESIGN.md in assets, made a kit preset by the Kit dialog's own importer. */
import { SYSTEM_KITS, systemKitPreset, type KitPreset } from "@unframed/domain";

// The markdown is its own chunk, loaded the first time the Library or the Kit dialog needs it.
const DOCUMENTS = import.meta.glob<string>("../../../../assets/design-md/*/DESIGN.md", { query: "?raw", import: "default" });

let built: Promise<ReadonlyArray<KitPreset>> | undefined;

export const systemKitPresets = (): Promise<ReadonlyArray<KitPreset>> => {
  built ??= Promise.all(
    SYSTEM_KITS.map(async (entry) => {
      const load = DOCUMENTS[`../../../../assets/design-md/${entry.folder}/DESIGN.md`];
      if (load === undefined) throw new Error(`${entry.folder}/DESIGN.md is not in this build.`);
      return systemKitPreset(entry, await load());
    }),
  );
  return built;
};
