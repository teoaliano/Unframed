import type { GenerationProvider, ModelsListAnswer } from "@unframed/contracts";
import { DEFAULT_PROVIDER, GENERATION_PROVIDERS, providerField, providerOf } from "@unframed/domain";
import { useEffect, useState } from "react";
import type { EngineConnection, Payload } from "../rpc/engine.ts";
import type { MediumDefinition } from "./mediumRegistry.ts";

type Catalogue = Payload<"models.list">["medium"];

const lists = new Map<string, ModelsListAnswer>();
const inflight = new Map<string, Promise<ModelsListAnswer>>();

const routedProvider = (medium: Catalogue, provider: GenerationProvider | undefined) =>
  providerOf(provider) !== DEFAULT_PROVIDER && provider !== undefined && GENERATION_PROVIDERS[provider].media.includes(medium) ? provider : undefined;

const keyOf = (medium: Catalogue, provider: GenerationProvider | undefined) => {
  const routed = routedProvider(medium, provider);
  return routed === undefined ? medium : `${medium}:${routed}`;
};

const request = (medium: Catalogue, provider: GenerationProvider | undefined): Payload<"models.list"> => ({ medium, ...providerField(routedProvider(medium, provider)) });

const fetchList = (engine: EngineConnection, medium: Catalogue, provider: GenerationProvider | undefined): Promise<ModelsListAnswer> => {
  const key = keyOf(medium, provider);
  const running = inflight.get(key);
  if (running) return running;
  const call = engine.call("models.list", request(medium, provider)).then(
    (answer) => {
      lists.set(key, answer);
      inflight.delete(key);
      return answer;
    },
    (error: unknown) => {
      inflight.delete(key);
      throw error;
    },
  );
  inflight.set(key, call);
  return call;
};

/**
 * A catalogue: fetched each time a tray opens, with the last answer shown meanwhile.
 * `undefined` until the first answer of the session arrives.
 */
export const useCatalogue = (engine: EngineConnection, medium: Catalogue, provider: GenerationProvider | undefined, ready = true): ModelsListAnswer | undefined => {
  const key = keyOf(medium, provider);
  const [answer, setAnswer] = useState(() => ({ key, list: lists.get(key) }));
  useEffect(() => {
    if (!ready) return;
    let live = true;
    fetchList(engine, medium, provider).then(
      (next) => {
        if (live) setAnswer({ key, list: next });
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [engine, medium, provider, key, ready]);
  if (!ready) return undefined;
  return answer.key === key ? answer.list : lists.get(key);
};

/** The last catalogue answer of the session, for actions that need a model's traits without a tray. */
export const knownCatalogue = (medium: Catalogue, provider?: GenerationProvider): ModelsListAnswer | undefined => lists.get(keyOf(medium, provider));

export const loadCatalogue = async (engine: EngineConnection, medium: Catalogue, provider?: GenerationProvider): Promise<ModelsListAnswer> => {
  const key = keyOf(medium, provider);
  return lists.get(key) ?? fetchList(engine, medium, provider);
};

/** The session's catalogue for a medium, fetched only when there is none yet: for surfaces that are not a tray (spec 06's recipe bar). */
export const useKnownCatalogue = (engine: EngineConnection, medium: Catalogue, provider?: GenerationProvider): ModelsListAnswer | undefined => {
  const key = keyOf(medium, provider);
  const [answer, setAnswer] = useState<{ key: string; list: ModelsListAnswer } | undefined>(() => {
    const list = lists.get(key);
    return list ? { key, list } : undefined;
  });
  useEffect(() => {
    let live = true;
    loadCatalogue(engine, medium, provider).then(
      (next) => live && setAnswer({ key, list: next }),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [engine, medium, provider, key]);
  return answer?.key === key ? answer.list : lists.get(key);
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
