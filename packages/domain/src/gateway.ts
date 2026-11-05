/** Spec 22: the Vercel AI Gateway's catalogue, prices, errors and credits, and which provider a tray runs on. */
import type { GenerationProvider, Medium, ModelEntry } from "@unframed/contracts";

export const GATEWAY_NO_KEY_MESSAGE = "No Vercel AI Gateway key yet. Add one in Settings, under Generation.";
export const GATEWAY_SERVES_MESSAGE = "The Vercel AI Gateway serves image and text runs only. Video runs through OpenRouter.";
export const GATEWAY_NO_IMAGE_MESSAGE = "The Vercel AI Gateway returned no image data.";
export const GATEWAY_VIDEO_BLOCKER =
  "Video runs through OpenRouter only: the Vercel AI Gateway has no video API Unframed can call. Connect OpenRouter in Settings to make video.";
export const GATEWAY_BAD_PROVIDER = 'provider has to be "openrouter" or "vercel".';
export const GATEWAY_KEY_SAVED_MESSAGE = "Vercel AI Gateway key saved. Images and text are ready to generate.";
export const GATEWAY_BROWSE = { image: "https://vercel.com/ai-gateway/models?type=image", text: "https://vercel.com/ai-gateway/models?type=language" } as const;

export const GENERATION_PROVIDER_NAMES: Readonly<Record<GenerationProvider, string>> = { openrouter: "OpenRouter", vercel: "the Vercel AI Gateway" };
export const GENERATION_PROVIDER_LABELS: Readonly<Record<GenerationProvider, string>> = { openrouter: "OpenRouter", vercel: "Vercel" };

const field = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined;

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** A dollar amount the gateway gives as a string or a number: finite and not negative, else undefined. */
export const gatewayAmount = (value: unknown): number | undefined => {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
  return Number.isFinite(number) && number >= 0 ? number : undefined;
};

/** One `/v1/models` entry as a catalogue row for the medium, or undefined when the medium cannot use it. */
export const gatewayCatalogueEntry = (raw: unknown, medium: "image" | "text"): ModelEntry | undefined => {
  const id = field(raw, "id");
  if (typeof id !== "string" || id === "") return undefined;
  const type = field(raw, "type");
  const input = list(field(field(raw, "modalities"), "input"));
  const output = list(field(field(raw, "modalities"), "output"));
  if (medium === "image" && type !== "image") return undefined;
  if (medium === "text" && !(type === "language" && output.includes("text") && input.includes("image"))) return undefined;
  const name = field(raw, "name");
  const released = field(raw, "released");
  const pricing = field(raw, "pricing");
  return {
    id,
    name: typeof name === "string" && name !== "" ? name : id,
    created: typeof released === "number" && Number.isFinite(released) ? released : null,
    params: null,
    pricing: typeof pricing === "object" && pricing !== null && !Array.isArray(pricing) ? (pricing as Record<string, unknown>) : null,
  };
};

/** The list price of a run: an image model's flat `pricing.image`, or a text run's tokens at the input and output prices. */
export const gatewayListPrice = (input: {
  readonly entry: Pick<ModelEntry, "pricing"> | undefined;
  readonly usage?: { readonly prompt_tokens?: unknown; readonly completion_tokens?: unknown };
}): number | null => {
  const pricing = input.entry?.pricing;
  if (!pricing) return null;
  if (input.usage === undefined) return gatewayAmount(pricing.image) ?? null;
  const prompt = gatewayAmount(input.usage.prompt_tokens);
  const completion = gatewayAmount(input.usage.completion_tokens);
  const inputPrice = gatewayAmount(pricing.input);
  const outputPrice = gatewayAmount(pricing.output);
  if (prompt === undefined || completion === undefined || inputPrice === undefined || outputPrice === undefined) return null;
  return prompt * inputPrice + completion * outputPrice;
};

/** The gateway's own words: `error.message`, a string `error`, else the start of the body. */
export const gatewayUpstream = (parsed: unknown, raw: string): string => {
  const error = field(parsed, "error");
  const message = field(error, "message");
  if (typeof message === "string") return message;
  if (typeof error === "string") return error;
  return raw.slice(0, 300);
};

/** The sentence for a non-2xx gateway answer. */
export const gatewayMessage = (status: number, parsed: unknown, raw: string): string => {
  const upstream = gatewayUpstream(parsed, raw);
  if (status === 401) return `The Vercel AI Gateway refused the key. It may have been revoked. Paste a new one in Settings, under Generation. (${upstream})`;
  if (status === 402 && field(field(parsed, "error"), "type") === "quota_for_entity_exceeded")
    return `The Vercel AI Gateway refused this because a budget was reached (the team's, this key's or yours). Raise it in the Vercel dashboard under AI Gateway, Budgets. (${upstream})`;
  if (status === 402) return `The Vercel AI Gateway refused this as unpaid: the team has no AI Gateway credits left. Add credits in the Vercel dashboard under AI Gateway. (${upstream})`;
  if (status === 429) return `The Vercel AI Gateway is rate limiting this model. Try again in a moment. (${upstream})`;
  return `Vercel AI Gateway (${status}): ${upstream}`;
};

export type VercelStatusValue = { readonly hasKey: false } | { readonly hasKey: true; readonly revoked: true } | { readonly hasKey: true; readonly balance: number; readonly totalUsed: number };

const dollars = (value: number) => `$${value.toFixed(2)}`;

export const gatewayCreditsCopy = (input: { readonly hasKey: boolean; readonly keyHint: string; readonly status: VercelStatusValue | undefined }): string => {
  if (!input.hasKey) return "Make a key in the Vercel dashboard (AI Gateway, API Keys) and paste it here. Images and text are billed to that team's AI Gateway credits.";
  const status = input.status;
  if (status === undefined || !status.hasKey) return `A key is already saved${input.keyHint === "" ? "" : ` (…${input.keyHint})`}. Entering a new one replaces it.`;
  if ("revoked" in status) return "This key no longer works at Vercel. It may have been revoked or its team member removed.";
  return `${dollars(status.balance)} of AI Gateway credit left on this Vercel team, ${dollars(status.totalUsed)} used so far.`;
};

export interface ProviderKeys {
  readonly hasKey: boolean;
  readonly hasVercelKey: boolean;
}

/** The providers that can run a medium with the keys there are, OpenRouter first. Audio is ElevenLabs (spec 15), so none. */
export const generationProviders = (keys: ProviderKeys, medium: Medium): GenerationProvider[] => {
  if (medium === "audio") return [];
  const providers: GenerationProvider[] = [];
  if (keys.hasKey) providers.push("openrouter");
  if (keys.hasVercelKey && medium !== "video") providers.push("vercel");
  return providers;
};

/**
 * The provider a tray runs on: the one wanted when it has a key, else the other one that has,
 * with the line that says so; with no key at all, the one wanted (the no-key blocker shows).
 */
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
  return { provider: other, switched: `Made through ${GENERATION_PROVIDER_NAMES[wanted]}, which has no key now. This run goes through ${GENERATION_PROVIDER_NAMES[other]}.` };
};
