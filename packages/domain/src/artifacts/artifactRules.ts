/**
 * Artifact rules (spec 09): file names, tag injection, where an agent-made artifact goes,
 * the artifact URLs, the add-a-parameter instruction and the few facts read from a file.
 */
import { projectSlug } from "../slug.ts";
import { ADD_PARAMETER_TEMPLATE } from "./prompts.ts";

export type ArtifactKind = "page" | "motion";

export const isArtifactKind = (type: unknown): type is ArtifactKind => type === "page" || type === "motion";

/** An artifact file may be at most this many bytes once its tags are in (2 MiB). */
export const ARTIFACT_SIZE_LIMIT = 2_097_152;

/** An artifact title the agent or a render passes is cut to this many characters. */
export const ARTIFACT_TITLE_MAX = 120;

/** Agent-created sizes; the add menu makes both kinds 480 by 320. */
export const AGENT_ARTIFACT_SIZE: Readonly<Record<ArtifactKind, { readonly w: number; readonly h: number }>> = {
  page: { w: 480, h: 320 },
  motion: { w: 480, h: 300 },
};

/**
 * `<epochMs>-<slug>[-<n>].<ext>`: the slug of `title`, or of `fallback` when the title is
 * empty, or `upload` when the slug comes out empty. `n` starts at 1 and counts up while
 * `exists` says the name is taken.
 */
export const artifactFileName = (input: {
  readonly title: string;
  readonly fallback: string;
  readonly now: number;
  readonly exists: (name: string) => boolean;
  readonly ext?: string;
}): string => {
  const title = input.title.trim();
  const slug = projectSlug(title === "" ? input.fallback : title) || "upload";
  const ext = input.ext ?? "html";
  const base = `${input.now}-${slug}`;
  let name = `${base}.${ext}`;
  for (let n = 1; input.exists(name); n++) name = `${base}-${n}.${ext}`;
  return name;
};

export const RUNTIME_TAG = '<script src="hyperframes-runtime.js" data-hyperframes-preview-runtime></script>';
export const BRIDGE_TAG = '<script src="unframed-dials.js"></script>';

const HAS_RUNTIME = /data-hyperframes-preview-runtime|hyperframes-runtime\.js|hyperframe\.runtime\.iife\.js/i;
const HAS_BRIDGE = /unframed-dials\.js/i;
const HEAD_CLOSE = /<\/head\s*>/i;
const BODY_OPEN = /<body(?:\s[^>]*)?>/i;

/**
 * The runtime and bridge tags a written file carries: a motion gets the runtime, then the
 * bridge; an agent's page gets the bridge only. A tag the document already has (by its
 * marker) is skipped, so reading a file back and writing it again adds nothing.
 */
export const injectTags = (html: string, kind: ArtifactKind): string => {
  const tags: string[] = [];
  if (kind === "motion" && !HAS_RUNTIME.test(html)) tags.push(RUNTIME_TAG);
  if (!HAS_BRIDGE.test(html)) tags.push(BRIDGE_TAG);
  if (tags.length === 0) return html;
  const block = tags.join("\n");
  const head = HEAD_CLOSE.exec(html);
  if (head) return `${html.slice(0, head.index)}${block}\n${html.slice(head.index)}`;
  const body = BODY_OPEN.exec(html);
  if (body) {
    const end = body.index + body[0].length;
    return `${html.slice(0, end)}\n${block}${html.slice(end)}`;
  }
  return `${block}\n${html}`;
};

/** The title an artifact shows: its title, else its original file name without `.html` or `.htm`, else nothing. */
export const artifactTitle = (props: { readonly title?: unknown; readonly fileName?: unknown }): string => {
  const title = typeof props.title === "string" ? props.title.trim() : "";
  if (title !== "") return title;
  const fileName = typeof props.fileName === "string" ? props.fileName.trim() : "";
  return fileName.replace(/\.html?$/i, "");
};

export interface PlacementBox {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Where an agent-created artifact goes: right of the selection (right edge + 60, top of the topmost), else (80, 80). */
export const placeBesideSelection = (selected: ReadonlyArray<PlacementBox>): { x: number; y: number } => {
  if (selected.length === 0) return { x: 80, y: 80 };
  return {
    x: Math.max(...selected.map((box) => box.x + box.w)) + 60,
    y: Math.min(...selected.map((box) => box.y)),
  };
};

/**
 * The loopback name artifact documents load under: the one the app is NOT using, so the
 * browser runs them in a process of their own (index contract 9).
 */
export const previewHostFor = (appHostname: string): string => {
  const host = appHostname.toLowerCase();
  return host === "localhost" ? "127.0.0.1" : "localhost";
};

/** An artifact's URL on the preview origin; a motion opens its viewer on the composition. */
export const artifactUrl = (input: {
  readonly appHostname: string;
  readonly previewPort: number;
  readonly project: string;
  readonly file: string;
  readonly kind: ArtifactKind;
}): string => {
  const base = `http://${previewHostFor(input.appHostname)}:${input.previewPort}/p/${encodeURIComponent(input.project)}`;
  return input.kind === "page"
    ? `${base}/${encodeURIComponent(input.file)}`
    : `${base}/hyperframes-viewer.html?c=${encodeURIComponent(input.file)}`;
};

/** The instruction the editor's Add a parameter box sends: "parameters" when the text has the word "and" or a comma. */
export const addParameterInstruction = (input: { readonly wanted: string; readonly kind: ArtifactKind; readonly title: string }): string => {
  const wanted = input.wanted.trim();
  const plural = /,|\band\b/i.test(wanted);
  // Function replacers, so a `$` the person typed is taken literally.
  return ADD_PARAMETER_TEMPLATE.replace("<wanted>", () => wanted)
    .replace("<a parameter | parameters>", plural ? "parameters" : "a parameter")
    .replace("<kind>", input.kind)
    .replace("<title>", () => input.title);
};

/** A composition's pixel size, from its root's `data-width` and `data-height`; 16:9 when absent. */
export const compositionSize = (html: string): { w: number; h: number } => {
  const root = /<[a-z][^>]*\bdata-composition-id\s*=[^>]*>/i.exec(html)?.[0] ?? /<[a-z][^>]*\bid\s*=\s*["']?root\b[^>]*>/i.exec(html)?.[0];
  const read = (name: string) => {
    const value = root === undefined ? undefined : new RegExp(`\\b${name}\\s*=\\s*["']?(\\d+(?:\\.\\d+)?)`, "i").exec(root)?.[1];
    const number = value === undefined ? NaN : Number(value);
    return Number.isFinite(number) && number > 0 ? number : undefined;
  };
  const w = read("data-width");
  const h = read("data-height");
  return w !== undefined && h !== undefined ? { w, h } : { w: 16, h: 9 };
};

/** At most this many artifacts run through the selection, and at most this many pinned per project. */
export const LIVE_SELECTED_LIMIT = 3;
export const PIN_LIMIT = 3;
export const PIN_LIMIT_MESSAGE = "Three are already playing. Stop one first.";

/**
 * Which artifacts run a live frame: the selected ones (the three nearest the viewport
 * centre when more are selected), the pinned ones, the one open in the editor and the one
 * whose parameters panel is open on the canvas.
 */
export const liveArtifacts = (input: {
  readonly selected: ReadonlyArray<{ readonly id: string; readonly centre: { readonly x: number; readonly y: number } }>;
  readonly pinned: ReadonlyArray<string>;
  readonly editing?: string | undefined;
  readonly tuning?: string | undefined;
  readonly viewportCentre: { readonly x: number; readonly y: number };
}): Set<string> => {
  const distance = (point: { readonly x: number; readonly y: number }) => Math.hypot(point.x - input.viewportCentre.x, point.y - input.viewportCentre.y);
  const nearest = [...input.selected].sort((a, b) => distance(a.centre) - distance(b.centre) || (a.id < b.id ? -1 : 1)).slice(0, LIVE_SELECTED_LIMIT);
  const live = new Set(nearest.map((shape) => shape.id));
  for (const id of input.pinned) live.add(id);
  if (input.editing !== undefined) live.add(input.editing);
  if (input.tuning !== undefined) live.add(input.tuning);
  return live;
};

/** Whether a live frame is so far off screen (more than one viewport width beyond it) that it unmounts. */
export const farOffscreen = (box: PlacementBox, viewport: PlacementBox): boolean => {
  const margin = viewport.w;
  return (
    box.x + box.w < viewport.x - margin ||
    box.x > viewport.x + viewport.w + margin ||
    box.y + box.h < viewport.y - margin ||
    box.y > viewport.y + viewport.h + margin
  );
};

/** A snapshot still fits a shape of this size when neither side changed by more than 10 %. */
export const snapshotFits = (snapshot: { readonly w: number; readonly h: number }, shape: { readonly w: number; readonly h: number }): boolean =>
  Math.abs(shape.w - snapshot.w) <= snapshot.w * 0.1 && Math.abs(shape.h - snapshot.h) <= snapshot.h * 0.1;

/** Where a motion's snapshot catches it: 1 s in, or half way through a motion shorter than 1 s. An unknown length counts as long enough. */
export const snapshotSeekSeconds = (duration: number): number => (Number.isFinite(duration) && duration > 0 && duration < 1 ? duration / 2 : 1);

/** A snapshot's file in the cache folder: named after the artifact file and its size. */
export const snapshotFileName = (file: string, size: { readonly w: number; readonly h: number }): string =>
  `${file}-${Math.round(size.w)}x${Math.round(size.h)}.png`;

/** Reads a snapshot file name back: the artifact file and the size, or nothing for any other name. */
export const parseSnapshotFileName = (name: string): { file: string; w: number; h: number } | undefined => {
  const match = /^(.+\.html?)-(\d+)x(\d+)\.png$/i.exec(name);
  return match ? { file: match[1]!, w: Number(match[2]), h: Number(match[3]) } : undefined;
};
