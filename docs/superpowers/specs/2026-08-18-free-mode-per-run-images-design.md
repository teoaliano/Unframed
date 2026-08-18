# Free mode: prompt sources, per-run images, and a preview gate

Date: 2026-08-18
Status: designed, not implemented

Three changes to the image output node's Free mode, in the order they were asked for.
They share one pipeline and are specified together because the second is unusable
without the first and untestable without the third.

## Why

Free mode today demands a wired **text output** and splits its `result` on `---`
lines. A user wired a plain prompt node describing nine images and found Generate
disabled, expecting a text model to rewrite the prose into nine prompts. That
rewrite already exists — the repair call in `ImageOutputNode.jsx` — but the gate on
`isTextOutput` sits upstream of it, so it never runs.

Behind that: `input_references` is built once, before the split, and every prompt in
the batch reuses the whole array. Nine runs over ten wired images send ninety image
inputs to get the eighteen the user wanted, and pay for all ninety. Nothing in the
graph can express "one of these per run".

## 1. A prompt node can be the Free source

`findWiredTextNode` becomes `findFreeSource` — the old name would lie about what it
returns, and it has only two callers. Precedence, not a shared pool:

1. the lowest-Y wired **text output**, exactly as today;
2. only if none is wired, the lowest-Y wired **prompt** node.

Precedence rather than "lowest-Y wins among both" is the load-bearing part. An
existing Free graph with a context prompt sitting above its text output would
otherwise silently switch which node supplies the list, and the symptom — a batch
built from the wrong text — costs money before it is noticed. Layerize's preset
(`library/layerize.js`) wires a real text output, so it keeps today's behaviour.

Reading the source text differs by type, so `resolve.js` exports one helper for it:
a text output yields `data.result` verbatim (never re-scanned for `@` tokens, per the
existing rule); a prompt node yields `data.text` with `@id` references substituted,
so `@p-1787051788659` expands before splitting instead of travelling as a literal
token. The "no result yet, run it first" guard applies to text outputs only; an empty
prompt node reports that it is empty.

`freeRunPrompts` blanks **both** `text` and `result` on the list node rather than
branching on its type — correct for either kind, one branch fewer, and it preserves
the existing intent that `@the-list-node` resolves to nothing rather than smuggling
the whole list back into the shared context.

Consequence to accept: typed prose almost never contains `---`, so a prompt-node
source takes the repair path on nearly every Generate. That is one text call per
click, which is the cheap half of the batch and the reason the preview gate below is
worth building.

## 2. Per-run images, chosen by the text model

**Rejected first:** a per-image toggle on the image node ("every run" / "one run
each"). Mechanical, and it asks the user to hold the distribution rule in their head
while wiring. The text model already reads the prose that explains the intent; it
should carry the decision.

**Syntax.** A section may open with a line naming the images that section uses:

```
images: 2, 5
A hand, palm forward, ...
```

The numbers are the badge numbers the canvas already shows — the Y-ordered, per-kind
numbering `sourceRoles` renders on each image node, so what the user sees on the
canvas is what the directive means. The line is stripped from the prompt only once it
has yielded a usable pick, per **Parsing** below; otherwise it is left in place as
ordinary text. **No line means every image**, which is exactly today's behaviour and
matches the stated expectation: not asking for a split gets everything.

**Parsing** is pure, in `resolve.js`, tested. The directive is recognised only on the
first non-empty line of a block, and only when that whole line is a bare list of
positive integers — `images: 2, 5`, nothing else on it. A caption that merely opens
with the word, like "Image: 3 women standing in a row, studio light", fails that match
and stays in the prompt untouched. The asymmetry is deliberate: a stray bookkeeping
line left in a prompt is noise, while a description deleted by a false match is a paid
image of something nobody asked for — so the line is deleted only once it is confirmed
to name something usable, never on the strength of the keyword alone. A section that
turns out to be nothing but a directive, with no prose left once the line is gone, is
dropped by `freeBatch` rather than run — it would otherwise bill for the shared context
alone, exactly what the node's no-sections guard exists to prevent. Numbers are
comma- or space-separated; duplicates collapse; **listed order is preserved**, because
that order defines the run's numbering (below).

**Applying** them is a second pure function so the mapping is testable apart from the
parse. It resolves pick *n* to the *n*th **image** reference, appends any wired videos
unchanged (an image output already warns that it sends and ignores them — that stays),
and returns one run's `input_references`. `buildRequest`'s node→reference mapping is
extracted so both callers share it.

**Numbering inside a section.** When a run attaches images 2 and 5, the provider sees
two attachments; "image 5" means nothing to it. The rule, and the instruction given to
the repair model: refer to picked images by their position in the `images:` line — the
first listed is "image 1" for that run. This is the part with real risk. The syntax is
trivial for a text model; consistent renumbering inside the prose is the behaviour to
test against awkward prompts, which is what section 3 is for.

**Known limitation, stated rather than fixed:** a *separate* prompt node that stays in
the shared context and refers to images by number can contradict a run's renumbering,
since the shared text is prepended verbatim. The fix is editorial — let the list source
own the image references — not code.

**Error handling.** Out-of-range numbers are dropped and noted. A directive whose
numbers all fall out of range falls back to every image with a note, rather than
generating with zero references; the preview gate is where such a note gets seen, and
a re-run costs one text call. Notes surface per run in the preview and, collapsed, in
the batch note the node already renders.

**Repair prompt.** Gains the attached-image count (known client-side, stated exactly:
"8 images are attached, numbered 1 to 8"), the directive syntax, the omit-it-to-send-
everything rule, and the per-section renumbering instruction. The existing clauses stay
— they are load-bearing for a reason `docs/models.md` records.

A hand-written text output emitting `images:` lines parses identically. One code path,
and it is how a user takes manual control without depending on the repair model.

## 3. "View final prompt" — a preview gate

A `CheckboxInput` labelled **View final prompt**, shown only under Free, persisted as
`data.previewPrompt` (joining `runs`/`freeRuns` in the list of keys deliberately absent
from `OUTPUT_DEFAULTS`, since it is a batch behaviour rather than a model trait).
Temporary by intent: it exists to iterate on the repair prompt cheaply, and removing it
later should cost one checkbox and one dialog.

**Flow.** Generate runs the whole pipeline up to the image calls — source, split, repair
call, directive parse, prompt assembly — then stops, clears the `running` marker (leaving
it set would freeze the button behind its own disabled guard), stages the batch in
component state, and opens a `Dialog`. Staging is component state, not node data: it is
transient, and autosaving a prompt blob into `graph.json` on every edit is wrong. Losing
it on unmount is acceptable — nothing has been spent but the text call.

**Contents.** One editable `TextArea` holding the list text as the pipeline has it at
that moment — the repair model's output when repair ran, the source node's own text when
it did not — with sections, `---` separators and `images:` lines intact. Above it, read-only, the
shared context every run receives, with a line stating that each run is shared + `\n\n` +
its section; together those are the final prompt, without building a second view of it.
Below it, derived live from the textarea, one row per run: `Run 1 · images 1, 5` (or
`all images`), plus that run's notes. That row is the parse feedback — it shows how the
directive was *read*, not merely what the model typed.

Editing re-derives the rows and, on confirm, re-runs split → parse → assemble on the
edited text, so the 10-run cap and its "list had 14 items" note apply to an edited list
exactly as to a generated one. **No second text call.** Edits are transient and are not written back to the
text node, whose `result` must stay the model's actual output.

Buttons: Cancel, and `Generate N×`. Confirm reads live `getNodes()`/`getEdges()`, so an
image wired while the dialog is open resolves against the graph as it is at confirm time.

The gate is Free-only: with the checkbox off, or in fixed-run mode where it is not
shown, Generate behaves exactly as today.

## Testing

Pure logic in `resolve.test.js`: source precedence (text output wins, prompt fallback,
Y-order within a kind), `@id` substitution before splitting, both fields blanked in the
shared context, directive recognised on the first line only and ignored mid-prose,
duplicates collapsed and order preserved, invalid numbers dropped, all-invalid falling
back to every image, picks resolving to badge numbers in listed order with videos
appended, and no-directive matching `buildRequest`'s array.

Node components have no tests by design, so the dialog, the checkbox and the repair
prompt are verified in the running app. The preview gate makes that verification free:
edge-case prompts can be run to the staged batch and read without a single image
generated.

## Out of scope

- Free mode on the video output node — it has none today.
- Per-run directives selecting videos.
- Persisting edited preview text back to the text node.
- The rejected per-image toggle.
