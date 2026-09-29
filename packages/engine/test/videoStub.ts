/**
 * Stub answers for OpenRouter's video endpoints: the catalogue, the unofficial find
 * endpoint behind the site's input filter, job creation, job status and the clip download.
 * A test scripts each one and reads back every request it received.
 */
import type http from "node:http";
import type { StubHandler } from "./engineProcess.ts";
import { json } from "./openRouterStub.ts";

const path = (req: http.IncomingMessage) => new URL(req.url ?? "/", "http://stub").pathname;

/** `GET /api/v1/videos/models` answering `models`, or an error status. */
export const videoCatalogue =
  (answer: { data: unknown[] } | { status: number }): StubHandler =>
  (req, _body, res) => {
    if (req.method !== "GET" || path(req) !== "/api/v1/videos/models") return false;
    if ("status" in answer) json(res, answer.status, { error: { message: "catalogue down" } });
    else json(res, 200, answer);
    return true;
  };

/**
 * `GET /api/frontend/v1/models/find`: the models whose input modalities include video, as
 * cards, or a failure: an error status, a body that is not JSON, or a body with no list.
 */
export const videoInputFinder =
  (answer: { slugs: Array<{ slug: string; input_modalities: string[] }> } | { status: number } | { text: string } | { body: unknown }): StubHandler =>
  (req, _body, res) => {
    if (req.method !== "GET" || path(req) !== "/api/frontend/v1/models/find") return false;
    if ("status" in answer) json(res, answer.status, { error: { message: "find down" } });
    else if ("text" in answer) {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(answer.text);
    } else if ("body" in answer) json(res, 200, answer.body);
    else json(res, 200, { data: { models: answer.slugs } });
    return true;
  };

/** How the stub answers one `POST /api/v1/videos`. */
export type CreateAnswer =
  | { readonly kind: "job"; readonly id: string; readonly status?: string }
  | { readonly kind: "status"; readonly status: number; readonly body: unknown }
  | { readonly kind: "not-json"; readonly text: string }
  | { readonly kind: "drop" }
  /** The connection closes before any answer: a network failure. */
  | { readonly kind: "hangup" }
  | { readonly kind: "no-id" };

/** How the stub answers one `GET /api/v1/videos/<id>`. */
export type StatusAnswer =
  | { readonly kind: "data"; readonly data: Record<string, unknown> }
  | { readonly kind: "hangup" }
  | { readonly kind: "status"; readonly status: number; readonly body: unknown }
  | { readonly kind: "not-json"; readonly text: string }
  | { readonly kind: "drop" };

export interface VideoRequest {
  readonly method: string;
  readonly path: string;
  readonly body: any;
  readonly headers: http.IncomingHttpHeaders;
}

export interface VideoJobs {
  readonly handler: StubHandler;
  /** Every create request, in order. */
  readonly creates: VideoRequest[];
  /** Every status request, in order. */
  readonly polls: VideoRequest[];
  /** Every clip download, in order. */
  readonly downloads: VideoRequest[];
  create(script: (request: VideoRequest) => CreateAnswer | Promise<CreateAnswer>): void;
  status(script: (id: string, request: VideoRequest) => StatusAnswer | Promise<StatusAnswer>): void;
  /** The clip each job's download answers; a promise holds the download open until it settles. */
  clip(script: (id: string) => Buffer | Promise<Buffer> | { status: number }): void;
}

/** A completed status answer naming this stub's download URL. */
export const completed = (origin: string, id: string, extra: Record<string, unknown> = {}): StatusAnswer => ({
  kind: "data",
  data: { id, status: "completed", unsigned_urls: [`${origin}/files/${id}.mp4`], usage: { cost: 0.42, video_seconds: 5 }, ...extra },
});

export const videoJobs = (): VideoJobs => {
  const creates: VideoRequest[] = [];
  const polls: VideoRequest[] = [];
  const downloads: VideoRequest[] = [];
  let createScript: (request: VideoRequest) => CreateAnswer | Promise<CreateAnswer> = () => ({ kind: "job", id: `job-${creates.length}`, status: "pending" });
  let statusScript: (id: string, request: VideoRequest) => StatusAnswer | Promise<StatusAnswer> = (id) => ({ kind: "data", data: { id, status: "in_progress", progress: 10 } });
  let clipScript: (id: string) => Buffer | Promise<Buffer> | { status: number } = (id) => Buffer.from(`clip of ${id}`);

  const handler: StubHandler = (req, body, res) => {
    const at = path(req);
    const request = (): VideoRequest => ({ method: req.method ?? "GET", path: at, body: body === "" ? undefined : JSON.parse(body), headers: req.headers });
    if (req.method === "POST" && at === "/api/v1/videos") {
      const made = request();
      creates.push(made);
      void Promise.resolve(createScript(made)).then((answer) => {
        switch (answer.kind) {
          case "job":
            json(res, 200, { id: answer.id, status: answer.status ?? "pending" });
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
            res.write('{"id":"job-');
            setTimeout(() => res.destroy(), 20);
            return;
          case "no-id":
            json(res, 200, { status: "pending" });
            return;
          case "hangup":
            req.socket.destroy();
            return;
        }
      });
      return true;
    }
    const status = /^\/api\/v1\/videos\/([^/]+)$/.exec(at);
    if (req.method === "GET" && status && status[1] !== "models") {
      const id = decodeURIComponent(status[1]!);
      const asked = request();
      polls.push(asked);
      void Promise.resolve(statusScript(id, asked)).then((answer) => {
        switch (answer.kind) {
          case "data":
            json(res, 200, answer.data);
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
            res.write('{"status":"compl');
            setTimeout(() => res.destroy(), 20);
            return;
          case "hangup":
            req.socket.destroy();
            return;
        }
      });
      return true;
    }
    const file = /^\/files\/([^/]+)\.mp4$/.exec(at);
    if (req.method === "GET" && file) {
      const id = decodeURIComponent(file[1]!);
      downloads.push(request());
      void Promise.resolve(clipScript(id)).then((clip) => {
        if ("status" in clip && !Buffer.isBuffer(clip)) {
          json(res, clip.status, { error: { message: "no clip" } });
          return;
        }
        res.writeHead(200, { "content-type": "video/mp4", "content-length": String(clip.length) });
        res.end(clip);
      });
      return true;
    }
    return false;
  };

  return {
    handler,
    creates,
    polls,
    downloads,
    create: (script) => {
      createScript = script;
    },
    status: (script) => {
      statusScript = script;
    },
    clip: (script) => {
      clipScript = script;
    },
  };
};
