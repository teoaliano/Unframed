/** The props an image model can declare, as the tray and the request name them. */
export type ImagePropKey = "resolution" | "size" | "aspect_ratio" | "quality" | "background" | "output_format";

export interface PropSpec {
  /** An image prop, or a video prop (spec 04). */
  readonly key: string;
  readonly label: string;
  /** Exactly the values the model declares. */
  readonly values: ReadonlyArray<string>;
  /** Menu labels for values that read differently from the chip (exact sizes). */
  readonly optionLabels?: Readonly<Record<string, string>>;
  /** Chip text for values that read differently from the value (spec 04: Input, Seconds, Audio). */
  readonly chipLabels?: Readonly<Record<string, string>>;
  /** A yes-or-no prop shown as one checkbox (spec 04: Audio). Its value is a boolean. */
  readonly checkbox?: true;
  /** Always in the tray: its menu has no Remove (spec 04: Input and Seconds). */
  readonly required?: true;
}

export interface ModelParams {
  /** In tray order: Size, Ratio, Quality, Background, Format. */
  readonly props: ReadonlyArray<PropSpec>;
  /** The `input_references` range's maximum, when the model declares one. */
  readonly referenceCap: number | undefined;
  /** Whether the model declares `key` with `value`. A value it does not declare is never sent. */
  supported(key: string, value: unknown): boolean;
}

/** A catalogue entry, as `models.list` answers it. `params` is OpenRouter's typed `supported_parameters`. */
export interface CatalogueEntry {
  readonly id: string;
  readonly name?: string | undefined;
  readonly params?: Readonly<Record<string, unknown>> | null | undefined;
}

/** Every prop a model drives. A model change resets these and nothing else. */
export const MODEL_DRIVEN_PROPS: ReadonlyArray<ImagePropKey> = ["quality", "background", "resolution", "aspect_ratio", "size", "output_format"];

export const IMAGE_DEFAULTS: Readonly<Partial<Record<ImagePropKey, string>>> = { resolution: "1K", quality: "low", aspect_ratio: "1:1" };

const LABELS: Record<ImagePropKey, string> = {
  resolution: "Size",
  size: "Size",
  aspect_ratio: "Ratio",
  quality: "Quality",
  background: "Background",
  output_format: "Format",
};

const field = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined;

/** An enum with at least one value, or a plain non-empty array: the prop's allowed values. */
const enumValues = (declared: unknown): string[] | undefined => {
  const list = Array.isArray(declared) ? declared : field(declared, "type") === "enum" ? field(declared, "values") : undefined;
  if (!Array.isArray(list)) return undefined;
  const values = list.filter((value) => typeof value === "string" || typeof value === "number").map(String);
  return values.length > 0 ? values : undefined;
};

const rangeMax = (declared: unknown): number | undefined => {
  if (field(declared, "type") !== "range") return undefined;
  const max = field(declared, "max");
  return typeof max === "number" && Number.isFinite(max) ? max : undefined;
};

const RATIOS: ReadonlyArray<readonly [string, number]> = [
  ["21:9", 21 / 9],
  ["16:9", 16 / 9],
  ["3:2", 3 / 2],
  ["4:3", 4 / 3],
  ["1:1", 1],
  ["3:4", 3 / 4],
  ["2:3", 2 / 3],
  ["9:16", 9 / 16],
  ["9:21", 9 / 21],
];

/** The nearest common ratio of `w` by `h`, when it is within 2% of the true one. */
export const ratioLabel = (w: number, h: number): string | undefined => {
  if (!(w > 0 && h > 0)) return undefined;
  const ratio = w / h;
  let best: readonly [string, number] | undefined;
  for (const candidate of RATIOS) {
    if (best === undefined || Math.abs(ratio - candidate[1]) < Math.abs(ratio - best[1])) best = candidate;
  }
  return best !== undefined && Math.abs(ratio - best[1]) / best[1] <= 0.02 ? best[0] : undefined;
};

const EXACT_SIZE = /^(\d+)x(\d+)$/;

/** An exact size's menu label: `1470x630 · 21:9`, or the size alone when no ratio is near. */
export const exactSizeLabel = (size: string): string => {
  const match = EXACT_SIZE.exec(size);
  const ratio = match ? ratioLabel(Number(match[1]), Number(match[2])) : undefined;
  return ratio === undefined ? size : `${size} · ${ratio}`;
};

/**
 * The props an image model declares, with exactly its values, and its reference cap. When
 * the catalogue supplies exact `WIDTHxHEIGHT` sizes, Size offers those instead of the
 * resolution tiers and Ratio is not offered.
 */
export const modelParams = (entry: CatalogueEntry | undefined): ModelParams => {
  const declared = entry?.params ?? {};
  const sizes = enumValues(declared.size)?.filter((value) => EXACT_SIZE.test(value));
  const exact = sizes !== undefined && sizes.length > 0;
  const order: ImagePropKey[] = exact ? ["size", "quality", "background", "output_format"] : ["resolution", "aspect_ratio", "quality", "background", "output_format"];
  const props: PropSpec[] = [];
  for (const key of order) {
    const values = key === "size" ? sizes : enumValues(declared[key]);
    if (values === undefined) continue;
    props.push(
      key === "size"
        ? { key, label: LABELS[key], values, optionLabels: Object.fromEntries(values.map((value) => [value, exactSizeLabel(value)])) }
        : { key, label: LABELS[key], values },
    );
  }
  const byKey = new Map(props.map((prop) => [prop.key as string, prop]));
  return {
    props,
    referenceCap: rangeMax(declared.input_references),
    supported: (key, value) => byKey.get(key)?.values.includes(String(value)) === true && (typeof value === "string" || typeof value === "number"),
  };
};

const isModelDriven = (key: string): key is ImagePropKey => (MODEL_DRIVEN_PROPS as ReadonlyArray<string>).includes(key);

/** The image defaults this model allows: each placed only when declared and allowed. */
export const defaultProps = (params: ModelParams): Record<string, string> => {
  const values: Record<string, string> = {};
  for (const prop of params.props) {
    const value = IMAGE_DEFAULTS[prop.key as ImagePropKey];
    if (value !== undefined && params.supported(prop.key, value)) values[prop.key] = value;
  }
  return values;
};

/** The tray after a model change: every model-driven prop back to its default or gone; the rest (Runs) kept. */
export const resetProps = (current: Readonly<Record<string, unknown>>, next: ModelParams): Record<string, unknown> => {
  const kept = Object.fromEntries(Object.entries(current).filter(([key]) => !isModelDriven(key)));
  return { ...defaultProps(next), ...kept };
};

/** Stored values filtered through the model: a model-driven prop survives only with a supported value. */
export const keepSupported = (values: Readonly<Record<string, unknown>>, params: ModelParams): Record<string, unknown> =>
  Object.fromEntries(Object.entries(values).filter(([key, value]) => !isModelDriven(key) || params.supported(key, value)));

/** The value a prop is offered with in "+ add prop": its current value, else its allowed default, else its first. */
export const addablePropValue = (params: ModelParams, key: string, current: Readonly<Record<string, unknown>>): string | undefined => {
  const prop = params.props.find((each) => each.key === key);
  if (!prop) return undefined;
  const now = current[key];
  if (now !== undefined && params.supported(key, now)) return String(now);
  const fallback = IMAGE_DEFAULTS[key as ImagePropKey];
  return fallback !== undefined && params.supported(key, fallback) ? fallback : prop.values[0];
};
