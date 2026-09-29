/** What the engine would learn from a sample project folder, gathered here the same way. */
import { createHash } from "node:crypto";
import { imageDimensions, mapProject, normalise, rebuild, type LegacyJob, type LegacyShape, type ProjectFacts } from "../../src/index.ts";
import { sampleBytes, sampleFiles, sampleText } from "./samples.ts";

export const DEFAULTS = { image: "openai/gpt-image-2", video: "bytedance/seedance-2.0", text: "google/gemini-3.5-flash-lite" };

export const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

const json = (text: string | null): unknown => {
  if (text === null) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

export const sampleFacts = (project: string, overrides: Partial<ProjectFacts> = {}): ProjectFacts => {
  const files = sampleFiles(project).filter((file) => !file.startsWith("graph."));
  const imageSizes: Record<string, { w: number; h: number }> = {};
  const sidecars: Record<string, unknown> = {};
  const textSidecars: Array<{ file: string; sidecar: unknown }> = [];
  for (const file of files) {
    if (/\.(png|jpe?g|webp|gif)$/i.test(file)) {
      const size = imageDimensions(sampleBytes(`${project}/${file}`));
      if (size) imageSizes[file] = size;
    }
    if (!file.endsWith(".json")) {
      const sidecar = json(sampleText(`${project}/${file.replace(/\.[^.]*$/, "")}.json`));
      if (sidecar !== undefined) sidecars[file] = sidecar;
    } else if (/-text-/.test(file)) textSidecars.push({ file, sidecar: json(sampleText(`${project}/${file}`)) });
  }
  const jobs = ((json(sampleText("jobs.json")) as LegacyJob[] | undefined) ?? []).filter((job) => job.project === project);
  return { files, imageSizes, sidecars, textSidecars, jobs, hasThreads: project === "everything", defaults: DEFAULTS, ...overrides };
};

export const IMPORTED_AT = "2026-09-29T12:00:00.000Z";

/** A sample project read, normalised and mapped, as the engine would. */
export const mapSample = (project: string, overrides: Partial<ProjectFacts> = {}) => {
  const rebuilt = rebuild(sampleText(`${project}/graph.json`), sampleText(`${project}/graph.log`));
  const normalised = normalise(rebuilt.graph);
  return mapProject(normalised.graph, sampleFacts(project, overrides), {
    source: rebuilt.stats,
    notes: [...rebuilt.notes, ...normalised.notes],
    importedAt: IMPORTED_AT,
    sha256,
  });
};

/** The shape with this `@id`, and every shape keyed. */
export const shapesOf = (mapped: { readonly canvas: { readonly shapes: ReadonlyArray<LegacyShape> } }) => {
  const list = mapped.canvas.shapes;
  const byKey = new Map(list.map((shape) => [shape.key, shape]));
  return {
    list,
    byKey,
    ref: (ref: string): LegacyShape => {
      const found = list.find((shape) => shape.ref === ref);
      if (!found) throw new Error(`no shape @${ref}`);
      return found;
    },
    key: (key: string): LegacyShape => {
      const found = byKey.get(key);
      if (!found) throw new Error(`no shape ${key}`);
      return found;
    },
  };
};
