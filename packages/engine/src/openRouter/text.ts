import { errorText } from "../log.ts";
import { readOpenRouterAnswer } from "./images.ts";

/** A reference part of a chat message, as spec 03 inlines them. */
export type ReferencePart = { readonly type: "image_url"; readonly image_url: { readonly url: string } } | { readonly type: "video_url"; readonly video_url: { readonly url: string } };

/** What one chat call answered: the text and its cost, or the sentence the person sees. */
export type TextCallOutcome = { readonly ok: true; readonly text: string; readonly cost: number | null } | { readonly ok: false; readonly error: string };

export const NO_TEXT_MESSAGE = "The model returned no text.";

const field = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined;

/**
 * The chat body: one user message of the prompt then one part per reference, after a
 * system message only when `system` is not blank. `usage.include` asks for the cost.
 */
export const chatRequestBody = (model: string, prompt: string, references: ReadonlyArray<ReferencePart>, system?: string): Record<string, unknown> => {
  const user = { role: "user", content: [{ type: "text", text: prompt }, ...references] };
  const messages = system !== undefined && system.trim() !== "" ? [{ role: "system", content: system }, user] : [user];
  return { model, messages, usage: { include: true } };
};

/** The answer's text: a string, or the text parts of a content list. */
const answerText = (content: unknown): string | undefined => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  const parts = content.flatMap((part) => (field(part, "type") === "text" && typeof field(part, "text") === "string" ? [field(part, "text") as string] : []));
  return parts.length > 0 ? parts.join("") : undefined;
};

/** One call to OpenRouter's chat completions endpoint. Never rejects: every failure is an outcome. */
export const completeText = async (origin: string, key: string, body: Record<string, unknown>): Promise<TextCallOutcome> => {
  let response: Response;
  try {
    response = await fetch(`${origin}/api/v1/chat/completions`, {
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
  const choices = field(answer.body, "choices");
  const text = answerText(field(field(Array.isArray(choices) ? choices[0] : undefined, "message"), "content"));
  if (text === undefined || text.trim() === "") return { ok: false, error: NO_TEXT_MESSAGE };
  const cost = field(field(answer.body, "usage"), "cost");
  return { ok: true, text, cost: typeof cost === "number" && Number.isFinite(cost) ? cost : null };
};
