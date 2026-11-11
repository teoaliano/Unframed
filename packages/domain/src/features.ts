import { FEATURES, type Feature } from "@unframed/contracts";

export type Features = ReadonlySet<Feature>;

export const ALL_FEATURES: Features = new Set(FEATURES);
export const NO_FEATURES: Features = new Set();

export const readFeatures = (value: string | undefined): Features => {
  const names = new Set((value ?? "").split(",").map((name) => name.trim().toLowerCase()));
  if (names.has("all")) return ALL_FEATURES;
  return new Set(FEATURES.filter((feature) => names.has(feature)));
};

export const featureList = (features: Features): Feature[] => FEATURES.filter((feature) => features.has(feature));

export const FEATURE_OFF_MESSAGES: Record<Feature, string> = {
  nodes: "Nodes are not available in this build.",
  "element-editing": "Element editing is not available in this build.",
};
