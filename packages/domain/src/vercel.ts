import type { ModelEntry } from "@unframed/contracts";

export const VERCEL_NO_KEY_MESSAGE = "No Vercel AI Gateway key yet. Add one in Settings, under Generation.";
export const VERCEL_NO_IMAGE_MESSAGE = "The Vercel AI Gateway returned no image data.";
export const VERCEL_VIDEO_BLOCKER =
  "Video runs through OpenRouter only: the Vercel AI Gateway has no video API Unframed can call. Connect OpenRouter in Settings to make video.";
export const VERCEL_VIDEO_INPUT_WARNING = "The Vercel AI Gateway takes no video input, so the selected videos are not sent.";
export const VERCEL_BAD_PROVIDER = 'provider has to be "openrouter" or "vercel".';
export const VERCEL_KEY_SAVED_MESSAGE = "Vercel AI Gateway key saved. Images and text are ready to generate.";

const field = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined;

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

export const vercelAmount = (value: unknown): number | undefined => {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
  return Number.isFinite(number) && number >= 0 ? number : undefined;
};

export const vercelCatalogueEntry = (raw: unknown, medium: "image" | "text"): ModelEntry | undefined => {
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

export const vercelListPrice = (input: {
  readonly entry: Pick<ModelEntry, "pricing"> | undefined;
  readonly usage?: { readonly prompt_tokens?: unknown; readonly completion_tokens?: unknown };
}): number | null => {
  const pricing = input.entry?.pricing;
  if (!pricing) return null;
  if (input.usage === undefined) return vercelAmount(pricing.image) ?? null;
  const prompt = vercelAmount(input.usage.prompt_tokens);
  const completion = vercelAmount(input.usage.completion_tokens);
  const inputPrice = vercelAmount(pricing.input);
  const outputPrice = vercelAmount(pricing.output);
  if (prompt === undefined || completion === undefined || inputPrice === undefined || outputPrice === undefined) return null;
  return prompt * inputPrice + completion * outputPrice;
};

export const vercelUpstream = (parsed: unknown, raw: string): string => {
  const error = field(parsed, "error");
  const message = field(error, "message");
  if (typeof message === "string") return message;
  if (typeof error === "string") return error;
  return raw.slice(0, 300);
};

export const vercelMessage = (status: number, parsed: unknown, raw: string): string => {
  const upstream = vercelUpstream(parsed, raw);
  if (status === 401) return `The Vercel AI Gateway refused the key. It may have been revoked. Paste a new one in Settings, under Generation. (${upstream})`;
  if (status === 402 && field(field(parsed, "error"), "type") === "quota_for_entity_exceeded")
    return `The Vercel AI Gateway refused this because a budget was reached (the team's, this key's or yours). Raise it in the Vercel dashboard under AI Gateway, Budgets. (${upstream})`;
  if (status === 402) return `The Vercel AI Gateway refused this as unpaid: the team has no AI Gateway credits left. Add credits in the Vercel dashboard under AI Gateway. (${upstream})`;
  if (status === 429) return `The Vercel AI Gateway is rate limiting this model. Try again in a moment. (${upstream})`;
  return `Vercel AI Gateway (${status}): ${upstream}`;
};

export type VercelStatusValue = { readonly hasKey: false } | { readonly hasKey: true; readonly revoked: true } | { readonly hasKey: true; readonly balance: number; readonly totalUsed: number };

const dollars = (value: number) => `$${value.toFixed(2)}`;

export const vercelCreditsCopy = (input: { readonly hasKey: boolean; readonly keyHint: string; readonly status: VercelStatusValue | undefined }): string => {
  if (!input.hasKey) return "Make a key in the Vercel dashboard (AI Gateway, API Keys) and paste it here. Images and text are billed to that team's AI Gateway credits.";
  const status = input.status;
  if (status === undefined || !status.hasKey) return `A key is already saved${input.keyHint === "" ? "" : ` (…${input.keyHint})`}. Entering a new one replaces it.`;
  if ("revoked" in status) return "This key no longer works at Vercel. It may have been revoked or its team member removed.";
  return `${dollars(status.balance)} of AI Gateway credit left on this Vercel team, ${dollars(status.totalUsed)} used so far.`;
};
