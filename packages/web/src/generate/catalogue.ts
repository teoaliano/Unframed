import type { ModelsListAnswer } from "@unframed/contracts";
import { useEffect, useState } from "react";
import type { EngineConnection, Payload } from "../rpc/engine.ts";
import type { MediumDefinition } from "./mediumRegistry.ts";

type Catalogue = Payload<"models.list">["medium"];

const lists = new Map<Catalogue, ModelsListAnswer>();

/**
 * A catalogue: fetched each time a tray opens, with the last answer shown meanwhile.
 * `undefined` until the first answer of the session arrives.
 */
export const useCatalogue = (engine: EngineConnection, medium: Catalogue): ModelsListAnswer | undefined => {
  const [answer, setAnswer] = useState(() => ({ medium, list: lists.get(medium) }));
  useEffect(() => {
    let live = true;
    engine.call("models.list", { medium }).then(
      (next) => {
        lists.set(medium, next);
        if (live) setAnswer({ medium, list: next });
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [engine, medium]);
  // Another medium's answer is never this one's, even for the render before the switch lands.
  return answer.medium === medium ? answer.list : lists.get(medium);
};

/** The last catalogue answer of the session, for actions that need a model's traits without a tray. */
export const knownCatalogue = (medium: Catalogue): ModelsListAnswer | undefined => lists.get(medium);

export const loadCatalogue = async (engine: EngineConnection, medium: Catalogue): Promise<ModelsListAnswer> => {
  const cached = lists.get(medium);
  if (cached) return cached;
  const answer = await engine.call("models.list", { medium });
  lists.set(medium, answer);
  return answer;
};

const pricing = new Map<string, Promise<unknown>>();

/**
 * The selected model's pricing, cached per medium and model for the session. A reply for a
 * model that is no longer selected is dropped.
 */
export const usePricing = (engine: EngineConnection, definition: MediumDefinition, model: string | undefined): unknown => {
  const [answer, setAnswer] = useState<{ key: string; pricing: unknown }>();
  const key = model === undefined ? undefined : `${definition.medium}:${model}`;
  useEffect(() => {
    if (key === undefined || model === undefined) return;
    let live = true;
    let request = pricing.get(key);
    if (!request) {
      request = definition.pricing(engine, model);
      pricing.set(key, request);
      request.catch(() => pricing.delete(key));
    }
    request.then(
      (next) => {
        if (live) setAnswer({ key, pricing: next });
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [engine, definition, key, model]);
  return answer !== undefined && answer.key === key ? answer.pricing : undefined;
};
