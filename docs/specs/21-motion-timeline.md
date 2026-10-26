# 21 · Motion timeline

Depends on: 01 to 20 (read 00-index first). It builds on spec 09's motions, viewer, dials and editor, on spec 18's Edit mode, source edits, bursts, edit bridge, point and tell and Design tab, and on spec 19's tokens. It changes the passages named under "Rules this spec bends". The build pull requests for this spec update those passages as the behaviour lands, so each earlier spec describes the app as it is.

## Problem Statement

A motion is a HyperFrames composition: clips with a start and a length, and one GSAP timeline whose tweens move, scale, fade and colour the elements inside them. Today a person can only watch it in HyperFrames' player and tune the dials the agent exposed. To make the title land a beat later, the fade a little slower, or the logo ease out instead of bounce, they have to ask the agent and wait for a rewrite of the whole file, even when the change is one number they could see and point at.

Every serious motion tool has a timeline for this. HyperFrames Studio has one, and it writes every edit back into the HTML source instead of keeping a separate edit layer. Unframed has already taken that model for pages and motions (spec 18): the file stays the truth, a person's edit is a new version, and whatever owns a value is what an edit changes. What a motion still lacks is a place to see time: where each clip and tween sits, a playhead to scrub, and handles to drag.

## Solution

When a motion is open in the editor, a **timeline** strip sits under the frame in the centre column. Its **transport** replaces HyperFrames' own player controls there (on the canvas the player keeps its controls): play and pause, a seconds and frames readout, frame steps, J/K/L shuttle, a loop range, playback speed and mute. A clock outside React moves the playhead and readout by direct DOM writes, as Studio's live-time pattern does.

The strip lists the motion's **clips** (from the HyperFrames runtime's own `timeline` message) and, under each, the elements its tweens animate, one row per element by `data-hf-id`. A row expands into **lanes** by property group (position, scale, size, rotation, visual, other), with a **bar** per tween and a **diamond** at each keyframe. A stagger draws one bar on each target's row, all of them one tween.

A person drags a bar to move a tween, stretches it to change its length, picks an ease from GSAP's named eases (or a kit easing token), and changes the numbers and colours the agent animated at a diamond. Moving or stretching a clip carries its tweens with it. Dragging the end marker changes the motion's total length. While dragging, the frame shows the change live through the edit bridge, which carries a port of Studio's runtime tween patch.

Every edit follows spec 18's owner rule. A literal in the source becomes a source edit, written by HyperFrames' own writer, collected into a burst, and committed as a new version. A value taken straight from a dial (`duration: v.speed`) moves the dial instead, so the bar and the slider are one value with two controls. A kit token offers another token or Detach. Anything computed is read-only, with `Set by the agent's code.` and an action that hands the tween to the agent.

The engine reads each motion file once with `@hyperframes/parsers` plus a small Unframed pass that knows about dials and tokens. From that it answers which values the person may change and who owns each one. The web draws and drags, and the engine checks every commit against the same reading. Renders are not touched by any of this: an MP4 already rendered is a video like any other.

Before any of it, the HyperFrames packages move from 0.8.93 to the newest release on their own pull request, and a probe measures how much of what the agent really writes the timeline can edit.

## User Stories

1. As a person, I want a timeline under a motion when I open it in the editor, so that I can see where everything happens in time.
2. As a person, I want the canvas to stay exactly as it is, with HyperFrames' player controls on a selected motion, so that the timeline costs nothing outside the editor.
3. As a person, I want to play and pause with Space and see the time in seconds and in frames, so that I can talk about a moment precisely.
4. As a person, I want to step one frame with the arrow keys and ten with Shift, so that I can land on an exact frame.
5. As a person, I want J, K and L to shuttle backward, stop and forward, faster on each press, so that I can scan a motion the way video editors do.
6. As a person, I want to set a loop range with I and O and toggle looping with Shift+L, so that I can watch one moment over and over while I tune it.
7. As a person, I want to play at 0.25x to 2x and mute with M, so that I can study a fast move and silence a soundtrack.
8. As a person, I want to scrub by dragging on the ruler, so that I can find a moment by hand.
9. As a person, I want to zoom the timeline with a pinch or Ctrl+wheel around my cursor, so that I can see a quick move frame by frame.
10. As a person, I want a row per clip and, under it, a row per animated element, so that the timeline reads like the composition.
11. As a person, I want to expand an element into lanes for position, scale, size, rotation, visual and other, so that overlapping tweens on one element come apart.
12. As a person, I want a diamond at each keyframe, so that I can see where values change.
13. As a person, I want a staggered tween to show a bar on each of its targets, offset by the stagger, so that I can see the cascade.
14. As a person, I want selecting a row to select its element in the frame and selecting an element in the frame to show its row, so that the two views agree.
15. As a person, I want to drag a tween's bar to change when it starts, and see the frame change while I drag, so that I can time it by eye.
16. As a person, I want to stretch a tween's bar from either end, so that I can make a move faster or slower.
17. As a person, I want drags to snap to whole frames, to other bars' edges and to the playhead, and to place freely while I hold a key, so that timing lines up without fiddling.
18. As a person, I want dragging any bar of a stagger to move the whole stagger, so that the cascade stays one gesture.
19. As a person, I want to change a stagger's spacing as one number, so that I can loosen or tighten a cascade.
20. As a person, I want to pick an ease from GSAP's named eases, each with a small curve, so that I can choose by shape.
21. As a person, I want my kit's easing tokens offered in the same picker, so that motions keep the house feel.
22. As a person, I want to change the numbers and colours the agent animated at a diamond, so that I can adjust where a move goes without asking.
23. As a person, I want a colour at a diamond to offer my kit's colours, so that an animated colour can use the palette.
24. As a person, I want a tween whose timing comes from a parameter to move that parameter when I drag it, and to stop at the parameter's limits, so that the slider and the bar never disagree.
25. As a person, I want moving the parameter's slider to move the bar, so that it is one value with two controls.
26. As a person, I want the ease picker to set an ease parameter when the agent made one, if my choice is among its options, so that the parameter stays the source.
27. As a person, I want a tween set by the agent's code to say so and offer to ask the agent, so that I know why I cannot drag it and how to change it.
28. As a person, I want loops in the agent's code shown but not editable, so that I see every tween without the timeline guessing at code.
29. As a person, I want moving or stretching a clip to carry its tweens, so that the animation inside it stays with it.
30. As a person, I want a clip move that cannot carry one of its tweens refused with a sentence naming it, so that the timing never silently comes apart.
31. As a person, I want to drag the end marker to change the motion's total length, so that the render is as long as I want.
32. As a person, I want my timeline edits saved as one new version after a pause, so that undo takes back a whole adjustment, not every pixel.
33. As a person, I want the agent's rewrite to win when it lands while I am adjusting, with a sentence saying my last change was not saved, so that nothing silently merges.
34. As a person, I want the playhead to stay where it was when a new version loads, so that I keep my place.
35. As a person, I want the Design tab's note on an animated property to take me to its tween on the timeline, so that I find where it is animated.
36. As a person, I want renders I already made left alone by timeline edits, so that an MP4 stays the video it is.
37. As a person, I want the timeline's height and whether it is open remembered, so that the editor opens the way I left it.
38. As a person, I want playback with the timeline open to stay smooth, so that the strip never makes the motion stutter.
39. As an agent, I want the file I read back with `motion_read` to hold the person's timeline edits, so that my next rewrite starts from what they see.
40. As an agent, I want the motion tool description to tell me to put a dial's value straight into a tween, so that what I write stays editable on the timeline.
41. As a maintainer, I want HyperFrames upgraded on its own pull request with renders and snapshots compared before and after, so that a regression is visible before the timeline depends on the new version.
42. As a maintainer, I want a measured count of how much of the agent's real output the timeline can edit, so that the build stops if the answer is "very little".

## Implementation Decisions

### Terms this spec adds

- **Timeline**: the strip under a motion in the editor: transport, ruler, rows.
- **Transport**: the timeline's playback controls and their shortcuts.
- **Clip**: a timed element of a composition (`class="clip"`, `data-start`, `data-duration`), as the HyperFrames runtime's `timeline` message reports it.
- **Tween**: one GSAP call (`to`, `from`, `fromTo` or `set`) in the motion's timeline script.
- **Bar**: what a tween draws on one row and lane, from its start to its end. One tween may draw several bars (one per stagger target, one per property group it animates). A `set` draws a diamond only.
- **Lane**: a row under an element for one property group.
- **Diamond**: a keyframe marker: a tween's start and end, and each step of its keyframes.
- **Carry**: the tweens a clip takes with it when it moves or stretches.
- **Timeline reading**: the engine's analysis of one motion file: its clips, tweens, owners and carries.

Spec 18's terms (source edit, burst, target, edit bridge, Edit and Interact, point and tell, and the owners `source`, `dial`, `script`, `animated` and `locked`) and spec 19's (token, kit, the `token` owner, `StyleRuleRef`, the ease catalogue and the ease curve) are used as those specs define them.

### Modules

| Module | Package | Interface | New or extended |
| --- | --- | --- | --- |
| Timeline reading | domain | `motionTimeline(html)` returns the reading below, or one with `script: "none"` when the file has no timeline script | new |
| Value owners | domain | `ownerOf(node, context)` gives one expression node of the timeline script its owner, in spec 18's names: `source`, `dial`, `token` (spec 19) or `script`; `dialsCallback(ast)` finds the apply function of `unframed.dials` and its parameter | new; the one place that decides who owns a tween value |
| Carry rules | domain | `carryFor(reading, clipHfId)` returns the tweens and dials a clip carries, or a refusal sentence | new |
| Motion edits | domain | the six edit types below, joined to spec 18's `applySourceEdits` union: each applied with HyperFrames' writer, refused with a sentence when its owner is not `source`, when it touches a locked element, or when the writer leaves the script unchanged | extended (spec 18) |
| Timeline maths | domain | frames at 30 fps, the readout formats, `snapTime`, zoom with an anchor, the ruler step, dial limits for a drag | new |
| Viewer | domain | the viewer page gains an editor mode and relays the player (below) | extended (spec 09) |
| Edit bridge, timeline part | domain | the live tween report and the tween preview patcher, built into the edit bridge spec 18 defines | extended (spec 18) |
| Timeline service | engine | RPC `motion.timeline`, cached per file | new |
| Artifact edit service | engine | `artifact.edit` accepts the motion edit types and checks each against the base file's reading | extended (spec 18) |
| HyperFrames packages | engine | `@hyperframes/core`, `engine`, `player`, `producer` and spec 18's `@hyperframes/parsers` moved together to the newest release | extended (specs 09 and 18) |
| Timeline strip, transport, values panel, ease picker | web | in the editor's centre column under a motion (centre and right columns below a 1280 px window); the ease picker lists spec 19's ease catalogue with spec 19's ease curve | new |

The timeline reading imports `@hyperframes/parsers` (its `gsap-parser-acorn`, `gsap-writer-acorn`, `gsap-constants` and `hf-ids` entry points). Only the engine calls it, so the parser and its HTML parser never load in the web.

### Upgrading HyperFrames

Unframed pins 0.8.93, `@hyperframes/parsers` included (spec 18). The newest release when this spec was written is 0.8.206. Task 1 moves `@hyperframes/core`, `@hyperframes/engine`, `@hyperframes/player`, `@hyperframes/producer` and `@hyperframes/parsers` together to the newest release at build time, alone on its own pull request, before any other task.

- What the release notes and the code at 0.8.206 say: no breaking change for this integration. The only breaking section in the range (0.8.156) removed Studio's inspector agent tools. `@hyperframes/core` still exports its runtime as an IIFE build, and the player still ships its global build beside its entry, so spec 09's library copies keep their sources. The producer still injects `variables` as `window.__hfVariables` before page scripts. The engine's browser order is config `chromePath` first, so spec 09's found Chrome still wins.
- Behaviour that changed and does not reach Unframed's motions: scripts wait for web fonts (0.8.122) and the preview mounts only scenes near the playhead (0.8.200). Both apply only to files HyperFrames' own compiler rewrote, and the preview serves the agent's file as written. Renders do compile, so a render may wait up to 5 s for fonts.
- The producer now depends on puppeteer 25. The install must still skip puppeteer's browser download (spec 09).
- Comparison, the person's step (task 2): the sample motions (the scripted agent's fixtures and the samples in "Assets this spec needs") are rendered and snapshotted at 0.8.93 and at the new version on the same machine. Stills at 0 s, 1 s and the last frame are compared by eye and by a pixel difference, recorded in the pull request, and any difference is explained or fixed before the pull request merges.

### The probe

Before the reading is built. A domain-seam test (task 3) runs HyperFrames' parser and a first version of the owner rules over the committed files only: every motion in the scripted agent's fixtures that writes one (`dials`, `revise`, `stitch`, `bad-shape`) and the samples written to follow `dials-timeline.md`. For each file it counts tweens and their start, duration, ease and animated values by owner (`source`, `dial`, `token`, `script`), and the read-only reasons, and it asserts the counts the fixtures are written to produce.

Then a step that is not a test (task 4): the same count runs over the committed files and over any motions the person copies in from their own projects (they choose which, and none is committed unless they say so), and the counts go into `docs/research/motion-editability.md` with one example per reason.

If fewer than half of the tweens in the agent-written files come out with an editable start and duration, the build stops after that step and the numbers go to the person, because the editing tasks would then be building for files that rarely occur. The rule this spec adds to `dials-timeline.md` (The agent, below) is written first, so the samples follow it.

### What @hyperframes/parsers gives, and what Unframed adds

Reading the parser at 0.8.206 settled this:

- `parseGsapScriptAcornForWrite` (in `gsap-parser-acorn`) returns the script's syntax tree and, for each tween call in source order, the call's nodes (target, vars, from-vars, position) and its parsed animation. Its walk enters every function, so tweens inside the dials callback are found.
- A value it cannot fold to a constant comes back as the string `__raw:<expression as written>`, for animated properties, from-values, the position, the stagger and the ease. A non-literal `duration` comes back only as `durationUnresolved: true`, with no text, and a raw ease is a string like any ease.
- It knows nothing of `unframed.dials` or `unframed.token`.

So Unframed adds one small pass over the write parse's located calls. It reads every value from its own node (the duration included), classifies it with `ownerOf`, and treats a string that starts `__raw:` as an expression, never as a value. It uses HyperFrames' writer for every byte it changes. The read path's helper and loop inlining is not used for editing, because the writer works on the source as written.

### The timeline reading

`motionTimeline(html)` finds the timeline script (HyperFrames' rule: the first inline script that declares `gsap.timeline`, else the first with tween calls). It parses it once and resolves every tween's targets against the source document. The engine caches the answer per file name, which is safe because an artifact file never changes.

```ts
type Owner =                                  // spec 18's owner names, for one tween value
  | { kind: "source"; value: number | string } // a literal in the source
  | { kind: "dial"; path: string[] }          // v.scene.speed -> ["scene", "speed"]
  | { kind: "token"; name: string }           // unframed.token("duration/fast"), spec 19
  | { kind: "script"; text: string }          // the expression as written, cut to 120 characters

type TweenRef = { index: number; id: string } // source order in the script; HyperFrames' animation id

type Tween = {
  ref: TweenRef
  method: "to" | "from" | "fromTo" | "set"
  targets: string[]                           // data-hf-id of each target, in document order
  groups: PropertyGroup[]                     // every group it animates; one bar per group lane
  start: Owner; duration: Owner; ease: Owner | null
  stagger: Owner | null
  repeat: { count: number | null; yoyo: boolean } | null
  keyframes: { at: number; values: Record<string, Owner>; ease: Owner | null }[]  // at: 0 to 1 within the tween
  readOnly: string | null                     // why nothing on it can be edited
  source: string                              // the call as written, cut to 300 characters
}

type Clip = {
  hfId: string; id: string; track: number
  start: Owner; duration: Owner               // from data-start and data-duration
  carry: { tweens: TweenRef[]; dials: string[][] } | { refused: string }
}

type MotionTimeline = {
  file: string
  script: "ok" | "none" | "unreadable"
  length: Owner                               // the root's data-duration
  clips: Clip[]; tweens: Tween[]
}
```

**Owners.** The reading gives every tween value one of spec 18's owners, so the strip and the values panel apply spec 18's owner table exactly as the Design tab does: for tweens, the static reading plays the part `fieldOwner` plays for style fields. `locked` comes from the shape's `lockedElements` (a tween with a locked target), and `animated` stays the Design tab's owner for a property a tween animates. `ownerOf` reads one node:

- A number, a string, a negative number, or arithmetic on numbers alone: `source`. A string with a relative operator (`"+=100"`, `"-=1"`), `random(` or a label is `script`.
- A member chain rooted at the dials callback's parameter, with dot or string-literal bracket steps and nothing else (`v.speed`, `v.scene.speed`, `v["speed"]`): `dial`, with its path. The parameter must not be reassigned in the callback. Arithmetic on it (`v.speed * 2`, `v.delay + 0.5`), a call on it, or a destructured parameter: `script`.
- `unframed.token("<name>")` with one string literal: `token`.
- Anything else: `script`.

**The dials callback.** `dialsCallback` finds the last `unframed.dials(name, config, apply)` call in the timeline script (the last declaration wins, spec 09). `apply` may be a function expression, an arrow function, or the name of a function declared in the same script. Its first parameter is the one dial paths are rooted at. A dial path is taken as written. The editor checks it against the schema the frame announced and treats a path the schema does not name as `script`.

**Read-only tweens.** `readOnly` is set, with a sentence the values panel shows under `Set by the agent's code.`, when the call:

- sits in a loop or an iteration callback (`for`, `while`, `forEach`, `map`): `It runs in a loop.`
- sits inside a function other than the dials callback: `It is built by a helper.`
- has a target that does not resolve to elements in the source: `Its target is found while the motion runs.`
- has keyframes that do not resolve to constants: `Its keyframes are computed.`
- uses `motionPath`: `It follows a motion path.`

A tween that is not read-only may still have values owned by `script`. Each value carries its own owner.

**Starts.** A numeric position is the start. A missing position, a relative one (`"<"`, `"+=0.5"`) or a label is owned by `script` for editing. The bar is drawn where the parser resolves it, or where the live report puts it.

**Repeats.** `repeat` and `yoyo` are shown and never edited. The bar covers one cycle, and the repeats draw as lighter copies after it.

**Staggers.** Targets are in document order (GSAP's order for a selector). With a stagger that is a number, or an object whose only timing key is a literal `each` or `amount`, target `i` starts `i × each` after the tween's start (`each = amount / (n − 1)`). Any other stagger option (`from`, `grid`, an ease) draws every target's bar at the tween's start with a stagger badge, and the amount is read-only.

**Groups.** HyperFrames' `classifyPropertyGroup`: position (`x`, `y`, `xPercent`, `yPercent`), scale (`scale`, `scaleX`, `scaleY`), size (`width`, `height`), rotation (`rotation`, `skewX`, `skewY`), visual (`opacity`, `autoAlpha`), other (everything else). A tween that animates several groups draws one bar in each group's lane. They are all one tween, and selecting one selects all.

**Keyframes.** `at` 0 holds the from-values (a `fromTo`'s first object, or a `from`'s vars) and `at` 1 the to-values. A `to` has no values at 0, and a `from` none at 1. Those diamonds say `Starts from the element's current look.` or `Ends at the element's own style.` Percentage, object-array and simple-array keyframes give one entry per step, as HyperFrames reads them.

**Clips.** One per element with `data-start` inside the root, by its `data-hf-id`. `data-start` and `data-duration` are owned by `source` when they are plain numbers. A `data-start` that names another clip (`data-start="intro"`, which HyperFrames resolves at run time) is owned by `script`. Rows and their order come from the runtime's `timeline` message (id, start, duration, track, kind). When the runtime's start or duration for a clip differs from the source's literal, the agent's code moved it, and the editor treats that value as owned by `script`.

**Carry.** `carryFor` follows HyperFrames' own rule for which tweens move with a clip (`clipTweenMatcher`). A tween is carried when every one of its targets is the clip or sits inside it with no nearer clip. It refuses, naming the first blocker, when:

- a carried tween's start is owned by `script`: `This clip can't move: the {group} tween on {target} is timed by the agent's code.`
- a dial that times a carried tween also times a tween that is not carried: `This clip can't move: the parameter {path} also times a tween outside it.`
- another clip's `data-start` names this one: `This clip can't move: {other} starts relative to it.`
- the clip's own start or duration is owned by `script`: `Set by the agent's code.`

A carried tween timed by a dial carries the dial: a move shifts it by the same amount, and a stretch scales it. A carried duration owned by `script` does not block a move, only a stretch, with the first sentence above saying "timed".

### Motion edits

Six edit types join spec 18's union. Each names its tween by `TweenRef` from the base file's reading. Applying one finds the call at `index`, checks that its HyperFrames id is still `id`, and calls HyperFrames' writer by the id the current script gives that call. Edits apply in order. Source order does not change under value edits, so the index stays good through a burst even though HyperFrames' id moves with a tween's start. In spec 18's burst, a tween edit's target is its `TweenRef` (keyed by `index`), a clip edit's target is the clip's `data-hf-id`, and `composition-duration`'s target is the root, each with its field (start, duration, ease, stagger, or the property and keyframe of a value), so later edits of the same tween and field replace earlier ones under spec 18's generic rule.

```ts
| { type: "tween-time"; tween: TweenRef; start?: number; duration?: number }
| { type: "tween-ease"; tween: TweenRef; ease: string | { token: string } }
| { type: "tween-value"; tween: TweenRef; at: number; property: string; value: number | string | { token: string } }
| { type: "tween-stagger"; tween: TweenRef; each: number }
| { type: "clip-time"; clip: string; start?: number; duration?: number }   // clip: data-hf-id
| { type: "composition-duration"; seconds: number }
```

- **tween-time** writes the position argument and the `duration` property (a keyframed tween through HyperFrames' keyframed resize, so its steps keep their percentages). Times are rounded to the millisecond. A start is at least 0. A duration is at least one frame (0.033 s), except on a `set`, which has none.
- **tween-ease** writes `ease`, or `easeEach` on a keyframed tween, as HyperFrames' writer does. A name must be in spec 19's ease catalogue or be exactly the ease already written. A token writes `unframed.token("<name>")` as an expression, and the name must be an easing token of the project's kit.
- **tween-value** writes one property at one diamond: the to-vars at 1, the from-vars at 0, or the keyframe step at that percentage. A number keeps the unit of the literal it replaces (`"120px"` stays in px). A colour must be one of the forms spec 19 accepts for a colour token: hex (`#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`), `rgb()` (with `rgba()`), `hsl()` (with `hsla()`), `oklch()` or a CSS named colour. A token writes `unframed.token("<name>")` and must be a token of a matching type. Detaching a token is a tween-value whose value is the token's resolved value in the artifact's kit mode, written as the kit writes it (its CSS text, or a number for a duration).
- **tween-stagger** writes the stagger as a number, or the literal `each` or `amount` in place (converted back from `each`), leaving other stagger keys untouched.
- **clip-time** writes the clip's `data-start` and `data-duration` itself and carries its tweens with one HyperFrames retime: a shift by the start's change, or a scale from the old span onto the new one. A carried dial is not written here. The web sets it in the same commit (Bursts, below).
- **composition-duration** writes the root's `data-duration`, at least one frame, rounded to the millisecond.
- **Timing attributes.** `data-start` and `data-duration` are written only by `clip-time` and `composition-duration`, never by spec 18's `attribute` edit: its allow-list gains nothing here, so every timing change goes through the carry and its checks.

Every edit is refused, with nothing written, when the value it changes is not owned by `source` in the base file: `{target}'s {field} is set by the agent's code.` It is refused with spec 18's lock sentence (`{label} is locked. Unlock it in Layers to edit it.`, naming the first one) when its targets include a locked element or an element inside one: a tween edit's targets, a clip edit's clip and every tween it carries, and for `composition-duration` the root. It is also refused when the tween's id no longer matches (`The tween on {target} changed since this edit began.`), when the clip's carry refuses (its sentence), and when HyperFrames' writer returns the script unchanged, which is how that writer reports a target it could not find (`The edit to {target} could not be applied.`). `{target}` is the element's layer name (spec 18). The sidecar's `edits` summary (spec 18) gets one line per edit, in sentence case: `Moved {target} {group} to {start} s`, `Set {target} {group} to {duration} s long`, `Eased {target} {group} with {ease label}`, `Set {target} {property} to {value}`, `Spaced the {target} stagger {each} s apart`, `Moved clip {label} to {start} s`, `Set clip {label} to {duration} s long`, `Set the length to {seconds} s`.

### The strip

- **Where**: the editor's centre column under a motion with a file, below the frame and above nothing. In a window narrower than 1280 px the strip spans the centre and right columns, and the right column ends above it. A page, or a motion with no file, has none. The frame keeps the rest of the centre body, and spec 09's preview size fits into that smaller box.
- **Height**: 240 px at first, from 120 px to 60 % of the column, resized by dragging its top border. **Hide timeline** and **Show timeline** (a ghost icon Button, PanelBottom, at the transport's right end) collapse it to the transport row alone. The height and the open state are one preferences store key, `editor.timeline` (`{ height, open }`), shared by every motion.
- **Region**: labelled `Timeline for {title}`, on `--card` under a border, in the app tokens (spec 12).
- **Layout**: the transport row (40 px), the ruler (24 px), then the rows, which scroll vertically. A label column on the left, 160 px, holds row names, disclosure chevrons and lock icons; when the strip is narrower than 900 px it collapses to 24 px of icons, with each name in a tooltip. The time area fills the rest and scrolls horizontally. Only rows in view are mounted.
- **The ruler**: a time step that keeps labels at least 64 px apart (frames, then 0.1, 0.5, 1, 5, 10 s). It shows the loop range shaded with draggable In and Out handles, and the end marker at the motion's length with `{seconds} s` beside it. Time past the end is dimmed.
- **Empty states**: `This motion has no GSAP timeline the editor can read.` when the reading says `none`, with the clips still listed. `The timeline script could not be read.` when `unreadable`, with every tween row from the live report and read-only.

### Rows, lanes and diamonds

- **Clip rows**, in the runtime's track order, then by start. Each shows the clip's name (spec 18's layer name, else its id), and a bar for the clip's span in the clip colour for its kind (element, video, audio, image).
- **Element rows** under the clip whose span holds them (the element's nearest clip ancestor, as Carry uses), one per element any tween targets, named as in Layers. An animated element outside any clip sits under a top row named `Composition`. Collapsed, an element row shows each of its tweens as a thin bar with its diamonds. Expanded (the chevron, or Right arrow on the focused row), it shows one lane per property group it has, each with full bars.
- **Runtime rows**: tweens the live report finds on elements that are not in the source (made by a script) show on greyed rows named by their selector, with the tooltip `Made by the agent's code while the motion runs.` Nothing on them can be edited.
- **Selection**: a click on a row selects its element, which spec 18's selection outlines in the frame and shows in Design and Layers. Selecting an element anywhere else selects and scrolls to its row. A click on a bar selects its tween and every bar of it. A click on empty track clears the tween selection. The tween selection is part of the editor's selection, so by spec 18's generic rule any change of it (selecting another tween, an element, or clearing it) commits the burst.
- **Locked elements** (spec 18) show the lock icon, and their bars and diamonds do not move: `Locked. Unlock it in Layers to edit it.`
- **Hidden elements** (spec 18) show their rows greyed and still editable.
- **Component instances** (spec 20) are one row. Elements inside an instance are not rows of their own.

### Editing on the strip

Strip edits work in Edit and Interact alike, by spec 18's rule for the whole editor: the mode only decides what the pointer and keys do inside the frame. Switching mode still commits the burst (spec 18).

- **Move**: dragging a bar's body moves its tween's start. On a stagger, dragging any target's bar moves the one tween. On a `set`, dragging the diamond moves it.
- **Stretch**: the bar's right edge (6 px) changes the duration with the start fixed. The left edge changes the start with the end fixed, so it needs both to be editable.
- **What a gesture may do** is known before it starts, from the reading. A gesture on a value that is not editable never starts. The cursor shows not-allowed, and the bar's tooltip and the values panel say why. A tween whose start is literal and whose duration is a dial moves by a source edit and stretches by the dial. A left-edge stretch on such a tween does both in one commit.
- **Dial-owned timing**: dragging moves the dial. The web posts `unframed:dials:set` to the frame on every move, which rebuilds the timeline through the agent's own callback, so the preview is the real thing. The write to `dials` is held in the burst by spec 18's rule for dials inside a burst, and lands with the burst's commit. The Parameters tab's control shows the new value, set on the DialKit controller without rebuilding it. A range dial stops the drag at its min or max, and its step rounds the value. A plain number dial stops at 0. Moving the dial in the Parameters tab or on the canvas panel moves the bar as the values are posted, not only after the write. A dial that times several tweens moves all of their bars together, since it is one value.
- **Token-owned timing** (owner `token`): a token cannot be dragged. The values panel offers another duration token or Detach, and after Detach the bar drags.
- **Snapping**: while dragging, the moving edge (or the nearer of the two edges on a move) snaps within 8 px to the playhead, the In and Out points, the end marker, clip edges and other bars' edges, in that priority. Failing those it lands on a whole frame at 30 fps, the render's rate. A vertical guide marks a snap. Holding Alt (Option on a Mac) places freely, to the millisecond. While a drag is on, a muted line under the rows says `Hold Alt to place freely` (`Hold Option to place freely` on a Mac).
- **Clips**: dragging a clip bar moves the clip, and its edges stretch it, carrying its tweens (Carry above). The drag stops where any carried dial reaches its limit. A refused carry never starts, and the clip's tooltip gives the sentence. Clips do not change tracks.
- **Total length**: dragging the end marker changes `data-duration`, at least one frame. It snaps to the last clip's end and to the playhead, and while dragging the editor sends the runtime `set-root-duration` through the viewer so playback follows.
- **Keys** with a bar selected: Enter opens the values panel. Delete does nothing, because tweens are never removed here.

### The values panel

A UI kit Popover, 280 px wide, anchored to the bar or diamond it opened from. A click on a diamond opens it, and so do a double-click on a bar and Enter with a tween selected. Esc closes it and leaves the editor open (the Esc order is under The transport). Its header names the element and the group (`Title · Visual`) and the method in muted text.

- **Timing**: `Start` and `Duration` (seconds, small number fields, Enter or leaving the field applies), `Ease` (the picker below), `Stagger` (seconds between targets) when the tween staggers, and a muted line for repeats: `Repeats {n} times` and `, back and forth` for yoyo, or `Repeats forever` for `-1`.
- **At this keyframe**: when a diamond opened it, one field per property the agent animated at that diamond, and nothing else, because properties are added by asking the agent. Numbers are number fields, with the literal's unit shown after them. Colours are a swatch, a hex field and spec 19's token choice. Other strings show as text, read-only.
- **Owners** on every field, by spec 18's owner table:
  - `source` is an editable field.
  - `dial` shows a chip with the SlidersHorizontal icon and `Parameter {path}` (folders joined with ` › `), tooltip `Set by the parameter {path}. Changing it here moves the parameter.`, and its field moves the dial.
  - `token` shows spec 19's token chip with its change and Detach actions.
  - `script` shows the value's text in monospace, `Set by the agent's code.`, and the action `Ask the agent to make this editable`. That is spec 18's point and tell: it puts the element's chip into the artifact's chat composer, with the tween's `source` as the chip's excerpt in place of the element's (Rules this spec bends, 9).
  - `locked` shows `Locked. Unlock it in Layers to edit it.` and nothing to edit.
- A read-only tween shows only the computed layout: its timing as text, the reason sentence, and the action.
- A `to` start diamond and a `from` end diamond show the sentence from The timeline reading, and nothing to edit.

### The ease picker

- A UI kit Popover from the `Ease` field: spec 19's ease catalogue, grouped by family. Linear first (written `none`), then Sine, Power1, Power2, Power3, Power4, Expo, Circ, Back, Elastic and Bounce, each a row with `In`, `Out` and `In-out` (written `<family>.in`, `.out`, `.inOut`): the catalogue's 31 eases. Each choice shows spec 19's ease curve for it. The current ease is checked.
- An ease written in a form the list does not name (an alias like `quad.out`, a parameter like `back.out(3)`, `steps(5)`) shows as written at the top, checked. Picking another replaces it.
- With a kit (spec 19), a `Kit` group lists the easing tokens by name, each with spec 19's ease curve when its value is a catalogue ease or a cubic bezier.
- When the ease is a select dial, only the dial's options can be chosen. Every other row is disabled, with the tooltip `This ease comes from the parameter {path}, which offers only its own options.` Choosing one sets the dial.
- No custom curve editor.

### Live preview

While a burst collects, nothing is written. The change shows in the frame through the edit bridge (spec 18), which this spec extends with a tween patcher ported from Studio's `gsapRuntimePatch` and the retime half of its `gsapLiveRetime` (Apache-2.0). Each ported part starts with a header naming the HyperFrames file it comes from, the licence, and that it was changed. `THIRD_PARTY_NOTICES` lists HyperFrames Studio beside spec 09's HyperFrames entry and spec 18's `@hyperframes/parsers`. The edit bridge is a generated file copied into project folders, so the header goes with it.

- **Messages**: tween patches are a new kind in spec 18's `unframed:edit:patch` (`{ kind: "tween", selector, channels, change }`, the change holding any of start, duration, ease, stagger and values at a keyframe), and spec 18's `unframed:edit:reset` drops them with the rest.
- **Finding the live tween**: by target identity and the property channels it animates, across `window.__timelines`, never by index, as Studio's scan does.
- **Values**: set the value in the tween's vars and invalidate that tween alone, never the whole timeline. Object-form keyframes are recreated: note the start, kill the tween, and add a new one with the same vars plus the change at the same start, because GSAP compiles those keyframes when the tween is made.
- **Ease and stagger**: GSAP reads them only when a tween is made, so these are recreated the same way. That is new work beyond Studio's patcher.
- **Timing**: remove the tween from its parent and add it again at the new start, and set its duration. Timing preview is new work beyond Studio's patcher, which never retimes; it follows the lessons of Studio's live retime. When a move would change the order of two tweens on the same element and property, the tween keeps the start values it recorded when it first played, so the preview is declined for that drag. The bar still moves, and the frame shows the change once the new version loads.
- **Seeks** are deferred to one per message, after all its patches, back to the current time.
- **Declined**: a string value with a relative operator or `random(`, a non-finite number, a `motionPath` tween, and a tween that cannot be found. Declining is silent. The bar moves, and the frame catches up at the commit.
- **Dials re-applying**: the agent's callback clears and rebuilds the timeline whenever a dial moves, which would drop the patches. So the edit bridge keeps the burst's patches and applies them again after every dials apply (the dials bridge signals each apply to the edit bridge in the same document) until the new version loads.
- **Live report**: after load and after every dials apply (at most once per frame), the edit bridge posts `unframed:edit:tweens` with each live tween's targets (their `data-hf-id`, or their selector when they have none), start, duration, keyframe percentages, animated properties, repeat and yoyo. The strip pairs live tweens with the reading by target and source order, as Studio's tween cache does. It draws the reading's tweens with dial values substituted, and uses the report to place what the reading cannot: computed starts, loops, helpers and runtime rows.

### Bursts and commits

Spec 18's burst applies unchanged: edits collect, keyed by target and field (Motion edits above), and they commit as one version 1.5 s after the last edit, or when the person switches mode, changes the editor's selection (an element or a tween, spec 18's generic trigger) or closes the editor. A commit is `artifact.edit { shapeId, baseFile, edits }` with the motion edits. The web folds a burst before sending: several moves of one tween become one `tween-time` with its last values.

- **Dials in a burst** follow spec 18's rule: a dial the strip moved (dial-owned timing, a mixed stretch, a clip carrying a dial) is posted to the frame at once and its write is held in the burst. It lands in the same tldraw history step as the new `file`, so one undo takes back the whole adjustment. A burst that only moved dials writes them alone at commit time, as one step, with no `artifact.edit`.
- **Agent wins** (spec 18, model rule 4): a burst open when the shape's file changes is dropped, and so is a commit `artifact.edit` answers with `conflict`. The editor shows spec 18's toast (`The agent rewrote this. Your last change wasn't saved.`, or `This motion changed somewhere else. Your last change wasn't saved.`), and the strip reloads on the new version. The dials held in that burst are dropped with it (spec 18), and the frame's dials go back to the shape's saved values.
- **Older files**: a motion with no `data-hf-id` goes through spec 18's `artifact.prepareEdit` when the editor opens it in Edit mode, and the strip asks for the reading of the prepared file.
- **After a version loads** (a commit, an agent write, an undo), the frame is a fresh document (spec 09 keys it by file). The strip keeps the playhead time and the paused or playing state, and seeks the new document there once its runtime sends `timeline`. It keeps the selected tween when a tween with the same HyperFrames id exists in the new reading. Until the new reading arrives it keeps drawing the edited bars, so nothing jumps back.
- Renders are never marked stale, re-run or touched. Spec 09's snapshot after a write still happens, because a source edit is a write.

### The transport

The transport row, left to right: Play/Pause (ghost icon Button, Play or Pause icon, tooltips `Play (Space)` and `Pause (Space)`), Previous frame and Next frame (ChevronLeft and ChevronRight, `Previous frame (←)` and `Next frame (→)`), the readout, then right-aligned: Playback speed (a small outline Button showing `1x`, labelled `Playback speed`, opening a menu of `0.25x`, `0.5x`, `1x`, `1.5x`, `2x`), Loop (a Toggle, Repeat icon, `Loop (Shift+L)`), Mute (Volume2 or VolumeX, `Mute (M)` and `Unmute (M)`), Zoom out, Zoom in and Fit to length (ZoomOut, ZoomIn, Maximize2), and Hide timeline.

- **Readout**: `{m}:{ss}.{cc} / {m}:{ss}.{cc}` (the playhead and the length, centiseconds), then `{frame}f` in muted text, with the frame `floor(time × 30)`. It uses tabular figures, so it does not shift while playing.
- **Shortcuts.** Space, Left and Right (with or without Shift), J, K, L, I, O, Shift+I, Shift+O, Shift+L and M act only when the focus is on the frame, on the strip's time area or on the page body (and I and O from a timeline row too, below). Any focused control (Tabs, ToggleGroups, Layers rows, timeline rows, inputs, menus, dialogs, the composer, DialKit) keeps its own keys, and a key it handles never reaches the transport. Inside the frame, in Edit mode, the keys reach the editor because spec 18's `unframed:edit:key` forwarding gains them in a motion, with spec 18's exception: while an in-place text edit is active, the bridge forwards only Esc and Enter.
  - Space plays and pauses.
  - Left and Right step one frame, and Shift with them ten.
  - L plays forward at 1x, and again at 2x and 4x. J plays backward at the same speeds. K pauses and ends the shuttle, so Space returns to the chosen speed.
  - Shift+L toggles looping. M mutes.
  - **I and O.** With the focus in the strip (its time area or one of its rows), I and O set In and Out at the playhead, and Shift+I and Shift+O clear them. Everywhere else I is spec 18's Interact shortcut and O does nothing. This is the one place the two specs share a key, and focus decides it (Rules this spec bends, 7).
- **Esc**, in this order, the first that applies: close an open values panel or ease picker; else clear the tween selection; else spec 18's chain (end an in-place text edit, clear the element selection, close the editor).
- **Playing in Edit mode.** Spec 18's viewer pauses the player when the mode becomes Edit. In the editor the transport may play it again in Edit mode: playback the person starts from the transport runs, and the outlines follow the boxes as they move. Switching to Edit while it plays pauses it, as spec 18 says.
- **Loop**: with looping on, playback wraps from Out (or the end) to In (or 0). With no range it loops the whole length. The range is remembered per motion for the session, in memory.
- **Speed, mute**: the player's own `playbackRate` and `muted`. The speed is per session. Mute starts on, as the viewer starts muted.
- **Scrub**: pressing or dragging on the ruler seeks (the runtime's drag seek while moving, then a commit seek on release). A click on the readout does nothing.
- **Zoom**: a pinch or Ctrl/Cmd+wheel over the strip zooms around the time under the cursor (factor `exp(−deltaY × 0.014)`). The buttons zoom around the playhead when it is in view, else the centre, by 2x steps. Fit shows the whole length, and the strip opens fitted. The range runs from 10 % of fit to 48 px per frame (1,440 px per second). A plain wheel scrolls the rows, and Shift+wheel scrolls time. These ranges are Studio's.
- **The clock**: one `requestAnimationFrame` loop outside React, running only while the motion plays or the person scrubs. Each tick takes the last time the viewer reported, advances it by the elapsed time at the current rate while playing, never past the next report's correction, and writes the playhead's transform and the readout's text directly. No React render happens per frame. Studio's `liveTime` is the model, rewritten for a clock that reads time from messages instead of a same-origin player.

### The viewer and its messages

The editor frames a motion through spec 09's viewer, across origins, so it cannot read the player directly. The viewer, which is the runtime's parent and the player's own document, relays.

- **Editor mode**: the editor's frame URL adds `&ui=editor`. The viewer then creates its player element from script with `runtime-src` and `muted` but without `controls` or `autoplay`, so nothing plays until the transport says so. Without `ui=editor` (the canvas, the live viewer, the snapshot renderer), it creates the element exactly as spec 09 writes it.
- **Messages**: the editor sends `unframed:player:hello` (the frame's load event), then `unframed:player:control` with an action: `play`, `pause`, `seek { seconds, mode: "drag" | "commit" }`, `rate { rate }` (negative while J shuttles), `mute { muted }`, `range { start, end, loop }`, `root-duration { seconds }`. The viewer answers with `unframed:player:state` (relaying each runtime `state` message: time, frame, playing, rate, muted) and `unframed:player:timeline` (relaying the runtime's `timeline` message: clips, duration, size), and replays the last of each to a new hello.
- **Acceptance**: the same rules as the dial relay. It takes control only from a loopback origin that said hello and is not the composition, and takes runtime messages only from the player's own frame.
- **Driving the player**: `play`, `pause`, `seek` (which lands paused), `playbackRate`, `muted`, and `rangeStart` and `rangeEnd` with `loop`. Backward shuttle is a seek every animation frame in the viewer, since the player plays forward only. `root-duration` posts the runtime's own `set-root-duration` control to the composition.
- The runtime's own picker is not used. Spec 18's one edit bridge picks for pages and motions alike.

### The Design tab link

In a motion, spec 18's note on a property a tween animates, `Animated by the agent's code.`, is followed by a link button `Show on timeline`. It opens the strip if hidden, expands the element's row, selects the tween that animates that property (the earliest after the playhead when there are several, else the last), and scrolls it into view.

### Persisted formats

No new project records. A committed burst is a spec 18 edit version: a new file with `source: "edit"`, `of`, and the `edits` lines above. Dials stay spec 09's `dials` prop. One preferences store key: `editor.timeline: { height: number; open: boolean }`. The loop range, speed and zoom are memory only.

### RPC methods

| Method | Input | Success | Failures |
| --- | --- | --- | --- |
| `motion.timeline` | `{ project, file }` | `MotionTimeline` | `bad_request`: `Which composition? Pass its .html file name.`; `not_found`: `No file {file} in this project.` |
| `artifact.edit` (spec 18) | gains the six motion edit types | spec 18's answer | spec 18's, plus the refusal sentences in Motion edits |

### The agent

- No new tool. `motion_read` returns the current file, which holds the person's timeline edits, and spec 07's change note already counts them as the person's changes (spec 18).
- `dials-timeline.md` gains one rule (Assets). It goes into `motion_write`'s description, because a value taken straight from a dial is what the timeline can drag and an expression is not.
- Turn revert keeps its rule: a motion the person edited on the timeline after the turn is skipped (spec 07, through spec 18).
- Outside agents (spec 14) get the same tools, so the same holds for them.

### Rules this spec bends

1. **Spec 09, Out of Scope**: "Keyframe or curve controls in the parameters column or the canvas panel." becomes: the parameters column and the canvas panel still have none. The editor's timeline edits existing keyframes' timing, easing and values, and adds no keyframe and no curve editor. Why: the person asked for timing edits on the motion itself.
2. **Spec 09, The viewer page**: "Loads `hyperframes-player.js` and mounts `<hyperframes-player runtime-src="hyperframes-runtime.js" controls muted autoplay>`." becomes: it creates that element from script, and with `ui=editor` leaves out `controls` and `autoplay`. "Relays dial messages … Everything else is ignored." gains the `unframed:player:*` relay. The protocol table gains those messages. Why: the transport replaces the player's controls in the editor, and only the viewer can reach the player.
3. **Spec 09, The editor, Centre body**: "With Fill it takes the whole body." For a motion with a file, the body is the frame above the timeline strip, and the preview size fits the frame's part.
4. **The pinned HyperFrames version, and spec 09, Licences**: the 0.8.93 that `@hyperframes/core`, `engine`, `player` and `producer` are pinned at, and that spec 18 pins `@hyperframes/parsers` at, moves to the newest release, all five together. The licence list gains the ported HyperFrames Studio code (Apache-2.0). The index's Stack line already names `@hyperframes/parsers` (spec 18) and does not change.
5. **Spec 18, the Design tab**: "The section shows `Animated by the agent's code.` (a later spec may link it)" keeps the sentence and adds the `Show on timeline` link.
6. **Spec 18, Motions in Edit mode**: "The viewer pauses the player when the mode becomes Edit; the player's own controls still seek, and the boxes follow." In the editor the player has no controls of its own (bend 2); the transport seeks instead, and it may play the motion in Edit mode, so the pause on entering Edit holds only until the person starts playback from the transport. Why: a person times an edit by watching it play, without leaving Edit mode.
7. **Spec 18, Mode shortcuts** ("V and I switch from anywhere in the editor except a text field or an in-place text edit, and from inside the frame through the bridge"): with the focus in the strip (its time area or one of its rows), I sets the loop's In point instead of switching to Interact. Why: I and O are the editing convention for a range, and the strip is where a range is set; focus keeps the two apart. Spec 18's edit bridge, "It forwards V, I, Esc, Shift+Enter and the editor's undo keys to the editor as `unframed:edit:key`", also forwards Space, J, K, L, M, the arrows, Shift+L and O in a motion, under spec 18's exception for an in-place text edit. Spec 18's Esc chain gains two steps before it (The transport).
8. **Spec 18, The edit bridge**: its message table gains `unframed:edit:tweens`, and its `unframed:edit:patch` gains the `tween` kind.
9. **Spec 18, Point and tell, the chip**: "Excerpt: the element's start tag as in the source (…), its own text cut to 80 characters, `…` for any children, and its end tag, cut to 240 characters." For a chip made by `Ask the agent to make this editable` on a tween, the excerpt is the tween's `source` (the call as written) instead, cut to 240 characters, and the selector and label are still the element's. Why: the agent must see the code that sets the value, not the element's markup.
10. **`assets/prompts/dials-timeline.md`** gains one sentence (Assets).
11. **CLAUDE.md, Commands**: "`pnpm test:perf` runs the frame-budget specs (specs 02, 09, 12 and 17)" gains spec 21.
12. **00-index, Vocabulary**: "Editor: … dials (DialKit parameters) on the right." gains "and, for a motion, the timeline under it". The index gains this spec's terms.

Not bent: spec 18's attribute allow-list (timing attributes go through this spec's own edits only); spec 18's burst key and its selection trigger, which are generic, so tween edits and the tween selection use them as they are; spec 18's rule that editor edits work in both modes; contract 3 and the preview origin (no route, header or policy changes; the strip talks to the frame by messages only), contract 9 (the strip is editor UI, the reading runs in the engine, and the clock runs only while playing or scrubbing), the hosting contract (spec 01), spec 09's "every edit is a new file", and spec 09's render rules.

## Testing Decisions

A good test drives one of the three seams and asserts only on what it exposes: return values of domain functions, RPC answers and the files and sidecars the engine writes, and what a person sees in the editor. No test reaches into React state, the strip's stores or the bridge's internals.

- **Domain seam**, table-driven, one row per case:
  - `ownerOf`: each literal form, relative strings, dial paths in dot and bracket form, nested folders, arithmetic on a dial, a reassigned or destructured parameter, a token call, and anything else.
  - `dialsCallback`: function, arrow and named-function forms, and the last declaration winning.
  - `motionTimeline`: over fixture files, for each read-only reason, staggers (number, `each`, `amount`, other options), groups and mixed tweens, repeats, keyframe forms, clips with literal, referenced and runtime-moved timing, the three `script` states, and the `__raw:` ease and the missing duration text handled as expressions.
  - `carryFor`: each refusal, dial carry, and HyperFrames' matcher cases.
  - Every motion edit type applied to HTML and read back by `motionTimeline` (the round trip is the assertion), plus each refusal and each summary line.
  - Timeline maths: frames, readouts, snapping priorities and the free key, zoom anchoring and limits, the ruler step, dial limits.
  - The built viewer, against a stub window, in both modes and for every relay and refusal.
  - The built edit bridge's tween patcher and live report, run with real GSAP on stub targets: finding by channels, single invalidation, recreation for object keyframes, ease and stagger, retiming, the declined cases, the order decline, the deferred seek, and patches re-applied after a dials apply.
  - The probe's counts over the committed fixtures and samples.
- **Engine seam**: `motion.timeline` answers and caching; `artifact.edit` with motion edits writing a new version through spec 09's writer with spec 18's sidecar, keeping `data-hf-id`, refusing on a stale base and on a locked target, never touching a render or its sidecar; the library copied from the upgraded packages; and `motion_write`'s description carrying the new rule. The before-and-after render comparison needs a real Chrome and ffmpeg, so it is the person's step (task 2), not a test, as spec 09's real render is.
- **Browser seam**: the strip, transport, keys and focus, the Esc order, rows, drags, snapping, the values panel, the ease picker, dial two-way and held dials, read-only states and the ask action, clips, the end marker, the Design link, the race, edits in Interact mode, and the performance budget. A motion fixture with literal, dial-owned, token-owned and computed tweens, a stagger, a loop and two clips serves most of them.
- Prior art: spec 09's bridge and viewer tests against stub windows, spec 09's dial end-to-end tests, spec 18's burst and race tests, spec 02 and 09's frame budgets.

## Tasks

1. Upgrade `@hyperframes/core`, `engine`, `player`, `producer` and spec 18's `@hyperframes/parsers` together to the newest release, alone on its own pull request: the library copies come from the new packages' files, puppeteer still downloads no browser, `hf-ids` stamps as before, and the existing artifact and render suites pass. Seam: engine.
2. Render comparison, the person's step, not a test (it needs a real Chrome and ffmpeg, as spec 09's real render does). On the upgrade's pull request, before it merges: the sample motions rendered and snapshotted at 0.8.93 and at the new version on the same machine, stills at 0 s, 1 s and the last frame compared by eye and by a pixel difference, and the result and any difference explained or fixed, recorded in the pull request. The agent may prepare the samples and a script for the stills; the person runs it.
3. Add the `dials-timeline.md` rule and the sample motions, then the probe test: over the committed fixtures and samples, the tween counts by owner and read-only reason match what each file is written to produce. Seam: domain.
4. Probe report, not a test. Run the probe's count over the committed files and over any motions the person supplies, and write `docs/research/motion-editability.md` with the counts and one example per reason. Stop and report to the person if fewer than half of the agent-written tweens have an editable start and duration.
5. Value owners: `ownerOf` giving `source`, `dial`, `token` and `script` for literals, relative strings, dial paths, arithmetic, tokens and the rest, and `dialsCallback` for its three forms. Seam: domain.
6. The reading's tweens: located calls, every value read from its own node (the duration included), `__raw:` treated as an expression, read-only reasons with their sentences, starts, repeats. Seam: domain.
7. The reading's targets: selectors resolved to `data-hf-id` in document order, stagger offsets for each form, groups and mixed tweens, keyframes at 0, 1 and each step. Seam: domain.
8. The reading's clips and length: literal, referenced and runtime-moved timing, and `carryFor` with every refusal and dial carry. Seam: domain.
9. `motion.timeline` RPC: the reading for a file, cached per file, its two failures, and `none` and `unreadable` answered without error. Seam: engine.
10. Edit `tween-time`: start and duration through HyperFrames' writer, a keyframed tween's resize, millisecond rounding, the limits, locating by index and id through a burst of several edits. Seam: domain.
11. Edits `tween-ease` and `tween-stagger`: spec 19's catalogue names, the as-written ease, `easeEach` on keyframes, a token ease, the three stagger forms. Seam: domain.
12. Edit `tween-value`: from, to and keyframe steps, units kept, every colour form spec 19 accepts (hex, `rgb()`, `hsl()`, `oklch()`, named) and a refused one, tokens written, and Detach writing the token's resolved value as the kit writes it. Seam: domain.
13. Edits `clip-time` and `composition-duration`: attributes and carried tweens shifted and scaled in one edit, refusals from `carryFor`, the length. Seam: domain.
14. Motion edit refusals for owners other than `source`, for a locked target (a tween's target, a clip, a tween a clip carries, the root), for a changed id and for a writer no-op, and the `edits` summary lines. Seam: domain.
15. `artifact.edit` with motion edits: a new version with spec 18's sidecar and the summary lines, `data-hf-id` kept, a stale base refused, no render touched, and the token check against the project's kit. Seam: engine.
16. `artifact.edit` refuses a `tween-time`, a `tween-value` and a `clip-time` whose targets include an element in the shape's `lockedElements`, or one inside it, with spec 18's lock sentence, and writes nothing. Seam: engine.
17. Timeline maths: frames at 30 fps, both readouts, snapping priorities and the free key, zoom anchoring and limits, the ruler step, dial limits and steps for a drag. Seam: domain.
18. The viewer's editor mode and player relay: no controls or autoplay with `ui=editor`, spec 09's markup without it, the control actions, the relayed state and timeline replayed on hello, backward shuttle by seeks, and the origin rules. Seam: domain.
19. The edit bridge's live report: tweens with targets, timing, keyframes and repeats after load and after a dials apply, at most once per frame; and the forwarded transport keys, with none but Esc and Enter forwarded during an in-place text edit. Seam: domain.
20. The edit bridge's tween patcher, ported with its header and notices: finding by channels, values with one invalidation, recreation for object keyframes, ease and stagger, retiming, the declined cases, the order decline, the deferred seek, and patches re-applied after a dials apply. Seam: domain.
21. The strip: present under a motion with a file and absent for a page or an empty motion, the frame fitting above it, resize between its limits, hide and show, the preference remembered across a reload, and the canvas player still showing its own controls. Seam: browser.
22. Transport playback: Space, the readout in seconds and frames while playing, frame steps with and without Shift, the speed menu, mute, playing from the transport in Edit mode with the outlines following, and the playhead moving with no per-frame React render. Seam: browser.
23. Shuttle and loop: J, K and L at each speed, I and O in the strip and I as Interact outside it, Shift+I and Shift+O, Shift+L looping the range and the whole length, and the keys forwarded from the frame in Edit mode. Seam: browser.
24. Keys and focus: with a Tabs list, a ToggleGroup, a Layers row, an input, a menu or the composer focused, Space, the arrows and J, K and L do what that control does and the transport does not act; Esc closes an open values panel, then clears the tween selection, then follows spec 18's chain. Seam: browser.
25. Ruler and zoom: scrubbing by press and drag, pinch and Ctrl+wheel anchored on the cursor, the buttons, Fit, and the zoom limits. Seam: browser.
26. Rows: clips in track order, element rows under their clip and under `Composition`, lanes on expand, diamonds, stagger bars on each target, repeat copies, runtime rows greyed, locked and hidden rows, and selection synced with the frame and Layers. Seam: browser.
27. Move a literal tween: the frame changes while dragging, the burst commits one version 1.5 s after the last drag, the sidecar's summary line, and one undo restoring the previous version. Seam: browser.
28. Stretch from both edges, the snap targets and their guide, whole frames, and free placement with Alt. Seam: browser.
29. Dial-owned timing: dragging moves the dial at once in the frame and the Parameters tab, with no new version, and writes `dials` when the burst commits, as one undo step; the drag stops at the dial's limits; moving the dial moves the bar; a mixed left-edge stretch commits the file and the dial as one undo step. Seam: browser.
30. Staggers: dragging any target's bar moves the whole stagger, and the stagger field respaces it. Seam: browser.
31. The ease picker: spec 19's 31 eases with their curves, the as-written ease, kit easing tokens, and a select dial limiting the choice and being set. Seam: browser.
32. The values panel: numbers with units and colours at a diamond (an `oklch()` and a named colour among them), a token chip with change and Detach, the dial chip, the from and to sentences, and the repeat line. Seam: browser.
33. Read-only: a value owned by `script`, a loop and a helper show `Set by the agent's code.` with their reasons, the gesture never starts, and `Ask the agent to make this editable` puts the element chip, with the tween's source as its excerpt, into the artifact's chat composer. Seam: browser.
34. Clips: a move and a stretch carrying their tweens, a carried dial moved in the same undo step, a refused carry with its sentence, and a clip referenced by another refused. Seam: browser.
35. The end marker changes `data-duration`, snaps to the last clip and the playhead, and playback follows while dragging. Seam: browser.
36. The Design tab's `Show on timeline` opens the strip, expands the row and selects the tween. Seam: browser.
37. Agent wins: a scripted agent write during a burst and a stale commit both show `The agent rewrote this. Your last change wasn't saved.`, write no dials, and reload the strip on the new version with the playhead and the selected tween kept. Seam: browser.
38. Interact mode: dragging a bar and the values panel edit exactly as in Edit mode, clicks in the frame reach the motion, and switching mode either way commits an open burst. Seam: browser.
39. After any new version, the playhead time and play state are kept, and the edited bars do not jump back while the new reading loads. Seam: browser.
40. Performance budget: a motion with 60 tweens over 6 clips and the strip open plays for 4 s, and a bar is dragged for 2 s, with the median frame gap at or under 16.7 ms, no more than 2 % of frames over 33 ms, and no long task over 50 ms on the app thread, in the hosted shape. Enforced by `pnpm test:perf` on real hardware, the rest asserted everywhere. Seam: browser.

## Out of Scope

- Adding or removing keyframes, tweens or animated properties. The person asks the agent for those.
- A custom curve editor, springs, wiggles and Studio's other ease modes beyond GSAP's named eases and kit tokens.
- Dragging a single keyframe in time within its tween.
- Motion paths, audio envelopes, clip split, moving a clip to another track, and moving several tweens at once other than a stagger or a clip's carry.
- Unrolling loops and helpers into literal tweens. They stay read-only.
- Editing repeat counts, yoyo, labels or relative positions.
- Marking renders stale, or re-rendering after an edit.
- Any timeline on the canvas or in the live viewer.
- Using the HyperFrames runtime's own element picker.
- Sub-compositions inside a motion (clips of kind `composition`). They show as clips and are read-only.

## Open decisions

None open. Settled with the person:

1. **The strip's width in a narrow window.** Below a 1280 px window the strip spans the centre and right columns, and its label column collapses to icons below 900 px of strip (Layout).

## Further Notes

- **What the brief and the code disagree on.** HyperFrames' property groups are six, not five: `size` (width, height) sits between scale and rotation, and this spec keeps it. Studio does retime live tweens after a save (its `gsapLiveRetime`), so timing preview is new only for its patcher. Studio has no snap-to-frame and no free-drag key, only a snapping toggle. Frame snapping and the Alt key are Unframed's. Studio never shows staggers on the timeline, so the per-target bars are Unframed's. Studio leaves tweens that cannot follow a clip move silently in place, and this spec refuses the move instead. The runtime picker reports `data-hf-id` only inside `dataAttributes`.
- **Why the reading runs in the engine.** A file never changes, so one reading per file serves every editor open on it. The engine must check every commit against the same reading anyway. And the parser with its HTML parser stays out of the web bundle.
- **Why the bars come from the source, not the live timeline.** The source is what an edit changes and what the engine checks, so drawing from it means a draggable bar is always a bar the engine will accept. The live report fills in only what the source cannot place.
- **Why commits name tweens by index.** HyperFrames' animation id includes the tween's start, so it changes when a tween moves. The index in source order does not change under the edits this spec makes. The id is still checked, so a mismatch is a refusal, never an edit to the wrong tween.
- **Licences.** `@hyperframes/parsers` and HyperFrames Studio: Apache-2.0. The parser runs in the engine. The ported patcher ships inside the generated edit bridge in every project folder, with its header. Studio's live-time, snapping and zoom patterns are rewritten from their descriptions, and the notices credit them too.

### Assets this spec needs

- `assets/prompts/dials-timeline.md` gains one sentence after its example, written at build time. Proposed: "Put a parameter's value straight into the tween (`duration: v.speed`, `x: v.toX`, a position of `v.delay`), never inside an expression such as `v.speed * 2`: the person can drag a value taken straight from a parameter on the editor's timeline, and anything computed is read-only there." The file's header changes from "Verbatim" to say that this sentence is Unframed's own.
- `assets/fixtures/motion-samples/`: six or more motions written to follow `dials-timeline.md`, made at build time for the probe and the browser tests. Together they cover literal and dial timing, a token ease, a stagger, a loop, a helper, keyframes and two clips.
- No new instruction asset. "Ask the agent to make this editable" uses spec 18's point and tell, with the tween's source as the chip's excerpt (Rules this spec bends, 9).
