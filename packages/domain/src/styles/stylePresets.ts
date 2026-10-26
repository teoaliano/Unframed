/**
 * The style documents that ship in the library: ten DESIGN.md files from
 * VoltAgent/awesome-design-md (MIT), kept under `assets/design-md/<folder>/`
 * as upstream wrote them, apart from the brand name corrected in `stripe/DESIGN.md`.
 * They are never written to `presets.json`; inserting one writes its markdown into the
 * project as a new style file.
 */
import type { ContentShape, Preset } from "../presetRules.ts";
import { STYLE_DEFAULT_SIZE } from "./styleRules.ts";

export interface StylePreset {
  readonly id: string;
  readonly name: string;
  /** The folder under `assets/design-md/` that holds its `DESIGN.md`. */
  readonly folder: string;
  readonly summary: string;
}

export const STYLE_PRESETS: ReadonlyArray<StylePreset> = [
  { id: "style-apple", name: "Apple", folder: "apple", summary: "Photography first: quiet UI, alternating light and dark tiles, one blue accent." },
  { id: "style-claude", name: "Claude", folder: "claude", summary: "Warm cream canvas, serif headlines, coral calls to action." },
  { id: "style-vercel", name: "Vercel", folder: "vercel", summary: "Stark black and white developer look with a multi-colour hero gradient." },
  { id: "style-notion", name: "Notion", folder: "notion", summary: "Friendly workspace: deep navy hero, illustrations, calm neutral surfaces." },
  { id: "style-airbnb", name: "Airbnb", folder: "airbnb", summary: "Warm, generous marketplace on white with Rausch pink for every primary action." },
  { id: "style-linear", name: "Linear", folder: "linear.app", summary: "Near-black, dense and precise, with one lavender-blue accent." },
  { id: "style-stripe", name: "Stripe", folder: "stripe", summary: "Deep navy ink, electric indigo and an atmospheric gradient mesh." },
  { id: "style-figma", name: "Figma", folder: "figma", summary: "Monochrome editorial frame broken by oversized pastel colour blocks." },
  { id: "style-bmw-m", name: "BMW M", folder: "bmw-m", summary: "Motorsport engineering: near-black canvas, uppercase display type, M stripes." },
  { id: "style-coinbase", name: "Coinbase", folder: "coinbase", summary: "Institutional finance on pure white with Coinbase Blue as the one accent." },
];

/** The shipped styles as library presets: one style shape each, its file filled in when it is inserted. */
export const stylePresets = (schema: unknown): Preset[] =>
  STYLE_PRESETS.map((style) => {
    const shape: ContentShape = {
      id: `shape:${style.id}`,
      typeName: "shape",
      type: "style",
      parentId: "page:page",
      index: "a1",
      x: 0,
      y: 0,
      rotation: 0,
      isLocked: false,
      opacity: 1,
      props: { ...STYLE_DEFAULT_SIZE, file: "", title: style.name, fileName: "", swatches: [], excerpt: "", role: "style" },
      meta: { ref: "100" },
    };
    return {
      format: 2,
      id: style.id,
      source: "system",
      name: style.name,
      summary: style.summary,
      kind: "style",
      content: { schema, shapes: [shape], rootShapeIds: [shape.id], assets: [], bindings: [] },
    };
  });
