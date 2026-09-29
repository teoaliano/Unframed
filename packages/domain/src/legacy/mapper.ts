/**
 * The legacy mapper (spec 11): an old graph, after the reader and the normaliser, as the
 * new canvas. Prompts, media, groups, pages and motions keep their `@id`s, positions and
 * sizes; each output becomes a recipe group (on its one group, around its sources, or
 * where it stood) and its results become result shapes with approximate recipes; wires
 * disappear. Pure: `facts` is everything the engine read from disk.
 */
import { boxesOverlap, wrapBox, type Box } from "../grouping.ts";
import { imageDimensions, type PixelSize } from "../imageDimensions.ts";
import { linkedVideoName } from "../media.ts";
import type { GroupRecipe } from "../recipeRules.ts";
import type { LegacyCanvas, LegacyMedia, LegacyRender, LegacyResult, LegacyResultRecipe, LegacyShape, LegacyShapeKind } from "./canvas.ts";
import { finite, LEGACY_OUTPUT_TYPES, record, type LegacyGraph, type LegacyNode } from "./graph.ts";
import { baseName, extractedFileName, fileOfResultUrl, mimeByExtension, parseDataUrl } from "./media.ts";
import { RefMinter } from "./minter.ts";
import { legacyPromptTexts } from "./normalise.ts";
import { OUTPUT_MEDIUM, outputRecipe, sidecarKind, sidecarNumber, sidecarParams, sidecarText, type LegacyDefaults } from "./recipes.ts";
import { reportText, type ImportCounts, type ImportReport, type ImportSource, type LegacyMedium, type ReportItem } from "./report.ts";

/** One record of `jobs.json`, as the old store wrote it. */
export interface LegacyJob {
  readonly id: string;
  readonly project?: string | null;
  readonly params?: unknown;
  readonly startedAt?: unknown;
  readonly status?: unknown;
  readonly savedPath?: unknown;
  readonly cost?: unknown;
  readonly error?: unknown;
}

/** What the engine learned from the project folder and the output folder. */
export interface ProjectFacts {
  /** Every file name in the project folder. */
  readonly files: ReadonlyArray<string>;
  /** The pixel size of image files, by name. */
  readonly imageSizes: Readonly<Record<string, PixelSize>>;
  /** The parsed sidecar (`<base>.json`) beside a file, by the file's name. */
  readonly sidecars: Readonly<Record<string, unknown>>;
  /** Every text run sidecar in the folder. */
  readonly textSidecars: ReadonlyArray<{ readonly file: string; readonly sidecar: unknown }>;
  /** The records of `jobs.json` for this project. */
  readonly jobs: ReadonlyArray<LegacyJob>;
  /** Whether `threads/` holds any file. */
  readonly hasThreads: boolean;
  readonly defaults: LegacyDefaults;
}

export interface MapOptions {
  /** What the reader says about the snapshot and the journal. */
  readonly source: ImportSource;
  /** The reader's and the normaliser's notes, in that order. */
  readonly notes: ReadonlyArray<ReportItem>;
  readonly importedAt: string;
  /** The hex SHA-256 of some bytes: extracted files are named by it. */
  readonly sha256: (bytes: Uint8Array) => string;
}

/** An inline `data:` URL to write out as a project file under `file`. */
export interface Extraction {
  readonly file: string;
  readonly bytes: Uint8Array;
  readonly mime: string;
  /** The old `fileName`, `''` when it had none. */
  readonly fileName: string;
}

export interface Mapped {
  readonly canvas: LegacyCanvas;
  readonly extractions: ReadonlyArray<Extraction>;
  readonly report: ImportReport;
}

const DEFAULT_SIZE = {
  prompt: { w: 240, h: 160 },
  group: { w: 420, h: 280 },
  page: { w: 480, h: 320 },
  motion: { w: 480, h: 300 },
  output: { w: 320, h: 200 },
} as const;
const MEDIA_WIDTH = 240;
const VIDEO_ASPECT = 16 / 9;
const RESULT_GAP = 24;
const INSTRUCTION_GAP = 28;
const SIDE_MARGIN = 28;
const TOP_MARGIN = 56;

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type Shape = Mutable<LegacyShape>;
type Params = LegacyResultRecipe["params"];

const nonEmpty = (value: unknown): string | undefined => (typeof value === "string" && value !== "" ? value : undefined);

/** A rough box for a prompt's text, for placement only: the web measures the real one. */
export const legacyTextBox = (value: string, width?: number): { w: number; h: number } => {
  const lines = value.split("\n");
  const w = width ?? Math.min(320, Math.max(40, Math.max(...lines.map((line) => line.length)) * 7 + 8));
  const rows = lines.reduce((sum, line) => sum + Math.max(1, Math.ceil((line.length * 7) / w)), 0);
  return { w, h: Math.max(28, rows * 20) };
};

const positiveAspect = (value: unknown): number | undefined => {
  const aspect = finite(value);
  return aspect !== undefined && aspect > 0 ? aspect : undefined;
};

export const resultRecipe = (medium: LegacyMedium, model: string, params: Params, sources: ReadonlyArray<string>, sentPrompt: string | undefined): LegacyResultRecipe => ({
  medium,
  model,
  params,
  selectionPrompt: "",
  instruction: "",
  references: [],
  sources,
  approximate: true,
  ...(sentPrompt === undefined ? {} : { sentPrompt }),
});

export const mapProject = (graph: LegacyGraph, facts: ProjectFacts, options: MapOptions): Mapped => {
  const files = new Set(facts.files);
  const shapes = new Map<string, Shape>();
  const order: string[] = [];
  const items: ReportItem[] = [];
  const extractions = new Map<string, Extraction>();
  const minter = new RefMinter(
    graph.nodes.map((node) => node.id),
    legacyPromptTexts(graph.nodes),
  );
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  /** The shape each image or video file is on, by kind and file. */
  const onCanvas = new Map<string, string>();

  const add = (shape: Shape, at?: "bottom") => {
    shapes.set(shape.key, shape);
    if (at === "bottom") order.unshift(shape.key);
    else order.push(shape.key);
    if ((shape.kind === "image" || shape.kind === "video") && shape.media?.kind === "file" && !onCanvas.has(`${shape.kind}:${shape.media.file}`)) {
      onCanvas.set(`${shape.kind}:${shape.media.file}`, shape.key);
    }
  };

  const absolute = (shape: Shape): Box => {
    const parent = shape.parent === undefined ? undefined : shapes.get(shape.parent);
    const origin = parent ? absolute(parent) : { x: 0, y: 0 };
    return { x: origin.x + shape.x, y: origin.y + shape.y, w: shape.w, h: shape.h };
  };

  const extractedSizes = new Map<string, PixelSize>();
  const sizeOf = (file: string): PixelSize | undefined => facts.imageSizes[file] ?? extractedSizes.get(file);
  const mimeOf = (file: string): string =>
    extractions.get(file)?.mime ?? nonEmpty(record(facts.sidecars[file])?.mime) ?? mimeByExtension(file) ?? "application/octet-stream";

  /** Writes out a `data:` URL once, and answers the file it becomes and its pixel size. */
  const extract = (url: unknown, fileName: string): { file: string; mime: string; size: PixelSize | undefined } | undefined => {
    const parsed = parseDataUrl(url);
    if (!parsed) return undefined;
    const file = extractedFileName({ hash: options.sha256(parsed.bytes), fileName, mime: parsed.mime });
    const size = parsed.mime.startsWith("image/") ? imageDimensions(parsed.bytes) : undefined;
    if (!extractions.has(file)) extractions.set(file, { file, bytes: parsed.bytes, mime: parsed.mime, fileName });
    if (size) extractedSizes.set(file, size);
    return { file, mime: parsed.mime, size };
  };

  const fileMedia = (file: string, name: string, mime: string, shape: { w: number; h: number }, size?: PixelSize): LegacyMedia => ({
    kind: "file",
    file,
    name: name || file,
    mime,
    w: size?.w ?? Math.round(shape.w),
    h: size?.h ?? Math.round(shape.h),
  });

  // ---------------------------------------------------------------------------------------
  // Inputs, groups and artifacts, in the old graph's order with members after the groups.

  const inputs = graph.nodes.filter((node) => !LEGACY_OUTPUT_TYPES.has(node.type));
  const ordered = [...inputs.filter((node) => node.parentId === undefined), ...inputs.filter((node) => node.parentId !== undefined)];

  for (const node of ordered) {
    const key = `node:${node.id}`;
    const { data } = node;
    const base = { key, ref: node.id, x: node.position.x, y: node.position.y, ...(node.parentId === undefined ? {} : { parent: `node:${node.parentId}` }) };
    switch (node.type) {
      case "prompt":
        add({ ...base, kind: "prompt", w: node.width ?? DEFAULT_SIZE.prompt.w, h: node.height ?? DEFAULT_SIZE.prompt.h, text: typeof data.text === "string" ? data.text : "", sized: data.sized === true });
        break;
      case "image":
      case "video": {
        const kind: "image" | "video" = node.type;
        const w = node.width ?? MEDIA_WIDTH;
        const fileName = typeof data.fileName === "string" ? data.fileName : "";
        const named = nonEmpty(data.file);
        const stated = positiveAspect(data.aspect);
        const fallback = kind === "video" ? VIDEO_ASPECT : 1;
        let media: LegacyMedia | undefined;
        let aspect = stated ?? fallback;
        if (named !== undefined && files.has(named)) {
          const size = kind === "image" ? facts.imageSizes[named] : undefined;
          aspect = stated ?? (size ? size.w / size.h : fallback);
          media = fileMedia(named, fileName, mimeOf(named), { w, h: w / aspect }, size);
        } else if (kind === "video" && typeof data.dataUrl === "string" && /^https:\/\/.+/.test(data.dataUrl)) {
          media = { kind: "link", url: data.dataUrl, name: fileName || linkedVideoName(data.dataUrl), w: Math.round(720 * aspect), h: 720 };
        } else {
          const extracted = extract(data.dataUrl, fileName);
          if (extracted) {
            aspect = stated ?? (extracted.size ? extracted.size.w / extracted.size.h : fallback);
            media = fileMedia(extracted.file, fileName, extracted.mime, { w, h: w / aspect }, extracted.size);
          }
        }
        if (!media && named !== undefined) items.push(reportText.missingFile(kind === "image" ? "Image" : "Video", node.id, named));
        add({ ...base, kind, w, h: w / aspect, ...(media ? { media } : {}) });
        break;
      }
      case "group":
        add({ ...base, kind: "group", w: node.width ?? DEFAULT_SIZE.group.w, h: node.height ?? DEFAULT_SIZE.group.h });
        break;
      case "page":
      case "motion": {
        const kind: "page" | "motion" = node.type;
        const named = nonEmpty(data.file);
        const file = named !== undefined && files.has(named) ? named : "";
        if (named !== undefined && file === "") items.push(reportText.missingFile(kind === "page" ? "Page" : "Motion", node.id, named));
        const dials = record(data.dials);
        add({
          ...base,
          kind,
          w: node.width ?? DEFAULT_SIZE[kind].w,
          h: node.height ?? DEFAULT_SIZE[kind].h,
          artifact: { file, title: typeof data.title === "string" ? data.title : "", fileName: typeof data.fileName === "string" ? data.fileName : "", ...(dials ? { dials } : {}) },
        });
        break;
      }
    }
  }

  // ---------------------------------------------------------------------------------------
  // Outputs, top to bottom, ties left to right.

  const outputs = graph.nodes
    .map((node, index) => ({ node, index }))
    .filter(({ node }) => LEGACY_OUTPUT_TYPES.has(node.type))
    .sort((a, b) => a.node.position.y - b.node.position.y || a.node.position.x - b.node.position.x || a.index - b.index)
    .map(({ node }) => node);
  const sourcesOf = (id: string): LegacyNode[] => {
    const seen = new Set<string>();
    return graph.edges.flatMap((edge) => {
      if (edge.target !== id || seen.has(edge.source)) return [];
      seen.add(edge.source);
      const node = byId.get(edge.source);
      return node ? [node] : [];
    });
  };
  const feeds = new Map<string, Set<string>>();
  for (const edge of graph.edges) feeds.set(edge.source, (feeds.get(edge.source) ?? new Set()).add(edge.target));
  const feedsOnlyOne = (node: LegacyNode) => (feeds.get(node.id)?.size ?? 0) <= 1;

  /** The shape a source is on the new canvas: a text output's is its answer. */
  const shapeOfSource = (node: LegacyNode): Shape | undefined => shapes.get(node.type === "textOutput" ? `answer:${node.id}` : `node:${node.id}`);
  const topLevel = (): Shape[] => order.map((key) => shapes.get(key)!).filter((shape) => shape.parent === undefined);
  const membersOf = (groupKey: string): Shape[] => order.map((key) => shapes.get(key)!).filter((shape) => shape.parent === groupKey);
  const lowestOf = (members: ReadonlyArray<Shape>): Shape | undefined =>
    members.reduce<Shape | undefined>((low, shape) => (low === undefined || shape.y + shape.h > low.y + low.h ? shape : low), undefined);

  /** Where a text output's instructions go in a group: below its lowest member, or inside the label margin of an empty one. */
  const instructionsAt = (members: ReadonlyArray<Shape>, instructions: string) => {
    const lowest = lowestOf(members);
    const box = legacyTextBox(instructions);
    return { x: lowest ? lowest.x : SIDE_MARGIN, y: lowest ? lowest.y + lowest.h + INSTRUCTION_GAP : TOP_MARGIN, ...box };
  };
  const grownToHold = (group: { w: number; h: number }, at: Box) => ({ w: Math.max(group.w, at.x + at.w + SIDE_MARGIN), h: Math.max(group.h, at.y + at.h + SIDE_MARGIN) });

  /** A result's meta from its file's generation sidecar, else from what the output recorded. */
  const mediaResult = (input: {
    readonly medium: "image" | "video";
    readonly file: string;
    readonly sources: ReadonlyArray<string>;
    readonly fallback: { readonly model: string; readonly params: Params; readonly batchId: string; readonly runIndex: number; readonly runCount: number; readonly cost: number | null };
  }): LegacyResult => {
    const sidecar = facts.sidecars[input.file];
    if (sidecarKind(sidecar) !== input.medium) {
      const { model, params, ...rest } = input.fallback;
      return { sidecar: null, medium: input.medium, model, ...rest, sources: input.sources, recipe: resultRecipe(input.medium, model, params, input.sources, undefined) };
    }
    const model = sidecarText(sidecar, "model") ?? input.fallback.model;
    return {
      sidecar: `${input.file.replace(/\.[^.]*$/, "")}.json`,
      medium: input.medium,
      model,
      batchId: sidecarText(sidecar, "batchId") ?? input.fallback.batchId,
      runIndex: sidecarNumber(sidecar, "runIndex") ?? input.fallback.runIndex,
      runCount: sidecarNumber(sidecar, "runCount") ?? input.fallback.runCount,
      cost: sidecarNumber(sidecar, "cost") ?? null,
      sources: input.sources,
      recipe: resultRecipe(input.medium, model, sidecarParams(sidecar, input.medium), input.sources, sidecarText(sidecar, "prompt")),
    };
  };

  /** The file an old result names: its saved path's name, else its URL's, else a `data:` URL written out. */
  const resultFile = (entry: Readonly<Record<string, unknown>>): string | undefined => {
    const saved = typeof entry.savedPath === "string" ? baseName(entry.savedPath) : undefined;
    if (saved !== undefined && files.has(saved)) return saved;
    const linked = fileOfResultUrl(entry.url);
    if (linked !== undefined && files.has(linked)) return linked;
    return extract(entry.url, "")?.file;
  };

  for (const output of outputs) {
    const medium = OUTPUT_MEDIUM[output.type]!;
    const recipe = outputRecipe(output, facts.defaults);
    const sources = sourcesOf(output.id);
    const instructions = medium === "text" && typeof output.data.text === "string" && output.data.text.trim() !== "" ? output.data.text : undefined;
    const answer = medium === "text" && typeof output.data.result === "string" && output.data.result !== "" ? output.data.result : undefined;
    const groupRef = () => (medium === "text" ? minter.mint() : output.id);

    let recipeKey: string;
    let stood: Shape | undefined;
    const only = sources.length === 1 ? sources[0]! : undefined;
    if (only?.type === "group" && shapes.get(`node:${only.id}`)?.recipe === undefined && feedsOnlyOne(only) && instructions === undefined) {
      // Rule 1: the output's settings go on the one group wired into it.
      recipeKey = `node:${only.id}`;
      shapes.get(recipeKey)!.recipe = recipe;
      items.push(reportText.onGroup(output.id, medium, only.id));
    } else {
      recipeKey = `group:${output.id}`;
      // Rule 2: a box around unshared, top-level sources that overlaps nothing else.
      const members = sources.map((node) => ({ node, shape: shapeOfSource(node) }));
      const boxable =
        members.length > 0 &&
        members.every(
          ({ node, shape }) =>
            shape?.parent === undefined &&
            shape !== undefined &&
            (node.type === "prompt" || node.type === "image" || node.type === "video" || node.type === "textOutput") &&
            feedsOnlyOne(node),
        );
      let boxed = false;
      if (boxable) {
        const memberShapes = members.map(({ shape }) => shape!);
        const box = wrapBox(memberShapes.map(absolute))!;
        const relative = memberShapes.map((shape) => ({ ...shape, x: shape.x - box.x, y: shape.y - box.y, parent: recipeKey }));
        const grown = instructions === undefined ? box : { ...box, ...grownToHold(box, instructionsAt(relative, instructions)) };
        const inside = new Set(memberShapes.map((shape) => shape.key));
        if (topLevel().every((shape) => inside.has(shape.key) || !boxesOverlap(absolute(shape), grown))) {
          boxed = true;
          add({ key: recipeKey, kind: "group", ref: groupRef(), ...box, recipe }, "bottom");
          for (const shape of relative) shapes.set(shape.key, shape);
          items.push(reportText.boxed(output.id, medium, sources.length));
        }
      }
      if (!boxed) {
        // Rule 3: a recipe group where the output stood.
        stood = { key: recipeKey, kind: "group", ref: groupRef(), x: output.position.x, y: output.position.y, w: output.width ?? DEFAULT_SIZE.output.w, h: output.height ?? DEFAULT_SIZE.output.h, recipe };
        add(stood, "bottom");
        items.push(sources.length === 0 ? reportText.unwired(output.id, medium) : reportText.stood(output.id, medium));
      }
    }

    let instructionRef: string | undefined;
    if (instructions !== undefined) {
      const group = shapes.get(recipeKey)!;
      const members = membersOf(recipeKey);
      const at = instructionsAt(members, instructions);
      Object.assign(group, grownToHold(group, at));
      instructionRef = minter.mint();
      const prompt: Shape = { key: `instructions:${output.id}`, kind: "prompt", ref: instructionRef, ...at, parent: recipeKey, text: instructions, sized: false };
      // Members follow their group in paint order, the instructions last.
      const last = order.reduce((found, key, index) => (key === recipeKey || shapes.get(key)!.parent === recipeKey ? index : found), -1);
      shapes.set(prompt.key, prompt);
      order.splice(last + 1, 0, prompt.key);
    }

    const sourceKeys = sources.flatMap((node) => shapeOfSource(node)?.key ?? []);
    const row = { x: output.position.x, y: stood ? stood.y + stood.h + RESULT_GAP : output.position.y };
    const place = (shape: Shape) => {
      add({ ...shape, x: row.x, y: row.y });
      row.x += shape.w + RESULT_GAP;
    };
    /** A result for `file`: the shape already showing it becomes the result, else a new shape joins the row. */
    const land = (kind: "image" | "video", file: string, key: string, result: LegacyResult) => {
      const existing = onCanvas.get(`${kind}:${file}`);
      if (existing !== undefined) {
        const shape = shapes.get(existing)!;
        shape.result ??= result;
        return;
      }
      const size = kind === "image" ? sizeOf(file) : undefined;
      const h = MEDIA_WIDTH / (size ? size.w / size.h : kind === "video" ? VIDEO_ASPECT : 1);
      place({ key, kind, ref: minter.mint(), x: 0, y: 0, w: MEDIA_WIDTH, h, media: fileMedia(file, file, mimeOf(file), { w: MEDIA_WIDTH, h }, size), result });
    };
    const running = output.data.running !== undefined && output.data.running !== null;

    if (medium === "text") {
      if (answer !== undefined) {
        const found = facts.textSidecars
          .filter(({ sidecar }) => sidecarKind(sidecar) === "text" && record(sidecar)?.result === answer)
          .sort((a, b) => String(record(b.sidecar)?.createdAt ?? "").localeCompare(String(record(a.sidecar)?.createdAt ?? "")) || b.file.localeCompare(a.file))[0];
        const model = (found ? sidecarText(found.sidecar, "model") : undefined) ?? recipe.model;
        const result: LegacyResult = {
          sidecar: found ? found.file : null,
          medium: "text",
          model,
          batchId: (found ? sidecarText(found.sidecar, "batchId") : undefined) ?? `legacy-${output.id}`,
          runIndex: 1,
          runCount: 1,
          cost: found ? (sidecarNumber(found.sidecar, "cost") ?? null) : (finite(output.data.cost) ?? null),
          sources: sourceKeys,
          recipe: resultRecipe("text", model, {}, sourceKeys, found ? sidecarText(found.sidecar, "prompt") : undefined),
        };
        place({ key: `answer:${output.id}`, kind: "prompt", ref: output.id, x: 0, y: 0, w: MEDIA_WIDTH, h: legacyTextBox(answer, MEDIA_WIDTH).h, text: answer, sized: true, result });
        items.push(reportText.answer(output.id));
      } else {
        items.push(reportText.noAnswer(output.id));
      }
      if (instructionRef !== undefined) items.push(reportText.instructions(instructionRef));
      if (running) items.push(reportText.runDropped(output.id));
    }

    if (medium === "image") {
      const listed = (Array.isArray(output.data.results) ? (output.data.results as unknown[]) : []).map(record).filter((each) => each !== undefined);
      const runs = listed.map((entry, index) => ({ entry, index, runIndex: finite(entry.runIndex) ?? index })).sort((a, b) => a.runIndex - b.runIndex || a.index - b.index);
      let gone = 0;
      const seen = new Set<string>();
      for (const { entry, runIndex } of runs) {
        const file = resultFile(entry);
        if (file === undefined) {
          gone++;
          continue;
        }
        if (seen.has(file)) continue;
        seen.add(file);
        land(
          "image",
          file,
          `result:${output.id}:${runIndex}`,
          mediaResult({
            medium: "image",
            file,
            sources: sourceKeys,
            fallback: { model: recipe.model, params: recipe.params, batchId: `legacy-${output.id}`, runIndex: runIndex + 1, runCount: listed.length, cost: finite(entry.cost) ?? null },
          }),
        );
      }
      if (gone > 0) items.push(reportText.missingResults(gone, output.id));
      if (running) items.push(reportText.runDropped(output.id));
    }

    if (medium === "video") {
      const clips: Array<{ file: string; cost: number | null }> = [];
      let gone = 0;
      const finished = record(output.data.result);
      if (finished) {
        const file = resultFile(finished);
        if (file === undefined) gone++;
        else clips.push({ file, cost: finite(finished.cost) ?? null });
      }
      const job = record(output.data.job);
      const jobId = nonEmpty(job?.id);
      let render: LegacyRender | undefined;
      if (jobId !== undefined) {
        const found = facts.jobs.find((each) => each.id === jobId);
        if (found?.status === "done" && typeof found.savedPath === "string") {
          const file = baseName(found.savedPath);
          if (!clips.some((clip) => clip.file === file)) {
            if (files.has(file)) clips.push({ file, cost: finite(found.cost) ?? null });
            else gone++;
          }
        } else if (found?.status === "pending") {
          const params = record(found.params) ?? record(job?.params) ?? {};
          render = {
            jobId,
            startedAt: finite(found.startedAt) ?? finite(job?.startedAt) ?? 0,
            params: {
              prompt: typeof params.prompt === "string" ? params.prompt : "",
              model: nonEmpty(params.model) ?? recipe.model,
              duration: finite(params.duration) ?? null,
              resolution: nonEmpty(params.resolution) ?? null,
              size: nonEmpty(params.size) ?? null,
            },
          };
        } else if (found?.status === "failed") {
          items.push(reportText.renderFailed(output.id, nonEmpty(found.error) ?? "Generation failed."));
        } else {
          items.push(reportText.renderUnknown(output.id));
        }
      }
      const count = clips.length + (render ? 1 : 0);
      clips.forEach((clip, index) =>
        land(
          "video",
          clip.file,
          `result:${output.id}:${index}`,
          mediaResult({
            medium: "video",
            file: clip.file,
            sources: sourceKeys,
            fallback: { model: recipe.model, params: recipe.params, batchId: `legacy-${output.id}`, runIndex: index + 1, runCount: count, cost: clip.cost },
          }),
        ),
      );
      if (render) {
        const { prompt, model, duration, resolution, size } = render.params;
        const params: Params = { ...(duration === null ? {} : { duration }), ...(resolution === null ? {} : { resolution }), ...(size === null ? {} : { size }) };
        place({
          key: `render:${output.id}`,
          kind: "video",
          ref: minter.mint(),
          x: 0,
          y: 0,
          w: MEDIA_WIDTH,
          h: MEDIA_WIDTH / VIDEO_ASPECT,
          render,
          result: {
            sidecar: null,
            medium: "video",
            model,
            batchId: `legacy-${output.id}`,
            runIndex: clips.length + 1,
            runCount: count,
            cost: null,
            sources: sourceKeys,
            recipe: resultRecipe("video", model, params, sourceKeys, prompt === "" ? undefined : prompt),
          },
        });
        items.push(reportText.renderTracked(output.id));
      }
      if (gone > 0) items.push(reportText.missingResults(gone, output.id));
    }
  }

  // A picture or clip a run made is a result even when no output lists it any more.
  for (const key of order) {
    const shape = shapes.get(key)!;
    if ((shape.kind !== "image" && shape.kind !== "video") || shape.result !== undefined || shape.media?.kind !== "file") continue;
    if (sidecarKind(facts.sidecars[shape.media.file]) !== shape.kind) continue;
    shape.result = mediaResult({
      medium: shape.kind,
      file: shape.media.file,
      sources: [],
      fallback: { model: "", params: {}, batchId: `legacy-${shape.ref}`, runIndex: 1, runCount: 1, cost: null },
    });
  }

  const list = order.map((key) => shapes.get(key)!);
  const plain = (kind: LegacyShapeKind) => list.filter((shape) => shape.kind === kind && shape.result === undefined).length;
  const counts: ImportCounts = {
    prompts: plain("prompt"),
    images: plain("image"),
    videos: plain("video"),
    groups: list.filter((shape) => shape.kind === "group" && shape.recipe === undefined).length,
    recipeGroups: list.filter((shape) => shape.kind === "group" && shape.recipe !== undefined).length,
    results: list.filter((shape) => shape.result !== undefined).length,
    pages: plain("page"),
    motions: plain("motion"),
    wiresRemoved: graph.edges.length,
    filesExtracted: extractions.size,
  };

  return {
    canvas: { shapes: list },
    extractions: [...extractions.values()],
    report: {
      importedAt: options.importedAt,
      source: options.source,
      counts,
      items: [
        ...(graph.edges.length > 0 ? [reportText.wires(graph.edges.length)] : []),
        ...options.notes,
        ...items,
        ...(facts.hasThreads ? [reportText.chats()] : []),
      ],
      seen: false,
    },
  };
};

export type { GroupRecipe };
