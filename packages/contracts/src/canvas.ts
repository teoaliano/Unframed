/**
 * The canvas schema: tldraw's own records, minus embeds and bookmarks, plus the Unframed
 * shape kinds. The engine's sync room and the web's store validate against this one
 * schema, so a record one side accepts the other accepts too.
 */
import {
  createShapePropsMigrationIds,
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
import type { Kit } from "./kits.ts";

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
    // tldraw makes an asset with an empty source before its upload answers.
    if (src === null || src === "" || isTransientSource(src)) return;
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
  /** The kit mode this artifact shows (spec 19). Absent means the kit's default mode. */
  mode?: string;
  /** Element ids the person locked in Layers (spec 18). Absent when none. */
  lockedElements?: string[];
}

const artifactProps = {
  w: T.nonZeroNumber,
  h: T.nonZeroNumber,
  file: bareFileOrEmpty,
  title: T.string,
  fileName: T.string,
  dials: T.dict(T.string, T.jsonValue).optional(),
  mode: T.string.optional(),
  lockedElements: T.arrayOf(T.string).optional(),
};

/**
 * Every later change to page and motion props is a migration here, used by the room and the web alike.
 * The first adds `lockedElements`; a record without it has no locks, so nothing is rewritten.
 * `mode` (spec 19) is optional and needs none.
 */
const artifactMigrations = (kind: ArtifactType) => {
  const ids = createShapePropsMigrationIds(kind, { AddLockedElements: 1 });
  return createShapePropsMigrationSequence({ sequence: [{ id: ids.AddLockedElements, up: (props) => props }] });
};

export const ARTIFACT_TYPES = ["page", "motion"] as const;
export type ArtifactType = (typeof ARTIFACT_TYPES)[number];

/** A component's tag: `uf-` and lowercase words joined by hyphens, at most 50 characters (spec 20). */
export const COMPONENT_TAG = /^uf-[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
export const COMPONENT_TAG_MAX = 50;

/**
 * A component shape: the current sheet of a shared custom element (spec 20). `tag` is set at
 * creation and never changes; the room refuses a shape whose tag breaks the tag rule.
 */
export interface ComponentShapeProps {
  w: number;
  h: number;
  file: string;
  title: string;
  fileName: string;
  tag: string;
}

const componentTag = T.string.check((tag) => {
  if (tag.length > COMPONENT_TAG_MAX || !COMPONENT_TAG.test(tag)) {
    throw new T.ValidationError(`Expected a component tag like uf-price-card, got ${JSON.stringify(tag)}`);
  }
});

declare module "@tldraw/tlschema" {
  interface TLGlobalShapePropsMap {
    page: ArtifactShapeProps;
    motion: ArtifactShapeProps;
    component: ComponentShapeProps;
  }
}

/** The shape kinds Unframed adds meaning to. Every other tldraw shape is a mark. */
export type UnframedKind = "prompt" | "image" | "video" | "group" | "page" | "motion" | "component";

export const kindOfShapeType = (type: string): UnframedKind | "mark" => {
  switch (type) {
    case "text":
      return "prompt";
    case "image":
    case "video":
    case "page":
    case "motion":
    case "component":
      return type;
    case "frame":
      return "group";
    default:
      return "mark";
  }
};

const { embed: _embed, bookmark: _bookmark, ...keptShapes } = defaultShapeSchemas;

/**
 * The kit's shape, before a rule reads it: the fields every rule assumes. A kit that lacks one
 * is refused here, so the rules never meet a broken record (spec 19).
 */
const kitShape = T.object({
  format: T.literal(1),
  name: T.string,
  modes: T.arrayOf(T.string),
  tokens: T.arrayOf(T.jsonValue),
}).allowUnknownProperties();

/**
 * The document record's kit must have the right shape and pass `refusalOf`, the domain's kit
 * rules, which the engine supplies. Contracts depends on no other workspace package, so the
 * rules come in as a function and the room keeps them.
 */
const checkKit = (document: unknown, refusalOf: (kit: Kit) => string | null): void => {
  const kit = (document as { meta?: { unframed?: { kit?: unknown } } } | null)?.meta?.unframed?.kit;
  if (kit === undefined) return;
  try {
    kitShape.validate(kit);
  } catch {
    throw new T.ValidationError("That kit is not in the form the app writes.");
  }
  const refusal = refusalOf(kit as Kit);
  if (refusal !== null) throw new T.ValidationError(refusal);
};

let schema: TLSchema | undefined;

const buildSchema = (refusalOf?: (kit: Kit) => string | null): TLSchema => {
  const built = createTLSchema({
    shapes: {
      ...keptShapes,
      text: { ...keptShapes.text, meta: { ...refMeta, sized: T.boolean.optional() } },
      image: { ...keptShapes.image, meta: refMeta },
      video: { ...keptShapes.video, meta: refMeta },
      frame: { ...keptShapes.frame, meta: unframedMeta },
      page: { props: artifactProps, meta: refMeta, migrations: artifactMigrations("page") },
      motion: { props: artifactProps, meta: refMeta, migrations: artifactMigrations("motion") },
      component: {
        props: { ...artifactProps, tag: componentTag },
        meta: refMeta,
        migrations: createShapePropsMigrationSequence({ sequence: [] }),
      },
    },
    bindings: defaultBindingSchemas,
    assets: {
      image: { migrations: imageAssetMigrations, props: { ...imageAssetProps, src: assetSource(false) } },
      video: { migrations: videoAssetMigrations, props: { ...videoAssetProps, src: assetSource(true) } },
    },
  });
  if (refusalOf !== undefined) {
    const document = built.types.document as unknown as { validate: (record: unknown, before?: unknown) => unknown };
    const validate = document.validate.bind(document);
    document.validate = (record, before) => {
      const checked = validate(record, before);
      checkKit(checked, refusalOf);
      return checked;
    };
  }
  return built;
};

/** The one canvas schema, made once, without the kit rules (the web store reads it this way). */
export const canvasSchema = (): TLSchema => {
  schema ??= buildSchema();
  return schema;
};

/** The canvas schema the engine's room uses: the same records, plus the kit rules it is given (spec 19). */
export const roomSchema = (refusalOf: (kit: Kit) => string | null): TLSchema => buildSchema(refusalOf);
