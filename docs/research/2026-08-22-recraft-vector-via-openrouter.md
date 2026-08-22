# Recraft's vector models through OpenRouter — research notes

Researched 2026-08-22, prompted by a run that wired an image into an `imageOutput`
node on `recraft/recraft-v4.1-pro-vector` and got back an SVG bearing no resemblance
to the input. First-party sources only — Recraft's own API reference and pricing
page, OpenRouter's image-generation guide and live catalogue. Every factual line
carries the URL that owns it, and what the docs do not answer is in
[Unknown / not documented](#unknown--not-documented) rather than inferred.

Primary sources used:

- Recraft API endpoints reference — <https://www.recraft.ai/docs/api-reference/endpoints.md>
- Recraft API pricing — <https://www.recraft.ai/docs/api-reference/pricing.md>
- OpenRouter image generation guide — <https://openrouter.ai/docs/guides/overview/multimodal/image-generation.md>
- OpenRouter image catalogue — `GET https://openrouter.ai/api/v1/images/models`
- OpenRouter per-model endpoints — `GET https://openrouter.ai/api/v1/images/models/<slug>/endpoints`

## 1. "Vectorize" is a different endpoint, and OpenRouter does not expose it

Recraft ships raster-to-SVG conversion as its own endpoint,
`POST https://external.api.recraft.ai/v1/images/vectorize`, described as "Converts a
given raster image to SVG format." Its only parameter besides the image is
`response_format`; there is no prompt (endpoints reference, "Vectorize image"). That
is the operation "turn this picture into a vector" names.

Recraft's *generation* endpoints are separate, and the one that takes an image is
`POST /v1/images/imageToImage`: "create images similar to a given image, preserving
certain aspects like composition, color, or subject identity while altering others
based on the prompt", with a **required** `strength` float in `[0, 1]` where "`0`
means almost identical, and `1` means minimal similarity" (endpoints reference,
"Image to image").

OpenRouter's image API is a generation API. Its `input_references` field is
documented as "Reference images for image-to-image generation" and demonstrated with
the prompt "make this scene look like a watercolor painting" (image-generation
guide). There is no `vectorize` route in it.

**So a raster wired into a Recraft vector model on OpenRouter is a reference for a
fresh drawing, not a source to trace.** Nothing in this repo is dropping the image —
the sidecar of the run that prompted this records `referenceCount: 1` and the request
carried it.

## 2. There is no fidelity control to turn up either

`strength` is required by Recraft's own `imageToImage` endpoint but is not part of
OpenRouter's request schema, and OpenRouter's per-model endpoint metadata lists
exactly which provider-native parameters may be passed through:

```
recraft/recraft-v4.1-pro-vector → allowed_passthrough_parameters: ["style", "controls", "text_layout"]
```

`strength` is not among them. So on OpenRouter the reference influences the result at
whatever weight the provider picks, and there is no way to ask for "closer to the
input".

## 3. Every image model states how many references it takes

`input_references` appears in the image catalogue's `supported_parameters` as a
`{type: "range", min, max}` — a third shape beside the typed enums and video's plain
arrays. All 43 image models declare one; the ceilings run from 1 (every Recraft
model, MAI, Krea) to 16 (the GPT Image family), with Gemini and Seedream at 14 and
Flux at 8 (catalogue read 2026-08-22).

This is what the image output node's over-cap warning reads. Before it existed, four
images wired into a Recraft output were all sent and OpenRouter decided.

## 4. Pricing is flat per image, and the two sources agree

OpenRouter's per-model endpoint metadata gives Pro Vector a single SKU:

```json
{"billable": "output_image", "unit": "image", "cost_usd": 0.3}
```

Recraft's own pricing page lists "Vector image generation – Recraft V4.1 Pro Vector"
at **$0.30 per image**, and the plain V4.1 Vector at **$0.08 per image**. No token
term, no charge for the input image. The sidecars from the run that prompted this
record `cost: 0.3` and `cost: 0.08` respectively, so the billed figure matches the
published one.

**The comparison worth knowing:** Recraft prices "Image vectorization" — the
`vectorize` endpoint of §1 — at **$0.01 per request**. Asking a Pro Vector generation
to stand in for it costs 30× and does not do the same thing.

## 5. `output_format` on the vector models accepts exactly one value

The four vector models (`recraft-v4.1-pro-vector`, `recraft-v4.1-vector`,
`recraft-v4-pro-vector`, `recraft-v4-vector`) declare
`output_format: {type: "enum", values: ["svg"]}` and nothing else. Only 10 of the 43
image models declare `output_format` at all; the other 33 have no such parameter, and
sending one to them was this app sending a value the catalogue never offered.

## Unknown / not documented

- **What weight OpenRouter gives a reference on a Recraft model.** `strength` is
  required by Recraft and absent from OpenRouter's schema and passthrough list, so
  some value is being chosen somewhere. Neither side documents which.
- **Whether an over-cap request is rejected or silently truncated.** OpenRouter says
  only that "the number of references accepted varies by provider"
  (image-generation guide); it does not say what happens past the maximum. Untested
  here on purpose — finding out costs a paid generation if it is *not* rejected. The
  node warns before the click rather than relying on either behaviour.
- **Whether OpenRouter intends to expose `vectorize`, `removeBackground` or the other
  Recraft utility endpoints.** They are absent from the image catalogue, and no
  OpenRouter doc mentions them.
- **Which of a model's several endpoints a request routes to** when the catalogue
  lists more than one at differing prices. `estimateImageCost` shows nothing in that
  case rather than picking one.
