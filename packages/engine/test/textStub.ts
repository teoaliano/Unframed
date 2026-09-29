/**
 * Stub answers for OpenRouter's general model listing and its chat completions endpoint,
 * the two text calls. A test scripts each completion: an answer, an error status, a body
 * that is not JSON, a body that drops mid-read, or an answer held until released.
 */
import type http from "node:http";
import type { StubHandler } from "./engineProcess.ts";
import { json } from "./openRouterStub.ts";

const path = (req: http.IncomingMessage) => new URL(req.url ?? "/", "http://stub").pathname;

/** `GET /api/v1/models` answering `models`, or an error status. */
export const textCatalogue =
  (answer: { data: unknown[] } | { status: number }): StubHandler =>
  (req, _body, res) => {
    if (req.method !== "GET" || path(req) !== "/api/v1/models") return false;
    if ("status" in answer) json(res, answer.status, { error: { message: "models down" } });
    else json(res, 200, answer);
    return true;
  };

/** A model entry of the general listing, with its modalities. */
export const listedModel = (id: string, input: string[], output: string[], extra: Record<string, unknown> = {}) => ({
  id,
  architecture: { input_modalities: input, output_modalities: output },
  ...extra,
});

export type ChatAnswer =
  | { readonly kind: "text"; readonly text: unknown; readonly cost?: number | null }
  | { readonly kind: "status"; readonly status: number; readonly body: unknown }
  | { readonly kind: "not-json"; readonly text: string }
  | { readonly kind: "drop" }
  | { readonly kind: "no-choices" };

export interface ChatRequest {
  readonly index: number;
  readonly body: any;
  readonly headers: http.IncomingHttpHeaders;
}

/** `POST /api/v1/chat/completions`: each request is answered by `script`, which may hold its answer back. */
export const chatCompletions = (script: (request: ChatRequest) => ChatAnswer | Promise<ChatAnswer>) => {
  const requests: ChatRequest[] = [];
  const handler: StubHandler = (req, body, res) => {
    if (req.method !== "POST" || path(req) !== "/api/v1/chat/completions") return false;
    const request = { index: requests.length, body: JSON.parse(body), headers: req.headers };
    requests.push(request);
    void Promise.resolve(script(request)).then((answer) => {
      switch (answer.kind) {
        case "text":
          json(res, 200, {
            id: "gen-1",
            choices: [{ index: 0, message: { role: "assistant", content: answer.text } }],
            usage: answer.cost === null ? { prompt_tokens: 10 } : { prompt_tokens: 10, cost: answer.cost ?? 0.0012 },
          });
          return;
        case "status":
          json(res, answer.status, answer.body);
          return;
        case "not-json":
          res.writeHead(200, { "content-type": "text/html" });
          res.end(answer.text);
          return;
        case "drop":
          res.writeHead(200, { "content-type": "application/json", "content-length": "100000" });
          res.write('{"choices":[{"message":{"content":"a fo');
          setTimeout(() => res.destroy(), 20);
          return;
        case "no-choices":
          json(res, 200, { choices: [], usage: { cost: 0.0001 } });
          return;
      }
    });
    return true;
  };
  return { handler, requests };
};
