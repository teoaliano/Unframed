import { UnframedError, type ImagePricingAnswer, type RenderedInputs } from "@unframed/contracts";
import {
  chainStepsOf,
  isPaidMedium,
  nodeCatalogueOf,
  nodeImageEstimate,
  nodeListEstimate,
  nodeProvider,
  providerLabel,
  GENERATION_PROVIDERS,
  estimateVideo,
  formatEstimate,
  modelPart,
  nodeName,
  nodeRequest,
  videoSettings,
  type DownstreamScope,
  type Slot,
  type VideoEntry,
  type VideoPropValue,
} from "@unframed/domain";
import { atom, type Editor } from "tldraw";
import { loadCatalogue } from "../generate/catalogue.ts";
import { nodeCatalogueProvider } from "./nodeTray.ts";
import { referencesFor } from "../generate/render.ts";
import type { EngineConnection } from "../rpc/engine.ts";
import { showError } from "../toasts.tsx";
import {nodeCanvas } from "./facts.ts";
import { nodeFrames, nodeModel } from "./operations.ts";

export interface ChainStep {
  readonly id: string;
  readonly name: string;
  readonly model: string;
  readonly estimate: number | null;
  readonly paid: boolean;
}

const pricing = new Map<string, Promise<ImagePricingAnswer | undefined>>();

const imagePricing = (engine: EngineConnection, model: string): Promise<ImagePricingAnswer | undefined> => {
  let known = pricing.get(model);
  if (!known) {
    known = engine.call("models.imagePricing", { id: model }).catch(() => {
      pricing.delete(model);
      return undefined;
    });
    pricing.set(model, known);
  }
  return known;
};

export const stepEstimate = async (editor: Editor, engine: EngineConnection, id: string): Promise<ChainStep | undefined> => {
  const canvas = nodeCanvas(editor);
  const node = canvas.nodes.get(id);
  if (!node) return undefined;
  const provider = nodeProvider(node);
  const catalogue = await loadCatalogue(engine, nodeCatalogueOf(node.medium), nodeCatalogueProvider(node.medium, provider)).catch(() => undefined);
  const model = node.model !== "" ? node.model : (catalogue?.default ?? nodeModel(node));
  const entry = catalogue?.models.find((each) => each.id === model);
  const step = { id, name: nodeName(canvas, id), model: [modelPart(model), ...providerLabel(provider)].join(" · "), paid: isPaidMedium(node.medium) };
  if (GENERATION_PROVIDERS[provider].listPriced) return { ...step, estimate: node.medium === "image" ? nodeListEstimate({ entry, runs: node.runs }) : null };
  if (node.medium === "image") {
    const answer = await imagePricing(engine, model);
    if (!answer) return { ...step, estimate: null };
    const request = nodeRequest({ node, canvas, assume: new Set(canvas.nodes.keys()) });
    const images = request.ok ? request.references.filter((slot) => slot.kind === "image").length : 0;
    return { ...step, estimate: nodeImageEstimate({ endpoints: answer.endpoints, params: node.params, referenceImages: images, runs: node.runs }) };
  }
  if (node.medium === "video") {
    const settings = videoSettings(entry as VideoEntry | undefined, node.params as Record<string, VideoPropValue>);
    return { ...step, estimate: estimateVideo({ pricing: entry?.pricing, resolution: settings.resolution, duration: settings.duration }) };
  }
  return { ...step, estimate: null };
};

export const runOrder = (editor: Editor, ids: ReadonlyArray<string>, downstream?: DownstreamScope): { readonly steps: ReadonlyArray<string> } | { readonly error: string } => {
  const canvas = nodeCanvas(editor);
  const frames = (id: string) => {
    const node = canvas.nodes.get(id);
    return node ? nodeFrames(node) : [];
  };
  const plan = chainStepsOf(canvas, ids, downstream, frames);
  return plan.ok ? { steps: plan.steps } : { error: plan.message };
};

export const chainTotal = (steps: ReadonlyArray<ChainStep>): { readonly label: string | undefined; readonly missing: ReadonlyArray<string> } => {
  const paid = steps.filter((step) => step.paid);
  const missing = paid.filter((step) => step.estimate === null).map((step) => step.name);
  const sum = paid.reduce((total, step) => total + (step.estimate ?? 0), 0);
  if (paid.length === 0) return { label: undefined, missing };
  return { label: missing.length === 0 ? `~$${sum < 0.1 ? sum.toFixed(3) : sum.toFixed(2)}` : undefined, missing };
};

export const stepLabel = (step: ChainStep): string => (step.estimate === null ? (step.paid ? "no exact estimate" : "ElevenLabs credits") : formatEstimate(step.estimate));

interface Confirming {
  readonly steps: ReadonlyArray<ChainStep>;
  readonly answer: (run: boolean) => void;
}

export const chainConfirmation = atom<Confirming | undefined>("chain confirmation", undefined);

const confirmChain = (steps: ReadonlyArray<ChainStep>): Promise<boolean> =>
  new Promise((resolve) => {
    chainConfirmation.get()?.answer(false);
    chainConfirmation.set({
      steps,
      answer: (run) => {
        chainConfirmation.set(undefined);
        resolve(run);
      },
    });
  });

const renderInputs = async (editor: Editor, project: string, steps: ReadonlyArray<string>): Promise<RenderedInputs> => {
  const canvas = nodeCanvas(editor);
  const drawn = new Map<string, Slot>();
  for (const [index, id] of steps.entries()) {
    const node = canvas.nodes.get(id);
    if (!node) continue;
    const request = nodeRequest({ node, canvas, assume: new Set(steps.slice(0, index)) });
    if (!request.ok) continue;
    for (const slot of [...request.references, ...request.frames.map((frame) => frame.slot)]) {
      if (slot.source.type === "composite" || slot.source.type === "sketch") drawn.set(slot.shapeId, slot);
    }
  }
  if (drawn.size === 0) return {};
  const slots = [...drawn.values()];
  const refs = await referencesFor(editor, project, slots);
  return Object.fromEntries(slots.map((slot, index) => [slot.shapeId, refs[index]!]));
};

const messageOf = (error: unknown) => (error instanceof UnframedError || error instanceof Error ? error.message : String(error));

export const runNodes = async (input: {
  readonly editor: Editor;
  readonly engine: EngineConnection;
  readonly project: string;
  readonly ids: ReadonlyArray<string>;
  readonly downstream?: DownstreamScope | undefined;
}): Promise<boolean> => {
  const { editor, engine, project, ids, downstream } = input;
  let order = runOrder(editor, ids, downstream);
  if ("error" in order) {
    showError(order.error);
    return false;
  }
  const estimates = async (stepIds: ReadonlyArray<string>) => (await Promise.all(stepIds.map((id) => stepEstimate(editor, engine, id)))).filter((step): step is ChainStep => step !== undefined);
  const sameAs = (a: ReadonlyArray<ChainStep>, b: ReadonlyArray<ChainStep>) => JSON.stringify(a) === JSON.stringify(b);
  try {
    if (order.steps.length > 1) {
      let shown = await estimates(order.steps);
      while (shown.filter((step) => step.paid).length >= 2) {
        if (!(await confirmChain(shown))) return false;
        const again = runOrder(editor, ids, downstream);
        if ("error" in again) {
          showError(again.error);
          return false;
        }
        const now = await estimates(again.steps);
        order = again;
        if (sameAs(now, shown)) break;
        shown = now;
      }
    }
    const rendered = await renderInputs(editor, project, order.steps);
    const steps = [...order.steps];
    if (downstream !== undefined && ids.length === 1) await engine.call("node.run", { project, shapeId: ids[0]!, downstream: true, scope: downstream, rendered, steps });
    else if (ids.length === 1 && order.steps.length === 1 && order.steps[0] === ids[0]) await engine.call("node.run", { project, shapeId: ids[0]!, rendered, steps });
    else await engine.call("chain.run", { project, shapeIds: [...ids], rendered, steps });
    return true;
  } catch (error) {
    showError(messageOf(error));
    return false;
  }
};
