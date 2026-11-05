import { isArtifactScale } from "@unframed/contracts";
import { projectSlug } from "../slug.ts";
import { ADD_PARAMETER_TEMPLATE } from "./prompts.ts";

export type ArtifactKind = "page" | "motion" | "component";

export const isArtifactKind = (type: unknown): type is ArtifactKind => type === "page" || type === "motion" || type === "component";

export const ARTIFACT_SIZE_LIMIT = 2_097_152;

export const ARTIFACT_TITLE_MAX = 120;

export const AGENT_ARTIFACT_SIZE: Readonly<Record<ArtifactKind, { readonly w: number; readonly h: number }>> = {
  page: { w: 480, h: 320 },
  motion: { w: 480, h: 300 },
  component: { w: 480, h: 320 },
};

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
export const TOKENS_TAG = '<script src="unframed-tokens.js"></script>';

const HAS_RUNTIME = /data-hyperframes-preview-runtime|hyperframes-runtime\.js|hyperframe\.runtime\.iife\.js/i;
const HAS_BRIDGE = /unframed-dials\.js/i;
const HAS_TOKENS = /unframed-tokens\.js/i;
const HEAD_OPEN = /<head(?:\s[^>]*)?>/i;
const HEAD_CLOSE = /<\/head\s*>/i;
const BODY_OPEN = /<body(?:\s[^>]*)?>/i;

export const injectTags = (html: string, kind: ArtifactKind): string => {
  const tags: string[] = [];
  if (kind === "motion" && !HAS_RUNTIME.test(html)) tags.push(RUNTIME_TAG);
  if (!HAS_BRIDGE.test(html)) tags.push(BRIDGE_TAG);
  let out = html;
  if (tags.length > 0) {
    const block = tags.join("\n");
    const head = HEAD_CLOSE.exec(html);
    if (head) out = `${html.slice(0, head.index)}${block}\n${html.slice(head.index)}`;
    else {
      const body = BODY_OPEN.exec(html);
      if (body) {
        const end = body.index + body[0].length;
        out = `${html.slice(0, end)}\n${block}${html.slice(end)}`;
      } else out = `${block}\n${html}`;
    }
  }
  if (HAS_TOKENS.test(out)) return out;
  const opening = HEAD_OPEN.exec(out);
  if (opening) {
    const end = opening.index + opening[0].length;
    return `${out.slice(0, end)}${TOKENS_TAG}\n${out.slice(end)}`;
  }
  const body = BODY_OPEN.exec(out);
  if (body) {
    const end = body.index + body[0].length;
    return `${out.slice(0, end)}\n${TOKENS_TAG}${out.slice(end)}`;
  }
  return `${TOKENS_TAG}\n${out}`;
};

export const artifactTitle = (props: { readonly title?: unknown; readonly fileName?: unknown }): string => {
  const title = typeof props.title === "string" ? props.title.trim() : "";
  if (title !== "") return title;
  const fileName = typeof props.fileName === "string" ? props.fileName.trim() : "";
  return fileName.replace(/\.html?$/i, "");
};

interface PlacementBox {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export const placeBesideSelection = (selected: ReadonlyArray<PlacementBox>): { x: number; y: number } => {
  if (selected.length === 0) return { x: 80, y: 80 };
  return {
    x: Math.max(...selected.map((box) => box.x + box.w)) + 60,
    y: Math.min(...selected.map((box) => box.y)),
  };
};

export const previewHostFor = (appHostname: string): string => {
  const host = appHostname.toLowerCase();
  return host === "localhost" ? "127.0.0.1" : "localhost";
};

export const artifactUrl = (input: {
  readonly appHostname: string;
  readonly previewPort: number;
  readonly project: string;
  readonly file: string;
  readonly kind: ArtifactKind;
  readonly editor?: boolean;
}): string => {
  const base = `http://${previewHostFor(input.appHostname)}:${input.previewPort}/p/${encodeURIComponent(input.project)}`;
  if (input.kind !== "motion") return `${base}/${encodeURIComponent(input.file)}`;
  const editor = input.editor === true ? "&ui=editor" : "";
  return `${base}/hyperframes-viewer.html?c=${encodeURIComponent(input.file)}${editor}`;
};

export const addParameterInstruction = (input: { readonly wanted: string; readonly kind: ArtifactKind; readonly title: string }): string => {
  const wanted = input.wanted.trim();
  const plural = /,|\band\b/i.test(wanted);
  return ADD_PARAMETER_TEMPLATE.replace("<wanted>", () => wanted)
    .replace("<a parameter | parameters>", plural ? "parameters" : "a parameter")
    .replace("<kind>", input.kind)
    .replace("<title>", () => input.title);
};

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

export const LIVE_SELECTED_LIMIT = 3;
export const PIN_LIMIT = 3;
export const PIN_LIMIT_MESSAGE = "Three are already playing. Stop one first.";

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

export const farOffscreen = (box: PlacementBox, viewport: PlacementBox): boolean => {
  const margin = viewport.w;
  return (
    box.x + box.w < viewport.x - margin ||
    box.x > viewport.x + viewport.w + margin ||
    box.y + box.h < viewport.y - margin ||
    box.y > viewport.y + viewport.h + margin
  );
};

export const snapshotFits = (snapshot: { readonly w: number; readonly h: number }, shape: { readonly w: number; readonly h: number }): boolean =>
  Math.abs(shape.w - snapshot.w) <= snapshot.w * 0.1 && Math.abs(shape.h - snapshot.h) <= snapshot.h * 0.1;

export const ARTIFACT_SCALES = [0.25, 0.5, 0.75, 1, 1.5, 2] as const;
export const ARTIFACT_LAYOUT_MAX = 4096;

interface Scaled {
  readonly w: number;
  readonly h: number;
  readonly scale?: unknown;
}

export const cappedArtifactScale = (props: Scaled): number =>
  Math.max(isArtifactScale(props.scale) ? props.scale : 1, Math.min(1, Math.max(props.w, props.h) / ARTIFACT_LAYOUT_MAX));

export const artifactScale = (props: Scaled): number => cappedArtifactScale(props);

export const artifactLayoutSize = (props: Scaled): { w: number; h: number } => {
  const scale = artifactScale(props);
  return { w: props.w / scale, h: props.h / scale };
};

export const scaledArtifactProps = <P extends Scaled>(props: P, next: number): Omit<P, "scale"> & { w: number; h: number; scale?: number } => {
  const layout = artifactLayoutSize(props);
  const { scale: _scale, ...rest } = props;
  return { ...rest, w: layout.w * next, h: layout.h * next, ...(next === 1 ? {} : { scale: next }) };
};

const REFERENCE_PATTERNS = [
  /\b(?:src|href)\s*=\s*["']([^"']+)["']/gi,
  /\bimport\s*(?:[^"';]*?\bfrom\s*)?["']([^"']+)["']/g,
  /@import\s+(?:url\(\s*)?["']([^"']+)["']/gi,
  /\burl\(\s*["']?([^"')]+)["']?\s*\)/gi,
];

const localPath = (raw: string): string | undefined => {
  const bare = raw.trim().replace(/[?#].*$/, "");
  if (bare === "" || bare.startsWith("/") || /^[a-z][a-z0-9+.-]*:/i.test(bare)) return undefined;
  let path: string;
  try {
    path = decodeURIComponent(bare);
  } catch {
    path = bare;
  }
  const name = path.replace(/^(\.\/)+/, "");
  return name === "" || name === "." || name === ".." || name.includes("/") || name.includes("\\") ? undefined : name;
};

export const artifactReferences = (html: string): string[] => {
  const found = new Set<string>();
  for (const pattern of REFERENCE_PATTERNS) {
    for (const match of html.matchAll(pattern)) {
      const path = localPath(match[1]!);
      if (path !== undefined) found.add(path);
    }
  }
  return [...found];
};

export const snapshotSeekSeconds = (duration: number): number => (Number.isFinite(duration) && duration > 0 && duration < 1 ? duration / 2 : 1);

type SnapshotKit = { readonly mode: string | null; readonly kit: string | null };

export const snapshotFileName = (file: string, size: { readonly w: number; readonly h: number }, kit: SnapshotKit): string =>
  `${file}-${Math.round(size.w)}x${Math.round(size.h)}-${kit.mode ?? "none"}-${kit.kit ?? "none"}.png`;

export const parseSnapshotFileName = (name: string): { file: string; w: number; h: number; mode: string | null; kit: string | null } | undefined => {
  const match = /^(.+\.html?)-(\d+)x(\d+)-([a-z0-9][a-z0-9-]{0,31}|none)-([0-9a-f]{8}|none)\.png$/i.exec(name);
  if (!match) return undefined;
  return { file: match[1]!, w: Number(match[2]), h: Number(match[3]), mode: match[4] === "none" ? null : match[4]!, kit: match[5] === "none" ? null : match[5]! };
};
