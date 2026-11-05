import type http from "node:http";
import { pngBytes } from "../../web/test/images.ts";
import type { StubHandler } from "./harness.ts";
import { json } from "./openRouterStub.ts";

export const VERCEL_KEY = "vck_test0123456789wxyz";

export const VERCEL_MODELS = [
  { id: "bfl/flux-2-pro", name: "FLUX.2 [pro]", type: "image", released: 1764028800, modalities: { input: ["text"], output: ["image"] }, pricing: { image: "0.03" } },
  { id: "bfl/flux-kontext-pro", name: "FLUX.1 Kontext [pro]", type: "image", released: 1750000000, modalities: { input: ["text"], output: ["image"] }, pricing: { image: "0.04" } },
  { id: "openai/gpt-image-2", name: "GPT Image 2", type: "image", released: 1760000000, modalities: { input: ["text"], output: ["image"] }, pricing: { input: "0.000005" } },
  { id: "google/gemini-3.5-flash-lite", name: "Gemini 3.5 Flash Lite", type: "language", released: 1770000000, modalities: { input: ["text", "image"], output: ["text"] }, pricing: { input: "0.000001", output: "0.000004" } },
  { id: "acme/text-only", name: "Text only", type: "language", released: 1, modalities: { input: ["text"], output: ["text"] }, pricing: {} },
  { id: "google/veo-3.1-generate-001", name: "Veo 3.1", type: "video", released: 1, modalities: { input: ["text"], output: ["video"] }, pricing: {} },
];

export type VercelAnswer = { readonly status: number; readonly body: unknown } | { readonly kind: "drop" } | { readonly kind: "raw"; readonly status: number; readonly text: string };

type Answering = VercelAnswer | Promise<VercelAnswer>;

export interface VercelScript {
  models?: () => Answering;
  image?: (request: VercelRequest) => Answering;
  chat?: (request: VercelRequest) => Answering;
  generation?: (id: string, attempt: number) => Answering;
  credits?: () => Answering;
}

export interface VercelRequest {
  readonly path: string;
  readonly body: any;
  readonly headers: http.IncomingHttpHeaders;
}

const send = (res: http.ServerResponse, answering: Answering) => void Promise.resolve(answering).then((answer) => reply(res, answer));

const reply = (res: http.ServerResponse, answer: VercelAnswer) => {
  if ("kind" in answer && answer.kind === "drop") {
    res.writeHead(200, { "content-type": "application/json", "content-length": "100000" });
    res.write("{");
    setTimeout(() => res.destroy(), 20);
    return;
  }
  if ("kind" in answer) {
    res.writeHead(answer.status, { "content-type": "text/plain" });
    res.end(answer.text);
    return;
  }
  json(res, answer.status, answer.body);
};

export const vercelRoutes = (script: VercelScript = {}) => {
  const calls: VercelRequest[] = [];
  const lookups = new Map<string, number>();
  const handler: StubHandler = (req, body, res) => {
    const url = new URL(req.url ?? "/", "http://stub");
    const request: VercelRequest = { path: url.pathname, body: body === "" ? undefined : JSON.parse(body), headers: req.headers };
    if (req.method === "GET" && url.pathname === "/v1/models") {
      calls.push(request);
      send(res, script.models?.() ?? { status: 200, body: { object: "list", data: VERCEL_MODELS } });
      return true;
    }
    if (req.method === "POST" && (url.pathname === "/v1/images/generations" || url.pathname === "/v1/images/edits")) {
      calls.push(request);
      send(res, script.image?.(request) ?? { status: 200, body: { created: 1, data: [{ b64_json: pngBytes(40, 20).toString("base64") }] } });
      return true;
    }
    if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
      calls.push(request);
      send(
        res,
        script.chat?.(request) ?? {
          status: 200,
          body: { id: "gen_1", object: "chat.completion", choices: [{ message: { role: "assistant", content: "A gateway answer." } }], usage: { prompt_tokens: 100, completion_tokens: 50 } },
        },
      );
      return true;
    }
    if (req.method === "GET" && url.pathname === "/v1/generation") {
      calls.push(request);
      const id = url.searchParams.get("id") ?? "";
      const attempt = (lookups.get(id) ?? 0) + 1;
      lookups.set(id, attempt);
      send(res, script.generation?.(id, attempt) ?? { status: 200, body: { data: { id, total_cost: 0.00042 } } });
      return true;
    }
    if (req.method === "GET" && url.pathname === "/v1/credits") {
      calls.push(request);
      send(res, script.credits?.() ?? { status: 200, body: { balance: "95.50", total_used: "4.50" } });
      return true;
    }
    return false;
  };
  return { handler, calls };
};
