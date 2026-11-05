import type { CostBasis, GenerationProvider, ImageParams, ModelsListAnswer } from "@unframed/contracts";
import { GENERATION_PROVIDERS, type EffectiveSettings, type RoutedMedium } from "@unframed/domain";
import { generateImage, imageRequestBody } from "../openRouter/images.ts";
import { chatRequestBody, completeText, NO_TEXT_MESSAGE, type ReferencePart } from "../openRouter/text.ts";
import { listVercelModels, vercelCost, vercelImage, vercelText } from "../vercel/client.ts";

export interface Priced {
  readonly cost: number | null;
  readonly costBasis?: CostBasis;
}

export type ProviderImage =
  | { readonly ok: true; readonly bytes: Buffer; readonly mediaType: string | undefined; readonly cost: number | null; readonly later?: () => Promise<Priced> }
  | { readonly ok: false; readonly error: string };

export type ProviderText =
  | { readonly ok: true; readonly text: string; readonly cost: number | null; readonly later?: () => Promise<Priced> }
  | { readonly ok: false; readonly error: string };

export interface RunProvider {
  readonly id: GenerationProvider;
  readonly key: (settings: EffectiveSettings) => string;
  readonly defaultModel: (settings: EffectiveSettings, medium: RoutedMedium) => string;
  readonly noKeyMessage: string;
  readonly image: (key: string, input: { readonly model: string; readonly prompt: string; readonly params: ImageParams; readonly references: ReadonlyArray<ReferencePart> }) => Promise<ProviderImage>;
  readonly text: (key: string, input: { readonly model: string; readonly prompt: string; readonly references: ReadonlyArray<ReferencePart>; readonly system?: string | undefined }) => Promise<ProviderText>;
}

export interface ProviderOrigins {
  readonly openRouterOrigin: string;
  readonly vercelOrigin: string;
  readonly vercelLookupMs: number;
}

const described = (id: GenerationProvider) => ({
  id,
  key: (settings: EffectiveSettings) => GENERATION_PROVIDERS[id].key(settings),
  defaultModel: (settings: EffectiveSettings, medium: RoutedMedium) => GENERATION_PROVIDERS[id].defaultModel(settings, medium),
  noKeyMessage: GENERATION_PROVIDERS[id].noKeyMessage,
});

export const runProviders = (origins: ProviderOrigins): Readonly<Record<GenerationProvider, RunProvider>> => ({
  openrouter: {
    ...described("openrouter"),
    image: async (key, input) => {
      const body = imageRequestBody(input.model, input.prompt, input.params);
      if (input.references.length > 0) body.input_references = [...input.references];
      return generateImage(origins.openRouterOrigin, key, body);
    },
    text: (key, input) => completeText(origins.openRouterOrigin, key, chatRequestBody(input.model, input.prompt, [...input.references], input.system)),
  },
  vercel: {
    ...described("vercel"),
    image: async (key, input) => {
      const images = input.references.flatMap((part) => (part.type === "image_url" ? [part.image_url.url] : []));
      const answer = await vercelImage(origins.vercelOrigin, key, { model: input.model, prompt: input.prompt, images });
      if (!answer.ok) return answer;
      return {
        ok: true,
        bytes: answer.bytes,
        mediaType: undefined,
        cost: null,
        later: () => vercelCost({ origin: origins.vercelOrigin, key, id: answer.id, medium: "image", model: input.model, waitMs: origins.vercelLookupMs }),
      };
    },
    text: async (key, input) => {
      const answer = await vercelText(origins.vercelOrigin, key, input, NO_TEXT_MESSAGE);
      if (!answer.ok) return answer;
      return {
        ok: true,
        text: answer.text,
        cost: null,
        later: () => vercelCost({ origin: origins.vercelOrigin, key, id: answer.id, medium: "text", model: input.model, usage: answer.usage, waitMs: origins.vercelLookupMs }),
      };
    },
  },
});

export const providerCatalogues = (input: {
  readonly vercelOrigin: string;
  readonly openRouter: (medium: RoutedMedium) => Promise<ModelsListAnswer>;
}): Readonly<Record<GenerationProvider, (settings: EffectiveSettings, medium: RoutedMedium) => Promise<ModelsListAnswer>>> => ({
  openrouter: (_settings, medium) => input.openRouter(medium),
  vercel: (settings, medium) => listVercelModels(input.vercelOrigin, medium, GENERATION_PROVIDERS.vercel.defaultModel(settings, medium), GENERATION_PROVIDERS.vercel.key(settings) !== ""),
});

export const settled = async (answer: { readonly cost: number | null; readonly later?: () => Promise<Priced> }): Promise<Priced> =>
  answer.later === undefined ? { cost: answer.cost } : answer.later();
