import type { KitPreset } from "../presetRules.ts";
import { fromDesignMd } from "./designMd.ts";
import { kitRefusal } from "./rules.ts";
import type { Kit } from "./types.ts";

export interface SystemKit {
  readonly id: string;
  readonly name: string;
  readonly folder: string;
  readonly summary: string;
}

export const SYSTEM_KIT_REVISION = 1;

export const SYSTEM_KITS: ReadonlyArray<SystemKit> = [
  { id: "kit-apple", name: "Apple", folder: "apple", summary: "Photography first: quiet UI, alternating light and dark tiles, one blue accent." },
  { id: "kit-claude", name: "Claude", folder: "claude", summary: "Warm cream canvas, serif headlines, coral calls to action." },
  { id: "kit-vercel", name: "Vercel", folder: "vercel", summary: "Stark black and white developer look with a multi-colour hero gradient." },
  { id: "kit-notion", name: "Notion", folder: "notion", summary: "Friendly workspace: deep navy hero, illustrations, calm neutral surfaces." },
  { id: "kit-airbnb", name: "Airbnb", folder: "airbnb", summary: "Warm, generous marketplace on white with Rausch pink for every primary action." },
  { id: "kit-linear", name: "Linear", folder: "linear.app", summary: "Near-black, dense and precise, with one lavender-blue accent." },
  { id: "kit-stripe", name: "Stripe", folder: "stripe", summary: "Deep navy ink, electric indigo and an atmospheric gradient mesh." },
  { id: "kit-figma", name: "Figma", folder: "figma", summary: "Monochrome editorial frame broken by oversized pastel colour blocks." },
  { id: "kit-bmw-m", name: "BMW M", folder: "bmw-m", summary: "Motorsport engineering: near-black canvas, uppercase display type, M stripes." },
  { id: "kit-coinbase", name: "Coinbase", folder: "coinbase", summary: "Institutional finance on pure white with Coinbase Blue as the one accent." },
];

export const systemKitPreset = (entry: SystemKit, markdown: string): KitPreset => {
  const read = fromDesignMd(markdown);
  if (!read.ok) throw new Error(`${entry.folder}/DESIGN.md: ${read.refusal}`);
  const kit: Kit = { format: 1, name: entry.name, modes: ["default"], tokens: read.fragment.tokens, ...(read.fragment.guidance === undefined ? {} : { guidance: read.fragment.guidance }) };
  const refusal = kitRefusal(kit);
  if (refusal !== null) throw new Error(`${entry.folder}/DESIGN.md: ${refusal}`);
  const { format: _format, ...definition } = kit;
  return { format: 2, id: entry.id, source: "system", name: entry.name, summary: entry.summary, kind: "kit", kit: definition, revision: SYSTEM_KIT_REVISION };
};
