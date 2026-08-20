# Connecting OpenRouter by OAuth — design

Replace "go to openrouter.ai, create a key, copy it, paste it here" with one
button. The user approves Unframed in their browser and the key arrives on its
own.

This is a new way to *obtain* a key, not a new place to keep one. `.env` remains
the only key store, `server/env.js` remains the only writer, and every consumer
downstream — `/api/generate`, `/api/text`, `/api/video`, the job sweep,
`DELETE /api/key` — is untouched and indifferent to how the key arrived.

Research behind every factual claim about OpenRouter's flow, with citations and a
list of what its documentation does *not* answer, is
`docs/research/2026-08-19-openrouter-oauth.md`.

## Scope

Local convenience only. The key lands in the local `.env` exactly as a pasted one
does, and the user's own OpenRouter account is billed. Nothing about this feature
sends key material anywhere but the machine that spends it.

Two things this is explicitly *not*, both considered and rejected:

- **Not a cloud-held key.** No server-side storage of a user's OpenRouter
  credential, now or as a stepping stone. That would make Unframed a custodian of
  other people's API keys and would contradict what the settings dialog promises.
- **Not a brokered relationship.** Management API keys (formerly "provisioning
  keys") mint keys owned by *our* account, spending *our* balance. They are the
  opposite of what this feature needs and stay out of this repo.

## The flow, and the one fact that makes it safe

OpenRouter's flow is not RFC 6749. The parameter is `callback_url`, not
`redirect_uri`; there is **no `state` parameter**; and the credential returned is
an ordinary long-lived user-owned key, not a token — there is no refresh
mechanism and no way to re-fetch it, so it is stored, once, like a pasted one.

```
client                    engine                     openrouter        browser
  │  POST /api/oauth/start  │                             │                │
  │ ───────────────────────►│ mint verifier + nonce       │                │
  │ ◄─────────────────────── │  { authorizeUrl }          │                │
  │  open in new tab ──────────────────────────────────────────────────────►│
  │                          │                            │ ◄── approve ───│
  │                          │  GET /api/oauth/callback/:nonce?code=…  ◄────│
  │                          │ ── POST /api/v1/auth/keys ─►│                │
  │                          │ ◄──── { key, user_id } ─────│                │
  │                          │  writeEnv(key)             │                │
  │  poll /api/health ──────►│                            │                │
```

The last inbound arrow is drawn direct for legibility; in the configured default
it passes through the bounce page described below, which changes nothing about
what the engine does.

**The `code_verifier` is generated in the engine and never leaves the process.**
This is the constraint the rest of the design hangs off, not an implementation
detail: it is what lets a code travel through a public web page without that page
being able to do anything with it, and it is why a leaked log line is not a
leaked key.

The client never builds the authorize URL. It cannot: the callback must point at
the engine, and in a clone the client reaches the API through Vite's proxy and
does not know the engine's port. The engine knows its own.

## Naming: why a public bounce page

A loopback `callback_url` works on any port with no pre-registration — the
`PORT=0` of a packaged app is not a problem. But OpenRouter assigns a localhost
app "a fixed title matching the host and port", and the only documented way to
get a real name is a public callback URL. Asking a newcomer to grant API access to
`127.0.0.1:51423` is worse than the paste flow it replaces, which at least never
looked like it was hiding.

So `callback_url` points at a page on the public site the app is downloaded from,
and that page does exactly one thing: redirect the code onward to the engine on
this machine. It never exchanges anything, because it cannot — the verifier is not
there.

**The port and nonce travel in the path, never the query.** Whether OpenRouter
preserves pre-existing query parameters on `callback_url` is undocumented, so the
design does not depend on it:

```
https://<site>/connect/51423-a7f3c9…          (OpenRouter appends ?code=…)
   → 302 http://127.0.0.1:51423/api/oauth/callback/a7f3c9…?code=…
```

**The bounce page constructs the loopback URL from a template and must never
accept one.** Port parsed as digits in 1024–65535, nonce as fixed-length
alphanumeric, host hardcoded to `127.0.0.1`. Taking a URL from its own path and
redirecting there would be an open redirect on the domain that serves the app's
installers — the worst outcome available in this design, and the one line here
that has to be right.

With JavaScript disabled the redirect happens server-side, or the page shows the
code for manual entry. That fallback is free: showing the code *is* OpenRouter's
documented headless mode, so the no-JS path and the SSH/container path are one
feature.

The host is not chosen yet — it is the public site the app is downloaded from, and
it reaches the engine as a single constant (`UNFRAMED_OAUTH_BOUNCE`). Nothing else
in this design depends on its value.

**Direct loopback stays permanently**, selected by that same variable being unset,
in the same idiom as `UNFRAMED_DATA_DIR` and `UNFRAMED_CLIENT_DIST`. It
is the development mode (the public page cannot be assumed to exist while this is
being built) and the fallback when the domain is unreachable. This is one string
differing, not a second code path.

## Server surface

Four routes and one module.

- **`POST /api/oauth/start`** → `{ authorizeUrl }`. Mints a `code_verifier` and a
  128-bit nonce, derives the S256 challenge, records the pending attempt, builds
  the callback from its own port. Supersedes any existing attempt, so two clicks
  on Connect leave exactly one live.
- **`GET /api/oauth/callback/:nonce`** → **HTML, not JSON**. The only route a
  human's browser lands on directly, so every branch — success, unknown nonce,
  expired code, upstream error — answers with a readable page. A bare 400 in a
  browser tab is a dead end.
- **`DELETE /api/oauth/pending`** → drops the attempt on Cancel. Without it, a
  user who cancels and then absent-mindedly approves in the browser gets a key in
  an app that told them the attempt was cancelled. Nothing is harmed; the app
  would simply be lying about its own state.
- **`GET /api/oauth/status`** → passthrough of `GET /api/v1/key`. Deliberately
  **not** folded into `/api/health`: health is called on every page load and must
  not depend on OpenRouter being reachable, while this is called when the settings
  dialog opens and is allowed to be slow or to fail.

**`server/oauth.js`** holds the pure parts — `challengeFrom`, `authorizeUrl`,
`callbackUrl`, and the pending-attempt store (`start` / `claim` / `cancel`, 10
minute window, matching OpenRouter's code lifetime; expiry is checked inside
`claim` rather than swept, since nothing needs to act the moment an attempt dies). Same trigger that produced
`env.js`, `presets.js` and `jobs.js`: rules load-bearing enough to want tests.
`claim` must succeed exactly once — a nonce claimable twice is a replayable
callback, and that failure is invisible from the outside, which is the whole
argument for the module.

**The pending attempt lives in memory, not on disk.** It survives ten minutes and
a restart mid-flow is a flow the user retries. Unlike `jobs.json` there is no paid
work in flight, so persisting a `code_verifier` would solve a problem nobody has.

**Every `await` sits inside a `try/catch` that answers.** The callback route makes
an outbound HTTPS call and then writes a file; both can reject, this Express 4
setup has no error-handling middleware, and an unhandled rejection takes the
server down.

## What the settings dialog shows

`GET /api/v1/key` is what the display is built from. It reports the KEY: what it
has spent, its cap, its expiry.

**A correction, 2026-08-20.** This section used to assert that `GET /api/v1/credits`
is management-key-only and that "there is no path for a local app holding a user's
key to read that user's credit balance." That is false — it answers 200 for an
ordinary user key and returns the real account balance. The claim shaped the whole
display, so it is struck rather than softened. Unframed still does not show the
balance, which is a choice now instead of a limitation: `is_free_tier` answers the
only question the dialog actually asks ("can this account generate at all"), and a
second number beside a per-key cap invites reading one for the other. If that
changes, the endpoint is there.

What IS unreachable is the key's human name. See the end of this document.

| Field | Shown as | When |
| --- | --- | --- |
| `usage` | "$1.34 spent with this key" | when `is_free_tier` is false |
| `limit` / `limit_remaining` | "of a $5.00 cap — $3.66 still available" | with the above, when `limit` is non-null |
| `is_free_tier` | "Add credit before generating", with a link | when true, and then INSTEAD of the two above |
| `expires_at` | "expires in 14 hours, and nothing renews it" | when set, and within a fortnight |
| 401 or 403 from the endpoint | "This key no longer works at OpenRouter — reconnect" | on revocation or expiry |

`limit_reset` is deliberately not shown: an undocumented upstream string, in
whatever shape and units OpenRouter happens to send, is not something to drop into
a sentence. It is not forwarded past the server either, so nothing downstream can
be tempted.

Spend and free-tier are mutually exclusive rather than stacked. With no credit
bought, what the key has spent against its cap is noise in front of the one thing
that has to happen next.

The cap is *per key*. The documentation implies it can only be set on the
management routes, which suggested a connected key would return `limit: null` and
show spend alone. **That is wrong** — the authorization page offers a cap while
the user approves (verified 2026-08-20, see the end of this document), so a capped
key is the ordinary outcome of this flow. The cap line is consequently the main
warning before generation stops, not a detail for the rare hand-capped key.

`is_free_tier` ("whether the user has paid for credits before") is what moves the
insufficient-credit discovery from *after a failed generation* to *the moment of
connecting*. It does not catch a user who paid once and ran dry; that case still
arrives as a 402, whose message gains the cause and a top-up link.

Refreshed when the dialog opens, never on a timer. Inference responses carry no
quota information, so polling is the only way to know, and nothing outside the
dialog needs it.

## Client surface

Additive to a dialog that already works. The paste path keeps its exact code, so
the fallback cannot rot.

**Keyless.** Heading becomes "Connect OpenRouter to start"; the four explanatory
paragraphs collapse to one (what OpenRouter is, that it bills your own account,
that the key stays on this machine); one primary **Connect OpenRouter** button;
below it a closed disclosure, "or paste a key instead", revealing the existing
field and Save.

**With a key.** The "API key" section becomes "OpenRouter" and shows the table
above, keeping **Remove key** and its confirm flow unchanged. The paste field
stays under the same disclosure for replacing a key. Nothing distinguishes a
connected key from a pasted one, because nothing about them differs — recording
the source in `.env` was considered and rejected as a new thing to migrate and a
new way for the file to disagree with itself, for a distinction no user cares
about.

**The waiting state polls `/api/health` every 1.5s and gives up at ten minutes,
not two.** At two minutes the copy softens to "Still waiting — finish in the
browser, or try again", but polling continues, because ten minutes is
OpenRouter's real code lifetime. Stopping earlier would report failure while the
flow is still valid — the user goes to find a password, returns, approves, and is
told it already failed.

**The poll lives in `App`, beside `cfg`, not inside the dialog.** Closing the
dialog mid-flow must not abandon the connection: the callback still lands
server-side, and `App` still notices. A poll inside the dialog's render path would
leave the key written on disk while the toolbar still showed the "add a key" icon
until a reload.

## Failure branches

Every one of these answers; none leaves a spinner running.

| Condition | Result |
| --- | --- |
| Browser never opens | The link, copyable, paste fallback present |
| Tab closed without approving | Times out at ten minutes; nothing written |
| Approval arrives after Cancel | Refused cleanly |
| Nonce unknown, stale, or replayed | Callback page says so; no exchange attempted |
| Upstream exchange errors | Its reason on the callback page |
| Code expired | OpenRouter's own reason on the callback page. There is deliberately no special-cased copy: the generic upstream-error branch already shows what it said, and a hand-written sentence for one upstream status is a second thing to keep true. |
| Key later revoked upstream | Settings says so on open, offers reconnect |

**The key returned by OpenRouter still passes `PATTERNS.OPENROUTER_API_KEY`.** A
provider's response gets the same scrutiny as a paste, because the value reaches a
shell-ish file and an HTTP header. But the rejection message must differ: the
`sk-or-v1-` prefix is not a documented contract (it appears only in a truncated
display label), so a failure here means "OpenRouter returned a key in a shape we
do not recognise" — not "that does not look like an OpenRouter key", which would
be baffling to read immediately after a successful approval.

## Security

Four defences, each against something specific.

1. **The verifier never leaves the engine.** Makes the public bounce safe, and
   makes a code in a CDN log unexploitable.
2. **The nonce is 128-bit, single-use, and in the path.** It substitutes for the
   `state` parameter OpenRouter does not offer. The callback is a top-level
   browser navigation, which CORS does not protect, so an unguessable single-use
   value is what makes a hostile local page's navigation pointless.
3. **The bounce page cannot redirect anywhere but loopback.** See above.
4. **Provider responses are validated at the same boundary as user input.**

**Prerequisite, shipped separately: `app.use(cors())` is wide open.** It sends
`Access-Control-Allow-Origin: *`, so any site visited while Unframed runs can read
`/api/health` (key hint, models, output path — usually containing a username),
enumerate projects, and call `DELETE /api/key`; permissive preflight answers do
not help. This predates the feature, but `/api/oauth/status` would hand any
website the user's spend, and a nonce-guarded flow behind a wide-open door is
incoherent. Neither real consumer needs CORS — Vite proxies server-side, the
packaged app is same-origin, and the share tunnel is a separate HTTP server by
design (`share.js`) — so the fix is narrow. **It lands in its own PR before this
work**, because it is independently valuable and should not be buried in a
feature branch.

## Testing

- **`server/oauth.test.js`** — plain `node` + `assert`, alongside the existing
  suites. `challengeFrom` matches the documented S256 encoding; `authorizeUrl`
  emits and encodes the right parameters; `callbackUrl` produces direct-loopback
  when no bounce is configured and the bounce form when it is; the store
  supersedes on `start`, `claim` succeeds once and fails the second time, and an
  expired attempt cannot be claimed. The replay case is the one whose failure is
  invisible externally.
- **`server/host.test.js`** — gains `POST /api/oauth/start` returning a
  well-formed URL, and the callback rejecting an unknown nonce. Both fit its
  existing fork-into-a-temp-dir shape and neither reaches OpenRouter, so the rule
  that nothing spending money goes there holds.
- **The exchange is verified in the running app, AND mocked.** Live first, because
  a mock proves only that it matches our reading of the docs, which is exactly the
  thing that might be wrong — and doing it live settled an open question for free
  (connect twice, count the rows at openrouter.ai/settings/keys: reconnecting does
  litter the account). The stub in `host.test.js` came after, and earns its place
  for the opposite reason: it makes the route's branches — a refused code, a
  malformed key, a replayed nonce, a cancelled attempt, a key removed mid-flow —
  reachable on demand and without network egress, which no live test can be.
- **No dialog tests.** Node components have no tests here by design; verified in
  the browser and said so.

## Relationship to a future Supabase account

None, by construction, and that is worth recording so it is not re-litigated.
Supabase would answer "who is this person and what have they bought from us"; this
feature answers "may Unframed spend this person's OpenRouter credit". Neither
issuer knows the other exists, and three things must stay true:

1. **Connect must never require a signed-in account.** A clone has no Supabase and
   must keep working; gating Connect on sign-in would leave a clone with no way to
   obtain a key at all.
2. **Supabase must never host the OAuth callback.** A hosted `https://` callback
   looks tidier than loopback, but routing the key through our server makes us a
   custodian of it. The bounce page redirects a code; it never receives a key.
3. **The key must not be synced to an account "for convenience".** Cross-machine
   key storage is a separate project with its own encryption-at-rest and
   revocation story, not an extension of this one.

The only real interaction is cosmetic and later: a dialog holding both an Account
section and a Provider section must keep them visually distinct, so nobody reads
"signed out" as "my key is gone".

## What the flow actually does — verified 2026-08-20

Three of this spec's open questions were answered by running the flow against a
real account. Two of the answers contradict the documentation, so they are
recorded here rather than left to be rediscovered.

- **The consent screen names the app `127.0.0.1:<port>`.** Confirmed, exactly as
  the docs' attribution note implied and as this design assumed. **This is what
  justifies the bounce page**: without it, users are asked to grant API access to
  a bare IP and port. The one inference the whole approach rested on holds.
- **Re-authorizing mints a new key every time.** Two authorizations took the
  account from three keys to five. Keys accumulate, so a user who reconnects
  repeatedly collects rows — which is a reason not to invite needless reconnects,
  and why the revoked state is the only place that offers one.
- **The browser flow lets the user name the key, set a spending cap, and set an
  expiry.** All three contradict the research, which recorded `key_label` and
  `limit` as available only on the management routes. The authorization page asks
  for a name (stored prefixed, e.g. `OAuth: my-laptop`), offers a cap, and offers
  an expiry, all while you approve.

  **The name is visible in OpenRouter's console and NOT returned to us**, which is
  a distinction this section originally blurred. `GET /api/v1/key` reports `label`,
  and `label` is a truncated form of the key itself (`sk-or-v1-464...845`) even for
  a key the user named — confirmed 2026-08-20 against a key whose console row reads
  `OAuth: oauth test 2`. The routes that would return the name (`/api/v1/keys`,
  `/api/v1/keys/current`) answer `401 Invalid management key`. So no display can
  say "connected as my-laptop", `label` is not forwarded past the server, and the
  code comment saying the field only ever holds key material was right all along.

  **The expiry has to be surfaced, not just recorded.** A key that lapses is
  indistinguishable from a revoked one afterwards — the 401 reads as `revoked`,
  which is accurate and arrives too late — so `expires_at` is reported and
  `client/src/keyExpiry.js` turns it into a warning while there is still time to
  act. Silent past a fortnight, since a warning nobody can act on yet is noise.

Two consequences worth stating, because the code depends on them:

1. **A capped key is the common case, not the exotic one.** This spec previously
   predicted `limit: null` for a connected key and treated the cap line as
   something only a hand-capped pasted key would show. Wrong: anyone who accepts
   the cap offered during approval has one. The cap display is therefore the main
   warning a user gets before generation stops, not a nicety.
2. **A 402 has two plausible causes, and they need different fixes.** An empty
   account balance and an exhausted per-key cap both return 402, and adding credit
   only clears the first. The generation routes name both rather than asserting
   one, and pass OpenRouter's own reason through, since it is the only thing that
   distinguishes them.

## Open questions the documentation does not answer

- **Are custom URI schemes supported?** Never mentioned. Irrelevant here — the
  design deliberately avoids them, since registering one would require changes in
  the shell repo and break the one-way dependency.
- ~~**Does a key from this flow ever expire on its own?**~~ **Answered
  2026-08-20.** Not on its own, but the authorization page offers an expiry
  alongside the name and the cap, so a connected key can carry one. Nothing here
  renews it — the credential has no refresh mechanism — so the expiry is displayed
  while it can still be acted on, and reconnecting is the only fix.
