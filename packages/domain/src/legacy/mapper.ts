/**
 * The legacy mapper (spec 11): an old graph, after the reader and the normaliser, as the
 * new canvas. Prompts, media, groups, pages and motions keep their `@id`s, positions and
 * sizes; each output becomes a recipe group (on its one group, around its sources, or
 * where it stood) and its results become result shapes with approximate recipes; wires
 * disappear. Pure: `facts` is everything the engine read from disk.
 */
import { boxesOverlap, wrapBox, type Box } from "../grouping.ts";
import { imageDimensions, type PixelSize } from "../imageDimensions.ts";
import { isHttpsLink, linkedVideoName } from "../media.ts";
import type { GroupRecipe } from "../recipeRules.ts";
import type { LegacyCanvas, LegacyMedia, LegacyRender, LegacyResult, LegacyResultRecipe, LegacyShapeKind } from "./canvas.ts";
import { finite, LEGACY_OUTPUT_TYPES, record, type LegacyGraph, type LegacyNode } from "./graph.ts";
import {
  answerOf,
  answerShape,
  belowLowest,
  DEFAULT_SIZE,
  grownToHold,
  instructionsOf,
  instructionsShape,
  legacyTextBox,
  MEDIA_WIDTH,
  nonEmpty,
  positiveAspect,
  resultRecipe,
  VIDEO_ASPECT,
  type Shape,
} from "./layout.ts";
import { baseName, extractedFileName, fileOfResultUrl, mimeByExtension, parseDataUrl } from "./media.ts";
import { RefMinter } from "./minter.ts";
import { legacyPromptTexts } from "./normalise.ts";
import { OUTPUT_MEDIUM, outputRecipe, sidecarKind, sidecarNumber, sidecarParams, sidecarString, type LegacyDefaults } from "./recipes.ts";
import { reportText, type ImportCounts, type ImportReport, type ImportSource, type ReportItem } from "./report.ts";

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

const RESULT_GAP = 24;

type Params = LegacyResultRecipe["params"];

/** What a result records when its file has no generation sidecar. */
interface Fallback {
  readonly model: string;
  readonly params: Params;
  readonly batchId: string;
  readonly runIndex: number;
  readonly runCount: number;
  readonly cost: number | null;
}

export const mapProject = (graph: LegacyGraph, facts: ProjectFacts, options: MapOptions): Mapped => {
  const files = new Set(facts.files);
  const shapes = new Map<string, Shape>();
  const order: string[] = [];
  const items: ReportItem[] = [];
  const extractions = new Map<string, Extraction>();
  const extractedSizes = new Map<string, PixelSize>();
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

  const mediaNode = (node: LegacyNode, kind: "image" | "video"): { w: number; h: number; media?: LegacyMedia } => {
    const { data } = node;
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
    } else if (kind === "video" && typeof data.dataUrl === "string" && isHttpsLink(data.dataUrl)) {
      media = { kind: "link", url: data.dataUrl, name: fileName || linkedVideoName(data.dataUrl), w: Math.round(720 * aspect), h: 720 };
    } else {
      const extracted = extract(data.dataUrl, fileName);
      if (extracted) {
        aspect = stated ?? (extracted.size ? extracted.size.w / extracted.size.h : fallback);
        media = fileMedia(extracted.file, fileName, extracted.mime, { w, h: w / aspect }, extracted.size);
      }
    }
    if (!media && named !== undefined) items.push(reportText.missingFile(kind === "image" ? "Image" : "Video", node.id, named));
    return { w, h: w / aspect, ...(media ? { media } : {}) };
  };

  const inputs = graph.nodes.filter((node) => !LEGACY_OUTPUT_TYPES.has(node.type));
  for (const node of [...inputs.filter((each) => each.parentId === undefined), ...inputs.filter((each) => each.parentId !== undefined)]) {
    const { data } = node;
    const base = { key: `node:${node.id}`, ref: node.id, x: node.position.x, y: node.position.y, ...(node.parentId === undefined ? {} : { parent: `node:${node.parentId}` }) };
    switch (node.type) {
      case "prompt":
        add({ ...base, kind: "prompt", w: node.width ?? DEFAULT_SIZE.prompt.w, h: node.height ?? DEFAULT_SIZE.prompt.h, text: typeof data.text === "string" ? data.text : "", sized: data.sized === true });
        break;
      case "image":
      case "video":
        add({ ...base, kind: node.type, ...mediaNode(node, node.type) });
        break;
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
  // Outputs: each one's recipe group, instructions and results.

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

  /** A result's meta from its file's generation sidecar, else from what the output recorded. */
  const mediaResult = (medium: "image" | "video", file: string, sources: ReadonlyArray<string>, fallback: Fallback): LegacyResult => {
    const sidecar = facts.sidecars[file];
    if (sidecarKind(sidecar) !== medium) {
      const { model, params, ...rest } = fallback;
      return { sidecar: null, medium, model, ...rest, sources, recipe: resultRecipe(medium, model, params, sources, undefined) };
    }
    const model = sidecarString(sidecar, "model") ?? fallback.model;
    return {
      sidecar: `${file.replace(/\.[^.]*$/, "")}.json`,
      medium,
      model,
      batchId: sidecarString(sidecar, "batchId") ?? fallback.batchId,
      runIndex: sidecarNumber(sidecar, "runIndex") ?? fallback.runIndex,
      runCount: sidecarNumber(sidecar, "runCount") ?? fallback.runCount,
      cost: sidecarNumber(sidecar, "cost") ?? null,
      sources,
      recipe: resultRecipe(medium, model, sidecarParams(sidecar, medium), sources, sidecarString(sidecar, "prompt")),
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

  /** Where an output's new result shapes go: a row from its position, or 24 below a recipe group standing there. */
  const resultRow = (output: LegacyNode, stood: Shape | undefined) => {
    const row = { x: output.position.x, y: stood ? stood.y + stood.h + RESULT_GAP : output.position.y };
    return (shape: Shape) => {
      add({ ...shape, x: row.x, y: row.y });
      row.x += shape.w + RESULT_GAP;
    };
  };

  /** A result for `file`: the shape already showing it becomes the result, else a new shape joins the row. */
  const land = (place: (shape: Shape) => void, kind: "image" | "video", file: string, key: string, result: LegacyResult) => {
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

  /** Where an output's recipe goes: rule 1 (its one group), rule 2 (a box around its sources) or rule 3 (where it stood). */
  const placeRecipe = (output: LegacyNode, recipe: GroupRecipe, sources: ReadonlyArray<LegacyNode>, instructions: string | undefined) => {
    const medium = recipe.medium;
    const groupRef = () => (medium === "text" ? minter.mint() : output.id);
    const only = sources.length === 1 ? sources[0]! : undefined;
    if (only?.type === "group" && shapes.get(`node:${only.id}`)?.recipe === undefined && feedsOnlyOne(only) && instructions === undefined) {
      shapes.get(`node:${only.id}`)!.recipe = recipe;
      items.push(reportText.onGroup(output.id, medium, only.id));
      return { key: `node:${only.id}`, stood: undefined };
    }
    const key = `group:${output.id}`;
    const members = sources.map((node) => ({ node, shape: shapeOfSource(node) }));
    const boxable =
      members.length > 0 &&
      members.every(
        ({ node, shape }) =>
          shape !== undefined &&
          shape.parent === undefined &&
          (node.type === "prompt" || node.type === "image" || node.type === "video" || node.type === "textOutput") &&
          feedsOnlyOne(node),
      );
    if (boxable) {
      const memberShapes = members.map(({ shape }) => shape!);
      const box = wrapBox(memberShapes.map(absolute))!;
      const relative = memberShapes.map((shape) => ({ ...shape, x: shape.x - box.x, y: shape.y - box.y, parent: key }));
      // Measured with the instructions in place: they would grow the box.
      const grown = instructions === undefined ? box : { ...box, ...grownToHold(box, { ...belowLowest(relative), ...legacyTextBox(instructions) }) };
      const inside = new Set(memberShapes.map((shape) => shape.key));
      if (topLevel().every((shape) => inside.has(shape.key) || !boxesOverlap(absolute(shape), grown))) {
        add({ key, kind: "group", ref: groupRef(), ...box, recipe }, "bottom");
        for (const shape of relative) shapes.set(shape.key, shape);
        items.push(reportText.boxed(output.id, medium, sources.length));
        return { key, stood: undefined };
      }
    }
    const stood: Shape = { key, kind: "group", ref: groupRef(), x: output.position.x, y: output.position.y, w: output.width ?? DEFAULT_SIZE.output.w, h: output.height ?? DEFAULT_SIZE.output.h, recipe };
    add(stood, "bottom");
    items.push(sources.length === 0 ? reportText.unwired(output.id, medium) : reportText.stood(output.id, medium));
    return { key, stood };
  };

  /** A text output's instructions as the last member of its recipe group, growing the box. */
  const addInstructions = (output: LegacyNode, groupKey: string, instructions: string): string => {
    const group = shapes.get(groupKey)!;
    const prompt = { ...instructionsShape(output, instructions, minter.mint()), ...belowLowest(membersOf(groupKey)), parent: groupKey };
    Object.assign(group, grownToHold(group, prompt));
    // Members follow their group in paint order, the instructions last.
    const last = order.reduce((found, key, index) => (key === groupKey || shapes.get(key)!.parent === groupKey ? index : found), -1);
    shapes.set(prompt.key, prompt);
    order.splice(last + 1, 0, prompt.key);
    return prompt.ref;
  };

  const textAnswer = (output: LegacyNode, recipe: GroupRecipe, sources: ReadonlyArray<string>, place: (shape: Shape) => void) => {
    const answer = answerOf(output);
    if (answer === undefined) {
      items.push(reportText.noAnswer(output.id));
      return;
    }
    const found = facts.textSidecars
      .filter(({ sidecar }) => sidecarKind(sidecar) === "text" && record(sidecar)?.result === answer)
      .sort((a, b) => String(record(b.sidecar)?.createdAt ?? "").localeCompare(String(record(a.sidecar)?.createdAt ?? "")) || b.file.localeCompare(a.file))[0];
    const model = (found ? sidecarString(found.sidecar, "model") : undefined) ?? recipe.model;
    place(
      answerShape(output, answer, {
        sidecar: found ? found.file : null,
        medium: "text",
        model,
        batchId: (found ? sidecarString(found.sidecar, "batchId") : undefined) ?? `legacy-${output.id}`,
        runIndex: 1,
        runCount: 1,
        cost: found ? (sidecarNumber(found.sidecar, "cost") ?? null) : (finite(output.data.cost) ?? null),
        sources,
        recipe: resultRecipe("text", model, {}, sources, found ? sidecarString(found.sidecar, "prompt") : undefined),
      }),
    );
    items.push(reportText.answer(output.id));
  };

  const imageResults = (output: LegacyNode, recipe: GroupRecipe, sources: ReadonlyArray<string>, place: (shape: Shape) => void) => {
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
      const fallback = { model: recipe.model, params: recipe.params, batchId: `legacy-${output.id}`, runIndex: runIndex + 1, runCount: listed.length, cost: finite(entry.cost) ?? null };
      land(place, "image", file, `result:${output.id}:${runIndex}`, mediaResult("image", file, sources, fallback));
    }
    if (gone > 0) items.push(reportText.missingResults(gone, output.id));
  };

  const videoResults = (output: LegacyNode, recipe: GroupRecipe, sources: ReadonlyArray<string>, place: (shape: Shape) => void) => {
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
    clips.forEach((clip, index) => {
      const fallback = { model: recipe.model, params: recipe.params, batchId: `legacy-${output.id}`, runIndex: index + 1, runCount: count, cost: clip.cost };
      land(place, "video", clip.file, `result:${output.id}:${index}`, mediaResult("video", clip.file, sources, fallback));
    });
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
          sources,
          recipe: resultRecipe("video", model, params, sources, prompt === "" ? undefined : prompt),
        },
      });
      items.push(reportText.renderTracked(output.id));
    }
    if (gone > 0) items.push(reportText.missingResults(gone, output.id));
  };

  const mapped = new Set<string>();
  const mapOutput = (output: LegacyNode) => {
    if (mapped.has(output.id)) return;
    mapped.add(output.id);
    const sources = sourcesOf(output.id);
    // A text output feeding this one is mapped first, so its answer is there to be boxed and recorded.
    for (const source of sources) if (source.type === "textOutput") mapOutput(source);
    const recipe = outputRecipe(output, facts.defaults);
    const instructions = recipe.medium === "text" ? instructionsOf(output) : undefined;
    const placed = placeRecipe(output, recipe, sources, instructions);
    const instructionRef = instructions === undefined ? undefined : addInstructions(output, placed.key, instructions);
    const sourceKeys = sources.flatMap((node) => shapeOfSource(node)?.key ?? []);
    const place = resultRow(output, placed.stood);
    const running = output.data.running !== undefined && output.data.running !== null;
    if (recipe.medium === "text") {
      textAnswer(output, recipe, sourceKeys, place);
      if (instructionRef !== undefined) items.push(reportText.instructions(instructionRef));
      if (running) items.push(reportText.runDropped(output.id));
    } else if (recipe.medium === "image") {
      imageResults(output, recipe, sourceKeys, place);
      if (running) items.push(reportText.runDropped(output.id));
    } else videoResults(output, recipe, sourceKeys, place);
  };

  // Top to bottom, ties left to right.
  graph.nodes
    .map((node, index) => ({ node, index }))
    .filter(({ node }) => LEGACY_OUTPUT_TYPES.has(node.type))
    .sort((a, b) => a.node.position.y - b.node.position.y || a.node.position.x - b.node.position.x || a.index - b.index)
    .forEach(({ node }) => mapOutput(node));

  // A picture or clip a run made is a result even when no output lists it any more.
  for (const key of order) {
    const shape = shapes.get(key)!;
    if ((shape.kind !== "image" && shape.kind !== "video") || shape.result !== undefined || shape.media?.kind !== "file") continue;
    if (sidecarKind(facts.sidecars[shape.media.file]) !== shape.kind) continue;
    shape.result = mediaResult(shape.kind, shape.media.file, [], { model: "", params: {}, batchId: `legacy-${shape.ref}`, runIndex: 1, runCount: 1, cost: null });
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

/**
 * Every file name the mapper may read facts about: the files media nodes name, the files
 * results name by saved path or URL, and the clips `jobs` saved. The engine reads the
 * pixel size and sidecar of each of these that is in the folder.
 */
export const legacyReferencedFiles = (graph: LegacyGraph, jobs: ReadonlyArray<LegacyJob>): string[] => {
  const names = new Set<string>();
  const named = (value: unknown) => {
    if (typeof value === "string" && value !== "") names.add(value);
  };
  const ofResult = (value: unknown) => {
    const entry = record(value);
    if (!entry) return;
    if (typeof entry.savedPath === "string") named(baseName(entry.savedPath));
    named(fileOfResultUrl(entry.url));
  };
  for (const node of graph.nodes) {
    named(node.data.file);
    if (Array.isArray(node.data.results)) for (const entry of node.data.results) ofResult(entry);
    ofResult(node.data.result);
  }
  for (const job of jobs) if (typeof job.savedPath === "string") named(baseName(job.savedPath));
  return [...names];
};
