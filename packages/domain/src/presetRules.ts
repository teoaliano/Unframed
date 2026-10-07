/**
 * Presets (spec 06): a saved group as tldraw content, how a selection becomes one, how one
 * goes back onto a canvas, and how the Library dialog lists them. Pure: the web hands in
 * tldraw's own copy of the selection and gets content back to put on the page.
 */
import { mayBeGroupMember, wrapBox, type Box } from "./grouping.ts";
import { refOnPaste, slugName } from "./groupRules.ts";
import { readGroupRecipe, type RecipeMedium } from "./recipeRules.ts";
import { META_REF_TYPES, nextRef, rewriteRichTextTokens } from "./refs.ts";

/** A shape record as tldraw's copy produces it. */
export interface ContentShape {
  readonly id: string;
  readonly typeName: "shape";
  readonly type: string;
  readonly parentId: string;
  readonly x: number;
  readonly y: number;
  readonly props: Readonly<Record<string, unknown>>;
  readonly meta: Readonly<Record<string, unknown>>;
  readonly [key: string]: unknown;
}

export interface ContentAsset {
  readonly id: string;
  readonly typeName: "asset";
  readonly type: string;
  readonly props: Readonly<Record<string, unknown>>;
  readonly [key: string]: unknown;
}

/**
 * tldraw content: the shape records, the asset records, the bindings among them and the
 * schema they were written with, so tldraw's migrations apply on insert. A preset's content
 * holds exactly one root shape, the group.
 */
export interface PresetContent {
  readonly schema: unknown;
  readonly shapes: ReadonlyArray<ContentShape>;
  readonly rootShapeIds: ReadonlyArray<string>;
  readonly assets: ReadonlyArray<ContentAsset>;
  readonly bindings?: ReadonlyArray<unknown>;
  readonly [key: string]: unknown;
}

export type PresetKind = "recipe" | "group";
export type PresetSource = "user" | "system";

/** One entry of `presets.json` (or a system preset, which is never stored). */
export interface Preset {
  readonly format: 2;
  readonly id: string;
  readonly source: PresetSource;
  /** Set by the engine at save. System presets, and presets spec 11 converts, have none. */
  readonly savedAt?: string;
  readonly name: string;
  readonly summary: string;
  readonly needs?: string;
  readonly kind: PresetKind;
  readonly medium?: RecipeMedium;
  readonly content: PresetContent;
  /** Spec 11: converted from an old entry on read, never written back. */
  readonly legacy?: true;
  /** Spec 11: what the conversion could not keep. */
  readonly notes?: ReadonlyArray<string>;
}

export const PRESET_NOT_ONE_GROUP_MESSAGE = "A preset is one group.";
export const PRESET_SPLIT_MESSAGE = "A preset is one group. Select one group, or shapes outside any group.";
export const PRESET_EMPTY_NAME_MESSAGE = "Give it a name.";

const PROJECT_FILE = "project-file:";
const PRESET_FILE = "preset-file:";
const PAGE = "page:page";

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

// ---------------------------------------------------------------------------------------
// From a selection to a preset.

/** How a selection becomes one group, if it can. */
export type PresetCase =
  /** Exactly one group, with or without loose pages and motions: the preset is that group. */
  | { readonly kind: "group"; readonly groupId: string }
  /** No group, at least one groupable shape: the preset wraps them in a new group. */
  | { readonly kind: "wrap"; readonly ids: ReadonlyArray<string> }
  /** Two or more groups, or a group and loose groupable shapes. */
  | { readonly kind: "split" }
  /** Nothing that may be in a group. */
  | { readonly kind: "empty" };

/** Which of the four cases a selection is. A shape inside a selected group is that group's, not loose. */
export const presetCase = (selection: ReadonlyArray<{ readonly id: string; readonly type: string; readonly parent?: string | undefined }>): PresetCase => {
  const groups = selection.filter((shape) => shape.type === "frame");
  const chosen = new Set(groups.map((shape) => shape.id));
  const loose = selection.filter((shape) => shape.type !== "frame" && mayBeGroupMember(shape.type) && !(shape.parent !== undefined && chosen.has(shape.parent)));
  if (groups.length === 1 && loose.length === 0) return { kind: "group", groupId: groups[0]!.id };
  if (groups.length === 0 && loose.length > 0) return { kind: "wrap", ids: loose.map((shape) => shape.id) };
  if (groups.length > 0) return { kind: "split" };
  return { kind: "empty" };
};

/** What a copy never carries (spec 03's copy rule): a run marker, a run error, an unfilled placeholder's result meta. */
const stripRunMeta = (meta: Readonly<Record<string, unknown>>): Record<string, unknown> => {
  const unframed = record(meta.unframed);
  if (!unframed) return { ...meta };
  const { run: _run, runError: _runError, result, ...rest } = unframed;
  const unfilled = record(result)?.sidecar === null;
  const kept = unfilled || result === undefined ? rest : { ...rest, result };
  const { unframed: _unframed, ...others } = meta;
  return Object.keys(kept).length > 0 ? { ...others, unframed: kept } : others;
};

const presetPointer = (project: string, src: unknown): unknown =>
  typeof src === "string" && src.startsWith(PROJECT_FILE) ? `${PRESET_FILE}${project}/${src.slice(PROJECT_FILE.length)}` : src;

const descendants = (shapes: ReadonlyArray<ContentShape>, rootIds: ReadonlyArray<string>): Set<string> => {
  const kept = new Set(rootIds);
  for (let grew = true; grew; ) {
    grew = false;
    for (const shape of shapes) {
      if (!kept.has(shape.id) && kept.has(shape.parentId)) {
        kept.add(shape.id);
        grew = true;
      }
    }
  }
  return kept;
};

const freshShapeId = (shapes: ReadonlyArray<ContentShape>): string => {
  const taken = new Set(shapes.map((shape) => shape.id));
  let id = "shape:preset";
  for (let n = 2; taken.has(id); n++) id = `shape:preset-${n}`;
  return id;
};

export type PresetFromSelection =
  | { readonly ok: true; readonly content: PresetContent; readonly kind: PresetKind; readonly medium?: RecipeMedium; readonly members: number }
  | { readonly ok: false; readonly error: string };

/**
 * A preset's content from tldraw's copy of the selection (its roots in page space) and
 * the page bounds of those roots. One group is kept with its members; loose groupable
 * shapes are wrapped in a new group named after the preset. Pages and motions are never
 * saved. Every `project-file:` source becomes a `preset-file:<project>/<file>` pointer and
 * every run marker, run error and unfilled result meta is removed.
 */
export const presetFromSelection = (
  captured: { readonly project: string; readonly content: PresetContent; readonly bounds: Readonly<Record<string, Box>> },
  details: { readonly name: string },
): PresetFromSelection => {
  const { content } = captured;
  const byId = new Map(content.shapes.map((shape) => [shape.id, shape]));
  const roots = content.rootShapeIds.flatMap((id) => byId.get(id) ?? []);
  const found = presetCase(roots.map((shape) => ({ id: shape.id, type: shape.type })));
  if (found.kind === "split") return { ok: false, error: PRESET_SPLIT_MESSAGE };
  if (found.kind === "empty") return { ok: false, error: PRESET_NOT_ONE_GROUP_MESSAGE };

  let groupId: string;
  let shapes: ContentShape[];
  if (found.kind === "group") {
    groupId = found.groupId;
    const kept = descendants(content.shapes, [groupId]);
    shapes = content.shapes.filter((shape) => kept.has(shape.id));
  } else {
    const members = roots.filter((shape) => found.ids.includes(shape.id));
    const box = wrapBox(members.map((shape) => captured.bounds[shape.id] ?? { x: shape.x, y: shape.y, w: 0, h: 0 }))!;
    groupId = freshShapeId(content.shapes);
    const kept = descendants(content.shapes, found.ids);
    const group: ContentShape = {
      id: groupId,
      typeName: "shape",
      type: "frame",
      parentId: PAGE,
      index: "a1",
      x: box.x,
      y: box.y,
      rotation: 0,
      isLocked: false,
      opacity: 1,
      props: { w: box.w, h: box.h, name: slugName(details.name) || nextRef(content.shapes), color: "black" },
      meta: {},
    };
    shapes = [
      group,
      ...content.shapes
        .filter((shape) => kept.has(shape.id))
        .map((shape) => (found.ids.includes(shape.id) ? { ...shape, parentId: groupId, x: shape.x - box.x, y: shape.y - box.y } : shape)),
    ];
  }

  shapes = shapes.map((shape) => ({ ...shape, meta: stripRunMeta(shape.meta) }));
  const shapeIds = new Set(shapes.map((shape) => shape.id));
  const assetIds = new Set(shapes.map((shape) => shape.props.assetId).filter((id): id is string => typeof id === "string"));
  const assets = content.assets.filter((asset) => assetIds.has(asset.id)).map((asset) => ({ ...asset, props: { ...asset.props, src: presetPointer(captured.project, asset.props.src) } }));
  const bindings = (content.bindings ?? []).filter((binding) => {
    const ends = record(binding);
    return ends !== undefined && shapeIds.has(String(ends.fromId)) && shapeIds.has(String(ends.toId));
  });
  const made: PresetContent = { ...content, shapes, rootShapeIds: [groupId], assets, bindings };
  const described = describePresetContent(made);
  if (!described.ok) return { ok: false, error: PRESET_NOT_ONE_GROUP_MESSAGE };
  const { ok: _ok, ...facts } = described;
  return { ok: true, content: made, ...facts, members: shapes.filter((shape) => shape.parentId === groupId).length };
};

export type DescribedPreset = { readonly ok: true; readonly kind: PresetKind; readonly medium?: RecipeMedium } | { readonly ok: false };

/** The kind and medium of preset content, read from its one root group; not ok unless there is exactly one. */
export const describePresetContent = (content: unknown): DescribedPreset => {
  const value = record(content);
  if (!value || !Array.isArray(value.shapes) || !Array.isArray(value.rootShapeIds) || value.rootShapeIds.length !== 1) return { ok: false };
  const [rootId] = value.rootShapeIds as unknown[];
  const root = (value.shapes as unknown[]).map(record).find((shape) => shape?.id === rootId);
  if (root?.type !== "frame") return { ok: false };
  const recipe = readGroupRecipe(record(record(root.meta)?.unframed)?.recipe);
  return recipe ? { ok: true, kind: "recipe", medium: recipe.medium } : { ok: true, kind: "group" };
};

// ---------------------------------------------------------------------------------------
// From a preset back onto a canvas.

export interface Instantiated {
  readonly content: PresetContent;
  /** The group's shape id in `content`. */
  readonly rootId: string;
}

/**
 * Preset content made ready for a canvas: a shape whose `@id` is a name keeps it, suffixed
 * while `taken` (every `@id` on the canvas) holds it, and a shape with a minted `@id` gets
 * a fresh one from `mint`. Every whole token in the preset's prompts that names one of its
 * own shapes follows it to the new `@id`; any other token is left exactly as typed.
 */
export const instantiate = (content: PresetContent, taken: Iterable<string>, mint: () => string): Instantiated => {
  const used = new Set(taken);
  const ids = new Map<string, string>();
  const shapes = content.shapes.map((shape): ContentShape => {
    if (shape.type === "frame") {
      const name = typeof shape.props.name === "string" ? shape.props.name : "";
      const next = refOnPaste(name, used, mint);
      used.add(next);
      if (name !== "") ids.set(name, next);
      return { ...shape, props: { ...shape.props, name: next } };
    }
    if (!META_REF_TYPES.has(shape.type)) return shape;
    const ref = typeof shape.meta.ref === "string" ? shape.meta.ref : undefined;
    const next = refOnPaste(ref, used, mint);
    used.add(next);
    if (ref !== undefined) ids.set(ref, next);
    return { ...shape, meta: { ...shape.meta, ref: next } };
  });
  const rewritten = shapes.map((shape) =>
    shape.type === "text" && shape.props.richText !== undefined ? { ...shape, props: { ...shape.props, richText: rewriteRichTextTokens(shape.props.richText, ids) } } : shape,
  );
  return { content: { ...content, shapes: rewritten }, rootId: content.rootShapeIds[0]! };
};

/** Where bounds go to be centred on `centre`: their new top-left corner. */
export const placeAt = (bounds: Box, centre: { readonly x: number; readonly y: number }): { x: number; y: number } => ({
  x: centre.x - bounds.w / 2,
  y: centre.y - bounds.h / 2,
});

export type PresetFile =
  | {
      /** The project a `preset-file:` pointer names; `''` means the project the preset goes into. */
      readonly project: string;
      readonly file: string;
    }
  /** Bytes a converted old preset (spec 11) carries inline, written into the project on insert. */
  | { readonly dataUrl: string };

const pointerOf = (src: unknown): PresetFile | undefined => {
  if (typeof src !== "string") return undefined;
  if (src.startsWith("data:")) return { dataUrl: src };
  if (!src.startsWith(PRESET_FILE)) return undefined;
  const rest = src.slice(PRESET_FILE.length);
  const slash = rest.indexOf("/");
  return slash < 0 ? undefined : { project: rest.slice(0, slash), file: rest.slice(slash + 1) };
};

const pointerKey = (file: PresetFile) => ("dataUrl" in file ? file.dataUrl : `${file.project}/${file.file}`);

/** Every distinct file a preset's assets point at, and every `data:` URL one carries (spec 11), in order: what the media copier copies in. */
export const presetFiles = (content: PresetContent): PresetFile[] => {
  const seen = new Map<string, PresetFile>();
  for (const asset of content.assets) {
    const pointer = pointerOf(asset.props.src);
    if (pointer && !seen.has(pointerKey(pointer))) seen.set(pointerKey(pointer), pointer);
  }
  return [...seen.values()];
};

export type CopiedFile = { readonly file: string } | { readonly missing: true };

/**
 * The content with each pointer replaced by its copy's `project-file:` marker, `copied`
 * answering `presetFiles(content)` in order. Every asset gets a fresh id from `newAssetId`,
 * so an insert never shares an asset with shapes already on the canvas. An asset whose file
 * is missing is dropped and its shapes arrive empty. `missing` counts the missing files.
 */
export const resolvePresetFiles = (
  content: PresetContent,
  copied: ReadonlyArray<CopiedFile>,
  newAssetId: () => string,
): { readonly content: PresetContent; readonly missing: number } => {
  const answers = new Map(presetFiles(content).map((pointer, index) => [pointerKey(pointer), copied[index]]));
  const renamed = new Map<string, string | null>();
  const assets: ContentAsset[] = [];
  for (const asset of content.assets) {
    const pointer = pointerOf(asset.props.src);
    const answer = pointer ? answers.get(pointerKey(pointer)) : undefined;
    if (pointer && (answer === undefined || "missing" in answer)) {
      renamed.set(asset.id, null);
      continue;
    }
    const id = newAssetId();
    renamed.set(asset.id, id);
    assets.push({ ...asset, id, props: { ...asset.props, src: answer && "file" in answer ? `${PROJECT_FILE}${answer.file}` : asset.props.src } });
  }
  const shapes = content.shapes.map((shape) => {
    const assetId = shape.props.assetId;
    if (typeof assetId !== "string" || !renamed.has(assetId)) return shape;
    return { ...shape, props: { ...shape.props, assetId: renamed.get(assetId) ?? null } };
  });
  const missing = [...answers.values()].filter((answer) => answer === undefined || "missing" in answer).length;
  return { content: { ...content, shapes, assets }, missing };
};

// ---------------------------------------------------------------------------------------
// The Library dialog's list.

/** What the list reads of a preset. */
export type PresetSummary = Pick<Preset, "id" | "source" | "name" | "summary" | "kind"> & Partial<Pick<Preset, "savedAt" | "medium" | "needs">>;

export type LibrarySort = "newest" | "oldest" | "az" | "za";

export interface LibraryControls {
  readonly query: string;
  readonly type: "all" | PresetKind;
  readonly source: "any" | PresetSource;
  readonly sort: LibrarySort;
  /** 1-based. */
  readonly page: number;
}

export const LIBRARY_PAGE_SIZE = 10;

export interface LibraryView<P extends PresetSummary> {
  readonly items: ReadonlyArray<P>;
  /** The page shown, clamped to the pages there are. */
  readonly page: number;
  readonly pages: number;
  /** Presets that match, over every page. */
  readonly total: number;
}

/** Undated user presets rank above every system preset and below every dated one. */
const UNDATED = -1;
const SYSTEM = -2;

const rank = (preset: PresetSummary): number => {
  if (preset.source === "system") return SYSTEM;
  const time = preset.savedAt === undefined ? Number.NaN : Date.parse(preset.savedAt);
  return Number.isNaN(time) ? UNDATED : time;
};

/**
 * The Library dialog's list: `presets` (user presets, then system presets) filtered by
 * type, source and query, then sorted, then cut into pages of 10. Sorting is stable;
 * Oldest and Z–A are the exact reverses of Newest and A–Z.
 */
export const libraryView = <P extends PresetSummary>(presets: ReadonlyArray<P>, controls: LibraryControls): LibraryView<P> => {
  const query = controls.query.trim().toLowerCase();
  const matching = presets.filter(
    (preset) =>
      (controls.type === "all" || preset.kind === controls.type) &&
      (controls.source === "any" || preset.source === controls.source) &&
      (query === "" || `${preset.name} ${preset.summary}`.toLowerCase().includes(query)),
  );
  const newest = () => [...matching].sort((a, b) => rank(b) - rank(a));
  const az = () => [...matching].sort((a, b) => a.name.localeCompare(b.name));
  const sorted =
    controls.sort === "newest" ? newest() : controls.sort === "oldest" ? newest().reverse() : controls.sort === "az" ? az() : az().reverse();
  const pages = Math.max(1, Math.ceil(sorted.length / LIBRARY_PAGE_SIZE));
  const page = Math.min(pages, Math.max(1, Math.floor(controls.page) || 1));
  return { items: sorted.slice((page - 1) * LIBRARY_PAGE_SIZE, page * LIBRARY_PAGE_SIZE), page, pages, total: sorted.length };
};

/** The pagination's count: `11–20 of 23`. */
export const libraryRange = (view: LibraryView<PresetSummary>): string => {
  const first = (view.page - 1) * LIBRARY_PAGE_SIZE + 1;
  return `${first}–${first + view.items.length - 1} of ${view.total}`;
};

/** The controls after a change: a new query, filter or sort goes back to page 1. */
export const changeLibrary = (controls: LibraryControls, patch: Partial<LibraryControls>): LibraryControls => {
  const next = { ...controls, ...patch };
  const reset = (["query", "type", "source", "sort"] as const).some((key) => patch[key] !== undefined && patch[key] !== controls[key]);
  return reset ? { ...next, page: 1 } : next;
};
