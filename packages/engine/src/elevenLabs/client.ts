import type { ElevenLabsStatus, ModelEntry, Voice, VoicesListAnswer } from "@unframed/contracts";
import {
  audioModelsProblemLine,
  creditsFrom,
  elevenLabsMessage,
  fieldOf,
  SPEECH_STALLED_MESSAGE,
  SPEECH_TIMEOUT_MESSAGE,
  speechFailure,
  speechLostMessage,
  type AudioModelsProblem,
  type SpeechCall,
} from "@unframed/domain";
import { errorText } from "../log.ts";

const TIMEOUT_MS = 30_000;
const SPEECH_TIMEOUT_MS = 120_000;

export class ElevenLabsError extends Error {}

const causeText = (error: unknown): string => {
  const cause = fieldOf(error, "cause");
  return cause instanceof Error ? cause.message : errorText(error);
};

const isTimeout = (error: unknown): boolean => fieldOf(error, "name") === "TimeoutError" || fieldOf(fieldOf(error, "cause"), "name") === "TimeoutError";

const get = async (origin: string, key: string, path: string): Promise<Response> =>
  fetch(`${origin}${path}`, { headers: { "xi-api-key": key, accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });

const toModel = (raw: unknown): ModelEntry | undefined => {
  const id = fieldOf(raw, "model_id");
  if (typeof id !== "string" || id === "" || fieldOf(raw, "can_do_text_to_speech") !== true) return undefined;
  const name = fieldOf(raw, "name");
  const languages = fieldOf(raw, "languages");
  const max = fieldOf(raw, "maximum_text_length_per_request");
  return {
    id,
    name: typeof name === "string" && name !== "" ? name : id,
    created: null,
    params: {
      canUseStyle: fieldOf(raw, "can_use_style") === true,
      canUseSpeakerBoost: fieldOf(raw, "can_use_speaker_boost") === true,
      languages: Array.isArray(languages)
        ? languages.flatMap((language) => {
            const languageId = fieldOf(language, "language_id");
            const languageName = fieldOf(language, "name");
            return typeof languageId === "string" ? [{ id: languageId, name: typeof languageName === "string" ? languageName : languageId }] : [];
          })
        : [],
      maxCharacters: typeof max === "number" && Number.isFinite(max) ? max : null,
    },
  };
};

export const listAudioModels = async (origin: string, key: string, fallback: string): Promise<{ models: ModelEntry[]; default: string; problem?: string }> => {
  const defaultRow: ModelEntry = { id: fallback, name: fallback, created: null, params: null };
  if (key === "") return { models: [defaultRow], default: fallback };
  const fallBack = (problem: AudioModelsProblem) => ({ models: [defaultRow], default: fallback, problem: audioModelsProblemLine(problem) });
  let response: Response;
  try {
    response = await get(origin, key, "/v1/models");
  } catch (error) {
    return fallBack({ kind: "unreachable", reason: causeText(error) });
  }
  if (response.status === 401) return fallBack({ kind: "revoked" });
  const answer: unknown = response.ok ? await response.json().catch(() => undefined) : undefined;
  if (!Array.isArray(answer)) return fallBack({ kind: "status", status: response.status });
  const models = answer.flatMap((raw) => toModel(raw) ?? []);
  return { models: models.some((model) => model.id === fallback) ? models : [...models, defaultRow], default: fallback };
};

const stringLabels = (labels: unknown): Record<string, string> =>
  Object.fromEntries(Object.entries(typeof labels === "object" && labels !== null ? labels : {}).filter((entry): entry is [string, string] => typeof entry[1] === "string"));

const toVoice = (raw: unknown): Voice | undefined => {
  const id = fieldOf(raw, "voice_id");
  if (typeof id !== "string" || id === "") return undefined;
  const name = fieldOf(raw, "name");
  const category = fieldOf(raw, "category");
  const preview = fieldOf(raw, "preview_url");
  return {
    id,
    name: typeof name === "string" && name !== "" ? name : id,
    category: typeof category === "string" ? category : null,
    labels: stringLabels(fieldOf(raw, "labels")),
    previewUrl: typeof preview === "string" && preview !== "" ? preview : null,
  };
};

export const listVoices = async (origin: string, key: string, input: { readonly search?: string | undefined; readonly pageToken?: string | undefined }): Promise<VoicesListAnswer> => {
  const query = new URLSearchParams({ page_size: "100" });
  if (input.search !== undefined && input.search.trim() !== "") query.set("search", input.search.trim());
  if (input.pageToken !== undefined && input.pageToken !== "") query.set("next_page_token", input.pageToken);
  let response: Response;
  try {
    response = await get(origin, key, `/v2/voices?${query}`);
  } catch (error) {
    throw new ElevenLabsError(`Could not reach ElevenLabs: ${causeText(error)}`);
  }
  const body = await response.text().catch(() => "");
  if (!response.ok) throw new ElevenLabsError(response.status === 401 ? `ElevenLabs refused the key: ${elevenLabsMessage(body)}. Check the key in Settings.` : `ElevenLabs (${response.status}): ${elevenLabsMessage(body)}`);
  let answer: unknown;
  try {
    answer = JSON.parse(body);
  } catch {
    throw new ElevenLabsError(`ElevenLabs (${response.status}): ${body.slice(0, 300)}`);
  }
  const voices = fieldOf(answer, "voices");
  const token = fieldOf(answer, "next_page_token");
  return {
    voices: (Array.isArray(voices) ? voices : []).flatMap((raw) => toVoice(raw) ?? []),
    nextPageToken: fieldOf(answer, "has_more") === true && typeof token === "string" && token !== "" ? token : null,
  };
};

export type SpeechOutcome =
  | { readonly ok: true; readonly bytes: Buffer; readonly credits: number | null; readonly requestId: string | null }
  | { readonly ok: false; readonly error: string };

export const speak = async (origin: string, key: string, voiceId: string, call: SpeechCall): Promise<SpeechOutcome> => {
  let response: Response;
  try {
    response = await fetch(`${origin}/v1/text-to-speech/${encodeURIComponent(voiceId)}?${new URLSearchParams(call.query)}`, {
      method: "POST",
      headers: { "xi-api-key": key, "content-type": "application/json", accept: "audio/*" },
      body: JSON.stringify(call.body),
      signal: AbortSignal.timeout(SPEECH_TIMEOUT_MS),
    });
  } catch (error) {
    return { ok: false, error: isTimeout(error) ? SPEECH_TIMEOUT_MESSAGE : `Could not reach ElevenLabs: ${causeText(error)}` };
  }
  let bytes: Buffer;
  try {
    bytes = Buffer.from(await response.arrayBuffer());
  } catch (error) {
    if (!response.ok) return { ok: false, error: speechFailure(response.status, "") };
    return { ok: false, error: isTimeout(error) ? SPEECH_STALLED_MESSAGE : speechLostMessage(causeText(error)) };
  }
  if (!response.ok) return { ok: false, error: speechFailure(response.status, bytes.toString("utf8")) };
  if (bytes.length === 0) return { ok: false, error: "ElevenLabs returned no audio." };
  const requestId = response.headers.get("request-id");
  return { ok: true, bytes, credits: creditsFrom(response.headers.get("character-cost")), requestId: requestId === null || requestId === "" ? null : requestId };
};

export const subscriptionStatus = async (origin: string, key: string): Promise<ElevenLabsStatus> => {
  if (key === "") return { hasKey: false };
  let response: Response;
  try {
    response = await get(origin, key, "/v1/user/subscription");
  } catch (error) {
    throw new ElevenLabsError(causeText(error));
  }
  if (response.status === 401) return { hasKey: true, revoked: true };
  if (response.status === 403) return { hasKey: true, usageHidden: true };
  const answer: unknown = response.ok ? await response.json().catch(() => undefined) : undefined;
  if (!response.ok || typeof answer !== "object" || answer === null || Array.isArray(answer)) throw new ElevenLabsError(`ElevenLabs answered ${response.status}.`);
  const tier = fieldOf(answer, "tier");
  const used = fieldOf(answer, "character_count");
  const limit = fieldOf(answer, "character_limit");
  const reset = fieldOf(answer, "next_character_count_reset_unix");
  const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
  return {
    hasKey: true,
    tier: typeof tier === "string" ? tier : null,
    creditsUsed: finite(used) ? used : 0,
    creditLimit: finite(limit) ? limit : null,
    resetsAt: finite(reset) ? new Date(reset * 1000).toISOString() : null,
  };
};
