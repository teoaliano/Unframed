/**
 * The OpenRouter connect flow (spec 10): the one pending attempt, the authorize URL, the
 * callback page a person's browser lands on, cancelling, and the key status. The verifier
 * never leaves this process; the key OpenRouter returns goes through the same validator
 * and the same `.env` funnel as a pasted one.
 */
import { randomBytes } from "node:crypto";
import type http from "node:http";
import { unframedError, type KeyStatus, type OAuthPendingAnswer, type UnframedError } from "@unframed/contracts";
import { authorizeUrl, callbackUrl, createOAuthAttempts, isOpenRouterKey } from "@unframed/domain";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { Route } from "../http/api.ts";
import { logInfo } from "../log.ts";
import { exchangeCode, fetchKeyStatus } from "../openRouter/keys.ts";
import { Config } from "../services.ts";
import { SettingsStore } from "../settingsStore.ts";

export class OAuth extends Context.Service<
  OAuth,
  {
    readonly start: Effect.Effect<{ authorizeUrl: string }>;
    readonly pending: Effect.Effect<OAuthPendingAnswer>;
    /** `oauth.cancel`: ends the attempt, and removes the key it wrote if it got that far. */
    readonly cancel: Effect.Effect<Record<string, never>, UnframedError>;
    /** Ends a pending attempt without touching `.env`. True when a key write for it is in flight or landed. */
    readonly cancelAttempt: Effect.Effect<boolean>;
    readonly status: Effect.Effect<KeyStatus, UnframedError>;
    /** `GET /api/oauth/callback/<nonce>`: a person's browser lands here, so it answers HTML. */
    readonly callbackRoute: Route;
    /** The API listener's port, once bound: only the engine knows where the callback lands. */
    readonly setApiPort: (port: number) => void;
  }
>()("unframed/engine/OAuth") {}

const CALLBACK = /^\/api\/oauth\/callback\/([^/]+)$/;
const AGAIN = "Close this tab and press Connect in Unframed again.";

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A complete dark page with one heading and one line. It links nowhere: the engine does not know where the web is served. */
const sendPage = (res: http.ServerResponse, status: number, heading: string, detail: string) => {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="color-scheme" content="dark">
<title>Unframed</title>
<style>
:root { color-scheme: dark; }
body { margin: 0; background: #111112; color: #DFE2E5; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; font-size: 16px; line-height: 1.5; }
main { max-width: 32em; margin: 12vh auto 0; padding: 0 1.5em; }
h1 { font-size: 1.3em; }
</style>
</head>
<body>
<main>
<h1>${escapeHtml(heading)}</h1>
<p>${escapeHtml(detail)}</p>
</main>
</body>
</html>
`;
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(html),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
  });
  res.end(html);
};

export const oauthLayer = Layer.effect(
  OAuth,
  Effect.gen(function* () {
    const config = yield* Config;
    const settings = yield* SettingsStore;
    const context = yield* Effect.context<never>();
    const runPromise = Effect.runPromiseWith(context);
    const attempts = createOAuthAttempts((size) => new Uint8Array(randomBytes(size)));
    let apiPort = 0;

    const start = Effect.sync(() => {
      const { nonce, challenge } = attempts.start(Date.now());
      const callback = callbackUrl({ port: apiPort, nonce, bounce: config.oauthBounce });
      return { authorizeUrl: authorizeUrl(config.openRouterOrigin, callback, challenge) };
    });

    const pending = Effect.sync((): OAuthPendingAnswer => attempts.peek(Date.now()) ?? { state: "none", reason: "" });

    const cancel = Effect.gen(function* () {
      if (!attempts.cancel()) return {};
      // Queued behind the callback's own key write, so the key ends up removed either way.
      yield* Effect.mapError(settings.write({ OPENROUTER_API_KEY: null }), (error) =>
        unframedError("internal", `Could not remove the key the cancelled connection had written: ${error.reason}`),
      );
      yield* settings.emit;
      return {};
    });

    const status = Effect.gen(function* () {
      const { key } = yield* settings.read;
      if (key === "") return { hasKey: false } as const;
      const answer = yield* Effect.promise(() => fetchKeyStatus(config.openRouterOrigin, key));
      if (!answer.ok) return yield* unframedError("upstream", answer.message);
      return answer.status;
    });

    const callback = async (res: http.ServerResponse, nonce: string, code: string | null) => {
      const verifier = attempts.claim(nonce, Date.now());
      // No resolve: the nonce may belong to nobody.
      if (verifier === null) return sendPage(res, 400, "That link is no longer valid", AGAIN);
      const fail = (status: number, heading: string, detail: string) => {
        attempts.resolve(nonce, "failed", detail);
        sendPage(res, status, heading, detail);
      };
      if (code === null || code === "") return fail(400, "OpenRouter did not send a code", AGAIN);

      const exchanged = await exchangeCode(config.openRouterOrigin, code, verifier);
      if (!exchanged.ok) {
        return exchanged.network
          ? fail(502, "Could not reach OpenRouter", exchanged.message)
          : fail(502, "OpenRouter could not complete the connection", exchanged.message);
      }
      const key = exchanged.key.trim();
      if (!isOpenRouterKey(key)) {
        return fail(502, "OpenRouter returned a key in a shape Unframed does not recognise", "Nothing was saved. You can paste a key manually in Unframed's settings instead.");
      }

      // Up to 30 seconds passed since the claim: a removal or a pasted key may have settled
      // which key the app uses, and both cancel the attempt. The write is queued in the
      // same tick as the commit, so no cancel can land between them.
      if (!attempts.commit(nonce, Date.now())) {
        return fail(
          409,
          "That connection was cancelled",
          "Nothing was saved, and Unframed is still using whichever key you chose instead. OpenRouter did create a key just now, so delete that row at openrouter.ai/settings/keys.",
        );
      }
      const written = settings.write({ OPENROUTER_API_KEY: key });

      const failure = await runPromise(Effect.match(written, { onFailure: (error) => error.reason, onSuccess: () => undefined }));
      if (failure !== undefined) {
        return fail(
          500,
          "OpenRouter created a key, but Unframed could not save it",
          `${failure}. The key exists in your OpenRouter account. You can delete it at openrouter.ai/settings/keys and try connecting again.`,
        );
      }
      await runPromise(settings.emit);
      attempts.resolve(nonce, "done");
      logInfo("oauth:    connected, key saved");
      sendPage(res, 200, "Connected to OpenRouter", "You can close this tab and return to Unframed.");
    };

    const callbackRoute: Route = async (req, res, url) => {
      const match = CALLBACK.exec(url.pathname);
      if (!match || req.method !== "GET") return false;
      await callback(res, match[1]!, url.searchParams.get("code"));
      return true;
    };

    return OAuth.of({
      start,
      pending,
      cancel,
      cancelAttempt: Effect.sync(() => attempts.cancel()),
      status,
      callbackRoute,
      setApiPort: (port) => {
        apiPort = port;
      },
    });
  }),
);
