/**
 * Stub answers for OpenRouter's side of the connect flow: the consent page at `/auth`
 * (approves at once, redirecting to `callback_url` with `?code=`), the code exchange at
 * `/api/v1/auth/keys` (checks the verifier against the challenge `/auth` saw, then answers
 * what the test scripts, possibly held) and the key status at `/api/v1/key`.
 */
import { createHash } from "node:crypto";
import type http from "node:http";
import type { StubHandler } from "./engineProcess.ts";
import { json } from "./openRouterStub.ts";

const path = (req: http.IncomingMessage) => new URL(req.url ?? "/", "http://stub").pathname;

export type ExchangeAnswer =
  | { readonly kind: "key"; readonly key: string }
  | { readonly kind: "status"; readonly status: number; readonly body?: unknown }
  /** The connection closes before any answer. */
  | { readonly kind: "hangup" };

export type KeyAnswer = { readonly kind: "data"; readonly data: unknown } | { readonly kind: "status"; readonly status: number; readonly body?: unknown };

export interface Exchange {
  readonly body: any;
  readonly headers: http.IncomingHttpHeaders;
  /** Whether the verifier hashes to the challenge `/auth` saw for this code. */
  readonly verified: boolean;
}

export interface OAuthStub {
  readonly handler: StubHandler;
  /** Each approval at `/auth`: the query it was given and the code it minted. */
  readonly approvals: Array<{ readonly callbackUrl: string; readonly challenge: string; readonly method: string; readonly code: string }>;
  readonly exchanges: Exchange[];
  readonly keyRequests: Array<{ readonly headers: http.IncomingHttpHeaders }>;
  /** How each exchange with a matching verifier answers; a promise holds it until it settles. */
  exchange(script: (exchange: Exchange, index: number) => ExchangeAnswer | Promise<ExchangeAnswer>): void;
  keyStatus(script: (request: { readonly headers: http.IncomingHttpHeaders }) => KeyAnswer): void;
}

export const CONNECTED_KEY = "sk-or-v1-connected-0000000000wxyz";

export const liveKey = (overrides: Record<string, unknown> = {}) => ({
  kind: "data" as const,
  data: { label: "sk-or-v1-abc...xyz", usage: 7.4412, limit: 10, limit_remaining: 2.5588, expires_at: null, is_free_tier: false, limit_reset: "monthly", ...overrides },
});

const challengeOf = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

export const oauthStub = (): OAuthStub => {
  const approvals: OAuthStub["approvals"] = [];
  const exchanges: Exchange[] = [];
  const keyRequests: OAuthStub["keyRequests"] = [];
  let exchangeScript: (exchange: Exchange, index: number) => ExchangeAnswer | Promise<ExchangeAnswer> = () => ({ kind: "key", key: CONNECTED_KEY });
  let keyScript: (request: { readonly headers: http.IncomingHttpHeaders }) => KeyAnswer = () => liveKey();

  const handler: StubHandler = (req, body, res) => {
    const at = path(req);
    if (req.method === "GET" && at === "/auth") {
      const query = new URL(req.url ?? "/", "http://stub").searchParams;
      const code = `code-${approvals.length + 1}`;
      approvals.push({ callbackUrl: query.get("callback_url") ?? "", challenge: query.get("code_challenge") ?? "", method: query.get("code_challenge_method") ?? "", code });
      const target = new URL(query.get("callback_url") ?? "");
      target.searchParams.set("code", code);
      res.writeHead(302, { location: target.toString() });
      res.end();
      return true;
    }
    if (req.method === "POST" && at === "/api/v1/auth/keys") {
      let parsed: any;
      try {
        parsed = JSON.parse(body);
      } catch {
        parsed = undefined;
      }
      const approval = approvals.find((each) => each.code === parsed?.code);
      const verified = approval !== undefined && typeof parsed?.code_verifier === "string" && challengeOf(parsed.code_verifier) === approval.challenge;
      const exchange: Exchange = { body: parsed, headers: req.headers, verified };
      const index = exchanges.length;
      exchanges.push(exchange);
      if (parsed?.code_challenge_method !== "S256") {
        json(res, 400, { error: { message: "Invalid code_challenge_method" } });
        return true;
      }
      if (!verified) {
        json(res, 403, { error: { message: "Invalid code or code_verifier" } });
        return true;
      }
      void Promise.resolve(exchangeScript(exchange, index)).then((answer) => {
        if (answer.kind === "hangup") req.socket.destroy();
        else if (answer.kind === "key") json(res, 200, { key: answer.key, user_id: "user_1" });
        else if (answer.body === undefined) {
          res.writeHead(answer.status);
          res.end();
        } else json(res, answer.status, answer.body);
      });
      return true;
    }
    if (req.method === "GET" && at === "/api/v1/key") {
      keyRequests.push({ headers: req.headers });
      const answer = keyScript({ headers: req.headers });
      if (answer.kind === "data") json(res, 200, { data: answer.data });
      else if (answer.body === undefined) {
        res.writeHead(answer.status);
        res.end();
      } else json(res, answer.status, answer.body);
      return true;
    }
    return false;
  };

  return {
    handler,
    approvals,
    exchanges,
    keyRequests,
    exchange: (script) => {
      exchangeScript = script;
    },
    keyStatus: (script) => {
      keyScript = script;
    },
  };
};
