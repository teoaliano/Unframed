import { unframedError, type ImagePricingAnswer, type ModelEntry, type ModelsListAnswer, type Sku, UnframedError } from "@unframed/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Config } from "../services.ts";
import { SettingsStore } from "../settingsStore.ts";

/** The model catalogue, proxied from OpenRouter. Never fails on an upstream problem. */
export class Catalogue extends Context.Service<
  Catalogue,
  {
    readonly listImageModels: Effect.Effect<ModelsListAnswer>;
    readonly imagePricing: (id: string) => Effect.Effect<ImagePricingAnswer, UnframedError>;
  }
>()("unframed/engine/Catalogue") {}

/** A model id is interpolated into an upstream path, so it must be a plain slug. */
export const MODEL_SLUG = /^~?[\w.-]+\/[\w.-]+$/;

const field = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined;

const getJson = async (url: string): Promise<unknown> => {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`answered ${response.status}`);
  return response.json();
};

/** The list inside an answer: `data`, or the answer itself. */
const listOf = (answer: unknown): unknown[] => {
  const data = field(answer, "data");
  if (Array.isArray(data)) return data;
  return Array.isArray(answer) ? answer : [];
};

const toEntry = (raw: unknown): ModelEntry | undefined => {
  const id = field(raw, "id");
  if (typeof id !== "string" || id === "") return undefined;
  const name = field(raw, "name");
  const created = field(raw, "created");
  const params = field(raw, "supported_parameters");
  return {
    id,
    name: typeof name === "string" && name !== "" ? name : id,
    created: typeof created === "number" && Number.isFinite(created) ? created : null,
    params: typeof params === "object" && params !== null && !Array.isArray(params) ? (params as Record<string, unknown>) : null,
  };
};

const toSku = (raw: unknown): Sku => {
  const sku: { -readonly [K in keyof Sku]: Sku[K] } = {};
  const unit = field(raw, "unit");
  const billable = field(raw, "billable");
  const variant = field(raw, "variant");
  const cost = field(raw, "cost_usd");
  if (typeof unit === "string") sku.unit = unit;
  if (typeof billable === "string") sku.billable = billable;
  if (typeof variant === "string" || variant === null) sku.variant = variant;
  const number = typeof cost === "number" ? cost : typeof cost === "string" && cost.trim() !== "" ? Number(cost) : Number.NaN;
  if (Number.isFinite(number)) sku.cost_usd = number;
  return sku;
};

const endpointsOf = (answer: unknown): unknown[] => {
  const data = field(answer, "data");
  for (const candidate of [field(data, "endpoints"), field(answer, "endpoints"), data]) if (Array.isArray(candidate)) return candidate;
  return [];
};

export const catalogueLayer = Layer.effect(
  Catalogue,
  Effect.gen(function* () {
    const config = yield* Config;
    const settings = yield* SettingsStore;
    const origin = config.openRouterOrigin;

    const listImageModels = Effect.gen(function* () {
      const fallback = (yield* settings.read).imageModel;
      const models = yield* Effect.promise(async () => {
        try {
          return listOf(await getJson(`${origin}/api/v1/images/models`)).flatMap((raw) => toEntry(raw) ?? []);
        } catch {
          return [];
        }
      });
      const all: ModelEntry[] = models.some((model) => model.id === fallback) ? models : [...models, { id: fallback, name: fallback }];
      return { models: all.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)), default: fallback };
    });

    const imagePricing = (id: string) =>
      Effect.gen(function* () {
        if (!MODEL_SLUG.test(id) || id.includes("..")) return yield* unframedError("bad_request", "Not a model slug.");
        return yield* Effect.promise(async (): Promise<ImagePricingAnswer> => {
          try {
            const answer = await getJson(`${origin}/api/v1/images/models/${id}/endpoints`);
            return {
              endpoints: endpointsOf(answer).map((endpoint) => {
                const pricing = field(endpoint, "pricing");
                return Array.isArray(pricing) ? pricing.map(toSku) : [];
              }),
            };
          } catch {
            return { endpoints: [] };
          }
        });
      });

    return Catalogue.of({ listImageModels, imagePricing });
  }),
);
