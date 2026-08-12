# Models and the catalogues

How a model gets chosen, and how the controls beside it are decided. Read this
before touching `/api/models`, the model picker, or any Size/Quality/Ratio
control. Core rules are in `CLAUDE.md`.

## Two catalogues, and a third that is not documented

- `/api/models` returns image models, via the load-bearing `?output_modalities=image`
  upstream filter.
- `/api/models?type=text` returns vision-capable text models, because a text output
  can always have images wired into it.
- `/api/models?type=video` returns video models.

`kind` in the client (`useModels(kind)`, `useModelParams(entry, kind)`) is always
this **catalogue** name — `image` / `video` / `text` — never a node type id. Do not
"align" `listModels('text')` with the `textOutput` node id; they are different
things that happen to share a word.

**Which video models take video IN is not in the documented API.**
`/api/v1/videos/models` has no modality field, and video models are absent from
`/api/v1/models`, where `architecture.input_modalities` lives. `loadVideoInputSlugs()`
therefore reads `/api/frontend/v1/models/find?input_modalities=video` — the endpoint
behind the site's own filter, unofficial but exact (6 of 6). A failure yields an
empty set and `acceptsVideo: null`, and the video output only warns on an explicit
`false`: **unknown must never render as "does not accept"**. Do not replace this
with a heuristic over pricing SKUs — that was tried, matched the count, and missed
the set.

## The controls are driven by the selected model

`OPENROUTER_IMAGE_MODEL` accepts any image slug OpenRouter lists, and is only the
*default* — every node has its own picker, and the three env models decide what a
fresh node starts on.

Size / Quality / Ratio are **not a fixed list**. `/api/models` proxies OpenRouter's
`/api/v1/images/models`, whose `supported_parameters` is a typed map per model; the
node renders a control only when that model declares the param, offering exactly its
values. A value the model doesn't declare is never sent.

(The general `/api/v1/models` listing also has a `supported_parameters`, but it is
the *chat* one — temperature, top_p — and never mentions an image param. That is why
these controls were guesswork before.)

The server forwards only params that are set, and treats `quality: 'auto'` as unset.

**Exact sizes replace the resolution + ratio pair.** Where a video model declares
`supported_sizes` (14 of 22), the Size control offers those exact `WIDTHxHEIGHT`
dimensions *instead of* the tier + ratio pair, and sends `size` alone. OpenRouter
documents the two as interchangeable, so offering both would let you ask for 720p at
a ratio the model only renders at 1080p. Options are labelled with their ratio
(`1470x630 · 21:9`, snapped to the nearest common ratio within 2%), since a pixel
pair is hard to choose by.

**The picker tags each row with what actually differs** — top resolution tier,
`transparent`, `quality`, `seed`, plus durations and audio for video. The
near-universal params are omitted, so an empty row means "nothing unusual" rather
than "nothing known".

## Multi-run

N runs are N ordinary `/api/generate` calls fired with `Promise.allSettled`, so a
partial batch keeps its successes (`2 of 3 succeeded`). Cap is 10 everywhere.

Free mode takes the run count from a wired text output: `splitSections` in
`resolve.js` cuts its result on standalone `---` lines. Fewer than two blocks
triggers one repair call through `/api/text` before falling back to a single run.

The repair prompt is load-bearing and is not a "split this up" instruction. Asked
merely to split, models copy the whole text N times: a real batch came back as three
identical prompts each still reading "3 versions of …", so every image rendered three
subjects and the run cost triple for one result. Two clauses earn their place — each
section must read as a complete prompt on its own, and a text that is not a list
comes back untouched rather than chopped into fragments that each bill as a
generation. It lives in `ImageOutputNode.jsx`; `freeRunPrompts` has tests in
`resolve.test.js`, so extend them if insertion changes prompt assembly.
