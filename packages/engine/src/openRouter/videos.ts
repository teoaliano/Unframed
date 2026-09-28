/** OpenRouter's video endpoint: create a job, ask about it, download its clip. */
import { errorText } from "../log.ts";
import { unpaidMessage, upstreamMessage } from "./images.ts";

const field = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined;

const first300 = (text: string) => text.slice(0, 300);

/** A fetch failure's own words: undici puts them on `cause`. */
const reason = (error: unknown): string => {
  const cause = field(error, "cause");
  return cause instanceof Error ? cause.message : errorText(error);
};

export type CreateFailureReason = "unreachable" | "upstream" | "unpaid";

export type CreateOutcome =
  | { readonly ok: true; readonly id: string; readonly status: string | undefined }
  | { readonly ok: false; readonly reason: CreateFailureReason; readonly message: string };

/** `POST /api/v1/videos`. Never rejects: every failure is an outcome with its reason. */
export const createVideoJob = async (origin: string, key: string, payload: Record<string, unknown>): Promise<CreateOutcome> => {
  let response: Response;
  try {
    response = await fetch(`${origin}/api/v1/videos`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    return { ok: false, reason: "unreachable", message: `Could not reach OpenRouter: ${reason(error)}` };
  }
  let raw: string;
  try {
    raw = await response.text();
  } catch (error) {
    return {
      ok: false,
      reason: "upstream",
      message: `Lost the connection while reading OpenRouter's answer: ${reason(error)}. The render may still have completed and been charged. Check your OpenRouter activity page.`,
    };
  }
  let parsed: unknown;
  let isJson = true;
  try {
    parsed = JSON.parse(raw);
  } catch {
    isJson = false;
  }
  if (!response.ok) {
    const upstream = upstreamMessage(isJson ? parsed : undefined, raw);
    if (response.status === 402) return { ok: false, reason: "unpaid", message: unpaidMessage(upstream) };
    return { ok: false, reason: "upstream", message: `OpenRouter (${response.status}): ${upstream}` };
  }
  if (!isJson) return { ok: false, reason: "upstream", message: `Unexpected response from OpenRouter: ${first300(raw)}` };
  const id = field(parsed, "id");
  if (typeof id !== "string" || id === "") return { ok: false, reason: "upstream", message: "OpenRouter did not return a video job id." };
  const status = field(parsed, "status");
  return { ok: true, id, status: typeof status === "string" ? status : undefined };
};

export const STATUS_TIMEOUT_MS = 30_000;

/**
 * What asking about a job got: an answer, or no answer. "No answer" (a network error or a
 * body lost mid-read, a body that is not JSON, a non-2xx status) is what the give-up clock
 * counts. `network` marks the kind the poll reports as unreachable.
 */
export type StatusRead =
  | { readonly answered: true; readonly data: unknown }
  | { readonly answered: false; readonly network: boolean; readonly message: string; readonly cause?: string };

/** `GET /api/v1/videos/<id>` with a 30 s timeout. The one reader the poll and the sweep share. Never rejects. */
export const readVideoStatus = async (origin: string, key: string, id: string): Promise<StatusRead> => {
  let raw: string;
  let response: Response;
  try {
    response = await fetch(`${origin}/api/v1/videos/${encodeURIComponent(id)}`, {
      headers: { authorization: `Bearer ${key}`, accept: "application/json" },
      signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
    });
    raw = await response.text();
  } catch (error) {
    return { answered: false, network: true, message: `could not read the status answer: ${reason(error)}`, cause: reason(error) };
  }
  let parsed: unknown;
  let isJson = true;
  try {
    parsed = JSON.parse(raw);
  } catch {
    isJson = false;
  }
  if (!response.ok) return { answered: false, network: false, message: `OpenRouter (${response.status}): ${upstreamMessage(isJson ? parsed : undefined, raw)}` };
  if (!isJson) return { answered: false, network: false, message: `Unexpected response from OpenRouter: ${first300(raw)}` };
  return { answered: true, data: parsed };
};

export const DOWNLOAD_TIMEOUT_MS = 300_000;

/** The URL a completed job's clip downloads from: `unsigned_urls[0]`, else `urls[0]`. */
export const clipUrlOf = (data: unknown): string | undefined => {
  for (const key of ["unsigned_urls", "urls"]) {
    const list = field(data, key);
    if (Array.isArray(list) && typeof list[0] === "string" && list[0] !== "") return list[0];
  }
  return undefined;
};

/** Downloads a completed job's clip with the key, within 300 s in all. Rejects with the sentence the person sees. */
export const downloadClip = async (url: string, key: string): Promise<Buffer> => {
  const response = await fetch(url, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`Could not download the video (${response.status}).`);
  return Buffer.from(await response.arrayBuffer());
};
