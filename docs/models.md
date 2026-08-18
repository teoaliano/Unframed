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
partial batch keeps its successes (`2 of 3 succeeded`). Cap is 10 everywhere — `MAX_RUNS`
in `resolve.js`, which is where truncation is computed, so the UI quotes it rather than
keeping a second copy.

Free mode takes the run count from the flow. Its list comes from the lowest-Y wired
**text output**, or — only when none is wired — the lowest-Y wired **prompt** node, whose
`@id` references are expanded before splitting. Precedence rather than lowest-Y across
both kinds: an existing Free graph with a context prompt above its text output would
otherwise silently change which node supplies the list, and a batch built from the wrong
text is only noticed after it is paid for. `splitSections` cuts the text on standalone
`---` lines; fewer than two blocks triggers one repair call through `/api/text`.

The repair prompt is load-bearing and is not a "split this up" instruction. Asked
merely to split, models copy the whole text N times: a real batch came back as three
identical prompts each still reading "3 versions of …", so every image rendered three
subjects and the run cost triple for one result. Two clauses earn their place — each
section must read as a complete prompt on its own, and a text that is not a list
comes back untouched rather than chopped into fragments that each bill as a
generation.

**A section can name the images it uses.** `images: 2, 5` on a section's first line — the
badge numbers the canvas already shows — sends only those, and the line is stripped before
the prompt travels. Only a bare list of positive integers counts, and the line is deleted
only once it has yielded at least one usable number: `Image: 3 women in a row` is an
ordinary caption, and the repair prompt teaches the model this very keyword, so stripping
on the keyword alone turned a described image into the shared context by itself — the
description gone, the generation paid for. A stray bookkeeping line left in a prompt is the
cheaper mistake, so that is the one the rule makes. No line means every image, which is what every run got before
directives existed, so a text model that ignores the syntax degrades to the old behaviour
rather than to a broken one. Within a section, a picked image is referred to by its
position in that line: the first listed is "image 1" for that run, because the provider
only ever sees the attachments it is handed. The repair prompt is told the attached count
and that renumbering rule; a hand-written text output emitting the same lines parses
identically. Out-of-range numbers are dropped and noted, and a directive whose numbers all
miss falls back to every image rather than a paid run with no reference at all. A section
left with nothing but its directive is not a run: `freeBatch` drops it and reports how many,
since running it would bill for the shared context alone, and a list of nothing but
directives raises the same "no sections" error as a list of nothing but separators. The note
is rendered on the node itself — truncation, skipped sections, dropped images, a re-split
count — not just logged.

One caveat the code cannot state: a *separate* prompt node that stays in the shared context
and refers to images by number can contradict a run's renumbering, since the shared text is
prepended verbatim. Let the list source own the image references.

`freeBatch` in `resolve.js` is the single seam from list text to the runs that get sent —
split, directive parse, prompt assembly, per-run references. The **View final prompt**
checkbox (Free only, `data.previewPrompt`) stages a built batch and opens a dialog that
derives its rows from that same call, so what is previewed cannot drift from what is sent;
confirming reuses the staged `batchId` and makes no second text call. It exists to make
prompt-tuning free and is expected to be removed once the repair prompt settles.
`freeRunPrompts`, `parseImagePicks`, `runReferences` and `freeBatch` have tests in
`resolve.test.js`, so extend them if insertion changes prompt assembly.
