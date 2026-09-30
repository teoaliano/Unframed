/** Maps hand-written old graphs, the way the engine maps one it read from disk. */
import { mapProject, normalise, type LegacyGraph, type ProjectFacts } from "../../src/index.ts";
import { DEFAULTS, IMPORTED_AT, sha256 } from "./facts.ts";
import type { Json } from "./journal.ts";
import { sampleText } from "./samples.ts";

export const NO_FACTS: ProjectFacts = { files: [], imageSizes: {}, sidecars: {}, textSidecars: [], jobs: [], hasThreads: false, defaults: DEFAULTS };

export const mapNodes = (nodes: Json[], edges: Json[] = [], facts: Partial<ProjectFacts> = {}) => {
  const normalised = normalise({ nodes, edges } as unknown as LegacyGraph);
  return mapProject(normalised.graph, { ...NO_FACTS, ...facts }, { source: { snapshotVersion: 1, journalEntriesApplied: 0 }, notes: normalised.notes, importedAt: IMPORTED_AT, sha256 });
};

/** The report's texts in one section. */
export const section = (mapped: { readonly report: { readonly items: ReadonlyArray<{ section: string; text: string }> } }, name: "changed" | "notKept" | "missing") =>
  mapped.report.items.filter((item) => item.section === name).map((item) => item.text);

export const at = (x: number, y: number) => ({ position: { x, y } });

const sketch = (JSON.parse(sampleText("everything/graph.json")!) as { nodes: Array<{ id: string; data: { dataUrl?: string } }> }).nodes.find((node) => node.id === "107")!;

/** The sample's inline sketch: a real 64 by 40 PNG as a `data:` URL. */
export const PNG_64x40: string = sketch.data.dataUrl!;
