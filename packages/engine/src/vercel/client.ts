import type { CostBasis, ModelEntry, ModelsListAnswer, VercelStatus } from "@unframed/contracts";
import { vercelAmount, vercelCatalogueEntry, vercelListPrice, vercelMessage, VERCEL_NO_IMAGE_MESSAGE } from "@unframed/domain";
import { errorText } from "../log.ts";
import type { ReferencePart } from "../openRouter/text.ts";

const CALL_TIMEOUT_MS = 30_000;
const IMAGE_TIMEOUT_MS = 120_000;
const SHORT_TIMEOUT_MS = 10_000;
const CATALOGUE_TTL_MS = 10 * 60_000;

const field = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined;

const reason = (error: unknown): string => {
  const cause = field(error, "cause");
  return cause instanceof Error ? cause.message : errorText(error);
};

type Answer = { readonly ok: true; readonly body: unknown } | { readonly ok: false; readonly error: string };

const call = async (url: string, init: RequestInit, timeoutMs: number): Promise<Answer> => {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    return { ok: false, error: `Could not reach the Vercel AI Gateway: ${reason(error)}` };
  }
  let raw: string;
  try {
    raw = await response.text();
  } catch (error) {
    return {
      ok: false,
      error: `Lost the connection while reading the Vercel AI Gateway's answer: ${reason(error)}. The run may still have completed and been charged. Check the AI Gateway logs in the Vercel dashboard.`,
    };
  }
  let parsed: unknown;
  let isJson = true;
  try {
    parsed = JSON.parse(raw);
  } catch {
    isJson = false;
  }
  if (!response.ok) return { ok: false, error: vercelMessage(response.status, isJson ? parsed : undefined, raw) };
  if (!isJson) return { ok: false, error: `Unexpected response from the Vercel AI Gateway: ${raw.slice(0, 300)}` };
  return { ok: true, body: parsed };
};

const post = (origin: string, key: string, path: string, body: unknown, timeoutMs: number) =>
  call(`${origin}${path}`, { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify(body) }, timeoutMs);

const catalogues = new Map<string, { readonly at: number; readonly data: unknown[] }>();

const catalogue = async (origin: string, fresh: boolean): Promise<unknown[] | undefined> => {
  const cached = catalogues.get(origin);
  if (!fresh && cached && Date.now() - cached.at < CATALOGUE_TTL_MS) return cached.data;
  const answer = await call(`${origin}/v1/models`, { headers: { accept: "application/json" } }, CALL_TIMEOUT_MS);
  if (!answer.ok) return undefined;
  const data = field(answer.body, "data");
  if (!Array.isArray(data)) return undefined;
  catalogues.set(origin, { at: Date.now(), data });
  return data;
};

export const listVercelModels = async (origin: string, medium: "image" | "text", fallback: string, hasKey: boolean): Promise<ModelsListAnswer> => {
  const data = hasKey ? await catalogue(origin, true) : undefined;
  const models = (data ?? []).flatMap((raw) => vercelCatalogueEntry(raw, medium) ?? []);
  const all: ModelEntry[] = models.some((model) => model.id === fallback) ? models : [...models, { id: fallback, name: fallback }];
  return { models: all.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)), default: fallback };
};

const catalogueEntry = async (origin: string, medium: "image" | "text", model: string): Promise<ModelEntry | undefined> =>
  ((await catalogue(origin, false)) ?? []).flatMap((raw) => vercelCatalogueEntry(raw, medium) ?? []).find((entry) => entry.id === model);

export type VercelImageOutcome =
  | { readonly ok: true; readonly bytes: Buffer; readonly id: string | undefined }
  | { readonly ok: false; readonly error: string };

export const vercelImage = async (origin: string, key: string, input: { readonly model: string; readonly prompt: string; readonly images: ReadonlyArray<string> }): Promise<VercelImageOutcome> => {
  const body: Record<string, unknown> = { model: input.model, prompt: input.prompt, n: 1, response_format: "b64_json" };
  if (input.images.length > 0) body.images = input.images.map((url) => ({ image_url: url }));
  const answer = await post(origin, key, input.images.length > 0 ? "/v1/images/edits" : "/v1/images/generations", body, IMAGE_TIMEOUT_MS);
  if (!answer.ok) return answer;
  const data = field(answer.body, "data");
  const b64 = field(Array.isArray(data) ? data[0] : undefined, "b64_json");
  if (typeof b64 !== "string" || b64 === "") return { ok: false, error: VERCEL_NO_IMAGE_MESSAGE };
  const id = field(answer.body, "id");
  return { ok: true, bytes: Buffer.from(b64, "base64"), id: typeof id === "string" && id !== "" ? id : undefined };
};

export type VercelTextOutcome =
  | { readonly ok: true; readonly text: string; readonly id: string | undefined; readonly usage: unknown }
  | { readonly ok: false; readonly error: string };

const answerText = (content: unknown): string | undefined => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  const parts = content.flatMap((part) => (field(part, "type") === "text" && typeof field(part, "text") === "string" ? [field(part, "text") as string] : []));
  return parts.length > 0 ? parts.join("") : undefined;
};

export const vercelText = async (
  origin: string,
  key: string,
  input: { readonly model: string; readonly prompt: string; readonly references: ReadonlyArray<ReferencePart>; readonly system?: string | undefined },
  noText: string,
): Promise<VercelTextOutcome> => {
  const user = { role: "user", content: [{ type: "text", text: input.prompt }, ...input.references.filter((part) => part.type === "image_url")] };
  const messages = input.system !== undefined && input.system.trim() !== "" ? [{ role: "system", content: input.system }, user] : [user];
  const answer = await post(origin, key, "/v1/chat/completions", { model: input.model, messages }, CALL_TIMEOUT_MS);
  if (!answer.ok) return answer;
  const choices = field(answer.body, "choices");
  const text = answerText(field(field(Array.isArray(choices) ? choices[0] : undefined, "message"), "content"));
  if (text === undefined || text.trim() === "") return { ok: false, error: noText };
  const id = field(answer.body, "id");
  return { ok: true, text, id: typeof id === "string" && id !== "" ? id : undefined, usage: field(answer.body, "usage") };
};

const lookup = async (origin: string, key: string, id: string): Promise<number | undefined> => {
  const answer = await call(`${origin}/v1/generation?id=${encodeURIComponent(id)}`, { headers: { authorization: `Bearer ${key}` } }, SHORT_TIMEOUT_MS);
  return answer.ok ? vercelAmount(field(field(answer.body, "data"), "total_cost")) : undefined;
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const vercelCost = async (input: {
  readonly origin: string;
  readonly key: string;
  readonly id: string | undefined;
  readonly medium: "image" | "text";
  readonly model: string;
  readonly usage?: unknown;
  readonly waitMs: number;
}): Promise<{ readonly cost: number | null; readonly costBasis?: CostBasis }> => {
  if (input.id !== undefined) {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await wait(input.waitMs);
      const cost = await lookup(input.origin, input.key, input.id);
      if (cost !== undefined) return { cost, costBasis: "measured" };
    }
  }
  const entry = await catalogueEntry(input.origin, input.medium, input.model);
  const usage = input.medium === "text" ? ((typeof input.usage === "object" && input.usage !== null ? input.usage : {}) as Record<string, unknown>) : undefined;
  const price = vercelListPrice({ entry, ...(usage === undefined ? {} : { usage }) });
  return price === null ? { cost: null } : { cost: price, costBasis: "list-price" };
};

export const vercelCredits = async (origin: string, key: string): Promise<VercelStatus> => {
  if (key === "") return { hasKey: false };
  let response: Response;
  try {
    response = await fetch(`${origin}/v1/credits`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(SHORT_TIMEOUT_MS) });
  } catch (error) {
    throw new Error(reason(error));
  }
  if (response.status === 401 || response.status === 403) return { hasKey: true, revoked: true };
  const body: unknown = response.ok ? await response.json().catch(() => undefined) : undefined;
  const balance = vercelAmount(field(body, "balance"));
  const totalUsed = vercelAmount(field(body, "total_used"));
  if (balance === undefined || totalUsed === undefined) throw new Error(`The Vercel AI Gateway answered ${response.status}.`);
  return { hasKey: true, balance, totalUsed };
};
