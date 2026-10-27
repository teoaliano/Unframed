/** Browser-seam helpers for components (spec 20): sheets in the project folder and the component shapes that name them. */
import { COMPONENT_HELPER_TAG } from "@unframed/domain";
import type { TestEngine } from "../../engine/test/engineProcess.ts";
import { writeProjectFile } from "./artifacts.ts";
import { testIndex } from "./media.ts";

/** The sheet file the fixtures write. Its name is the spec's `<epochMs>-<slug>.html` rule. */
export const SHEET_FILE = "1761400000000-price-card.html";

export interface SheetOptions {
  readonly tag: string;
  /** Variant names and values, the first value the default. */
  readonly variants?: Record<string, string[]>;
  /** Markup for the example children every board cell shows. */
  readonly example?: string;
}

/**
 * A component sheet with a declaration, a style and a template holding one text property. Its
 * head carries the sheet helper's tag, as the engine writes it, so the sheet builds its board.
 */
export const sheetHtml = (options: SheetOptions): string => {
  const declaration = { tag: options.tag, variants: options.variants ?? {}, props: { label: "text" }, slots: [] };
  const example = options.example ?? "";
  return `<!doctype html><html><head><meta charset="utf-8">${COMPONENT_HELPER_TAG}</head><body style="margin:0">
<script type="application/json" data-uf-component>${JSON.stringify(declaration)}</script>
<style type="text/x-uf-component" data-uf-component-style>
:host { display: inline-block; }
button { background: #111111; color: #ffffff; padding: 8px 12px; }
:host([kind="secondary"]) button { background: #eeeeee; color: #000000; }
</style>
<div data-uf-template hidden><button data-uf-prop="label">Buy</button></div>
<div data-uf-example hidden>${example}</div>
</body></html>`;
};

/** Writes a sheet into a project's folder, as the agent's component write would leave it. */
export const writeSheet = (engine: TestEngine, options: SheetOptions, file = SHEET_FILE, project = "default"): Promise<void> =>
  writeProjectFile(engine, file, sheetHtml(options), project);

/** A component record: the current sheet `file` of the component `tag`. */
export const componentShape = (options: {
  id: string;
  ref: string;
  at: { x: number; y: number };
  file?: string;
  tag: string;
  title?: string;
  size?: { w: number; h: number };
}) => ({
  id: options.id,
  typeName: "shape",
  type: "component",
  x: options.at.x,
  y: options.at.y,
  rotation: 0,
  index: testIndex(),
  parentId: "page:page",
  isLocked: false,
  opacity: 1,
  props: {
    w: options.size?.w ?? 480,
    h: options.size?.h ?? 320,
    file: options.file ?? SHEET_FILE,
    title: options.title ?? "",
    fileName: "",
    tag: options.tag,
  },
  meta: { ref: options.ref },
});
