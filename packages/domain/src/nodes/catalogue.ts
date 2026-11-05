import type { NodeMedium } from "@unframed/contracts";
import { estimateImageRun, type Sku } from "../estimate.ts";
import { downstreamRun, planChain, type ChainPlan, type DownstreamScope } from "./chain.ts";
import type { NodeCanvas } from "./model.ts";

export type NodeCatalogue = "image" | "video" | "text" | "audio";

export const nodeCatalogueOf = (medium: NodeMedium): NodeCatalogue => (medium === "page" ? "text" : medium);

export const isPaidMedium = (medium: NodeMedium): boolean => medium !== "audio";

export const frameImagesOf = (entry: { readonly params?: unknown } | undefined): string[] => {
  const frames = (entry?.params as { frame_images?: unknown } | null | undefined)?.frame_images;
  return Array.isArray(frames) ? frames.filter((each): each is string => typeof each === "string") : [];
};

export const nodeImageEstimate = (input: {
  readonly endpoints: ReadonlyArray<ReadonlyArray<Sku>>;
  readonly params: Readonly<Record<string, string | number | boolean>>;
  readonly referenceImages: number;
  readonly runs: number | undefined;
}): number | null =>
  estimateImageRun({
    endpoints: input.endpoints,
    chosen: {
      ...(typeof input.params.quality === "string" ? { quality: input.params.quality } : {}),
      ...(typeof input.params.resolution === "string" ? { resolution: input.params.resolution } : {}),
    },
    referenceImages: input.referenceImages,
    outputs: input.runs ?? 1,
  });

export const chainStepsOf = (canvas: NodeCanvas, ids: ReadonlyArray<string>, downstream: DownstreamScope | undefined, frames: (nodeId: string) => ReadonlyArray<string>): ChainPlan => {
  const chosen = downstream !== undefined && ids.length === 1 ? downstreamRun(canvas, ids[0]!, downstream, frames) : ids;
  return planChain(canvas, chosen);
};

export const CHAIN_CHANGED_MESSAGE = "The chain changed since you confirmed it. Check its steps and run it again.";
export const NODE_FIRST_MESSAGE = "That node must run first.";
export const NODE_SKETCH_MESSAGE = "This node needs a sketch or a marked picture: run it from its card.";
