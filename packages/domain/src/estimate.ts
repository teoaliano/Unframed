/** One billing line of an endpoint's pricing, as `models.imagePricing` answers it. */
export interface Sku {
  readonly unit?: string | undefined;
  readonly billable?: string | undefined;
  readonly variant?: string | null | undefined;
  readonly cost_usd?: number | undefined;
}

/** The tray values a SKU's variant is matched against. */
export interface ChosenValues {
  readonly quality?: string | undefined;
  readonly resolution?: string | undefined;
}

const INPUT_BILLABLES = new Set(["input_image", "input_reference"]);

const cost = (sku: Sku): number => (typeof sku.cost_usd === "number" && Number.isFinite(sku.cost_usd) ? sku.cost_usd : 0);

/**
 * The price of one image from one endpoint, or `null` when it cannot be known exactly: no
 * SKUs, any SKU not billed per image, no output SKU, or no single output SKU the tray's
 * quality and resolution pick out. Each reference image sent adds the input billables.
 */
export const imagePrice = (skus: ReadonlyArray<Sku>, chosen: ChosenValues, referenceImages: number): number | null => {
  if (skus.length === 0) return null;
  if (skus.some((sku) => sku.unit !== "image")) return null;
  const outputs = skus.filter((sku) => sku.billable === "output_image");
  if (outputs.length === 0) return null;
  let picked: Sku | undefined;
  if (outputs.length === 1) picked = outputs[0];
  else {
    const wanted = new Set([chosen.quality, chosen.resolution].filter((value): value is string => value !== undefined).map((value) => value.toLowerCase()));
    const matching = outputs.filter(
      (sku) => typeof sku.variant === "string" && sku.variant !== "" && sku.variant.toLowerCase().split("_").every((part) => wanted.has(part)),
    );
    const candidates = matching.length > 0 ? matching : outputs.filter((sku) => sku.variant === undefined || sku.variant === null || sku.variant === "");
    if (candidates.length === 1) picked = candidates[0];
  }
  if (!picked) return null;
  const perReference = skus.filter((sku) => sku.billable !== undefined && INPUT_BILLABLES.has(sku.billable)).reduce((sum, sku) => sum + cost(sku), 0);
  return cost(picked) + perReference * referenceImages;
};

/**
 * The price of a run: every endpoint must give a number and all must agree, else `null`.
 * `referenceImages` counts every image slot sent, over the cap included, so the estimate
 * is an upper bound exactly when the cap warning shows.
 */
export const estimateImageRun = (input: {
  readonly endpoints: ReadonlyArray<ReadonlyArray<Sku>>;
  readonly chosen: ChosenValues;
  readonly referenceImages: number;
  readonly outputs: number;
}): number | null => {
  if (input.endpoints.length === 0) return null;
  let agreed: number | undefined;
  for (const skus of input.endpoints) {
    const price = imagePrice(skus, input.chosen, input.referenceImages);
    if (price === null) return null;
    if (agreed !== undefined && Math.abs(agreed - price) > 1e-12) return null;
    agreed = price;
  }
  return agreed === undefined ? null : agreed * input.outputs;
};

/** `est. ~$0.17` with two decimals from $0.10, three below. */
export const formatEstimate = (value: number): string => `est. ~$${value >= 0.1 ? value.toFixed(2) : value.toFixed(3)}`;
