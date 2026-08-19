# OpenRouter OAuth PKCE and key provisioning — research notes

Researched 2026-08-19. First-party sources only (openrouter.ai docs, OpenRouter's own API
reference and SDK reference pages). Every factual line carries the URL that owns it.
Anything the docs do not answer is in [Unknown / not documented](#unknown--not-documented) —
it is not filled in from general OAuth knowledge.

Primary sources used:

- OAuth PKCE guide — <https://openrouter.ai/docs/guides/overview/auth/oauth> (raw: `.../oauth.md`; the older `/docs/use-cases/oauth-pkce` path serves the same page)
- API reference, exchange endpoint — <https://openrouter.ai/docs/api/api-reference/oauth/exchange-authorization-code-for-api-key>
- API reference, create-authorization-code endpoint — <https://openrouter.ai/docs/api/api-reference/oauth/create-authorization-code>
- Management API keys guide — <https://openrouter.ai/docs/guides/overview/auth/management-api-keys>
- API reference, create key — <https://openrouter.ai/docs/api/api-reference/api-keys/create-a-new-api-key>
- Credit limits and rate limits — <https://openrouter.ai/docs/api_reference/limits>
- Authentication — <https://openrouter.ai/docs/api_reference/authentication>
- SDK reference (OAuth namespace, field-by-field param tables) — <https://openrouter.ai/docs/client-sdks/python/sdks/oauth/README> and <https://openrouter.ai/docs/client-sdks/typescript/sdks/oauth/README>
- App attribution — <https://openrouter.ai/docs/app-attribution>
- API changelog — <https://openrouter.ai/docs/changelog>

## 1. The PKCE flow, exactly

**Step 1 — authorize URL.** Send the user's browser to `https://openrouter.ai/auth`
(<https://openrouter.ai/docs/guides/overview/auth/oauth>). The documented query params, verbatim from the
three code samples on that page:

| Param | Required? | Notes |
| --- | --- | --- |
| `callback_url` | Required for a redirect flow; **omit** for headless mode | "send your user to OpenRouter's `/auth` URL with a `callback_url` parameter pointing back to your site" (<https://openrouter.ai/docs/guides/overview/auth/oauth>) |
| `code_challenge` | "optional but recommended"; **required** in headless mode | same page |
| `code_challenge_method` | Optional | `S256` or `plain`; omit together with `code_challenge` (same page, "Without Code Challenge" sample) |
| `key_label` | Optional | shown only in the headless sample on the guide (<https://openrouter.ai/docs/guides/overview/auth/oauth>), but the underlying API accepts it generally — see the `key_label` row of `POST /auth/keys/code` (<https://openrouter.ai/docs/api/api-reference/oauth/create-authorization-code>) |

`code_challenge_method` options: `S256` (base64url of the SHA-256 of the verifier — "For
maximum security, set `code_challenge_method` to `S256`") or `plain`; the method can be
omitted entirely if no challenge is used. So plain `S256` is **recommended, not required**
(<https://openrouter.ai/docs/guides/overview/auth/oauth>). The API-reference enum for the exchange call is
`S256 | plain | null` (<https://openrouter.ai/docs/api/api-reference/oauth/exchange-authorization-code-for-api-key>).

The user logs in, authorizes, and is redirected to `callback_url` with a `code` query param
(<https://openrouter.ai/docs/guides/overview/auth/oauth>).

**Step 2 — exchange.** `POST https://openrouter.ai/api/v1/auth/keys`
(reference path `POST /auth/keys` relative to `https://openrouter.ai/api/v1`;
<https://openrouter.ai/docs/api/api-reference/oauth/exchange-authorization-code-for-api-key>).

Headers: `Content-Type: application/json` only — the guide's fetch sample sends no
Authorization header (<https://openrouter.ai/docs/guides/overview/auth/oauth>). HTTPS and POST are mandatory:
"`405 Method Not Allowed`: Make sure you're using `POST` and `HTTPS` for your request"
(same page).

Body (all three fields flat JSON):

```json
{
  "code": "<CODE_FROM_QUERY_PARAM>",
  "code_verifier": "<CODE_VERIFIER>",
  "code_challenge_method": "S256"
}
```

`code` is required; `code_verifier` and `code_challenge_method` are optional and only sent
if a challenge was used (<https://openrouter.ai/docs/api/api-reference/oauth/exchange-authorization-code-for-api-key>,
field table).

Response, 200: `{ "key": string, "user_id": string | null }`
(<https://openrouter.ai/docs/api/api-reference/oauth/exchange-authorization-code-for-api-key>). The guide only
destructures `key` (<https://openrouter.ai/docs/guides/overview/auth/oauth>).

Documented errors (<https://openrouter.ai/docs/guides/overview/auth/oauth>):

- `400 Invalid code_challenge_method` — method in step 2 must match step 1
- `403 Invalid code or code_verifier`
- `403 Authorization code expired` — "Authorization codes expire 10 minutes after issuance"
- `405 Method Not Allowed` — non-POST or non-HTTPS

Error bodies are the standard `{ error: { code, message }, openrouter_metadata?, user_id? }`
shape for 400/403/500 (<https://openrouter.ai/docs/api/api-reference/oauth/exchange-authorization-code-for-api-key>).

**Generating the challenge** — the guide's own sample is
`Buffer.from(await crypto.subtle.digest('SHA-256', encoder.encode(verifier))).toString('base64url')`,
i.e. base64**url**, unpadded (<https://openrouter.ai/docs/guides/overview/auth/oauth>).

**A second, server-side way to mint the code exists.** `POST /auth/keys/code` creates an
authorization code programmatically and **requires a management key in the Authorization
header** (Bearer). Body fields: `callback_url` (required, uri), `code_challenge`,
`code_challenge_method` (`S256`|`plain`), `expires_at` (date-time), `key_label`, `limit`
(number), `spawn_agent`, `spawn_cloud`, `usage_limit_type` (`daily`|`weekly`|`monthly`),
`workspace_id` (uuid). Response: `{ data: { id, app_id, created_at } }`. Errors 400, 401,
403, 409, 500 (<https://openrouter.ai/docs/api/api-reference/oauth/create-authorization-code>). The SDKs expose
it as `createAuthCode` / `create_auth_code`
(<https://openrouter.ai/docs/client-sdks/python/sdks/oauth/README>). This is *not* the browser flow — it is
the caller's own credential creating a code, so it is not a way to avoid the user's login in
the plain PKCE flow.

## 2. What the returned credential actually is

A **user-controlled OpenRouter API key** — the same kind of credential used for normal
inference, sent as `Authorization: Bearer <key>`; the guide's step 3 uses it directly against
`POST /api/v1/chat/completions` (<https://openrouter.ai/docs/guides/overview/auth/oauth>). Not a
short-lived access token, and no refresh mechanism appears anywhere in the OAuth guide, the
API reference for either endpoint, or the SDK OAuth namespace
(<https://openrouter.ai/docs/guides/overview/auth/oauth>, <https://openrouter.ai/docs/client-sdks/typescript/sdks/oauth/README>).
The guide's instruction is to "Store the API key securely within the user's browser or in
your own database" — i.e. persist it, there is nothing to re-fetch it with
(<https://openrouter.ai/docs/guides/overview/auth/oauth>).

The **authorization code** is what is short-lived and one-shot: "The code is single-use and
expires after 10 minutes" (<https://openrouter.ai/docs/guides/overview/auth/oauth>, headless section; repeated
as the `403 Authorization code expired` error). So the exchange is one-shot per code; a new
key requires a new trip through `/auth`.

Key **expiry is possible but opt-in and set by whoever creates the code**: `expires_at`
("Optional expiration time for the API key to be created") is a field on `POST /auth/keys/code`
(<https://openrouter.ai/docs/api/api-reference/oauth/create-authorization-code>,
<https://openrouter.ai/docs/client-sdks/python/sdks/oauth/README>). Nothing documents an
expiry for a key minted through the plain browser `/auth` flow.

## 3. redirect_uri / callback rules

- The param is named `callback_url`, not `redirect_uri` (<https://openrouter.ai/docs/guides/overview/auth/oauth>).
- "Localhost callbacks are supported on **any port**. This is useful for CLI tools and
  local-first apps that bind to an arbitrary free OS port for the OAuth callback (e.g.
  `http://localhost:51423/callback`)" (<https://openrouter.ai/docs/guides/overview/auth/oauth>). So the port
  is *not* matched against anything pre-registered.
- `127.0.0.1` is explicitly allowed alongside `localhost`: the field description for
  `callback_url` reads "Supports https URLs and localhost/127.0.0.1 URLs on any port for
  local CLI tools" (<https://openrouter.ai/docs/client-sdks/python/sdks/oauth/README>).
- That same sentence is the only statement on scheme: **https** for public URLs, with
  loopback the carve-out where plain `http://` is shown as fine
  (`http://localhost:51423/callback`, <https://openrouter.ai/docs/guides/overview/auth/oauth>).
- **No pre-registration.** The callback is declared per request in the URL; the docs describe
  no app-registration step anywhere in the flow. What the callback affects is naming and
  attribution: "Localhost apps are assigned a fixed title matching the host and port (e.g.
  `localhost:3000`) but will not appear in the OpenRouter marketplace or rankings. If you
  want a custom app name and marketplace presence, use a public URL as the callback instead."
  "When moving to production, replace the localhost callback URL with a public URL (your
  project website or a GitHub repo link) to get full app attribution."
  (<https://openrouter.ai/docs/guides/overview/auth/oauth>)
- **Custom URI schemes (`unframed://callback`): not documented.** No page mentions custom
  schemes, deep links, or non-http(s) callbacks. The `callback_url` description enumerating
  "https URLs and localhost/127.0.0.1 URLs" reads as an exhaustive list
  (<https://openrouter.ai/docs/client-sdks/python/sdks/oauth/README>) — *that reading is my
  inference, not a documented prohibition.* See Unknowns.
- **Headless alternative when there is no callback at all:** omit `callback_url` and the
  authorize page "displays the authorization code on screen instead of redirecting. The user
  copies it and pastes it into your app (e.g. at a terminal prompt), and you exchange it in
  Step 2 exactly as usual." `code_challenge` is **required** in this mode "because the code
  is displayed on screen" (<https://openrouter.ai/docs/guides/overview/auth/oauth>).

## 4. Limits and lifecycle of an OAuth-provisioned key

- **Whose credit it spends:** the end user's. The key is "user-controlled" and belongs to the
  OpenRouter account that logged in during the flow
  (<https://openrouter.ai/docs/guides/overview/auth/oauth>); OpenRouter's framing of its own keys is that
  "API keys on OpenRouter are more powerful than keys used directly for model APIs. They
  allow users to set credit limits for apps, and they can be used in OAuth flows"
  (<https://openrouter.ai/docs/api_reference/authentication>).
- **Nothing in the docs distinguishes an OAuth-minted key's limits from a hand-created key's.**
  The limits page describes one model for all keys: an account balance plus an optional
  per-key credit cap (`limit` / `limit_reset` / `limit_remaining`), and free-model request
  caps of 20 req/min with 50 req/day under 10 credits purchased all-time, or 1,000 req/day at
  10+ credits, plus Cloudflare DDoS protection
  (<https://openrouter.ai/docs/api_reference/limits>). Note also: "Making additional accounts or API keys
  will not affect your rate limits, as we govern capacity globally" (same page).
- **A cap can be requested at code-creation time** via `limit` ("Credit limit for the API key
  to be created") and `usage_limit_type` (`daily`|`weekly`|`monthly`) on `POST /auth/keys/code`
  (<https://openrouter.ai/docs/api/api-reference/oauth/create-authorization-code>). Whether the plain
  browser `/auth` URL accepts these as query params is not documented.
- **How the user sees and revokes it:** keys live at <https://openrouter.ai/keys>, and the
  settings page is <https://openrouter.ai/settings/keys> — "immediately visit your key
  settings page to delete the compromised key and create a new one"
  (<https://openrouter.ai/docs/api_reference/authentication>). The OAuth guide adds owner-only deep links
  built from the lowercase hex SHA-256 of the key itself:
  `https://openrouter.ai/keys/{keyHash}` (key settings) and
  `https://openrouter.ai/logs?api_key_hash={keyHash}` (activity). "The links only work for
  the signed-in owner of the API key. If the hash does not resolve for the viewer, the page
  returns a `404` rather than showing unfiltered data."
  (<https://openrouter.ai/docs/guides/overview/auth/oauth>)
- **Validity / limits check:** `GET https://openrouter.ai/api/v1/key` with the key as Bearer
  (<https://openrouter.ai/docs/api_reference/limits>; reference page
  <https://openrouter.ai/docs/api/api-reference/api-keys/get-current-api-key>). Response, verbatim from
  the limits page:

  ```ts
  type Key = {
    data: {
      label: string;
      limit: number | null;            // Credit limit for the key, or null if unlimited
      limit_reset: string | null;      // Type of limit reset, or null if never resets
      limit_remaining: number | null;  // Remaining credits, or null if unlimited
      include_byok_in_limit: boolean;
      usage: number;                   // all time
      usage_daily: number; usage_weekly: number; usage_monthly: number;
      byok_usage: number; byok_usage_daily: number;
      byok_usage_weekly: number; byok_usage_monthly: number;
      is_free_tier: boolean;           // Whether the user has paid for credits before
      // rate_limit: { ... } // A deprecated object in the response, safe to ignore
    };
  };
  ```

  There is no `/api/v1/auth/key` endpoint in the docs — the path is `/api/v1/key`.
- Credit exhaustion surfaces as 402 ("Your account or API key has insufficient credits"),
  rate limiting as 429 with `X-RateLimit-Limit` / `-Remaining` / `-Reset` on the error
  response only — "Successful inference responses do not include `X-RateLimit-*` headers"
  (<https://openrouter.ai/docs/api_reference/limits>, <https://openrouter.ai/docs/api_reference/errors-and-debugging>).

## 5. Desktop / native app support

Not framed as web-only. The guide names the non-hosted cases directly:

- Localhost, for exactly the pattern a desktop app uses: "useful for CLI tools and
  local-first apps that bind to an arbitrary free OS port for the OAuth callback"
  (<https://openrouter.ai/docs/guides/overview/auth/oauth>).
- Headless, "Headless Apps (SSH Servers, Containers)" — "If your app runs where a localhost
  callback can't be reached (an SSH session, a remote dev box, a container), omit
  `callback_url` entirely", code shown on screen and pasted back
  (<https://openrouter.ai/docs/guides/overview/auth/oauth>).

Guidance for an app with no hosted callback URL is therefore: bind a loopback port, or fall
back to headless copy-paste. The docs' only stated cost of the localhost route is
attribution — fixed `localhost:PORT` title, no marketplace or rankings presence
(<https://openrouter.ai/docs/guides/overview/auth/oauth>). Attribution otherwise comes from the
`HTTP-Referer` (required for an app page), `X-OpenRouter-Title` / `X-Title`, and
`X-OpenRouter-Categories` headers, whose category list includes `native-app-builder` and
`cli-agent` (<https://openrouter.ai/docs/app-attribution>). The docs never say "desktop app"
as a supported client type in so many words — the framing is CLI / local-first / headless.

## 6. Provisioning keys vs OAuth

OpenRouter now calls this **Management API keys**
(<https://openrouter.ai/docs/guides/overview/auth/management-api-keys>). You create one at
<https://openrouter.ai/settings/management-keys>, then call `/api/v1/keys` with it as Bearer:

- `GET /api/v1/keys` (list, most recent 100, `offset` for pagination)
- `POST /api/v1/keys` (create)
- `GET /api/v1/keys/{keyHash}`
- `PATCH /api/v1/keys/{keyHash}`
- `DELETE /api/v1/keys/{keyHash}`

(<https://openrouter.ai/docs/guides/overview/auth/management-api-keys>)

Create body: `name` (required) plus optional `expires_at` (ISO 8601), `limit`, `limit_reset`
(`daily`|`weekly`|`monthly`|null), `include_byok_in_limit`, `creator_user_id`, `workspace_id`.
The response is `{ key, data: {...} }` and "the plaintext key is returned only in this
response" (<https://openrouter.ai/docs/api/api-reference/api-keys/create-a-new-api-key>); the SDK page
repeats it as "Treat it as a write-only, sensitive value; it cannot be retrieved later"
(<https://openrouter.ai/docs/client-sdks/typescript/sdks/apikeys/README>).

Ownership and billing difference: management-created keys belong to *your* account — the use
case OpenRouter names is "SaaS Applications: Automatically create unique API keys for each
customer instance", i.e. keys you own and whose spend lands on your balance, capped per key
by `limit` (<https://openrouter.ai/docs/guides/overview/auth/management-api-keys>). OAuth PKCE instead yields
a key owned by the end user's own account
(<https://openrouter.ai/docs/guides/overview/auth/oauth>). Hard constraint on the management key itself:
"Management keys cannot be used to make API calls to OpenRouter's completion endpoints -
they are exclusively for administrative operations"
(<https://openrouter.ai/docs/guides/overview/auth/management-api-keys>).

Labels, caps, expiry, by route:

| | OAuth PKCE (browser `/auth`) | `POST /auth/keys/code` (management key) | `POST /api/v1/keys` (management key) |
| --- | --- | --- | --- |
| Human label | `key_label` on the authorize URL (guide shows it for headless) | `key_label` | `name` |
| Credit cap | not documented as a `/auth` query param | `limit` + `usage_limit_type` | `limit` + `limit_reset` |
| Expiry | not documented | `expires_at` | `expires_at` |
| Workspace | not documented | `workspace_id` | `workspace_id` |
| Owner | the end user | the end user who authorizes | the management key's account |

(<https://openrouter.ai/docs/guides/overview/auth/oauth>,
<https://openrouter.ai/docs/api/api-reference/oauth/create-authorization-code>,
<https://openrouter.ai/docs/api/api-reference/api-keys/create-a-new-api-key>)

**Scopes: not a thing in these docs.** No endpoint in either family takes a scope,
permission, or model-restriction field; the only controls are credit limit, limit reset,
BYOK inclusion, `disabled`, and expiry (same three sources). The `usage`/`usage_daily`/
`usage_weekly`/`usage_monthly` and `byok_usage*` counters plus `limit_remaining` come back on
every key read (<https://openrouter.ai/docs/guides/overview/auth/management-api-keys>).

## 7. Things that would surprise an implementer

- **The exchange endpoint's response has a second field, `user_id`,** documented only in the
  API reference — the guide's sample throws it away
  (<https://openrouter.ai/docs/api/api-reference/oauth/exchange-authorization-code-for-api-key> vs
  <https://openrouter.ai/docs/guides/overview/auth/oauth>).
- **`code_challenge_method` must be echoed in step 2** or you get `400 Invalid
  code_challenge_method` — "Make sure you're using the same code challenge method in step 1
  as in step 2" (<https://openrouter.ai/docs/guides/overview/auth/oauth>). PKCE implementations that only
  send `code_verifier` will fail here.
- **10-minute, single-use code.** Both the headless section and the `403 Authorization code
  expired` entry state it (<https://openrouter.ai/docs/guides/overview/auth/oauth>).
- **A wrong HTTP method or plain HTTP returns 405, not 400 or a redirect**
  (<https://openrouter.ai/docs/guides/overview/auth/oauth>).
- **The key deep-links need a lowercase *hex* SHA-256 digest** of the key — not base64, not
  base64url, unlike the code challenge on the same page, which is base64url. Getting it wrong
  yields a `404` rather than an error (<https://openrouter.ai/docs/guides/overview/auth/oauth>).
- **Choosing a localhost callback silently costs app attribution**: fixed `localhost:PORT`
  title, no marketplace or rankings (<https://openrouter.ai/docs/guides/overview/auth/oauth>). For Unframed
  that also means the app name the user sees on the consent screen is `localhost:PORT`.
- **`rate_limit` in the `GET /api/v1/key` response is deprecated** — "A deprecated object in
  the response, safe to ignore" (<https://openrouter.ai/docs/api_reference/limits>). Don't build against it.
- **`X-RateLimit-*` headers only appear on 429 error responses**, never on successful
  inference calls, so you cannot track quota from normal traffic — poll `GET /api/v1/key`
  instead (<https://openrouter.ai/docs/api_reference/limits>).
- **A negative account balance 402s even free models** (<https://openrouter.ai/docs/api_reference/limits>).
- **A 401 can mean "OAuth session expired"** as well as a bad key — that phrasing is in the
  error-code list (<https://openrouter.ai/docs/api_reference/errors-and-debugging>), even though nothing in
  the OAuth guide describes a session or an expiring key. Unresolved; see Unknowns.
- **Two undocumented-purpose fields on `POST /auth/keys/code`**: `spawn_agent` and
  `spawn_cloud`, present in the schema with no description
  (<https://openrouter.ai/docs/api/api-reference/oauth/create-authorization-code>).
- **The docs moved.** The canonical OAuth page is now
  `/docs/guides/overview/auth/oauth`, and provisioning is now "Management API keys" at
  `/docs/guides/overview/auth/management-api-keys`; the older `/docs/use-cases/oauth-pkce`
  and `/docs/features/provisioning-api-keys` paths still resolve to the current content
  (verified 2026-08-19). `https://openrouter.ai/docs/llms.txt` is the index that lists the
  live paths.
- **The API changelog (<https://openrouter.ai/docs/changelog>) contains no OAuth or
  `/auth/keys` entries at all** as of 2026-08-19 — no deprecations or breaking changes
  announced for this flow. It is generated from OpenAPI diffs, so silence there is weak
  evidence of stability, not a guarantee.

## Unknown / not documented

Each of these is a real gap in first-party docs as of 2026-08-19, not something to infer.

1. **Custom URI schemes** (`unframed://callback`) — never mentioned. The `callback_url`
   description says "Supports https URLs and localhost/127.0.0.1 URLs on any port"
   (<https://openrouter.ai/docs/client-sdks/python/sdks/oauth/README>), which *reads* as
   exhaustive, but no page states that a custom scheme is rejected. Needs an empirical test.
2. **Whether `http://` on a non-loopback host is rejected**, and whether `[::1]` counts as
   loopback. Only `localhost` and `127.0.0.1` are named.
3. **Whether the callback path and query are matched at all** — e.g. whether
   `http://localhost:51423/callback` and `http://localhost:51423/other` are interchangeable,
   and whether extra query params on `callback_url` survive the redirect.
4. **The key's format** — no first-party page in this set states the `sk-or-v1-...` prefix as
   a contract. The management-keys sample response shows a `label` of `"sk-or-v1-abc...123"`
   (<https://openrouter.ai/docs/guides/overview/auth/management-api-keys>), which is a truncated display
   label, not a documented format guarantee.
5. **Whether the plain `/auth` URL accepts `limit`, `usage_limit_type`, `expires_at`, or
   `workspace_id` as query params.** They are documented only on `POST /auth/keys/code`
   (<https://openrouter.ai/docs/api/api-reference/oauth/create-authorization-code>); the guide's authorize
   URL shows only `callback_url`, `code_challenge`, `code_challenge_method`, `key_label`.
6. **Whether an OAuth-minted key ever expires on its own, and any refresh/rotation path.**
   No expiry, no refresh token, no re-exchange is documented for the browser flow.
7. **What happens on a repeat authorization** — does a second trip through `/auth` for the
   same user and app mint an additional key, or return/replace the existing one? Not stated.
8. **Whether the app can detect revocation other than by a failing call.** `GET /api/v1/key`
   is documented for limits; its behaviour on a deleted key is not specified.
9. **What "OAuth session expired" in the 401 description refers to**
   (<https://openrouter.ai/docs/api_reference/errors-and-debugging>) — no OAuth-session concept appears in
   the OAuth guide.
10. **`spawn_agent` and `spawn_cloud`** on `POST /auth/keys/code` — schema only, no semantics.
11. **`state` parameter / CSRF guidance.** The authorize URL documents no `state` param, and
    the docs give no CSRF advice for the callback.
12. **Per-key rate limits distinct from account limits.** The limits page describes account
    balance, per-key credit caps, and global capacity governance; it does not document a
    per-key request-rate cap, and says extra keys do not change rate limits
    (<https://openrouter.ai/docs/api_reference/limits>).
13. **Any consent-screen or approval-scope UI detail** beyond the two screenshots on the
    guide — what exactly the user sees they are granting is not described in text.

## Follow-up

Three questions from the coordinator, researched 2026-08-19, same rules.

### F1. Account credit balance — the endpoint exists but an ordinary key cannot call it

Yes, there is one: **`GET /api/v1/credits`**, "Get remaining credits"
(<https://openrouter.ai/docs/api/api-reference/credits/get-remaining-credits>).

Response shape, verbatim from the reference:

```json
{ "data": { "total_credits": 0, "total_usage": 0 } }
```

(<https://openrouter.ai/docs/api/api-reference/credits/get-remaining-credits>) — i.e. purchased
total and used total for the account; remaining balance is the subtraction, which the docs
describe as the endpoint that "has live information about the balance and remaining credits
for the account" (<https://openrouter.ai/docs/terms-of-service>, credits section).

**Authorization: a management key is required.** The reference page states "Management key
required", and every SDK page for it repeats the sentence: "Get total credits purchased and
used for the authenticated user. **Management key required**"
(<https://openrouter.ai/docs/api/api-reference/credits/get-remaining-credits>,
<https://openrouter.ai/docs/client-sdks/typescript/sdks/credits/README>,
<https://openrouter.ai/docs/client-sdks/python/sdks/credits/README>,
<https://openrouter.ai/docs/client-sdks/go/sdks/credits/README>). Documented errors are 401
Unauthorized and 403 Forbidden (same pages). The FAQ's account of the three auth methods keeps
them separate — "Cookie-based authentication for the web interface and chatroom", "API keys
(passed as Bearer tokens) for accessing the completions API and other core endpoints", and
"Management API keys for programmatically managing API keys through the key management
endpoints" (<https://openrouter.ai/docs/faq>).

**So: an OAuth-obtained key is a plain inference API key and is not documented as authorized
for `GET /api/v1/credits`.** A management key belongs to *our* account, not the user's, so it
cannot read the *user's* balance either — there is no documented path by which a desktop app
holding a user's OAuth key reads that user's purchased credit. The only balance-ish number
such a key can read is `GET /api/v1/key` → `limit_remaining`, which is the per-key cap and is
`null` when uncapped ("Remaining credits for the key, or null if unlimited",
<https://openrouter.ai/docs/api_reference/limits>). *Inference, labelled:* the practical signal
left for an uncapped OAuth key is the 402 response — "If your account has a negative credit
balance, you may see 402 errors" — plus `is_free_tier` on `GET /api/v1/key`, which reports
"Whether the user has paid for credits before" (<https://openrouter.ai/docs/api_reference/limits>).
Whether OpenRouter would in fact accept an ordinary key on `/credits` is untested here; the
docs say it needs a management key, and that is the answer to build against.

### F2. What the consent screen shows for a loopback callback — not documented in text

The only first-party statement about naming a localhost app is on the OAuth guide: "Localhost
apps are assigned a fixed title matching the host and port (e.g. `localhost:3000`) but will
not appear in the OpenRouter marketplace or rankings. If you want a custom app name and
marketplace presence, use a public URL as the callback instead."
(<https://openrouter.ai/docs/guides/overview/auth/oauth>) The guide illustrates the authorize page with a
screenshot only — its alt text is literally "Alt text" — so no page states in words what
string the consent screen renders as the requesting app's name
(<https://openrouter.ai/docs/guides/overview/auth/oauth>). *Inference, labelled:* "assigned a fixed
title" plus "If you want a custom app name … use a public URL" reads as the consent screen
showing `127.0.0.1:51423`, and the sentence would be pointless otherwise — but that is
reasoning, not a documented claim.

Documented ways to supply a display name, and what each governs:

- **No title/app_name param on the `/auth` URL is documented.** The guide's samples show only
  `callback_url`, `code_challenge`, `code_challenge_method`, and `key_label`
  (<https://openrouter.ai/docs/guides/overview/auth/oauth>).
- **`key_label` names the key, not the app** — "Optional custom label for the API key.
  **Defaults to the app name** if not provided"
  (<https://openrouter.ai/docs/client-sdks/python/sdks/oauth/README>). So the app name is an
  upstream concept that `key_label` merely inherits from; setting `key_label` does not appear
  to set it.
- **`HTTP-Referer` / `X-OpenRouter-Title` (`X-Title`) are documented for attribution on API
  requests**, and the app page is keyed on the referer URL — "Without it, no app page will be
  created"; the title header "alone does not create an app page. It must be paired with
  `HTTP-Referer`" (<https://openrouter.ai/docs/app-attribution>). Notably the SDK param tables show
  these same three headers being accepted **on the create-authorization-code call** —
  `http_referer`, `x_open_router_title`, `x_open_router_categories`
  (<https://openrouter.ai/docs/client-sdks/python/sdks/oauth/README>) — but that call is
  `POST /auth/keys/code` and requires a management key
  (<https://openrouter.ai/docs/api/api-reference/oauth/create-authorization-code>); it is not the
  browser `/auth` URL. Nothing states these headers affect what the consent page displays.
- **No app-registration step of any kind is documented**, so there is no documented way to
  register "Unframed" as a name that coexists with a loopback callback; the guide's only offer
  is to swap in a public callback URL — "your project website or a GitHub repo link"
  (<https://openrouter.ai/docs/guides/overview/auth/oauth>).

Observed behaviour (first-party, verified 2026-08-19): requesting
`https://openrouter.ai/auth?callback_url=http%3A%2F%2F127.0.0.1%3A51423%2Fcallback&code_challenge=…&code_challenge_method=S256`
unauthenticated returns 200 after redirecting to
`https://openrouter.ai/sign-up?redirect_url=<the same /auth URL>` — the loopback callback and
the challenge survive the login round-trip, and the consent screen itself is behind a session,
so its text could not be read here. That the loopback URL is accepted this far, rather than
rejected up front, is the only thing this observation establishes.

*Practical read, labelled as inference:* if the approval screen must say "Unframed", the
documented lever is a public `callback_url` on a domain we own, not a param — which for a
desktop app means hosting a redirect page that then hands the code to the local app, or
accepting `127.0.0.1:PORT` on the consent screen, or using headless copy-paste (whose screen
naming is equally undocumented).

### F3. Repeat authorization — still unknown

Checked the OAuth guide (<https://openrouter.ai/docs/guides/overview/auth/oauth>), the authentication page
(<https://openrouter.ai/docs/api_reference/authentication>), the management-keys guide
(<https://openrouter.ai/docs/guides/overview/auth/management-api-keys>), the FAQ
(<https://openrouter.ai/docs/faq>), the limits page (<https://openrouter.ai/docs/api_reference/limits>),
the key-rotation cookbook (<https://openrouter.ai/docs/cookbook/administration/api-key-rotation>)
and the API changelog (<https://openrouter.ai/docs/changelog>). **None of them says what a second
authorization by the same user for the same app does** — no mention of an "already authorized"
state, key reuse, replacement, or a per-app key limit. The guide's only lifecycle statement is
about the code, not the key: single-use, 10 minutes
(<https://openrouter.ai/docs/guides/overview/auth/oauth>).

The nearest first-party hints, neither of which answers it: every documented key-creating path
returns a fresh plaintext `key` that "is returned only in this response"
(<https://openrouter.ai/docs/api/api-reference/api-keys/create-a-new-api-key>), and the exchange
endpoint's response likewise carries a `key`
(<https://openrouter.ai/docs/api/api-reference/oauth/exchange-authorization-code-for-api-key>) — a shape that
would be odd if it were handing back an existing key it could not re-read, *but that is my
inference and not a documented behaviour.* Stays in the unknowns list (item 7); resolve it by
authorizing twice against a real account and counting rows in
<https://openrouter.ai/settings/keys>.
