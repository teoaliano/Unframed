/** Browser-seam helpers for pages and motions (spec 09): files in the project folder, shapes that name them, their frames. */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FrameLocator, Locator, Page } from "@playwright/test";
import { BRIDGE_TAG, dialsBridgeSource } from "@unframed/domain";
import type { TestEngine } from "../../engine/test/engineProcess.ts";
import { shapeOnScreen } from "./canvas.ts";
import { putRecords, testIndex } from "./media.ts";

/** Writes a file straight into a project's folder, as the agent or a person would have left it. */
export const writeProjectFile = (engine: TestEngine, name: string, text: string | Buffer, project = "default"): Promise<void> =>
  writeFile(join(engine.dataDir, "output", project, name), text);

export const projectPath = (engine: TestEngine, name: string, project = "default"): string => join(engine.dataDir, "output", project, name);

/** A page or motion record naming `file`. */
export const artifactShape = (options: {
  id: string;
  kind: "page" | "motion";
  ref: string;
  at: { x: number; y: number };
  file?: string;
  title?: string;
  size?: { w: number; h: number };
  dials?: Record<string, unknown>;
}) => ({
  id: options.id,
  typeName: "shape",
  type: options.kind,
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
    file: options.file ?? "",
    title: options.title ?? "",
    fileName: "",
    ...(options.dials === undefined ? {} : { dials: options.dials }),
  },
  meta: { ref: options.ref },
});

/** Writes the file and puts the shape on the board. For a motion, the engine's library comes with a motion upload. */
export const filledArtifact = async (
  engine: TestEngine,
  options: Parameters<typeof artifactShape>[0] & { html: string; project?: string },
): Promise<{ file: string }> => {
  const project = options.project ?? "default";
  let file = options.file ?? `${Date.now()}-${options.kind}-${options.ref}.html`;
  if (options.kind === "motion") {
    // The motion upload writes the viewer, the player, the runtime and GSAP beside it.
    file = (await (await engine.rpc()).call("motion.upload", { project, fileName: `${options.title ?? "motion"}.html`, html: options.html })).file;
  } else {
    await writeProjectFile(engine, file, options.html, project);
  }
  await putRecords(engine, [artifactShape({ ...options, file })], project);
  return { file };
};

/** The artifact's frame element on the canvas. */
export const frameOf = (page: Page, id: string): Locator => shapeOnScreen(page, id).locator("iframe[data-artifact-frame]");

/** Inside a page's frame. */
export const insideFrame = (page: Page, id: string): FrameLocator => shapeOnScreen(page, id).frameLocator("iframe[data-artifact-frame]");

/** Inside a motion's composition: the viewer's player holds it in its own frame. */
export const insideComposition = (outer: FrameLocator): FrameLocator => outer.locator("hyperframes-player").frameLocator("iframe");

/** Writes the dials bridge beside a project's pages, as a page write would. */
export const writeBridge = (engine: TestEngine, project = "default"): Promise<void> => writeProjectFile(engine, "unframed-dials.js", dialsBridgeSource(), project);

/** A page that shows its dial values: its body's text is the values as JSON, and the accent is its background. */
export const dialsPage = (config: Record<string, unknown>) => `<!doctype html><html><head><style>body{margin:0;font:14px sans-serif}</style>${BRIDGE_TAG}</head><body><pre id="values">none</pre>
<script>
unframed.dials("Look", ${JSON.stringify(config)}, function (v) {
  document.getElementById("values").textContent = JSON.stringify(v);
  if (typeof v.accent === "string") document.body.style.background = v.accent;
});
</script></body></html>`;
