import type { GenerationProvider, Medium } from "@unframed/contracts";
import { NO_KEY_MESSAGE } from "./runMessages.ts";
import { VERCEL_NO_KEY_MESSAGE, VERCEL_VIDEO_INPUT_WARNING } from "./vercel.ts";

export interface ProviderKeys {
  readonly hasKey: boolean;
  readonly hasVercelKey: boolean;
}

export interface ProviderSecrets {
  readonly key: string;
  readonly vercelKey: string;
}

export interface ProviderModels {
  readonly imageModel: string;
  readonly textModel: string;
  readonly vercelImageModel: string;
  readonly vercelTextModel: string;
}

export type RoutedMedium = "image" | "text";

export interface GenerationProviderInfo {
  readonly id: GenerationProvider;
  readonly name: string;
  readonly title: string;
  readonly label: string;
  readonly media: ReadonlyArray<Medium>;
  readonly hasKey: (keys: ProviderKeys) => boolean;
  readonly key: (secrets: ProviderSecrets) => string;
  readonly defaultModel: (models: ProviderModels, medium: RoutedMedium) => string;
  readonly noKeyMessage: string;
  readonly browse: Readonly<Record<RoutedMedium, string>>;
  readonly browseLabel: string;
  readonly listPriced: boolean;
  readonly videoInputWarning?: string;
}

export const GENERATION_PROVIDERS: Readonly<Record<GenerationProvider, GenerationProviderInfo>> = {
  openrouter: {
    id: "openrouter",
    name: "OpenRouter",
    title: "OpenRouter",
    label: "OpenRouter",
    media: ["image", "video", "text"],
    hasKey: (keys) => keys.hasKey,
    key: (secrets) => secrets.key,
    defaultModel: (models, medium) => (medium === "image" ? models.imageModel : models.textModel),
    noKeyMessage: NO_KEY_MESSAGE,
    browse: { image: "https://openrouter.ai/models?output_modalities=image", text: "https://openrouter.ai/models?output_modalities=text&input_modalities=image" },
    browseLabel: "Browse on OpenRouter",
    listPriced: false,
  },
  vercel: {
    id: "vercel",
    name: "the Vercel AI Gateway",
    title: "Vercel AI Gateway",
    label: "Vercel",
    media: ["image", "text"],
    hasKey: (keys) => keys.hasVercelKey,
    key: (secrets) => secrets.vercelKey,
    defaultModel: (models, medium) => (medium === "image" ? models.vercelImageModel : models.vercelTextModel),
    noKeyMessage: VERCEL_NO_KEY_MESSAGE,
    browse: { image: "https://vercel.com/ai-gateway/models?type=image", text: "https://vercel.com/ai-gateway/models?type=language" },
    browseLabel: "Browse on Vercel",
    listPriced: true,
    videoInputWarning: VERCEL_VIDEO_INPUT_WARNING,
  },
};

export const GENERATION_PROVIDER_IDS: ReadonlyArray<GenerationProvider> = ["openrouter", "vercel"];

export const DEFAULT_PROVIDER: GenerationProvider = "openrouter";

export const isGenerationProvider = (value: unknown): value is GenerationProvider => GENERATION_PROVIDER_IDS.includes(value as GenerationProvider);

export const providerOf = (value: unknown): GenerationProvider => (isGenerationProvider(value) ? value : DEFAULT_PROVIDER);

export const providerField = (provider: GenerationProvider | undefined): { readonly provider?: GenerationProvider } =>
  providerOf(provider) === DEFAULT_PROVIDER ? {} : { provider: providerOf(provider) };

export const providerLabel = (provider: GenerationProvider | undefined): string[] =>
  providerOf(provider) === DEFAULT_PROVIDER ? [] : [GENERATION_PROVIDERS[providerOf(provider)].label];

export const providerKeysOf = (secrets: ProviderSecrets): ProviderKeys => ({ hasKey: secrets.key !== "", hasVercelKey: secrets.vercelKey !== "" });

export const generationProviders = (keys: ProviderKeys, medium: Medium): GenerationProvider[] =>
  GENERATION_PROVIDER_IDS.filter((id) => GENERATION_PROVIDERS[id].media.includes(medium) && GENERATION_PROVIDERS[id].hasKey(keys));

export const trayProvider = (input: {
  readonly medium: Medium;
  readonly wanted: GenerationProvider | undefined;
  readonly settings: ProviderKeys;
}): { readonly provider: GenerationProvider; readonly switched?: string } => {
  if (input.medium === "video" || input.medium === "audio") return { provider: "openrouter" };
  const offered = generationProviders(input.settings, input.medium);
  const wanted = input.wanted ?? offered[0] ?? "openrouter";
  if (offered.length === 0 || offered.includes(wanted)) return { provider: wanted };
  const other = offered[0]!;
  if (input.wanted === undefined) return { provider: other };
  return { provider: other, switched: `Made through ${GENERATION_PROVIDERS[wanted].name}, which has no key now. This run goes through ${GENERATION_PROVIDERS[other].name}.` };
};
