# 22 · Vercel AI Gateway

Depends on: 01 to 15 (read 00-index first). Spec 15 made room for a second provider: this spec is one more row of its provider-key table. Spec 16 is not a dependency: a node's run uses the same run requests, so it inherits the provider field when it is built.

## Problem Statement

Every image and text run goes through OpenRouter. A person who already pays for the Vercel AI Gateway (through a Vercel team, its credits or its budgets) has to open and fund a second account just to use Unframed, and someone whose OpenRouter account is out of credit or rate limited has no other way to generate (issue #198).

The Vercel AI Gateway serves many of the same models behind an OpenAI-compatible API, but it is not a drop-in copy of OpenRouter. Its key is pasted (no OAuth). Its catalogue is a different list with different fields: no typed parameters for image models, prices as strings. Its answers carry no cost: the cost of a run is read from a generation lookup that may lag, or from the catalogue's list price. It has no public HTTP API for video. Each of those differences touches a rule the app keeps: the key never leaves the engine, every paid run leaves a sidecar with its cost, a recipe repeats a run exactly, and the composer only offers what will work.

The research is in `docs/research/vercel-ai-gateway.md`.

## Solution

The Vercel AI Gateway sits **beside** OpenRouter as a second provider for image and text runs. Either one alone is enough to generate images and text; video still needs OpenRouter; audio still needs ElevenLabs (spec 15).

- **Settings, Generation** gains a **Vercel AI Gateway** block after OpenRouter: paste a key (`vck_…`), remove it with spec 10's two-step confirm, and see the team's credit balance and total spent. Default models gains `Image · Vercel` and `Text · Vercel`.
- **The composer** shows a **provider switch** (`OpenRouter` | `Vercel`) in the Generate tray's prop row when both keys exist and the medium is image or text. The model chip, the model dialog and the estimate follow the chosen provider's catalogue. With only a gateway key, image and text use the gateway without a switch, and video shows why it cannot run.
- **Runs** carry the provider. The result's recipe records it, so Regenerate, Recipe, recipe groups and the library repeat a run through the same provider. Results made through the gateway say so on their line, with their cost.
- **Costs** are read from the gateway's generation lookup when it answers in time, else taken from the catalogue's list price. The sidecar says which, and the result line marks a list price with `≈`.
- **Outside and in-app agents' `generate`** take an optional `provider`. Spend limits count gateway costs like OpenRouter's: both are dollars.

## User Stories

1. As a person with a Vercel team, I want to paste my AI Gateway key in Settings, so that I can generate without an OpenRouter account.
2. As a person, I want Settings to refuse something that is not a gateway key, with a sentence that says what a key looks like, so that I do not save a typo.
3. As a person, I want to see my team's AI Gateway credit balance and how much it has spent, so that I know whether a run will go through.
4. As a person, I want Settings to tell me when my gateway key no longer works, so that I replace it before a run fails.
5. As a person, I want to remove the gateway key with a confirm, so that a stray click does not delete it.
6. As a person with only a gateway key, I want image and text runs to work, so that I need no second account.
7. As a person with only a gateway key, I want the video medium to tell me it needs OpenRouter and why, so that I am not left guessing.
8. As a person with both keys, I want to choose the provider in the composer, so that I can use the account that has credit or the model only one of them lists.
9. As a person, I want the composer to remember the provider I last used for each medium, so that I do not choose it every time.
10. As a person, I want the model dialog to list the chosen provider's models, with a link to that provider's model page, so that I pick a model that exists there.
11. As a person, I want the composer's estimate to show the gateway's list price for a flat-priced image model, so that I know the cost before sending.
12. As a person, I want a result made through the gateway to show its cost and that it came through Vercel, so that my spend is visible where I work.
13. As a person, I want a list price to be marked as such, so that I can tell a measured cost from an estimate.
14. As a person, I want Regenerate and Recipe to go through the provider the result was made with, so that the repeat is the same run.
15. As a person, when the result's provider has no key any more, I want the composer to switch to the provider I have and say so, so that I can still repeat the run.
16. As a person, I want a recipe group to keep its provider, and the library's presets with it, so that the standing settings mean the same thing next time.
17. As a person, I want gateway errors (bad key, no credits, a budget reached, rate limited) in plain sentences that say what to do, so that I can fix them.
18. As a person, I want default models for the gateway, separate from OpenRouter's, so that each provider starts on a model it lists.
19. As an agent outside the app, I want `generate` to take a provider, so that I can run on the account the person asked for.
20. As a person, I want an agent's gateway runs to count against the spend limit I set, so that the limit still means what it says.
21. As a developer, I want every gateway call in tests to go to a loopback stub, so that no test can spend money or send the key off the machine.

## Implementation Decisions

### Terms this spec adds

- **Provider** (of a run): `openrouter` or `vercel`, the service a paid image or text run goes through. Absent means `openrouter` everywhere it is stored, so every record written before this spec reads unchanged.
- **Gateway**: the Vercel AI Gateway. In copy it is `Vercel AI Gateway` the first time in a block and `Vercel` in tight spots (the provider switch, the result line).
- **Cost basis**: where a gateway run's cost came from: `gateway` (the generation lookup's `total_cost`) or `list-price` (the catalogue).

### Modules

| Module | Package | Interface | New or extended |
| --- | --- | --- | --- |
| Provider keys | domain | `PROVIDER_KEYS` gains `VERCEL_KEY`: id `vercel`, variable `AI_GATEWAY_API_KEY`, patch field `vercelKey`, `hasVercelKey`, `vercelKeyHint`, origin `https://ai-gateway.vercel.sh`, test origin variable `UNFRAMED_TEST_VERCEL_ORIGIN`, remove action `settings.removeVercelKey` and its lines | extended (spec 15) |
| Settings rules | domain | `AI_GATEWAY_IMAGE_MODEL` and `AI_GATEWAY_TEXT_MODEL` with defaults and validators | extended (spec 01) |
| Gateway answers | domain | `gatewayMessage(status, body, raw)`, `gatewayCatalogueEntry(raw, medium)`, `gatewayListPrice({ entry, usage? })`, `gatewayCreditsCopy(status)` | new |
| Generation providers | domain | `generationProviders(settings)` (which providers have a key), `trayProvider({ medium, wanted, settings })` (the provider a tray runs on and the line when it had to switch), `PROVIDER_NAMES` | new |
| Result line | domain | `resultLine` gains `provider` and `listPrice` | extended (spec 03) |
| Recipe rules | domain | `GroupRecipe` reading, equality and chip keep `provider` | extended (spec 06) |
| Contracts | contracts | `GenerationProvider`; `provider?` on `ImageRunRequest`, `TextRunRequest`, `TextCompleteRequest`, `ModelsListRequest`, `ResultRecipe`, `GroupRecipe`, `ResultMeta`; `listPrice?` on `ResultMeta`; `Settings` and `SettingsPatch` gain the gateway fields; `VercelStatus` | extended |
| Gateway client | engine | one adapter for every gateway call (catalogue, images, chat, generation lookup, credits), reading the origin from config | new |
| Catalogue proxy | engine | `models.list({ medium, provider: "vercel" })` | extended (spec 03) |
| Run services | engine | `run.image`, `run.text`, `text.complete` route by provider | extended (specs 03 and 05) |
| Settings store | engine | the three variables; `settings.removeVercelKey`; `vercel.status` | extended (specs 01 and 10) |
| Agent generation | engine | `generate` takes `provider` | extended (spec 14) |
| Settings dialog | web | the Vercel AI Gateway block and two default model selects | extended (spec 10) |
| Generate tray | web | the provider switch, the catalogue per provider, last-used provider, recipe and group provider | extended (specs 03, 05 and 06) |

### Settings, the key and the status

Three settings variables join spec 01's table:

| Variable | Default | Validator (after trimming) | Editable in app | Clearable with `''` |
| --- | --- | --- | --- | --- |
| `AI_GATEWAY_API_KEY` | none | `^vck_[\w-]{8,200}$` | yes | no (removal is its own action) |
| `AI_GATEWAY_IMAGE_MODEL` | `openai/gpt-image-2` | spec 01's model slug rule | yes | no |
| `AI_GATEWAY_TEXT_MODEL` | `google/gemini-3.5-flash-lite` | spec 01's model slug rule | yes | no |

The variable name is the one Vercel's own docs use, so a person who already exports it in their shell gets it picked up as a process-environment value. Refusals: `That does not look like a Vercel AI Gateway key. Keys start with "vck_".`, and spec 01's model slug sentence for the two models. `.env.example` gains `AI_GATEWAY_API_KEY=` (empty), `AI_GATEWAY_IMAGE_MODEL=openai/gpt-image-2` and `AI_GATEWAY_TEXT_MODEL=google/gemini-3.5-flash-lite`.

`Settings` gains `hasVercelKey`, `vercelKeyHint` (the last four characters, or `''`), `gatewayImageModel`, `gatewayTextModel`. `SettingsPatch` gains `vercelKey?`, `gatewayImageModel?`, `gatewayTextModel?`. A patch carrying `vercelKey` does not cancel a pending OpenRouter connection. Writing `gatewayImageModel` or `gatewayTextModel` does not touch the last-used values: last-used models are kept per provider (below), and a stored model the catalogue no longer lists already falls back to the default.

`settings.removeVercelKey`: delete the `AI_GATEWAY_API_KEY` line through the write funnel, clear the key in the running process, emit on `settings.subscribe`, answer `{ settings }`. Nothing else is resolved: gateway runs are not durable (no video), and a live one finishes or fails on its own. Field warning: `This deletes the Vercel AI Gateway key from .env. You will need to paste it again, or make a new one in the Vercel dashboard (AI Gateway, API Keys).` Line after removal: `Vercel AI Gateway key removed.`

`vercel.status` answers `VercelStatus`:

```ts
type VercelStatus =
  | { hasKey: false }
  | { hasKey: true; revoked: true }
  | { hasKey: true; balance: number; totalUsed: number }
```

- No key: `{ hasKey: false }`, no upstream call.
- `GET /v1/credits` with the key. 401 or 403: `{ hasKey: true, revoked: true }`.
- Other non-2xx, or a body without finite `balance` and `total_used` (strings or numbers): `upstream`, `The Vercel AI Gateway answered <status>.` Network failure: `upstream` with the error message.
- 2xx: the two values as numbers.
- Fetched when the dialog opens with a gateway key and after one is saved. Never on a timer.

Gateway credits copy (domain), dollars with two decimals:

| Condition | Shown |
| --- | --- |
| revoked | `This key no longer works at Vercel. It may have been revoked or its team member removed.` |
| credits | `$<balance> of AI Gateway credit left on this Vercel team, $<totalUsed> used so far.` |
| not fetched or failed, key saved | `A key is already saved (…<hint>). Entering a new one replaces it.` |
| no key | `Make a key in the Vercel dashboard (AI Gateway, API Keys) and paste it here. Images and text are billed to that team's AI Gateway credits.` |

The balance is the team's, and the line says so: the gateway has no per-key read.

### The settings dialog

Spec 10's Generation section gains a **Vercel AI Gateway** block after the OpenRouter block and before ElevenLabs:

- Heading `Vercel AI Gateway`. A password field (the kit Input), accessible label `Vercel AI Gateway API key`, placeholder `vck_…`. Beside it, with a key, `Remove key` with spec 10's two-step confirm and the lines above. Under it, the credits copy (`data-testid="vercel-status"`).
- Without an OpenRouter key, the block shows the supporting line `No OpenRouter account? Images and text can run through the Vercel AI Gateway instead. Video still needs OpenRouter.` in `text-xs` muted text. Its field is always shown.
- ElevenLabs' supporting line (spec 15) shows when there is neither an OpenRouter nor a gateway key, and reads `Only want audio? Paste an ElevenLabs key here. Images and text need OpenRouter or the Vercel AI Gateway, and video needs OpenRouter.`
- Save sends `vercelKey` when the trimmed field is not empty, clears the field and the shown status on success, then refetches the status. Save shows on Generation when any key exists, the OpenRouter paste field is revealed, or the ElevenLabs or gateway field holds text.
- Saving a first gateway key while there is no OpenRouter key and no ElevenLabs key closes the dialog with the toast `Vercel AI Gateway key saved. Images and text are ready to generate.`
- Default models: with a gateway key, two searchable selects after spec 10's three, labelled `Image · Vercel` and `Text · Vercel`, listing the gateway's image and text catalogues. With only a gateway key the section holds those two (and `Audio` with an ElevenLabs key). Spec 10's line that the models need a key shows only with no key at all, and reads `Connect OpenRouter or paste a Vercel AI Gateway key to choose the models Generate starts on.`
- The gear's tooltip (spec 15) names the first of: the OpenRouter key, the gateway key (`Settings: Vercel key …<hint>, default models, output folder`), the ElevenLabs key.

### Gateway calls

Every call goes to `https://ai-gateway.vercel.sh` (the origin replaced by `UNFRAMED_TEST_VERCEL_ORIGIN` when set) with `Authorization: Bearer <key>`, except the catalogue, which is public and is sent without the key. Every call has a 30 second timeout except images (120 s) and the generation lookup and credits (10 s).

- **Catalogue.** `GET /v1/models`. For image: entries with `type: "image"`. For text: entries with `type: "language"` whose `modalities.output` includes `text` and whose `modalities.input` includes `image` (spec 05's rule: a text run's pictures are seen). Each becomes `{ id, name (else id), created: released (else null), params: null, pricing }`, where `pricing` is the entry's `pricing` object as given. The default model for the medium is appended as `{ id, name: id }` when missing. Without a key, or on a failure, the answer is the default row alone (the catalogue needs no key, but the tray offers no gateway without one).
- **Image, no references.** `POST /v1/images/generations` with `{ model, prompt, n: 1, response_format: "b64_json" }`. The gateway catalogue declares no parameters for image models, so the tray sends none (Out of Scope).
- **Image, with references.** `POST /v1/images/edits` with the JSON body `{ model, prompt, n: 1, response_format: "b64_json", images: [{ image_url: <data URL or https link> }, …] }`. Project files become data URLs at this boundary, as spec 03 does for OpenRouter. Video references are not sent; the composer warns about them (below).
- **Text.** `POST /v1/chat/completions` with spec 05's body without `usage` (the gateway does not take it): one user message of the prompt then one `image_url` part per image reference, after a system message only when one is given. Video references are not sent, as for images.
- **Generation lookup.** `GET /v1/generation?id=<id>`, used for cost (below).
- **Credits.** `GET /v1/credits`, for Settings only.

The image answer is the first `data[].b64_json`; its media type is sniffed from the bytes as spec 03 does. The text answer is spec 05's rule (`choices[0].message.content`, a string or the text parts). `id` is kept when it is a string.

### Gateway errors

The upstream words are `error.message` when `error` is an object holding a string `message`, else `error` when it is a string, else the first 300 characters of the body. Every sentence a person can see:

| Case | Sentence |
| --- | --- |
| no gateway key at send | `No Vercel AI Gateway key yet. Add one in Settings, under Generation.` |
| video or audio sent through the gateway | `The Vercel AI Gateway serves image and text runs only. Video runs through OpenRouter.` |
| network failure | `Could not reach the Vercel AI Gateway: <reason>` |
| the body lost mid-read | `Lost the connection while reading the Vercel AI Gateway's answer: <reason>. The run may still have completed and been charged. Check the AI Gateway logs in the Vercel dashboard.` |
| 401 | `The Vercel AI Gateway refused the key. It may have been revoked. Paste a new one in Settings, under Generation. (<upstream>)` |
| 402 with `error.type` `quota_for_entity_exceeded` | `The Vercel AI Gateway refused this because a budget was reached (the team's, this key's or yours). Raise it in the Vercel dashboard under AI Gateway, Budgets. (<upstream>)` |
| other 402 | `The Vercel AI Gateway refused this as unpaid: the team has no AI Gateway credits left. Add credits in the Vercel dashboard under AI Gateway. (<upstream>)` |
| 429 | `The Vercel AI Gateway is rate limiting this model. Try again in a moment. (<upstream>)` |
| other non-2xx | `Vercel AI Gateway (<status>): <upstream>` |
| 2xx that is not JSON | `Unexpected response from the Vercel AI Gateway: <first 300 characters>` |
| 2xx with no image | `The Vercel AI Gateway returned no image data.` |
| 2xx with no text | spec 05's `The model returned no text.` |
| the composer, only a gateway key, medium video | `Video runs through OpenRouter only: the Vercel AI Gateway has no video API Unframed can call. Connect OpenRouter in Settings to make video.` |
| the composer, the recorded provider has no key | `Made through <Name>, which has no key now. This run goes through <Other>.` (a warning, not a blocker) |
| `generate`'s `provider` not one of the two | `provider has to be "openrouter" or "vercel".` |

`<Name>` and `<Other>` are `OpenRouter` and `the Vercel AI Gateway`. No sentence names the key itself.

### Cost

A run's sidecar always has a `cost` field (index contract 4). For a gateway run:

1. When the answer carries an `id` (chat completions always do; the images endpoints document none), look it up: `GET /v1/generation?id=<id>` up to three times, the first right after the answer and then after a wait each time (1500 ms, or `UNFRAMED_TEST_GATEWAY_LOOKUP_MS`). A 2xx whose `data.total_cost` is a finite number at or above zero gives `cost` with `costBasis: "gateway"`. Anything else (`Usage event not found`, another status, a network error) moves on. The lookup never fails the run.
2. Else the catalogue's list price, from the entry the run's model has in the gateway catalogue (fetched again if the engine has none cached): an image run's `pricing.image`; a text run's `usage.prompt_tokens × pricing.input + usage.completion_tokens × pricing.output`. Each must be a finite number at or above zero. That gives `cost` with `costBasis: "list-price"`.
3. Else `cost: null` and no `costBasis`.

The placeholder fills, and the `output` event is published, after the cost is known, so a gateway run lands up to three seconds later than its upstream answer. The gateway adds no markup (research), so a list price is what the run costs unless the team has a negotiated discount or uses its own provider keys; the `≈` on the result line says it is not measured.

### Persisted formats

- **Image and text sidecars** of a gateway run gain `provider: "vercel"` and `costBasis` (when `cost` is not null). An OpenRouter run's sidecar is unchanged, so a spend sum over `cost` keeps working and adds both providers' dollars.
- **`ResultRecipe`** gains `provider?: "openrouter" | "vercel"`, written as `"vercel"` on a gateway run and left out otherwise.
- **`GroupRecipe`** gains the same optional `provider`. `readGroupRecipe` keeps it when it is `"vercel"` and drops anything else; `recipeEquals` treats absent and `"openrouter"` as the same; spec 06's chip ends `· Vercel` for a gateway recipe.
- **`ResultMeta`** gains `provider?: "vercel"` and `listPrice?: true`, set by the engine on the filled result.
- **Last-used values** (spec 03, `lastUsed.<medium>` in the preferences store) gain `provider`, and keep the model per provider: `{ provider, model, models: { openrouter?, vercel? }, props }`. A stored value without `provider` reads as OpenRouter.
- Spec 11's imported recipes carry no provider and run through OpenRouter.

### RPC changes

| Method | Change |
| --- | --- |
| `models.list` | input gains `provider?`; `vercel` with medium `video` or `audio` fails `bad_request` with the serves-only sentence |
| `run.image`, `run.text`, `text.complete` | input gains `provider?` (absent is `openrouter`). Validation: the provider's key must exist, else `unavailable` with spec 03's no-key sentence for OpenRouter and the gateway's sentence above |
| `settings.removeVercelKey` | new, as above |
| `vercel.status` | new, as above |
| `models.imagePricing` | unchanged; OpenRouter only (the gateway's prices come with its catalogue) |

`run.video` and `run.audio` take no provider.

### The composer

- **Which providers a tray offers.** `generationProviders(settings)`: OpenRouter with an OpenRouter key, the gateway with a gateway key. Image and text offer both; video offers OpenRouter only; audio is ElevenLabs (spec 15) and shows no switch.
- **The switch.** When the medium is image or text and both keys exist, the prop row starts with a segmented toggle, `aria-label="Provider"`, values `OpenRouter` and `Vercel`. With one provider there is no switch: the tray runs on the one it has.
- **The provider a tray starts on** (`trayProvider`), in order: in recipe mode, the recipe's provider; on a recipe group, its provider; else the last-used provider for the medium; else OpenRouter. When that provider has no key and the other has one, the tray runs on the other, and recipe mode and recipe groups show the warning sentence above.
- **Changing provider** keeps the model when the new catalogue lists it, else takes the provider's last-used model for that medium, else its default. Props are reset to what the new model declares (spec 03's model change rule), and Runs stays.
- **Catalogues** are fetched per medium and provider (`models.list({ medium, provider })`) and cached per pair for the session.
- **Model dialog.** With the gateway it is titled as before and its browse link is `Browse on Vercel`, to `https://vercel.com/ai-gateway/models?type=image` or `…?type=language`. Gateway entries have no `params`, so the image tray offers no model parameters and the model column shows their names.
- **Estimate.** A gateway image model whose `pricing.image` is a finite number shows `$<price × runs>` (spec 03's format); Free shows `<price> / image`. Any other gateway model shows no estimate.
- **No-key blocker.** Image and text block only when neither provider has a key (spec 03's line). Video with only a gateway key blocks with the video sentence above and spec 03's Open Settings button.
- **Video slots** in an image or text run through the gateway are not sent, because the gateway's images and chat endpoints take no video input, and the status band warns `The Vercel AI Gateway takes no video input, so the selected videos are not sent.`
- **Send** adds `provider` to the request when it is the gateway, and saves the last-used values with the provider.
- **Free** (spec 05) sends each output through the tray's provider; its repair call (`text.complete`) goes through the same provider, on the source text result's model when that result was made through it, else the provider's default text model.
- **Recipe groups.** Save as recipe and Update recipe store the tray's provider; Generate from a recipe group's toolbar sends through its provider (switching as above when its key is gone).
- **Last-used values.** A send from recipe mode is not a pick (spec 03), so it stores no model; the provider is stored either way.
- **Results.** `resultLine` (spec 03) becomes `<model> · <w>×<h> · <cost> · Vercel` for a gateway result, where `<cost>` is `≈$0.0300` when `listPrice` is set. A text result's label (spec 05) uses the same cost text.

### The agent

`generate` (spec 14) gains `provider: "openrouter" | "vercel"` (optional). Absent: OpenRouter when it has a key, else the gateway. `medium: "video"` with `provider: "vercel"` is refused with the serves-only sentence. The dry-run answer gains `provider`. The estimate is the gateway list price when there is one, else `null`. A gateway run's cost counts against the connection's spend limit like any other, because it is dollars. The tool's input schema gains `provider` (enum `openrouter`, `vercel`) described as `provider: "openrouter" or "vercel" for image and text; the one with a key when omitted. Video runs through OpenRouter.`, and its description says the person pays OpenRouter or the Vercel AI Gateway.

### Test hooks

Two test-only variables join spec 01's table:

| Variable | Used by | Effect |
| --- | --- | --- |
| `UNFRAMED_TEST_VERCEL_ORIGIN` | 22 | replaces `https://ai-gateway.vercel.sh` in every gateway URL the engine builds. Accepted only under the loopback rule of `UNFRAMED_TEST_OPENROUTER_ORIGIN` (one domain function for all three); any other value is ignored with `  test origin ignored: <value> is not a loopback origin`, so the key can never leave this machine |
| `UNFRAMED_TEST_GATEWAY_LOOKUP_MS` | 22 | the wait between generation lookups, in place of 1500 ms |

Both are read from the process environment only, are inert when unset, and are not part of the hosting contract. The engine-seam harness gains a `vercel` stub option beside its OpenRouter and ElevenLabs stubs.

### Rules this spec bends

1. **Index, The product**: "Generate (one paid model call through OpenRouter, or ElevenLabs for audio)". Image and text runs may go through the Vercel AI Gateway instead. On build the line reads "through OpenRouter or the Vercel AI Gateway, or ElevenLabs for audio", and "holds your OpenRouter, Vercel AI Gateway and ElevenLabs keys".
2. **Index contract 2** is extended: the gateway key never leaves the engine either; the web learns `hasVercelKey` and its last four characters.
3. **Index contract 4** is kept: a gateway run's sidecar has `cost` in dollars, with `costBasis` saying where it came from.
4. **Index, Test seams**: a third stub origin, `UNFRAMED_TEST_VERCEL_ORIGIN`, under the same loopback rule, for spec 15's reason (a second origin for a second API).
5. **Spec 01's `.env.example`** gains three lines; **spec 03's recipe and result meta**, **spec 05's text requests**, **spec 06's group recipe** and **spec 14's `generate`** each gain the optional `provider`.

Nothing in spec 01's hosting contract changes.

## Testing Decisions

A good test drives one of the three seams and asserts on what it exposes: RPC answers and events, the room's shapes, sidecars and `.env` in the data folder, what the stub gateway received, and what a person sees. No test reaches into the gateway client, the run registry or React state.

- **Domain seam** for the rules with many cases: the key and model validators; the gateway catalogue entry mapping (image, text, filtered out, missing name); the list price (flat image price, token prices, missing or garbage prices); the error sentences for each status and body shape; the credits copy; `generationProviders` and `trayProvider` (every key combination, recorded provider without its key); the result line with a provider and a list price; group recipe reading, equality and chip with a provider. Table-driven Vitest.
- **Engine seam** with `UNFRAMED_TEST_VERCEL_ORIGIN` pointed at an in-test stub that records every request and can answer any status and body: settings and removal, the status, both catalogues, `run.image` without and with references, `run.text`, `text.complete`, the cost rules (lookup found, not found then list price, neither), every failure sentence, the provider refusals, `generate` with a provider, and the key never appearing in any answer.
- **Browser seam** for the Settings block in each key combination, the provider switch, the catalogue and model dialog per provider, last-used provider, the video blocker with only a gateway key, a gateway result's line, Regenerate keeping the provider, and recipe groups.
- Prior art: spec 15's ElevenLabs settings and stub tests (a second provider), spec 05's text run tests, spec 03's image run tests.

## Tasks

1. Contracts: `GenerationProvider`; `provider?` on the run requests, `ModelsListRequest`, `ResultRecipe`, `GroupRecipe`, `ResultMeta`; `listPrice?`; settings fields; `VercelStatus`; the two RPC methods. Seam: engine (typecheck plus the RPC answers below).
2. Provider key row and settings rules: `VERCEL_KEY` in `PROVIDER_KEYS`; the three variables, defaults, validators and refusals; `SETTING_OF_VARIABLE`. Seam: domain.
3. Gateway answers: catalogue entry mapping, list price, error sentences, credits copy. Seam: domain.
4. Generation providers: `generationProviders`, `trayProvider` with its warning sentence, the result line with provider and `≈`. Seam: domain.
5. Group recipe rules keep, compare and show `provider`. Seam: domain.
6. Config and settings store: `UNFRAMED_TEST_VERCEL_ORIGIN` accepted only when loopback; the three variables read, defaulted, written, refused and reported; the key in no RPC answer; `.env.example`. Seam: engine.
7. `settings.removeVercelKey` and `vercel.status` (no key, 401, 2xx, 500, network). Seam: engine.
8. `models.list` with `provider: "vercel"` for image and text (filtering, mapping, default appended, no key, failure) and its refusal for video and audio. Seam: engine.
9. `run.image` through the gateway: no key refused; generations without references, edits with them (data URLs, links); the file, the sidecar with `provider` and `costBasis: "list-price"`, the filled result meta with `provider` and `listPrice`; every failure sentence. Seam: engine.
10. `run.text` and `text.complete` through the gateway: the body, the generation lookup found (`costBasis: "gateway"`), not found then the list price, neither; failures. Seam: engine.
11. Agent `generate` with `provider`: default by key, refusal for video, a bad value, a gateway image run's sidecar carrying `chat` and `provider`. Seam: engine.
12. Settings dialog: the Vercel AI Gateway block with only OpenRouter, only the gateway, and both: paste, a bad key's error, the credits line, revoked, two-step remove, the first-key toast, the default model selects, the ElevenLabs line. Seam: browser.
13. Composer: the provider switch with both keys, its absence with one, the catalogue and model dialog per provider, the estimate from a list price, the provider sent and remembered, the video blocker with only a gateway key. Seam: browser.
14. Results and recipes: a gateway result's line with `≈` and `Vercel`; Regenerate keeps the provider; a recipe whose provider lost its key switches with the warning; Save as recipe stores the provider and the group's chip shows it. Seam: browser.
15. Docs: 00-index (product, contract 2, the stub origins, spec 22 in the build order), spec 01's tables and `.env.example`, spec 10's Generation section, spec 14's `generate`, spec 15's ElevenLabs line, BUILD-STATUS. Seam: none (docs).

## Out of Scope

- **Video through the gateway.** The gateway documents video only through the AI SDK's experimental `generateVideo`; there is no public HTTP endpoint (research). Video stays OpenRouter-only until Vercel documents one.
- **Audio through the gateway.** Audio stays ElevenLabs (spec 15).
- **Gemini-style image models through chat completions** (language models whose output includes images). Only `type: "image"` models are listed for image runs.
- **Model parameters for gateway image models** (size, aspect ratio, quality, provider options). The catalogue declares none, so the tray offers none.
- An OAuth or Connect flow: the gateway offers none for third-party apps.
- OIDC tokens, BYOK settings, provider ordering, model fallbacks, budgets management and request tags.
- Streaming answers.
- A per-key spend line: the gateway reads credits per team.
- Retrying a 429 automatically: the run fails with the rate-limit sentence and the person sends again.
- Any change to the desktop shell.

## Further Notes

### Open decisions

These are the person's to make. Each has a recommended default, which is what is built.

1. **Video stays OpenRouter-only.** Recommended, because the only video path is an experimental SDK API. Revisit when Vercel publishes an HTTP endpoint.
2. **Gateway image models get no parameters.** Recommended, because the catalogue declares none and a wrong `size` fails the run. A later change could offer `size` for models known to take it.
3. **Cost from the lookup, else the list price, marked `≈`.** Recommended over leaving `cost: null`, because a spend sum that silently drops gateway runs under-reports. The alternative is `cost: null` and no line.
4. **Default models** `openai/gpt-image-2` and `google/gemini-3.5-flash-lite`, the same ids as OpenRouter's defaults, both listed by the gateway on 2026-11-05.
5. **The composer starts on OpenRouter** when both keys exist and nothing was used yet. The alternative is the gateway first.
6. **Multimodal language models with image output** (Nano Banana and friends) are not offered for image runs through the gateway. They could be added through chat completions' `message.images`.

### Facts relied on, from Vercel's docs, checked 2026-11-05

See `docs/research/vercel-ai-gateway.md`: the base URL, bearer key auth and the `vck_` prefix; `/v1/images/generations` and `/v1/images/edits` with `images[].image_url` taking data URLs; chat completions' OpenAI shape and `id` as the generation id; `/v1/generation` lagging ("Usage event not found"); `/v1/credits` with `balance` and `total_used`; the 401, 402 (`quota_for_entity_exceeded`), 403 and 429 meanings; video only through the AI SDK.
