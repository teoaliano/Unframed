import { errorText } from "../log.ts";

/** What one image call answered: the picture, or the sentence the person sees. */
export type ImageCallOutcome =
  | { readonly ok: true; readonly bytes: Buffer; readonly mediaType: string | undefined; readonly cost: number | null }
  | { readonly ok: false; readonly error: string };

const field = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined;

const first300 = (text: string) => text.slice(0, 300);

/** `error.message` when it is a string, else `error` when it is a string, else the start of the body. */
export const upstreamMessage = (parsed: unknown, raw: string): string => {
  const error = field(parsed, "error");
  const message = field(error, "message");
  if (typeof message === "string") return message;
  if (typeof error === "string") return error;
  return first300(raw);
};

/** OpenRouter's two causes of a 402, in one sentence. */
export const unpaidMessage = (upstream: string): string =>
  `OpenRouter refused this as unpaid: either the account is out of credit, or this key has hit its own spending cap. Add credit at openrouter.ai/credits, or check the key's cap at openrouter.ai/settings/keys. (${upstream})`;

/**
 * Reads an OpenRouter answer's body, telling apart the failures a person can act on: the
 * connection dropping mid-read (the call may still have been charged), a non-2xx status
 * with the upstream's own words, and a 2xx body that is not JSON.
 */
export const readOpenRouterAnswer = async (
  response: Response,
): Promise<{ readonly ok: true; readonly body: unknown } | { readonly ok: false; readonly error: string }> => {
  let raw: string;
  try {
    raw = await response.text();
  } catch (error) {
    return {
      ok: false,
      error: `Lost the connection while reading OpenRouter's answer: ${errorText(error)}. The run may still have completed and been charged. Check your OpenRouter activity page.`,
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
    if (response.status === 402) return { ok: false, error: unpaidMessage(upstream) };
    return { ok: false, error: `OpenRouter (${response.status}): ${upstream}` };
  }
  if (!isJson) return { ok: false, error: `Unexpected response from OpenRouter: ${first300(raw)}` };
  return { ok: true, body: parsed };
};

/** The image endpoint's body: only set params are sent, and `quality: "auto"` and `background: "auto"` are not. */
export const imageRequestBody = (model: string, prompt: string, params: Readonly<Record<string, string | undefined>>): Record<string, unknown> => {
  const body: Record<string, unknown> = { model, prompt };
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
    if ((key === "quality" || key === "background") && value === "auto") continue;
    body[key] = value;
  }
  return body;
};

/** One call to OpenRouter's image endpoint. Never rejects: every failure is an outcome. */
export const generateImage = async (origin: string, key: string, body: Record<string, unknown>): Promise<ImageCallOutcome> => {
  let response: Response;
  try {
    response = await fetch(`${origin}/api/v1/images`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (error) {
    const cause = field(error, "cause");
    return { ok: false, error: `Could not reach OpenRouter: ${cause instanceof Error ? cause.message : errorText(error)}` };
  }
  const answer = await readOpenRouterAnswer(response);
  if (!answer.ok) return answer;
  const data = field(answer.body, "data");
  const image = Array.isArray(data) ? data[0] : undefined;
  const b64 = field(image, "b64_json");
  if (typeof b64 !== "string" || b64 === "") return { ok: false, error: "OpenRouter returned no image data." };
  const mediaType = field(image, "media_type") ?? field(answer.body, "media_type");
  const cost = field(field(answer.body, "usage"), "cost");
  return {
    ok: true,
    bytes: Buffer.from(b64, "base64"),
    mediaType: typeof mediaType === "string" ? mediaType : undefined,
    cost: typeof cost === "number" && Number.isFinite(cost) ? cost : null,
  };
};
