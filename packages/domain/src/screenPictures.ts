export const PICTURE_KEY = /^[a-f0-9]{40}$/;

export const pictureKeyOf = (props: { readonly picture?: string | undefined }): string | undefined => (props.picture !== undefined && PICTURE_KEY.test(props.picture) ? props.picture : undefined);

export type PictureVariant = "w128" | "w384" | "full" | "html";

export const PICTURE_POLICY = "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; font-src 'self' data:; sandbox";

const PICTURE_FILE = /^[a-f0-9]{40}(?:\.w128\.png|\.w384\.png|\.png|\.html)$/;
const PART_FILE = /^parts\/[a-f0-9]{40}\.(?:png|jpg|gif|webp|svg|avif|woff2|woff|ttf|otf)$/;

export const pictureFile = (key: string, variant: PictureVariant): string =>
  variant === "full" ? `${key}.png` : variant === "html" ? `${key}.html` : `${key}.${variant}.png`;

export const pictureUrl = (project: string, key: string, variant: PictureVariant): string => `/api/pictures/${encodeURIComponent(project)}/${pictureFile(key, variant)}`;

export const picturePartsUrl = (project: string): string => `/api/pictures/${encodeURIComponent(project)}/parts/`;

export const pictureFileName = (name: string): string | undefined => (PICTURE_FILE.test(name) || PART_FILE.test(name) ? name : undefined);

const PART_EXTENSIONS: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/avif": "avif",
  "font/woff2": "woff2",
  "application/font-woff2": "woff2",
  "font/woff": "woff",
  "application/font-woff": "woff",
  "font/ttf": "ttf",
  "application/x-font-ttf": "ttf",
  "font/otf": "otf",
};

export const partExtension = (contentType: string): string | undefined => {
  const bare = contentType.split(";")[0]!.trim().toLowerCase();
  return Object.hasOwn(PART_EXTENSIONS, bare) ? PART_EXTENSIONS[bare] : undefined;
};

export interface ScreenSignatureInput {
  readonly instance: string;
  readonly revision: number;
  readonly route: string;
  readonly steps?: ReadonlyArray<unknown> | undefined;
  readonly mocks?: ReadonlyArray<unknown> | undefined;
  readonly w: number;
  readonly h: number;
  readonly dials?: Readonly<Record<string, unknown>> | null | undefined;
}

const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value === null || typeof value !== "object") return value;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    const item = (value as Record<string, unknown>)[key];
    if (item !== undefined) sorted[key] = canonical(item);
  }
  return sorted;
};

export const screenSignature = (input: ScreenSignatureInput): string =>
  JSON.stringify(
    canonical({
      instance: input.instance,
      revision: input.revision,
      route: input.route,
      steps: input.steps ?? [],
      mocks: input.mocks ?? [],
      w: Math.round(input.w),
      h: Math.round(input.h),
      dials: input.dials ?? null,
    }),
  );

export const resolvePictureParts = (html: string, names: ReadonlyArray<string | undefined>): string =>
  html.replace(/uf-part:(\d+)/g, (_match, index: string) => {
    const name = names[Number(index)];
    return name === undefined ? "data:," : `parts/${name}`;
  });
