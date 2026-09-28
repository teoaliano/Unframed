import type { ImagePricingAnswer, ModelsListAnswer } from "@unframed/contracts";
import { useEffect, useState } from "react";
import type { EngineConnection } from "../rpc/engine.ts";

const lists = new Map<string, ModelsListAnswer>();

/**
 * A medium's catalogue: fetched each time a tray opens, with the last answer shown
 * meanwhile. `undefined` until the first answer of the session arrives.
 */
export const useCatalogue = (engine: EngineConnection, medium: "image"): ModelsListAnswer | undefined => {
  const [answer, setAnswer] = useState(() => lists.get(medium));
  useEffect(() => {
    let live = true;
    engine.call("models.list", { medium }).then(
      (next) => {
        lists.set(medium, next);
        if (live) setAnswer(next);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [engine, medium]);
  return answer;
};

/** The last catalogue answer of the session, for actions that need a model's traits without a tray. */
export const knownCatalogue = (medium: "image"): ModelsListAnswer | undefined => lists.get(medium);

export const loadCatalogue = async (engine: EngineConnection, medium: "image"): Promise<ModelsListAnswer> => {
  const cached = lists.get(medium);
  if (cached) return cached;
  const answer = await engine.call("models.list", { medium });
  lists.set(medium, answer);
  return answer;
};

const pricing = new Map<string, Promise<ImagePricingAnswer>>();

/**
 * The pricing of the selected model, cached per model for the session. A reply for a model
 * that is no longer selected is dropped.
 */
export const usePricing = (engine: EngineConnection, model: string | undefined): ImagePricingAnswer | undefined => {
  const [answer, setAnswer] = useState<{ model: string; pricing: ImagePricingAnswer }>();
  useEffect(() => {
    if (model === undefined) return;
    let live = true;
    let request = pricing.get(model);
    if (!request) {
      request = engine.call("models.imagePricing", { id: model });
      pricing.set(model, request);
      request.catch(() => pricing.delete(model));
    }
    request.then(
      (next) => {
        if (live) setAnswer({ model, pricing: next });
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [engine, model]);
  return answer !== undefined && answer.model === model ? answer.pricing : undefined;
};
