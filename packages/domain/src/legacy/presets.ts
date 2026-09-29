/**
 * The legacy preset converter (spec 11): an old `presets.json` entry, a fragment of the old
 * graph, as a spec 06 preset. An output makes it a recipe group, no output a plain group.
 * The library converts on every read and never writes the result back, so this is pure
 * and idempotent. The content's tldraw schema is left for the engine to stamp.
 */
import { wrapBox, type Box } from "../grouping.ts";
import { imageDimensions } from "../imageDimensions.ts";
import { linkedVideoName } from "../media.ts";
import type { Preset } from "../presetRules.ts";
import type { GroupRecipe } from "../recipeRules.ts";
import { projectSlug } from "../slug.ts";
import type { LegacyMedia, LegacyShape } from "./canvas.ts";
import { finite, LEGACY_OUTPUT_TYPES, record, type LegacyGraph, type LegacyNode } from "./graph.ts";
import { legacyTextBox, resultRecipe } from "./mapper.ts";
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

const MEDIA_WIDTH = 240;
const SIDE_MARGIN = 28;
const TOP_MARGIN = 56;
const GAP = 28;
const DEFAULT_SIZE = { prompt: { w: 240, h: 160 }, group: { w: 420, h: 280 }, output: { w: 320, h: 200 } } as const;
const PAGE = "page:page";

type Shape = { -readonly [K in keyof LegacyShape]: LegacyShape[K] };

const text = (value: unknown): string | undefined => (typeof value === "string" && value !== "" ? value : undefined);

const isOldPreset = (entry: Record<string, unknown>): boolean =>
  entry.format === undefined && typeof entry.id === "string" && Array.isArray(record(entry.fragment)?.nodes);

/** An old fragment's media as a preset carries it: a pointer to a file of the target project, bytes inline, or a link. */
const mediaOf = (node: LegacyNode, w: number, h: number): LegacyMedia | undefined => {
  const fileName = typeof node.data.fileName === "string" ? node.data.fileName : "";
  const file = text(node.data.file);
  if (file !== undefined && !file.includes("/") && !file.includes("\\") && !file.includes("..")) {
    return { kind: "preset-file", file, name: fileName || file, mime: mimeByExtension(file) ?? "application/octet-stream", w: Math.round(w), h: Math.round(h) };
  }
  const url = node.data.dataUrl;
  if (node.type === "video" && typeof url === "string" && /^https:\/\/.+/.test(url)) {
    return { kind: "link", url, name: fileName || linkedVideoName(url), w: Math.round(720 * (w / h)), h: 720 };
  }
  const parsed = parseDataUrl(url);
  if (!parsed || typeof url !== "string") return undefined;
  const size = parsed.mime.startsWith("image/") ? imageDimensions(parsed.bytes) : undefined;
  return { kind: "data", url, name: fileName || "upload", mime: parsed.mime, w: size?.w ?? Math.round(w), h: size?.h ?? Math.round(h) };
};

/**
 * An old preset as a spec 06 preset, or `undefined` for an entry that is not one (no
 * `format` and a fragment of nodes). `defaults` are the app's models, for an output that
 * names none.
 */
export const convertPreset = (entry: unknown, options: { readonly defaults: LegacyDefaults }): { readonly preset: ConvertedPreset; readonly notes: ReadonlyArray<string> } | undefined => {
  const value = record(entry);
  if (!value || !isOldPreset(value)) return undefined;
  const fragment = record(value.fragment)!;
  const notes: string[] = [];
  const { graph } = normalise({ nodes: fragment.nodes, edges: Array.isArray(fragment.edges) ? fragment.edges : [] } as unknown as LegacyGraph);
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const minter = new RefMinter(
    graph.nodes.map((node) => node.id),
    legacyPromptTexts(graph.nodes),
  );

  // 1. Run markers and produced output are dropped.
  const produced = graph.nodes.some((node) => (node.type === "imageOutput" && Array.isArray(node.data.results) && node.data.results.length > 0) || (node.type === "videoOutput" && record(node.data.result) !== undefined));
  if (produced) notes.push(presetNotes.results);

  // 2. The recipe output: not a source of another output, topmost, ties left to right.
  const outputs = graph.nodes.filter((node) => LEGACY_OUTPUT_TYPES.has(node.type));
  const feedsAnOutput = (node: LegacyNode) => graph.edges.some((edge) => edge.source === node.id && byId.get(edge.target) !== undefined && LEGACY_OUTPUT_TYPES.has(byId.get(edge.target)!.type));
  const recipeOutput = outputs
    .filter((node) => !feedsAnOutput(node))
    .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x)[0];
  const recipe: GroupRecipe | undefined = recipeOutput ? outputRecipe(recipeOutput, options.defaults) : undefined;

  const shapes: Shape[] = [];
  /** A text output's answer as a text result. `model` is empty for a text step, which lost its model. */
  const answerOf = (output: LegacyNode, at: { x: number; y: number }, model: string): Shape | undefined => {
    const answer = text(output.data.result);
    if (answer === undefined) return undefined;
    return {
      key: `answer:${output.id}`,
      kind: "prompt",
      ref: output.id,
      ...at,
      w: MEDIA_WIDTH,
      h: legacyTextBox(answer, MEDIA_WIDTH).h,
      text: answer,
      sized: true,
      result: { sidecar: null, medium: "text", model, batchId: `legacy-${output.id}`, runIndex: 1, runCount: 1, cost: null, sources: [], recipe: resultRecipe("text", model, {}, [], undefined) },
    };
  };
  const instructionsOf = (output: LegacyNode, at: { x: number; y: number }): Shape | undefined => {
    const instructions = typeof output.data.text === "string" && output.data.text.trim() !== "" ? output.data.text : undefined;
    if (instructions === undefined) return undefined;
    return { key: `instructions:${output.id}`, kind: "prompt", ref: minter.mint(), ...at, ...legacyTextBox(instructions), text: instructions, sized: false };
  };

  // 3. A text step that feeds another output keeps its instructions and answer; any other output goes.
  const kept: Shape[] = [];
  for (const output of outputs) {
    if (output === recipeOutput) continue;
    const medium = OUTPUT_MEDIUM[output.type]!;
    if (medium === "text" && feedsAnOutput(output)) {
      const instructions = instructionsOf(output, output.position);
      const answer = answerOf(output, instructions ? { x: output.position.x, y: output.position.y + instructions.h + GAP } : output.position, "");
      kept.push(...[instructions, answer].filter((shape): shape is Shape => shape !== undefined));
      notes.push(presetNotes.textStep(output.id));
    } else notes.push(presetNotes.extraOutput(output.id, medium));
  }

  const inputShape = (node: LegacyNode, at: { x: number; y: number }, parent?: string): Shape | undefined => {
    const base = { key: `node:${node.id}`, ref: node.id, ...at, ...(parent === undefined ? {} : { parent }) };
    if (node.type === "prompt") {
      return { ...base, kind: "prompt", w: node.width ?? DEFAULT_SIZE.prompt.w, h: node.height ?? DEFAULT_SIZE.prompt.h, text: typeof node.data.text === "string" ? node.data.text : "", sized: node.data.sized === true };
    }
    if (node.type === "image" || node.type === "video") {
      const w = node.width ?? MEDIA_WIDTH;
      const stated = finite(node.data.aspect);
      let aspect = stated !== undefined && stated > 0 ? stated : node.type === "video" ? 16 / 9 : 1;
      const media = mediaOf(node, w, w / aspect);
      if (media?.kind === "data" && (stated === undefined || stated <= 0) && media.w > 0 && media.h > 0) aspect = media.w / media.h;
      return { ...base, kind: node.type, w, h: w / aspect, ...(media ? { media } : {}) };
    }
    return undefined;
  };

  // 5. The group: the one top-level group, or a new one around every kept top-level input.
  const topInputs = graph.nodes.filter((node) => node.parentId === undefined && (node.type === "prompt" || node.type === "image" || node.type === "video" || node.type === "group"));
  const onlyGroup = topInputs.length === 1 && topInputs[0]!.type === "group" ? topInputs[0]! : undefined;
  let group: Shape;
  if (onlyGroup) {
    group = { key: `node:${onlyGroup.id}`, kind: "group", ref: onlyGroup.id, ...onlyGroup.position, w: onlyGroup.width ?? DEFAULT_SIZE.group.w, h: onlyGroup.height ?? DEFAULT_SIZE.group.h };
    const members = graph.nodes.filter((node) => node.parentId === onlyGroup.id).flatMap((node) => inputShape(node, node.position, group.key) ?? []);
    shapes.push(group, ...members);
    // Kept text steps go inside it, below its lowest member.
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
    const box = wrapBox(loose.map((shape) => ({ x: shape.x, y: shape.y, w: shape.w, h: shape.h })));
    const at: Box = box ?? { x: recipeOutput?.position.x ?? 0, y: recipeOutput?.position.y ?? 0, w: recipeOutput?.width ?? DEFAULT_SIZE.output.w, h: recipeOutput?.height ?? DEFAULT_SIZE.output.h };
    group = { key: "group:preset", kind: "group", ref: projectSlug(typeof value.name === "string" ? value.name : "") || minter.mint(), ...at };
    shapes.push(group, ...loose.map((shape) => ({ ...shape, x: shape.x - at.x, y: shape.y - at.y, parent: group.key })));
  }

  // 4. A text recipe output's answer, then its instructions at the bottom of the group.
  if (recipeOutput && OUTPUT_MEDIUM[recipeOutput.type] === "text") {
    const answer = answerOf(recipeOutput, { x: 0, y: 0 }, recipe?.model ?? options.defaults.text);
    if (answer) placeBelow(group, shapes, answer);
    const instructions = instructionsOf(recipeOutput, { x: 0, y: 0 });
    if (instructions) placeBelow(group, shapes, instructions);
  }
  if (recipe) group.recipe = recipe;

  // 6. Pages and motions are not kept.
  if (graph.nodes.some((node) => node.type === "page" || node.type === "motion")) notes.push(presetNotes.artifacts);

  const records = legacyRecords(shapes, { page: PAGE, shape: (key) => `shape:${key}`, asset: (key) => `asset:${key}` });
  const preset: ConvertedPreset = {
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
  return { preset, notes };
};

/** Puts `shape` in `group` below its lowest member with a gap of 28, or inside the label margin of an empty one, growing the box. */
const placeBelow = (group: Shape, shapes: Shape[], shape: Shape) => {
  const members = shapes.filter((each) => each.parent === group.key);
  const lowest = members.reduce<Shape | undefined>((low, each) => (low === undefined || each.y + each.h > low.y + low.h ? each : low), undefined);
  const placed: Shape = { ...shape, x: lowest ? lowest.x : SIDE_MARGIN, y: lowest ? lowest.y + lowest.h + GAP : TOP_MARGIN, parent: group.key };
  group.w = Math.max(group.w, placed.x + placed.w + SIDE_MARGIN);
  group.h = Math.max(group.h, placed.y + placed.h + SIDE_MARGIN);
  shapes.push(placed);
};

