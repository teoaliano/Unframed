# Node anatomy: a docked tab, an empty box, and a line below

*2026-08-20*

## Why

An input node is mostly a picture, and the picture was the smallest part of it. A
`240px` image node spent a `28px` title bar on a name you already knew from the icon,
`10px` of body padding on every side of the thing you were trying to look at, and four
rounded corners on the thing itself. The clip nodes were worse: the transport row sat
inside the card, so a video node was a title bar, a clip, and a control strip, in a box
whose corners bit into all three.

The redesign is one move, applied everywhere: **the box holds content only.** The name,
the connection role, the `@id` and the run cost all leave the card. What is left inside
is the picture, the clip, the prompt field, or the output's controls — and nothing else.

That move is worth more than the pixels it recovers. It is what lets an image run edge
to edge, and it is what makes all six node types the same shape as each other for the
first time: a **tab**, a **box**, and a **line below**.

The design was worked out on a canvas of eleven boards
(prompt/image/video directions A, C, D, E; states; zoom; and four boards on C alone).
The rejected directions are recorded at the end of this file rather than in the canvas,
which is scaffolding.

## The anatomy

Every node — all six types, both families — is three parts stacked in a column:

```
[tab]                 <- docked on the card's top edge, shares its border
+---------------+
|               |     <- the card: content only
|               |
+---------------+
· role / @id / cost   <- one line, left-aligned under the tab
```

### The tab

Docked top-left, `22px` tall, `border-radius: 8px 8px 0 0`, `border-bottom: none` and
`margin-bottom: -1px` so its bottom border and the card's top border are one line. Type
is `11px` uppercase, `letter-spacing: 0.06em`, weight 500, with the type's `12px` icon
from `nodeIcons.jsx`.

`NodeHeader` becomes this component. It already takes a `family` prop and already
decides the accent from it; what changes is what it renders, not what it knows.

- **Input**: surface fill, `--color-border-emphasized` border, `--color-text-secondary`
  ink.
- **Output**: `--color-accent` fill, accent border, `--color-on-accent` ink.

**The tab is the only thing that tells the two families apart by colour.** The accent
border that used to ring every output card is gone (see below), so the family signal is
carried by the tab's *fill*. That has one consequence worth stating in advance: it means
selection cannot also be a filled tab, which is why selection is a border (§ Selection).

### The card

`1px solid --color-border-emphasized`, on **both families**. The output's accent border
is removed. `--color-background-card` fill, `overflow: clip`, flex column.

Radius depends on what is inside, not on which family the node is in:

| Node | Radius |
| --- | --- |
| `image`, `video` | `0` |
| `prompt`, `imageOutput`, `videoOutput`, `textOutput` | `0 12px 12px 12px` |

**Media squares off because a radius deletes part of the picture.** A container radius
softens *chrome*; a reference image is not chrome, it is the thing being judged, and
four rounded corners are four small bites out of every reference on the canvas. A prompt
field and an output's controls have nothing reaching the corner, so they keep
`--radius-container`.

The top-left is `0` on the rounded types so the tab has a straight edge to dock into.
**When the tab hides at low zoom, that corner rounds back to `12px`**, cross-faded with
the tab over `--duration-fast` — otherwise a tabless card reads as chipped. The media
types have no such transition: they are square in both states, which is the second thing
squaring them bought.

### The line below

`margin-top: 7px`, left-aligned under the tab, same `11px`/uppercase/`0.06em` type as
the tab. It carries exactly one fact, and which fact depends on what the node has:

| Node | Line below |
| --- | --- |
| `image`, `video` | the connection role from `sourceRoles` — `image 1`, `image 1 / 2`, `first frame`, `image 1 / —`; `not connected`; absent when the node holds no file |
| `prompt` | its `@id` |
| `imageOutput`, `videoOutput`, `textOutput` | what the run cost, plus the result count and the video estimate |

A live role gets a `5px` accent dot and weight 500. Everything else — `not connected`,
an `@id`, a cost — is `--color-text-secondary` at weight 400 with no dot, so "this feeds
something" and "this is just a fact about the node" never read alike.

**`sourceRoles` returns a bare `"1"`, and the line below spells it out** — `image 1`
rather than `1`. In the old header the word "image" sat two inches to the left; out here
there is nothing nearby to say what is being counted. The two-consumer case is where it
pays: `image 1 / 2` is legible where `1 / 2` is a riddle.

### Handles

Unchanged: `16px` accent dot, `2px` surface border, `32px` transparent target. Right for
inputs, left for outputs. The handle keeps its `z-index: 2` over the resize strips.

## The video transport stays outside the clip

`VideoPlayer` already moved its controls out of the `<video>` element, and its own
comment says why: native controls live in shadow DOM, so a press on the timeline
retargets to the `<video>` and nothing downstream can tell a scrub from a node drag.
That constraint is **load-bearing for this design and is easy to undo by accident** —
the obvious "clean" move is a transport overlaid on the bottom of the clip, and it costs
the node its drag surface.

So the transport sits between the card and the line below. A video node reads: tab,
clip, transport, role. Nothing pressable is ever drawn on top of the media.

## The output footer is dismantled

`CostFoot` renders `.xnode-foot`: a bordered strip carrying the cost, plus whatever the
call site passes through `before` and `after`. Those contents do not all belong in the
same place.

- **The cost, the result count and the video estimate are labels** reporting on the node
  as a whole. They are the same kind of thing as an input's connection role, so they go
  where that goes: the line below.
- **`ImageOutputNode`'s Clear button is a control.** It cannot follow them out. A
  control loose on the canvas sits on the pane rather than on any node, so it has to
  fight the drag surface for its own press and has no `nodrag` ancestor to opt out of.
  It moves *into* the body, next to the results strip it empties — which is where it
  belonged anyway, since it acts on that strip and nothing else. It stays labelled
  `Clear`; the count is already on the line below and saying it twice is worse than
  saying it once.

`CostFoot` therefore stops being a footer and becomes the same small component the input
nodes use for their role line. `.xnode-foot`, `.xnode-foot-end` and the accent
`border-top` go with it.

## Zoom

The tab and the line below are **part of the node**: they scale with the canvas, like
everything else in it. No counter-scaling, no chrome that stays `11px` while the node it
names becomes a thumbnail.

What that costs is that a label stops being *readable* well before it stops being
*drawn* — at `0.35×` an `11px` tab is under `4px` — so the show/hide threshold is really
"the zoom at which this type still resolves":

| Zoom | Tab and line below |
| --- | --- |
| below `0.5` | hidden |
| `0.5` – `0.75` | hidden at rest, shown on hover |
| `0.75` and up | always shown |

Driven by one CSS variable off React Flow's zoom, not by per-node measurement. **The
numbers are a starting point from drawing, not from use** — they are expected to move
once the thing is on a real canvas.

Below the threshold the card's top-left radius transitions as described above, and the
whole family signal disappears with the tab: see "Left open".

## Interaction states

- **Hover** — the tab's ink promotes to primary, the card border steps to
  `--color-text-secondary`, the remove chip appears on media, and the edge under the
  pointer lights up `3px` accent. Nothing moves; there is no layout shift on hover.
- **The resize edges become visible.** `MediaResize`'s four strips draw nothing at all
  today, and `styles.css` says so explicitly ("Invisible full stop — not even on hover
  … the node is due a redesign that will decide what an affordance here should look
  like"). This is that decision: the pointed edge lights, the cursor does the rest.
- **Selected** — a doubled accent border: `border-color: --color-accent` plus
  `inset 0 0 0 1px` on the card, and the equivalent on the tab where the tab is not
  already accent.

  **Why not the offset ring every node uses today.** The silhouette is notched — a tab
  narrower than the card sitting on its top edge — and an `outline` with an
  `outline-offset` traces the bounding box, leaving the tab hanging outside its own
  selection ring. Two alternatives were drawn and rejected below.

  The doubled border only works because **both families now start from the same neutral
  border**. `styles.css` records why it did not work before: the output's border was
  already accent, so a flush ring "would just read as a thicker border". Unifying the
  borders is what made the cheapest selection signal viable, and the two decisions
  cannot be separated — reintroducing an accent output border silently breaks selection
  on outputs.

## Resize

All four edges, as today. One change: **the prompt node moves from a CSS `resize: both`
on its field to node-wrapper resizing on the card**, which means it stores both a
`width` and a `height` in node data.

That is a genuinely new shape. `starter.js` currently writes a `width` for `image` and
`video` only, and deliberately never writes a height — "while it is undefined the
media's own aspect ratio computes it, which is what makes a resize keep the picture's
proportions exactly." A prompt has no aspect ratio to preserve, so it needs both
dimensions, and `withDrag` has to stop treating a size as a media-only concern.
`fieldResize.js` and `data.size` are no longer needed for `PromptNode` (they remain for
`TextOutputNode`'s two fields).

## Everything else that squares

Media is square wherever it appears, not only on the input nodes:

- the generated result thumbnails in `ImageOutputNode`'s strip;
- the video result in `VideoOutputNode`;
- the empty-state drop region and the remove chip, which otherwise read as rounded
  stickers on a square node.

## Left open

Four things this spec deliberately does not settle. They are cheap to change and want
real use, not more drawing.

- **The zoom thresholds** (`0.5` / `0.75`), per above.
- **The family signal below the threshold.** The output's accent border was the only
  family cue that survived a zoomed-out canvas — down there the tab is hidden, the line
  below is hidden, and a text output's body is a grey box like any other. So a
  zoomed-out canvas now says where the nodes are but not which way the work flows. The
  cheap fix, if it turns out to matter, is letting an output's *handle* keep the accent
  while an input's goes neutral: a dot still reads at `0.35×`. Not built, because it is
  a guess about a feeling.
- **The corner cross-fade on `prompt` and the three outputs.** The transition is
  specified; whether it reads as deliberate or as a glitch is a thing to watch, and the
  fallback is keeping those corners square permanently.
- **Whether the tab is enough of a "grab here".** The title bar was the one strip that
  was nothing but a drag handle, and it is gone. The whole card already drags
  (`2026-08-18-canvas-interaction-design.md`), so nothing breaks — but the visible
  affordance does. The tab is the closest thing left to one.

## Rejected

- **A bare text label floating above the node** (direction A, and the closest to the
  original sketch). No second frame, nothing but type on the canvas. Rejected because
  unboxed text collides with whatever sits behind it, and because the docked tab reads
  as belonging to its node in a way floating text does not.
- **A floating chip** on the toolbar's surface-and-shadow recipe (direction B). Always
  legible over anything, but twenty nodes means twenty little shadows, and it reads as
  UI hovering over the canvas rather than as part of a node.
- **All chrome below the node** (direction D): one rail under every node, name and role
  together, since the video needed a row down there anyway. Its real argument was that
  the card's top edge would then be the node's true top edge — what you aim at when
  dragging or aligning. Rejected because you meet the picture before its name, and
  because the tab turned out to be worth having as the last visible grab affordance.
- **A ghost header revealed inside the node** (direction E): chrome painted over the
  node's own first `26px`, present only on hover or past the threshold, so a node at rest
  occupies exactly its rectangle. Rejected because it covers the top of the picture at
  precisely the zoom where you were inspecting it, and because the video's transport
  cannot hide, so video breaks the pattern.
- **The role badge inside the frame** on a scrim (the first version of the chosen
  direction). It needs a scrim to survive an arbitrary picture, and the scrim is the
  thing covering the picture. Moving it below removed the contrast problem and the
  overlay in one step.
- **A solid pill for the role line.** Legible, and far too much ink repeated under every
  wired node once it no longer needs to survive on top of a photograph.
- **The role line right-aligned.** Tab top-left and role bottom-right makes a diagonal
  rather than a column, but it drifts toward the handle and the wire leaving it.
- **Counter-scaled labels that hold `11px` at every zoom**, like a frame name. Readable
  at `0.35×`, where a scaled label is `4px` — and it makes the chrome stop belonging to
  the node, which is the whole idea being built here.
- **The transport overlaid on the clip.** See above; it costs the node its drag surface,
  and `VideoPlayer` already paid to avoid exactly that.
- **A selection ring drawn as an SVG path around the notched silhouette.** Keeps today's
  signal exactly and works at every zoom and with either tab treatment. Rejected on cost:
  the path has to know the tab's rendered width, which follows the node's title, so it
  needs a runtime measurement per node for a signal nobody consciously notices.
- **Selection as a filled tab.** The strongest signal of the three, and unavailable: the
  tab's fill is spent on telling the two families apart. If the family signal ever moves
  back to ink, this becomes the better answer.
- **Squaring the prompt node too**, for one rule with no exceptions. Simpler to state,
  but it squares a box with nothing to clip, and the rule "square what is media" says
  something true where "square what is an input" says something arbitrary.
