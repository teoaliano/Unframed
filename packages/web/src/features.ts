import type { Feature } from "@unframed/contracts";
import { NO_FEATURES, type Features } from "@unframed/domain";
import { useSyncExternalStore } from "react";

let enabled: Features = NO_FEATURES;
const listeners = new Set<() => void>();

export const currentFeatures = (): Features => enabled;

export const featureOn = (feature: Feature): boolean => enabled.has(feature);

export const setFeatures = (features: ReadonlyArray<Feature>): void => {
  const next = new Set(features);
  if (next.size === enabled.size && [...next].every((feature) => enabled.has(feature))) return;
  enabled = next;
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

export const useFeatures = (): Features => useSyncExternalStore(subscribe, currentFeatures);

export const useFeature = (feature: Feature): boolean => useFeatures().has(feature);
