# Vercel AI Gateway: what Unframed can use

Research for issue #198 ("Support Vercel AI Gateway"). Gathered 2026-11-05 from Vercel's own documentation (the `.md` form of each page under `vercel.com/docs/ai-gateway`) and the live public model list at `https://ai-gateway.vercel.sh/v1/models`. No key was used and no paid call was made.

## Question

Can the Vercel AI Gateway stand beside OpenRouter as a second provider for Unframed's paid runs, and if so, for which media and through which calls? Specifically:

1. How does a local app authenticate?
2. What is the base URL and the API shape?
3. Which of Unframed's media (image, video, text) can it serve, and how?
4. What does the model catalogue answer, and does it carry prices?
5. Can spend, credits or usage be read for a key?
6. What do errors and rate limits look like?

## Short answer

- **Auth is a bearer API key.** A key made in the Vercel dashboard (AI Gateway, API Keys), with `vercel ai-gateway api-keys create`, or through Vercel's REST API with a Vercel access token, sent as `Authorization: Bearer <key>`. The docs show a key as `vck_...` in one example (reporting a leaked key); they do not document a key format, so `vck_` is an inference, not a rule. OIDC tokens are for apps deployed on Vercel, so a local app uses the key. The AI Gateway docs describe no OAuth flow a third-party app can use to obtain a key on a person's behalf, so Unframed takes a pasted key.
- **Base URL `https://ai-gateway.vercel.sh/v1`, OpenAI-compatible.** `POST /v1/chat/completions`, `POST /v1/images/generations`, `POST /v1/images/edits`, `GET /v1/models`, `GET /v1/credits`, `GET /v1/generation?id=`.
- **Text: yes**, through `/v1/chat/completions`, with image parts in the user message for vision models.
- **Image: yes**, two ways. Image-only models (`type: "image"`: FLUX, Seedream, GPT Image, Recraft, Grok Imagine and others) through `/v1/images/generations` (prompt only) and `/v1/images/edits` (prompt plus source images, as `https` or `data:` URLs in a JSON body). Multimodal language models with image output (Gemini image models) through `/v1/chat/completions`, answering `message.images[]`.
- **Video: SDKs only.** Video generation is documented through SDKs: the AI SDK's experimental helpers (`experimental_generateVideo`, `experimental_startVideo`, `experimental_getVideoStatus`) and a beta Python SDK. The docs mention the SDK's internal `/video-model/start` path only in a workaround that "reaches into the provider's wire format". There is no documented REST endpoint Unframed could call without an SDK.
- **Catalogue: public, no key needed.** `GET /v1/models` lists every model with `id`, `name`, `type`, `released`, `modalities.input` and `modalities.output`, `tags` and `pricing`. Only some image models carry a flat `pricing.image` (dollars per image, a string); several carry only token prices (`openai/gpt-image-2`), only `image_dimension_quality_pricing`, or an empty `pricing`. The catalogue declares no per-model parameters for image models (unlike OpenRouter's image catalogue).
- **Spend: readable per team.** `GET /v1/credits` answers `{ balance, total_used }` in dollars, for the team that owns the key. `GET /v1/generation?id=<id>` answers one generation's `total_cost` in dollars (including surcharges, broken out as `surcharge_cost`), but usage is ingested asynchronously, so an immediate lookup can answer "Usage event not found".
- **Cost is not in the chat or image answer body.** The OpenAI-shaped answers carry `usage` tokens only. The cost comes from the generation lookup (chat completion `id` is the generation id) or from the catalogue's list price.
- **Errors use OpenAI's shape**, `{ "error": { "message", "type", "param"?, "code"? } }`, with 401 (bad or revoked key), 402 (no credit, or a budget hit when `type` is `quota_for_entity_exceeded`), 403 (free-tier model limits, allowlists, payment method needed), 404, 429 (rate limit, sometimes with `retry-after`).

## Details

### Authentication

From "AI Gateway API keys" and the REST API reference:

- "Pass an AI Gateway API key in the `Authorization` header. AI Gateway infers the team from the key." `Authorization: Bearer <api_key>`.
- "On Vercel deployments, you can pass the Vercel OIDC token in the `Authorization` header instead." OIDC needs a Vercel deployment, so it does not apply to a local engine.
- A key's value is shown once at creation. The docs' leaked-key example shows the shape `vck_...`.
- A key may have its own budget, and its spend counts against the team budget and, for user-attributed keys, the creator's user budget.
- When a team member leaves, keys they created are deactivated.

### Base URL and API shape

From "AI Gateway REST API Reference" and "OpenAI Chat Completions":

- Base URL: `https://ai-gateway.vercel.sh/v1`.
- Model ids are `creator/model` slugs, often the same as OpenRouter's (`openai/gpt-image-2`, `google/gemini-3.5-flash-lite`), but the two catalogues are not the same list.
- Chat completions take OpenAI's body (`model`, `messages`, `stream`, `max_tokens`, `temperature`, ...) plus gateway extensions (`providerOptions.gateway.order`, `models` for fallbacks). The answer is OpenAI's `chat.completion` object; `id` is the generation id.

### Images

From "Image Generation" and "Image generation with the Chat Completions API":

- "Image-only models use the OpenAI-compatible `/v1/images/generations` endpoint, not `/v1/chat/completions`." Body `{ model, prompt, n?, size?, response_format: "b64_json" }`, answer `{ data: [{ b64_json }] }`. Provider-specific options go under `providerOptions.<provider>` (for example `providerOptions.blackForestLabs.outputFormat`).
- "Image-only models can also edit an existing image. Send one or more source images and a prompt ... to the OpenAI-compatible `/v1/images/edits` endpoint." With a JSON body, "each entry in `images` takes an `image_url` that is either an `https` URL or a base64 `data:` URL". "Support varies by model." File ids are not supported, and edits do not stream.
- "Multimodal LLMs like Nano Banana, Nano Banana Pro, and GPT-5 variants can generate images alongside text using the `/v1/chat/completions` endpoint. Images are returned in the response's `images` array" as `{ type: "image_url", image_url: { url: "data:image/png;base64,..." } }`.
- On the live list fetched 2026-11-05, 23 of the 39 models of `type: "image"` had a flat `pricing.image`; `openai/gpt-image-2` had token prices only, and `bfl/flux-2-pro` had an empty `pricing`. Several language models (Gemini image models among them) list `image` in `modalities.output`. The list changes; these counts are a snapshot, not a property of the API.

### Video

From "Video Generation":

- The page documents the AI SDK's `experimental_generateVideo` function ("experimental and subject to change") and shows a Python example for a beta Python SDK.
- Asynchronous jobs, polling and webhooks are documented through `experimental_startVideo` and `experimental_getVideoStatus`. The only HTTP path named is the SDK's internal `/video-model/start`, described as "the provider's wire format", "a stopgap".
- The catalogue does list 39 video models with `video_capabilities` (operations, resolutions, aspect ratios, durations) and per-second prices. They are reachable only through the AI SDK.

### Text

From "Text Generation" and "OpenAI Chat Completions": `/v1/chat/completions` with a `messages` array. Image input is a content part `{ type: "image_url", image_url: { url } }` with an `https` or `data:` URL. The catalogue's `modalities.input` says which models read images.

### Catalogue

`GET /v1/models`, "No API key required" (the docs' `llms.txt` index). Fields used here:

| Field | Meaning |
| --- | --- |
| `id` | `creator/model` slug |
| `name` | display name |
| `type` | `language`, `image`, `video`, `embedding`, `speech`, `transcription`, `reranking`, `realtime`, `evaluation` |
| `released` | Unix seconds of the provider's release |
| `modalities.input`, `modalities.output` | lists such as `text`, `image`, `video` |
| `pricing.input`, `pricing.output` | dollars per token, as strings (language models) |
| `pricing.image` | dollars per generated image, as a string; present only on image models with a flat price |
| `pricing.image_dimension_quality_pricing` | prices by size, quality or style, when they vary |

### Spend and usage

From the REST API reference and "Usage":

- `GET /v1/credits` → `{ "balance": "95.50", "total_used": "4.50" }`: "Remaining credit balance, in USD" and "Total credits used to date, in USD". This is the team's balance, not the key's.
- `GET /v1/generation?id={generation_id}` → `{ data: { id, total_cost, usage, model, is_byok, provider_name, ... } }`. "Usage events are ingested asynchronously, so a lookup issued immediately after the generation completes returns `Usage event not found` rather than the record. Allow a few seconds."
- "Generation IDs are returned on every chat completion response as the `id` field." The images endpoints document no generation id.
- Vercel states it adds no markup to provider token prices. A generation's `total_cost` can still include surcharges (`surcharge_cost`, for example Zero Data Retention or Custom Reporting writes), and negotiated discounts or BYOK change what is billed. So a catalogue list price is an estimate of a run's cost, not a measurement.

### Errors and rate limits

From "OpenAI Chat Completions" (error format), the FAQ and "Rate limits":

| Status | Cause |
| --- | --- |
| 400 | invalid request |
| 401 | key missing, invalid or revoked |
| 402 | no positive credit balance; with `type: "quota_for_entity_exceeded"`, a team, project, key or user budget was reached |
| 403 | `customer_verification_required` (add a payment method), a model outside the free tier, or a model or provider allowlist |
| 404 | model or endpoint not found |
| 429 | rate limit (free tier: a lower limit per model; paid tier: only the provider's), sometimes with `retry-after` |

Body: `{ "error": { "message": "...", "type": "invalid_request_error", "param": "model", "code": "missing_parameter" } }`. A provider's own 429 "can carry that provider's own error body instead of the AI Gateway error shape".

## What this means for Unframed

- Text and image runs can go through the gateway with plain `fetch`, the same way they go to OpenRouter today. Video cannot without taking an SDK as a dependency and relying on an experimental API; it stays OpenRouter-only.
- An image model without a flat `pricing.image` gets no cost from Unframed: the images endpoints return no generation id to look up. The default image model should be flat-priced.
- The key can only be pasted (no OAuth). Its status in Settings is the team's credit balance and total used, from `/v1/credits`.
- A run's cost is the generation lookup's `total_cost` when it is found in time, else the catalogue's list price, and the sidecar must say which.

## Sources

- AI Gateway overview: https://vercel.com/docs/ai-gateway
- REST API reference: https://vercel.com/docs/ai-gateway/sdks-and-apis/rest-api
- API keys: https://vercel.com/docs/ai-gateway/authentication-and-byok/api-keys
- Image generation: https://vercel.com/docs/ai-gateway/modalities/image-generation
- Image generation with Chat Completions and the images endpoints: https://vercel.com/docs/ai-gateway/modalities/image-generation/openai
- Video generation: https://vercel.com/docs/ai-gateway/modalities/video-generation
- OpenAI Chat Completions (error format): https://vercel.com/docs/ai-gateway/sdks-and-apis/openai-chat-completions
- Usage and generation lookup: https://vercel.com/docs/ai-gateway/observability-and-spend/usage
- Rate limits: https://vercel.com/docs/ai-gateway/rate-limits
- FAQ (error table): https://vercel.com/docs/ai-gateway/faq
- Live model list: https://ai-gateway.vercel.sh/v1/models
