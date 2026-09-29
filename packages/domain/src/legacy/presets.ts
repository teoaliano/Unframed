/**
 * The legacy preset converter (spec 11): an old `presets.json` entry, a fragment of the old
 * graph, as a spec 06 preset. An output makes it a recipe group, no output a plain group.
 * The library converts on every read and never writes the result back, so this is pure
 * and idempotent. The content's tldraw schema is left for the engine to stamp.
 */
import { wrapBox, type Box } from "../grouping.ts";
import { imageDimensions } from "../imageDimensions.ts";
import { isHttpsLink, linkedVideoName } from "../media.ts";
import type { Preset } from "../presetRules.ts";
import type { GroupRecipe } from "../recipeRules.ts";
import { projectSlug } from "../slug.ts";
import type { LegacyMedia, LegacyResult } from "./canvas.ts";
import { LEGACY_OUTPUT_TYPES, record, type LegacyGraph, type LegacyNode } from "./graph.ts";
import {
  answerOf,
  answerShape,
  belowLowest,
  DEFAULT_SIZE,
  grownToHold,
  instructionsOf,
  instructionsShape,
  MEDIA_WIDTH,
  nonEmpty,
  positiveAspect,
  resultRecipe,
  VIDEO_ASPECT,
  type Shape,
} from "./layout.ts";
import { mimeByExtension, parseDataUrl } from "./media.ts";
import { RefMinter } from "./minter.ts";
import { legacyPromptTexts, normalise } from "./normalise.ts";
import { OUTPUT_MEDIUM, outputRecipe, type LegacyDefaults } from "./recipes.ts";
import { legacyRecords } from "./records.ts";
import type { LegacyMedium } from "./report.ts";

/** A converted old preset: spec 06's record with the notes of what was not kept. */
export type ConvertedPreset = Preset & { readonly legacy: true; readonly notes: ReadonlyArray<string> };

export const presetNotes = {
  results: "Its old results were not kept.",
  textStep: (id: string) => `The text step @${id} lost its model. Run it with the composer.`,
  extraOutput: (id: string, medium: LegacyMedium) => `@${id}, a second ${medium} output, was not kept.`,
  flattened: (id: string) => `Group @${id} was flattened into the preset's group.`,
  artifacts: "Pages and motions are not kept in a preset.",
};

/** The line the Library shows under a converted preset's summary. */
export const legacyPresetLine = (notes: ReadonlyArray<string>): string => (notes.length === 0 ? "From the old app." : `From the old app. Not kept: ${notes.join(" ")}`);

const PAGE = "page:page";
const STEP_GAP = 28;

const isOldPreset = (entry: Record<string, unknown>): boolean =>
  entry.format === undefined && typeof entry.id === "string" && Array.isArray(record(entry.fragment)?.nodes);

/** An old fragment's media as a preset carries it: a pointer to a file of the target project, bytes inline, or a link. */
const mediaOf = (node: LegacyNode, w: number, h: number): LegacyMedia | undefined => {
  const fileName = typeof node.data.fileName === "string" ? node.data.fileName : "";
  const file = nonEmpty(node.data.file);
  if (file !== undefined && !file.includes("/") && !file.includes("\\") && !file.includes("..")) {
    return { kind: "preset-file", file, name: fileName || file, mime: mimeByExtension(file) ?? "application/octet-stream", w: Math.round(w), h: Math.round(h) };
  }
  const url = node.data.dataUrl;
  if (node.type === "video" && typeof url === "string" && isHttpsLink(url)) {
    return { kind: "link", url, name: fileName || linkedVideoName(url), w: Math.round(720 * (w / h)), h: 720 };
  }
  const parsed = parseDataUrl(url);
  if (!parsed || typeof url !== "string") return undefined;
  const size = parsed.mime.startsWith("image/") ? imageDimensions(parsed.bytes) : undefined;
  return { kind: "data", url, name: fileName || "upload", mime: parsed.mime, w: size?.w ?? Math.round(w), h: size?.h ?? Math.round(h) };
};

/** A prompt, image or video node as a preset shape at `at`. */
const inputShape = (node: LegacyNode, at: { x: number; y: number }, parent?: string): Shape | undefined => {
  const base = { key: `node:${node.id}`, ref: node.id, ...at, ...(parent === undefined ? {} : { parent }) };
  if (node.type === "prompt") {
    return { ...base, kind: "prompt", w: node.width ?? DEFAULT_SIZE.prompt.w, h: node.height ?? DEFAULT_SIZE.prompt.h, text: typeof node.data.text === "string" ? node.data.text : "", sized: node.data.sized === true };
  }
  if (node.type !== "image" && node.type !== "video") return undefined;
  const w = node.width ?? MEDIA_WIDTH;
  const stated = positiveAspect(node.data.aspect);
  const media = mediaOf(node, w, w / (stated ?? (node.type === "video" ? VIDEO_ASPECT : 1)));
  const aspect = stated ?? (media?.kind === "data" ? media.w / media.h : node.type === "video" ? VIDEO_ASPECT : 1);
  return { ...base, kind: node.type, w, h: w / aspect, ...(media ? { media } : {}) };
};

/** A text answer's result meta. A text step lost its model, so its `model` is empty. */
const answerResult = (output: LegacyNode, model: string): LegacyResult => ({
  sidecar: null,
  medium: "text",
  model,
  batchId: `legacy-${output.id}`,
  runIndex: 1,
  runCount: 1,
  cost: null,
  sources: [],
  recipe: resultRecipe("text", model, {}, [], undefined),
});

/** Puts `shape` in `group` below its lowest member, growing the box to hold it. */
const placeBelow = (group: Shape, shapes: Shape[], shape: Shape) => {
  const placed: Shape = { ...shape, ...belowLowest(shapes.filter((each) => each.parent === group.key)), parent: group.key };
  Object.assign(group, grownToHold(group, placed));
  shapes.push(placed);
};

/**
 * An old preset as a spec 06 preset with its notes, or `undefined` for an entry that is not
 * one (it has a `format`, or no fragment of nodes). `defaults` are the app's models, for an
 * output that names none. The numbered steps are spec 11's.
 */
export const convertPreset = (entry: unknown, options: { readonly defaults: LegacyDefaults }): ConvertedPreset | undefined => {
  const value = record(entry);
  if (!value || !isOldPreset(value)) return undefined;
  const fragment = record(value.fragment)!;
  const notes: string[] = [];
  // Step 1: legacy types migrate as a project's do; run markers and produced output are never read, and old results are noted.
  const { graph } = normalise({ nodes: fragment.nodes, edges: Array.isArray(fragment.edges) ? fragment.edges : [] } as unknown as LegacyGraph);
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const minter = new RefMinter(
    graph.nodes.map((node) => node.id),
    legacyPromptTexts(graph.nodes),
  );
  const produced = graph.nodes.some(
    (node) => (node.type === "imageOutput" && Array.isArray(node.data.results) && node.data.results.length > 0) || (node.type === "videoOutput" && record(node.data.result) !== undefined),
  );
  if (produced) notes.push(presetNotes.results);

  // Step 2: the recipe output feeds no other output; the topmost, ties left to right.
  const outputs = graph.nodes.filter((node) => LEGACY_OUTPUT_TYPES.has(node.type));
  const feedsAnOutput = (node: LegacyNode) => graph.edges.some((edge) => edge.source === node.id && LEGACY_OUTPUT_TYPES.has(byId.get(edge.target)?.type ?? ""));
  const recipeOutput = outputs.filter((node) => !feedsAnOutput(node)).sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x)[0];
  const recipe: GroupRecipe | undefined = recipeOutput ? outputRecipe(recipeOutput, options.defaults) : undefined;

  // Step 3: a text step that feeds another output keeps its instructions and answer; any other output goes.
  const kept: Shape[] = [];
  for (const output of outputs) {
    if (output === recipeOutput) continue;
    const medium = OUTPUT_MEDIUM[output.type]!;
    if (medium !== "text" || !feedsAnOutput(output)) {
      notes.push(presetNotes.extraOutput(output.id, medium));
      continue;
    }
    const instructions = instructionsOf(output);
    const prompt = instructions === undefined ? undefined : { ...instructionsShape(output, instructions, minter.mint()), ...output.position };
    const answer = answerOf(output);
    if (prompt) kept.push(prompt);
    if (answer !== undefined) kept.push({ ...answerShape(output, answer, answerResult(output, "")), x: output.position.x, y: prompt ? prompt.y + prompt.h + STEP_GAP : output.position.y });
    notes.push(presetNotes.textStep(output.id));
  }

  // Step 5 comes before step 4, which puts things in the group: the one top-level group, or a new one around every kept top-level input.
  const shapes: Shape[] = [];
  const topInputs = graph.nodes.filter((node) => node.parentId === undefined && (node.type === "prompt" || node.type === "image" || node.type === "video" || node.type === "group"));
  const onlyGroup = topInputs.length === 1 && topInputs[0]!.type === "group" ? topInputs[0]! : undefined;
  let group: Shape;
  if (onlyGroup) {
    group = { key: `node:${onlyGroup.id}`, kind: "group", ref: onlyGroup.id, ...onlyGroup.position, w: onlyGroup.width ?? DEFAULT_SIZE.group.w, h: onlyGroup.height ?? DEFAULT_SIZE.group.h };
    shapes.push(group, ...graph.nodes.filter((node) => node.parentId === onlyGroup.id).flatMap((node) => inputShape(node, node.position, group.key) ?? []));
    for (const shape of kept) placeBelow(group, shapes, shape);
  } else {
    const loose: Shape[] = [];
    for (const node of topInputs) {
      if (node.type !== "group") {
        const shape = inputShape(node, node.position);
        if (shape) loose.push(shape);
        continue;
      }
      notes.push(presetNotes.flattened(node.id));
      for (const member of graph.nodes.filter((each) => each.parentId === node.id)) {
        const shape = inputShape(member, { x: node.position.x + member.position.x, y: node.position.y + member.position.y });
        if (shape) loose.push(shape);
      }
    }
    loose.push(...kept);
    const box: Box = wrapBox(loose) ?? {
      x: recipeOutput?.position.x ?? 0,
      y: recipeOutput?.position.y ?? 0,
      w: recipeOutput?.width ?? DEFAULT_SIZE.output.w,
      h: recipeOutput?.height ?? DEFAULT_SIZE.output.h,
    };
    group = { key: "group:preset", kind: "group", ref: projectSlug(typeof value.name === "string" ? value.name : "") || minter.mint(), ...box };
    shapes.push(group, ...loose.map((shape) => ({ ...shape, x: shape.x - box.x, y: shape.y - box.y, parent: group.key })));
  }

  // Step 4: a text recipe output's answer, then its instructions at the bottom of the group.
  if (recipeOutput && recipe?.medium === "text") {
    const answer = answerOf(recipeOutput);
    if (answer !== undefined) placeBelow(group, shapes, answerShape(recipeOutput, answer, answerResult(recipeOutput, recipe.model)));
    const instructions = instructionsOf(recipeOutput);
    if (instructions !== undefined) placeBelow(group, shapes, instructionsShape(recipeOutput, instructions, minter.mint()));
  }
  if (recipe) group.recipe = recipe;

  // Step 6: pages and motions are not kept. Step 7: edges are never read.
  if (graph.nodes.some((node) => node.type === "page" || node.type === "motion")) notes.push(presetNotes.artifacts);

  // Steps 8 and 9: media as the records carry it, and the entry's own fields.
  const records = legacyRecords(shapes, { page: PAGE, shape: (key) => `shape:${key}`, asset: (key) => `asset:${key}` });
  return {
    format: 2,
    id: value.id as string,
    source: "user",
    ...(typeof value.savedAt === "string" ? { savedAt: value.savedAt } : {}),
    name: typeof value.name === "string" ? value.name : "",
    summary: typeof value.summary === "string" ? value.summary : "",
    ...(typeof value.needs === "string" && value.needs !== "" ? { needs: value.needs } : {}),
    kind: recipe ? "recipe" : "group",
    ...(recipe ? { medium: recipe.medium } : {}),
    content: { schema: null, shapes: records.shapes, rootShapeIds: [`shape:${group.key}`], assets: records.assets, bindings: [] },
    legacy: true,
    notes,
  };
};
