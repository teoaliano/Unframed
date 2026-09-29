/** OpenRouter's key endpoints (spec 10): the PKCE code exchange and the key status. */
import type { KeyStatus } from "@unframed/contracts";
import { errorText } from "../log.ts";

const EXCHANGE_TIMEOUT_MS = 30_000;
const STATUS_TIMEOUT_MS = 10_000;

const field = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined;

/** A fetch failure's own words: undici puts them on `cause`. */
const reason = (error: unknown): string => {
  const cause = field(error, "cause");
  return cause instanceof Error ? cause.message : errorText(error);
};

/** OpenRouter's own message: `error.message`, a string `error`, or `message`. */
const upstreamWords = (body: unknown): string | undefined => {
  const error = field(body, "error");
  const message = field(error, "message");
  if (typeof message === "string" && message !== "") return message;
  if (typeof error === "string" && error !== "") return error;
  const top = field(body, "message");
  return typeof top === "string" && top !== "" ? top : undefined;
};

export type ExchangeOutcome =
  | { readonly ok: true; readonly key: string }
  | { readonly ok: false; readonly network: true; readonly message: string }
  | { readonly ok: false; readonly network: false; readonly message: string };

/** Redeems a code with its verifier. The method is echoed, or OpenRouter answers 400. */
export const exchangeCode = async (origin: string, code: string, verifier: string): Promise<ExchangeOutcome> => {
  let response: Response;
  let body: unknown;
  try {
    response = await fetch(`${origin}/api/v1/auth/keys`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: "S256" }),
      signal: AbortSignal.timeout(EXCHANGE_TIMEOUT_MS),
    });
    const text = await response.text();
    try {
      body = JSON.parse(text);
    } catch {
      body = undefined;
    }
  } catch (error) {
    return { ok: false, network: true, message: reason(error) };
  }
  const key = field(body, "key");
  if (response.ok && typeof key === "string") return { ok: true, key };
  return { ok: false, network: false, message: upstreamWords(body) ?? `It answered ${response.status}. Try connecting again.` };
};

export type KeyStatusOutcome = { readonly ok: true; readonly status: KeyStatus } | { readonly ok: false; readonly message: string };

const finiteOr = <T>(value: unknown, fallback: T): number | T => (typeof value === "number" && Number.isFinite(value) ? value : fallback);

/**
 * One call to OpenRouter's key endpoint, coerced. Everything else it answers is dropped,
 * `label` above all: it is a truncated form of the key itself.
 */
export const fetchKeyStatus = async (origin: string, key: string): Promise<KeyStatusOutcome> => {
  let response: Response;
  let body: unknown;
  try {
    response = await fetch(`${origin}/api/v1/key`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(STATUS_TIMEOUT_MS) });
    if (response.status === 401 || response.status === 403) return { ok: true, status: { hasKey: true, revoked: true } };
    const text = await response.text();
    try {
      body = JSON.parse(text);
    } catch {
      body = undefined;
    }
  } catch (error) {
    return { ok: false, message: reason(error) };
  }
  const data = field(body, "data");
  if (!response.ok || typeof data !== "object" || data === null || Array.isArray(data)) return { ok: false, message: `OpenRouter answered ${response.status}.` };
  const expiresAt = field(data, "expires_at");
  return {
    ok: true,
    status: {
      hasKey: true,
      usage: finiteOr(field(data, "usage"), 0),
      limit: finiteOr(field(data, "limit"), null),
      limitRemaining: finiteOr(field(data, "limit_remaining"), null),
      expiresAt: typeof expiresAt === "string" ? expiresAt : null,
      isFreeTier: field(data, "is_free_tier") === true,
    },
  };
};
