/**
 * Stub answers for OpenRouter's image catalogue, pricing and generation endpoints. A test
 * scripts each generation request: an image, an error status, a body that is not JSON, a
 * body that drops mid-read, a body with no image, or an answer held until released.
 */
import type http from "node:http";
import type { StubHandler } from "./engineProcess.ts";

export const json = (res: http.ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
};

/** Answers the first handler that takes the request. */
export const routes =
  (...handlers: StubHandler[]): StubHandler =>
  (req, body, res) =>
    handlers.some((handler) => handler(req, body, res) === true);

const path = (req: http.IncomingMessage) => new URL(req.url ?? "/", "http://stub").pathname;

/** `GET /api/v1/images/models` answering `models`, or an error status. */
export const imageCatalogue =
  (answer: { data: unknown[] } | { status: number }): StubHandler =>
  (req, _body, res) => {
    if (req.method !== "GET" || path(req) !== "/api/v1/images/models") return false;
    if ("status" in answer) json(res, answer.status, { error: { message: "catalogue down" } });
    else json(res, 200, answer);
    return true;
  };

/** `GET /api/v1/images/models/<id>/endpoints` answering pricing per model id. */
export const imagePricing =
  (byModel: Record<string, unknown>): StubHandler =>
  (req, _body, res) => {
    const match = /^\/api\/v1\/images\/models\/(.+)\/endpoints$/.exec(path(req));
    if (req.method !== "GET" || !match) return false;
    const id = decodeURIComponent(match[1]!);
    if (!(id in byModel)) {
      json(res, 404, { error: { message: "no such model" } });
      return true;
    }
    const answer = byModel[id];
    if (typeof answer === "number") json(res, answer, { error: { message: "pricing down" } });
    else json(res, 200, answer);
    return true;
  };

export type ImageAnswer =
  | { readonly kind: "image"; readonly bytes: Buffer; readonly mediaType?: string | null; readonly cost?: number | null }
  | { readonly kind: "status"; readonly status: number; readonly body: unknown }
  | { readonly kind: "not-json"; readonly text: string }
  | { readonly kind: "drop" }
  | { readonly kind: "no-image" };

export interface ImageRequest {
  readonly index: number;
  readonly body: any;
  readonly headers: http.IncomingHttpHeaders;
}

/**
 * `POST /api/v1/images`: each request is answered by `script`, which may hold its answer
 * back by returning a promise.
 */
export const imageGeneration = (script: (request: ImageRequest) => ImageAnswer | Promise<ImageAnswer>) => {
  const requests: ImageRequest[] = [];
  const handler: StubHandler = (req, body, res) => {
    if (req.method !== "POST" || path(req) !== "/api/v1/images") return false;
    const request = { index: requests.length, body: JSON.parse(body), headers: req.headers };
    requests.push(request);
    void Promise.resolve(script(request)).then((answer) => {
      switch (answer.kind) {
        case "image":
          json(res, 200, {
            created: 1,
            data: [{ b64_json: answer.bytes.toString("base64"), ...(answer.mediaType === null ? {} : { media_type: answer.mediaType ?? "image/png" }) }],
            usage: answer.cost === null ? {} : { cost: answer.cost ?? 0.042 },
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
          res.write('{"data":[{"b64_json":"iVBOR');
          setTimeout(() => res.destroy(), 20);
          return;
        case "no-image":
          json(res, 200, { data: [], usage: { cost: 0.01 } });
          return;
      }
    });
    return true;
  };
  return { handler, requests };
};

/** A promise a test resolves later, to hold a stub answer until it is ready. */
export const gate = <T>() => {
  let release!: (value: T) => void;
  const promise = new Promise<T>((resolve) => (release = resolve));
  return { promise, release };
};
