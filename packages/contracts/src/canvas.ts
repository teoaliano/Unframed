/**
 * The canvas schema: tldraw's own records, minus embeds and bookmarks, plus the Unframed
 * shape kinds. The engine's sync room and the web's store validate against this one
 * schema, so a record one side accepts the other accepts too.
 */
import {
  createShapePropsMigrationSequence,
  createTLSchema,
  defaultBindingSchemas,
  defaultShapeSchemas,
  imageAssetMigrations,
  imageAssetProps,
  videoAssetMigrations,
  videoAssetProps,
  type TLSchema,
} from "@tldraw/tlschema";
import { T } from "@tldraw/validate";

// ---------------------------------------------------------------------------------------
// Asset markers: the one definition.

export const PROJECT_FILE = "project-file:";
export const PRESET_FILE = "preset-file:";

/** A file name inside a marker is a bare basename: never `/`, `\` or `..`. */
export const isBareFileName = (name: string): boolean =>
  name !== "" && name !== "." && !name.includes("/") && !name.includes("\\") && !name.includes("..");

export type AssetMarker =
  | { readonly kind: "project-file"; readonly file: string }
  | { readonly kind: "link"; readonly url: string }
  | { readonly kind: "preset-file"; readonly project: string; readonly file: string };

/**
 * Reads an asset `src` as one of the three markers: a file in this project, a linked
 * `https://` clip, or a preset's portable pointer. Anything else is not a marker.
 */
export const parseAssetMarker = (src: string): AssetMarker | undefined => {
  if (src.startsWith(PROJECT_FILE)) {
    const file = src.slice(PROJECT_FILE.length);
    return isBareFileName(file) ? { kind: "project-file", file } : undefined;
  }
  if (/^https:\/\/.+/.test(src)) return { kind: "link", url: src };
  if (src.startsWith(PRESET_FILE)) {
    const rest = src.slice(PRESET_FILE.length);
    const slash = rest.indexOf("/");
    if (slash < 0) return undefined;
    const project = rest.slice(0, slash);
    const file = rest.slice(slash + 1);
    return isBareFileName(file) && !project.includes("\\") && !project.includes("..") ? { kind: "preset-file", project, file } : undefined;
  }
  return undefined;
};

export const projectFileMarker = (file: string): string => `${PROJECT_FILE}${file}`;

/**
 * `data:` and `blob:` sources may reach the room, which rewrites them within 2 seconds:
 * a data URL into a project file, a blob URL into no source at all.
 */
const isTransientSource = (src: string): boolean => src.startsWith("data:") || src.startsWith("blob:");

const assetSource = (allowLinks: boolean) =>
  T.string.nullable().check((src) => {
    if (src === null || isTransientSource(src)) return;
    const marker = parseAssetMarker(src);
    if (marker?.kind === "project-file" || (allowLinks && marker?.kind === "link")) return;
    throw new T.ValidationError(`Expected a project file or ${allowLinks ? "an https link" : "no source"}, got ${JSON.stringify(src)}`);
  });

// ---------------------------------------------------------------------------------------
// Shape meta and props.

/** Where later specs keep their fields (result, run, runError, recipe), and nowhere else in meta. */
const unframedMeta = { unframed: T.jsonValue.optional() };

export interface PromptMeta {
  readonly ref: string;
  readonly sized?: boolean;
  readonly unframed?: unknown;
}

export interface RefMeta {
  readonly ref: string;
  readonly unframed?: unknown;
}

const refMeta = { ref: T.string, ...unframedMeta };

const bareFileOrEmpty = T.string.check((file) => {
  if (file !== "" && !isBareFileName(file)) throw new T.ValidationError(`Expected a file name, got ${JSON.stringify(file)}`);
});

/** A page or motion: its file in the project folder (`''` when empty), title and original file name. */
export interface ArtifactShapeProps {
  w: number;
  h: number;
  file: string;
  title: string;
  fileName: string;
  dials?: Record<string, unknown>;
}

const artifactProps = {
  w: T.nonZeroNumber,
  h: T.nonZeroNumber,
  file: bareFileOrEmpty,
  title: T.string,
  fileName: T.string,
  dials: T.dict(T.string, T.jsonValue).optional(),
};

/** Every later change to page and motion props is a migration here, used by the room and the web alike. */
const artifactMigrations = () => createShapePropsMigrationSequence({ sequence: [] });

export const ARTIFACT_TYPES = ["page", "motion"] as const;
export type ArtifactType = (typeof ARTIFACT_TYPES)[number];

declare module "@tldraw/tlschema" {
  interface TLGlobalShapePropsMap {
    page: ArtifactShapeProps;
    motion: ArtifactShapeProps;
  }
}

/** The shape kinds Unframed adds meaning to. Every other tldraw shape is a mark. */
export type UnframedKind = "prompt" | "image" | "video" | "group" | "page" | "motion";

export const kindOfShapeType = (type: string): UnframedKind | "mark" => {
  switch (type) {
    case "text":
      return "prompt";
    case "image":
    case "video":
    case "page":
    case "motion":
      return type;
    case "frame":
      return "group";
    default:
      return "mark";
  }
};

const { embed: _embed, bookmark: _bookmark, ...keptShapes } = defaultShapeSchemas;

let schema: TLSchema | undefined;

/** The one canvas schema, made once. */
export const canvasSchema = (): TLSchema => {
  schema ??= createTLSchema({
    shapes: {
      ...keptShapes,
      text: { ...keptShapes.text, meta: { ...refMeta, sized: T.boolean.optional() } },
      image: { ...keptShapes.image, meta: refMeta },
      video: { ...keptShapes.video, meta: refMeta },
      frame: { ...keptShapes.frame, meta: unframedMeta },
      page: { props: artifactProps, meta: refMeta, migrations: artifactMigrations() },
      motion: { props: artifactProps, meta: refMeta, migrations: artifactMigrations() },
    },
    bindings: defaultBindingSchemas,
    assets: {
      image: { migrations: imageAssetMigrations, props: { ...imageAssetProps, src: assetSource(false) } },
      video: { migrations: videoAssetMigrations, props: { ...videoAssetProps, src: assetSource(true) } },
    },
  });
  return schema;
};
