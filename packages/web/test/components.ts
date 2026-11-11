import { BRIDGE_TAG, COMPONENT_HELPER_TAG } from "@unframed/domain";
import { stampElementIds } from "@unframed/domain/html";
import type { TestEngine } from "../../engine/test/engineProcess.ts";
import { writeProjectFile } from "./artifacts.ts";
import { testIndex } from "./media.ts";

export const SHEET_FILE = "1761400000000-price-card.html";

export interface SheetOptions {
  readonly tag: string;
  readonly variants?: Record<string, string[]>;
  readonly example?: string;
}

export const sheetHtml = (options: SheetOptions): string => {
  const declaration = { tag: options.tag, variants: options.variants ?? {}, props: { label: "text" }, slots: [] };
  const example = options.example ?? "";
  return stampElementIds(`<!doctype html><html><head><meta charset="utf-8">${BRIDGE_TAG}${COMPONENT_HELPER_TAG}</head><body style="margin:0">
<script type="application/json" data-uf-component>${JSON.stringify(declaration)}</script>
<style type="text/x-uf-component" data-uf-component-style>
:host { display: inline-block; }
button { background: #111111; color: #ffffff; padding: 8px 12px; }
:host([kind="secondary"]) button { background: #eeeeee; color: #000000; }
</style>
<div data-uf-template hidden><button data-uf-prop="label">Buy</button></div>
<div data-uf-example hidden>${example}</div>
</body></html>`);
};

export const writeSheet = (engine: TestEngine, options: SheetOptions, file = SHEET_FILE, project = "default"): Promise<void> =>
  writeProjectFile(engine, file, sheetHtml(options), project);

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
