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


export const PROJECT_FILE = "project-file:";
export const PRESET_FILE = "preset-file:";

export const isBareFileName = (name: string): boolean =>
  name !== "" && name !== "." && !name.includes("/") && !name.includes("\\") && !name.includes("..");

type AssetMarker =
  | { readonly kind: "project-file"; readonly file: string }
  | { readonly kind: "link"; readonly url: string }
  | { readonly kind: "preset-file"; readonly project: string; readonly file: string };

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

const isTransientSource = (src: string): boolean => src.startsWith("data:") || src.startsWith("blob:");

const assetSource = (allowLinks: boolean) =>
  T.string.nullable().check((src) => {
    if (src === null || src === "" || isTransientSource(src)) return;
    const marker = parseAssetMarker(src);
    if (marker?.kind === "project-file" || (allowLinks && marker?.kind === "link")) return;
    throw new T.ValidationError(`Expected a project file or ${allowLinks ? "an https link" : "no source"}, got ${JSON.stringify(src)}`);
  });


const unframedMeta = { unframed: T.jsonValue.optional() };

export interface PromptMeta {
  readonly ref: string;
  readonly sized?: boolean;
  readonly unframed?: unknown;
}

const refMeta = { ref: T.string, ...unframedMeta };

const bareFileOrEmpty = T.string.check((file) => {
  if (file !== "" && !isBareFileName(file)) throw new T.ValidationError(`Expected a file name, got ${JSON.stringify(file)}`);
});

export const isSheetFileName = (name: string): boolean => /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}\.html$/.test(name);

const sheetFileOrEmpty = T.string.check((file) => {
  if (file !== "" && !isSheetFileName(file)) throw new T.ValidationError(`Expected a component sheet file name, got ${JSON.stringify(file)}`);
});

export interface ArtifactShapeProps {
  w: number;
  h: number;
  file: string;
  title: string;
  fileName: string;
  dials?: Record<string, unknown>;
  mode?: string;
  lockedElements?: string[];
  scale?: number;
}

export const ARTIFACT_SCALE_MIN = 0.1;
export const ARTIFACT_SCALE_MAX = 4;

export const isArtifactScale = (scale: unknown): scale is number =>
  typeof scale === "number" && Number.isFinite(scale) && scale >= ARTIFACT_SCALE_MIN && scale <= ARTIFACT_SCALE_MAX;

export const artifactScaleProp = T.number.check((scale) => {
  if (!isArtifactScale(scale)) throw new T.ValidationError(`Expected a scale from ${ARTIFACT_SCALE_MIN} to ${ARTIFACT_SCALE_MAX}, got ${JSON.stringify(scale)}`);
});

const artifactProps = {
  w: T.nonZeroNumber,
  h: T.nonZeroNumber,
  file: bareFileOrEmpty,
  title: T.string,
  fileName: T.string,
  dials: T.dict(T.string, T.jsonValue).optional(),
  mode: T.string.optional(),
  lockedElements: T.arrayOf(T.string).optional(),
  scale: artifactScaleProp.optional(),
};

const artifactMigrations = (kind: ArtifactType) => {
  const ids = createShapePropsMigrationIds(kind, { AddLockedElements: 1, AddScale: 2 });
  return createShapePropsMigrationSequence({
    sequence: [
      { id: ids.AddLockedElements, up: (props) => props },
      { id: ids.AddScale, up: (props) => props },
    ],
  });
};

export const ARTIFACT_TYPES = ["page", "motion"] as const;
type ArtifactType = (typeof ARTIFACT_TYPES)[number];

const COMPONENT_TAG = /^uf-[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
export const COMPONENT_TAG_MAX = 50;

interface ComponentShapeProps {
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

export interface AudioShapeProps {
  w: number;
  h: number;
  file: string;
  fileName: string;
}

export const AUDIO_HEIGHT = 64;
export const AUDIO_DEFAULT_SIZE = { w: 320, h: AUDIO_HEIGHT } as const;
export const AUDIO_EMPTY_SIZE = { w: 240, h: AUDIO_HEIGHT } as const;
export const AUDIO_WIDTH = { min: 200, max: 640 } as const;

const audioProps = { w: T.nonZeroNumber, h: T.nonZeroNumber, file: bareFileOrEmpty, fileName: T.string };

const audioMigrations = () => {
  const ids = createShapePropsMigrationIds("audio", { Initial: 1 });
  return createShapePropsMigrationSequence({ sequence: [{ id: ids.Initial, up: (props) => props }] });
};

declare module "@tldraw/tlschema" {
  interface TLGlobalShapePropsMap {
    audio: AudioShapeProps;
    page: ArtifactShapeProps;
    motion: ArtifactShapeProps;
    component: ComponentShapeProps;
  }
}

type UnframedKind = "prompt" | "image" | "video" | "audio" | "group" | "page" | "motion" | "component";

export const kindOfShapeType = (type: string): UnframedKind | "mark" => {
  switch (type) {
    case "text":
      return "prompt";
    case "image":
    case "video":
    case "audio":
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

const kitShape = T.object({
  format: T.literal(1),
  name: T.string,
  modes: T.arrayOf(T.string),
  tokens: T.arrayOf(T.jsonValue),
}).allowUnknownProperties();

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
      audio: { props: audioProps, meta: refMeta, migrations: audioMigrations() },
      page: { props: artifactProps, meta: refMeta, migrations: artifactMigrations("page") },
      motion: { props: artifactProps, meta: refMeta, migrations: artifactMigrations("motion") },
      component: {
        props: { ...artifactProps, file: sheetFileOrEmpty, tag: componentTag },
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

export const canvasSchema = (): TLSchema => {
  schema ??= buildSchema();
  return schema;
};

export const roomSchema = (refusalOf: (kit: Kit) => string | null): TLSchema => buildSchema(refusalOf);
