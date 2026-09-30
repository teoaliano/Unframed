import type { ModelEntry, ModelsListAnswer } from "@unframed/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { errorText, logInfo } from "../log.ts";
import { Config } from "../services.ts";
import { SettingsStore } from "../settingsStore.ts";

/** OpenRouter's video catalogue, with each model's video input from the site's own filter. Never fails. */
export class VideoCatalogue extends Context.Service<VideoCatalogue, { readonly list: Effect.Effect<ModelsListAnswer> }>()("unframed/engine/VideoCatalogue") {}

const field = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined;

const getJson = async (url: string): Promise<unknown> => {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`answered ${response.status}`);
  return response.json();
};

const listOrNull = (value: unknown): unknown[] | null => (Array.isArray(value) ? value : null);

const toEntry = (raw: unknown, videoInputs: ReadonlySet<string>): ModelEntry | undefined => {
  const id = field(raw, "id");
  if (typeof id !== "string" || id === "") return undefined;
  const name = field(raw, "name");
  const created = field(raw, "created");
  const pricing = field(raw, "pricing_skus");
  return {
    id,
    name: typeof name === "string" && name !== "" ? name : id,
    created: typeof created === "number" && Number.isFinite(created) ? created : null,
    params: {
      duration: listOrNull(field(raw, "supported_durations")),
      resolution: listOrNull(field(raw, "supported_resolutions")),
      aspect_ratio: listOrNull(field(raw, "supported_aspect_ratios")),
      size: listOrNull(field(raw, "supported_sizes")),
      frame_images: listOrNull(field(raw, "supported_frame_images")),
      generate_audio: field(raw, "generate_audio") === true,
      seed: field(raw, "seed") === true,
    },
    pricing: typeof pricing === "object" && pricing !== null && !Array.isArray(pricing) ? (pricing as Record<string, unknown>) : null,
    // Unknown must never read as "does not accept": an empty set means nobody knows.
    acceptsVideo: videoInputs.size === 0 ? null : videoInputs.has(id),
  };
};

export const videoCatalogueLayer = Layer.effect(
  VideoCatalogue,
  Effect.gen(function* () {
    const config = yield* Config;
    const settings = yield* SettingsStore;
    const origin = config.openRouterOrigin;

    // The documented catalogue has no modality field, and video models are absent from the
    // general listing, so video input comes from the endpoint behind OpenRouter's own site filter.
    let videoInputs: Promise<ReadonlySet<string>> | undefined;
    const findVideoInputs = (): Promise<ReadonlySet<string>> =>
      (videoInputs ??= (async () => {
        try {
          const answer = await getJson(`${origin}/api/frontend/v1/models/find?active=true&fmt=cards&input_modalities=video`);
          const models = field(field(answer, "data"), "models");
          if (!Array.isArray(models)) throw new Error("the answer has no model list");
          const slugs = new Set<string>();
          for (const model of models) {
            const modalities = field(model, "input_modalities");
            const slug = field(model, "slug");
            if (typeof slug === "string" && Array.isArray(modalities) && modalities.includes("video")) slugs.add(slug);
          }
          return slugs;
        } catch (error) {
          logInfo(`video input modalities unavailable (${errorText(error)}); warnings disabled`);
          return new Set<string>();
        }
      })());

    const list = Effect.gen(function* () {
      const fallback = (yield* settings.read).videoModel;
      const models = yield* Effect.promise(async () => {
        let raw: unknown[];
        try {
          const answer = await getJson(`${origin}/api/v1/videos/models`);
          const data = field(answer, "data");
          raw = Array.isArray(data) ? data : Array.isArray(answer) ? answer : [];
        } catch {
          return [];
        }
        const inputs = await findVideoInputs();
        return raw.flatMap((each) => toEntry(each, inputs) ?? []);
      });
      const all: ModelEntry[] = models.some((model) => model.id === fallback) ? models : [...models, { id: fallback, name: fallback }];
      return { models: all.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)), default: fallback };
    });

    return VideoCatalogue.of({ list });
  }),
);
