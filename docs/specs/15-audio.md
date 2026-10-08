# 15 · Audio

Depends on: 01 to 13 (read 00-index first). Spec 14 is not a dependency.

## Problem Statement

Unframed makes images, video and text from a selection, but not sound. A person writing a storyboard or a motion wants the narration, the line of dialogue or the voiceover made on the same canvas, from the same prompts, and kept with the same record of what it cost and how to make it again. Today they leave the app for ElevenLabs, generate there, download the file and drag it back in, and the result carries no recipe.

OpenRouter, which runs every other medium, has no text-to-speech model good enough for this (issue #63). ElevenLabs does, but it is a second provider with its own key, its own catalogue of models and voices, its own delivery settings, and its own unit of spend: credits, whose price depends on the person's plan. None of the app's rules assume a second provider. The key rules, the cost field every sidecar carries, the single stub origin the tests use, and the canvas's shape kinds all have to make room for it without breaking what they promise.

The issue was written against the old app: an "Audio node" with an "Add to canvas" button. The rewrite has no nodes, no wires and no "Add to canvas" (specs 02 and 03, Out of Scope): results land on the canvas directly.

## Solution

The Generate tray gains the **audio** medium. With audio chosen, the selected prompts plus the per-run instruction are the text that gets spoken. The tray shows a voice chip, the model chip (defaulting to ElevenLabs' current flagship, Eleven v4), the delivery controls that shape the line (Stability, Style when the model takes it, Speed) and an **Advanced** chip holding the technical ones (Similarity, Speaker boost, Format, Seed, Language). Generate makes one ElevenLabs text-to-speech call. The answer lands on the canvas as an **audio** shape: a small card with a player. It carries spec 03's recipe, so Regenerate reopens the composer on it as on any result, and its line shows the ElevenLabs credits the call used, in credits, never dollars.

The canvas gains the **audio** shape kind for any sound file: dropped, pasted, picked with "Choose file", or generated. An audio shape is not an input to any run in this spec: selected into an image, video or text run it sends nothing and shows the unused mark, as an artifact does.

Settings gains an **ElevenLabs** block beside OpenRouter: paste a key, remove it with a confirm, see the account's credit usage for the current billing period, and pick the default audio model. The block shows even without an OpenRouter key, so someone who only wants audio can set up ElevenLabs alone; image, video and text generation still need OpenRouter. ElevenLabs offers no OAuth flow for third-party apps, so there is no Connect button: the key is pasted, and stored in `.env` exactly like the OpenRouter key.

What carries over from the issue and what changes:

| Issue item | Here |
| --- | --- |
| Audio node | an audio medium in the Generate composer, and an audio shape on the canvas |
| Voice picker, model picker (default Eleven v3) | voice chip and voice dialog; model chip and model dialog, default `eleven_v4`, which replaced v3 as ElevenLabs' flagship since the issue was written |
| Instructions field appended after the connected prompt | the composer's per-run instruction, appended after the selected prompts (spec 03) |
| Stability, style, speed on the node; similarity, speaker boost, format, seed, language behind Advanced | the same split, as tray chips and an Advanced chip |
| Generate, inline player | Generate in the composer; the player is the audio shape itself |
| "Add to canvas" makes an Audio input node | gone: the result is already a shape on the canvas. Using it as an input is a later spec |
| Bracketed performance tags | passed through as typed, with a one-line hint under the box |
| Cost per generation; credits used for the connected key | credits on the result's line and in its sidecar; the account's credits for the billing period in Settings, labelled as the account's (ElevenLabs gives a personal key no per-key read) |
| Pronunciation dictionaries, sound effects, music | out of scope, as the issue says |

## User Stories

1. As a person, I want to pick "audio" as the medium in the Generate tray, so that the prompts I selected become spoken audio instead of a picture.
2. As a person, I want the selected prompts and my instruction to be the text that is spoken, joined in the order they sit on the canvas, so that audio composes the same way every other medium does.
3. As a person, I want `@id` references in the spoken text resolved like any prompt's, so that I can pull a line in by name.
4. As a person, I want to pick a voice from a searchable list of the voices my ElevenLabs account can use, so that I am not limited to a fixed set.
5. As a person, I want to hear a short preview of a voice before I pick it, so that I do not pay to find out it is wrong.
6. As a person, I want the voice list to show each voice's category and descriptive labels (accent, gender, age, use), so that I can scan for the one I want.
7. As a person, I want more voices to load when my account has more than one page of them, so that a large library is reachable.
8. As a person, I want the composer to refuse to send until a voice is picked, and to say so, so that a run never fails on a missing voice.
9. As a person, I want a model picker listing ElevenLabs' text-to-speech models, so that I can choose speed or quality.
10. As a person, I want a fresh tray to start on the default audio model from settings, Eleven v4 unless I changed it, so that I get the best model without choosing.
11. As a person, I want the delivery controls (Stability, Style, Speed) visible in the tray, so that the settings that shape a line are one click away.
12. As a person, I want the technical controls (Similarity, Speaker boost, Format, Seed, Language) behind an Advanced chip, so that they do not crowd the delivery controls.
13. As a person, I want Style and Speaker boost offered only when the model declares it takes them, so that I never set a knob that does nothing.
14. As a person, I want each slider to show its value and a way back to the default, so that I can experiment and undo.
15. As a person, I want the Language list to be the languages the chosen model declares, so that I cannot pick one it does not speak.
16. As a person, I want switching the model to reset the model-driven settings, so that a setting the new model ignores is never carried over.
17. As a person, I want a hint that bracketed directions such as `[whispers]` shape delivery, so that I learn the convention without reading ElevenLabs' docs.
18. As a person, I want a warning when my text is longer than the model takes in one request, naming both numbers, so that I shorten it before paying.
19. As a person, I want images and clips in my selection marked as unused while the audio medium is on, with one warning line, so that I know they will not be sent.
20. As a person, I want Cmd+Enter to generate, as in every other medium, so that the composer behaves the same everywhere.
21. As a person, I want a placeholder where the audio will land while it generates, so that I can see the run in flight.
22. As a person, I want the result to land as an audio shape beside my selection, so that it sits with the material it came from.
23. As a person, I want the result's line to show the model, the duration and the credits the generation used, so that I know what it spent in the unit ElevenLabs bills.
24. As a person, I want credits shown as credits and never converted into dollars, so that I am never shown a price my plan does not charge.
25. As a person, I want Regenerate on an audio result to reopen the composer with its voice, model, settings and instruction, so that another take, or "same line, slower", is one change and Cmd+Enter away.
26. As a person, I want no Generate on an audio result's bar, so that I am not offered a run that would take the result as input when audio is never an input.
27. As a person, I want no Vary and no one-click repeat on an audio result, so that every paid take goes through the composer where I can see what it will send.
28. As a person, I want a failed audio run to say why in a toast, in ElevenLabs' own words where it gave any, so that I can fix it.
29. As a person, I want a message that names both causes when ElevenLabs refuses for lack of credits (the account's quota, or the key's own credit limit), so that I try the right fix.
30. As a person, I want the audio file and its sidecar written into the project folder, never overwriting another file, so that the folder is a complete record of what I generated.
31. As a person, I want an audio run to finish and land even if I close the tab, so that I never pay for a line that never reaches the canvas.
32. As a person, I want to drop or paste an mp3, wav or m4a onto the canvas and get an audio shape, so that I can keep reference sound with my board.
33. As a person, I want to add an empty audio shape from the add menu and pick a file into it, so that I can place a slot before I have the file.
34. As a person, I want dropping a sound file onto an audio shape to replace its file, so that I can swap a take in place.
35. As a person, I want play, pause, a position slider and a time readout on the audio card, so that I can listen without leaving the canvas.
36. As a person, I want the player's controls never to drag the shape, and the rest of the card to drag it, so that scrubbing and moving never fight.
37. As a person, I want starting one audio shape to pause any other that is playing, so that two lines never talk over each other.
38. As a person, I want "Reveal in Finder" on an audio shape, so that I can find the file on disk.
39. As a person, I want to copy and paste audio shapes, including across projects, so that I can reuse a take.
40. As a person, I want to paste an ElevenLabs key in Settings, so that the audio medium can run.
41. As a person, I want a clear error when what I pasted does not look like a key, so that a stray paste is caught at once.
42. As a person, I want to remove the ElevenLabs key with a second confirming click, so that a stray click does not lose it.
43. As a person, I want Settings to show how many credits my ElevenLabs account has used this billing period, of how many, and when it resets, so that I know when generation will stop.
44. As a person whose ElevenLabs key was revoked, I want Settings to say it no longer works, so that a mystery failure becomes an obvious fix.
45. As a person, I want to pick the default audio model in Settings, alongside image, text and video, so that new audio runs start on the model I prefer.
46. As a person who only wants audio, I want to add an ElevenLabs key without connecting OpenRouter, so that I can generate speech without an account I do not need.
47. As a person with only an ElevenLabs key, I want image, video and text to tell me they need an OpenRouter key, and the settings dialog to stop opening on its own, so that the app works for audio and says plainly what else it needs.
48. As a person, I want the ElevenLabs key never to reach the browser, with the app knowing only whether there is one and its last four characters, so that the same promise covers both keys.
49. As a person, I want the composer to open on the voice, model and settings I last used for audio, so that a second line in the same voice takes no setup.
50. As a person, I want to save audio settings as a group's recipe, so that a group of lines always speaks in one voice.
51. As the agent, I want `canvas_read` to report audio shapes with their file, and `canvas_write` to place one from an existing project file, so that I can see and arrange sound on the board.
52. As a maintainer, I want the audio sidecar to carry credits in their own field and no `cost` field, so that a dollar spend summed over `cost` is never corrupted by credits.
53. As a test author, I want every ElevenLabs call pointed at an in-test stub through one loopback-only variable, so that the audio path is tested without spending credits.
54. As the desktop shell, I want nothing I depend on to change, so that installed apps keep working when this lands.

## Implementation Decisions

### Terms this spec adds

- **audio** (shape kind): a custom tldraw shape naming a sound file in the project folder. Added to 00-index's shape list when this spec is built.
- **Voice**: an ElevenLabs voice, by its `voice_id`. The text-to-speech endpoint takes it in the URL path.
- **Credits**: ElevenLabs' billing unit. The price of a credit depends on the person's plan, so Unframed never converts credits into money.
- **Delivery settings**: ElevenLabs' `voice_settings` object (stability, similarity boost, style, speaker boost, speed).

### Modules

| Module | Package | Interface | New or extended |
| --- | --- | --- | --- |
| Audio params | domain | `audioParams(entry)` returns the props the model declares and their ranges or values; `audioDefaults(params)`, `audioReset(props, params)`, `audioKeep(props, params)` | new |
| Audio request | domain | `audioRequest({ composition, props, voice, model })` returns `{ text, voiceId, query: { output_format }, body: { text, model_id, voice_settings?, seed?, language_code? } }` and the roles for the selection's media | new; deep: the tray, the badges and the engine payload all come from it |
| Audio status | domain | `audioStatus({ composition, props, voice, entry, hasKey })` returns spec 03's `TrayStatus` | new |
| ElevenLabs answers | domain | `creditsFrom(headerValue)`, `elevenLabsMessage(status, body)`, `audioExtension(format)`, `audioLine({ model, durationMs, credits })` | new |
| ElevenLabs status copy | domain | turns an `ElevenLabsStatus` into the Settings lines | new, beside spec 10's key status copy |
| Settings rules | domain | the two new `.env` variables, their validators and normalising | extended (spec 01) |
| Media naming and drop kinds | domain | the extension table gains audio types; the drop kind gains `audio`; the allowed-member rule refuses audio | extended (spec 02) |
| Menu rules | domain | Reveal on a filled audio shape | extended (spec 02) |
| Recipe rules | domain | `recipeChip` for an audio recipe | extended (spec 06) |
| `Medium` and the recipe schema | contracts | `Medium` becomes `["image", "video", "text", "audio"]`; `ResultMeta` gains `credits?: number \| null` | extended (spec 03) |
| Audio shape schema | contracts | the `audio` shape's props and meta, with its first migration, used by room and web | new |
| Settings schemas | contracts | `Settings` gains `hasElevenLabsKey`, `elevenLabsKeyHint`, `audioModel`; `SettingsPatch` gains `elevenLabsKey`, `audioModel` | extended (spec 01) |
| ElevenLabs client | engine | one adapter for every ElevenLabs call (models, voices, speech, subscription), reading the base URL from config so tests point it at a stub | new |
| Audio run service | engine | `run.audio`; registers in spec 03's run registry and uses spec 03's placeholders, file naming and run events | new, mirrors spec 05's text run service |
| Catalogue proxy | engine | `models.list({ medium: "audio" })` and `voices.list` | extended (spec 03) |
| Settings store | engine | reads and writes the two variables; `settings.removeElevenLabsKey`; `elevenlabs.status` | extended (specs 01 and 10) |
| Canvas tool service | engine | `canvas_read` reports audio shapes; `canvas_write` creates them | extended (spec 07) |
| Audio shape | web | the shape util: empty state, player card, placeholder | new |
| External content handler | web | `audio/*` drop and paste | extended (spec 02, `externalContent.ts`) |
| Audio medium | web | registered into spec 03's medium registry (`mediumRegistry.ts`) with its voice chip, tray props, Advanced chip, roles, status and send | new |
| Voice dialog | web | the searchable voice table | new |
| Settings dialog | web | the ElevenLabs block and the Audio default model | extended (spec 10) |

### The audio shape

- **Schema.** tldraw has no audio shape or audio asset, so `audio` is a custom shape like page and motion (spec 02): `meta.ref: string`; `props: { w, h, file: string, fileName: string }`. `file` is a bare project file name, `''` when empty; `fileName` is the original name of a dropped or picked file, `''` otherwise. Its result meta, run marker and run error live under `meta.unframed` as spec 03 defines them. Defined in contracts with its first shape migration, shared by the room and the web.
- **Size.** Default 320 × 64. Width 200 to 640, height fixed at 64 (resize changes width only). Empty default 240 × 64.
- **Empty state.** A card frame (spec 12: `--card` fill, the kit border, 10 px radius), the label "Audio" above it in spec 02's label type (`@<name>` once named, below), and a "Choose file" button (the kit's small outline Button) opening the OS picker for `audio/*`.
- **Filled.** The same card, holding one row: a Play or Pause button (the kit's ghost icon Button, labels "Play" and "Pause"), then a column with the title in `text-xs` (a result's spoken text with whitespace collapsed, first 40 characters, ellipsised; otherwise `fileName`, else `file`) above a position slider (the native range input in the highlight colour, label "Position", step 0.01 s) and the readout `m:ss / m:ss` in tabular numerals, muted. The audio element preloads metadata only and never autoplays.
- **Controls are controls.** A press on the button or the slider never starts a shape drag or a selection; a press anywhere else on the card drags the shape. This is spec 02's rule for the video transport.
- **One at a time.** Starting playback on one audio shape pauses every other audio shape playing in the tab.
- **Remove.** A selected filled audio shape shows spec 02's remove button at its top-right corner (label "Remove <file name>"). It clears `file` and `fileName`; the file stays on disk.
- **Placeholder.** While it carries a run marker: the filled card's frame with spec 12's spinner and `Generating…` in place of the controls.
- **Label.** Filled or empty, the label above the card reads "Audio" until the shape is named, then `@<name>` (spec 06). It follows spec 02's `labelLevel` like every other label.
- **Not groupable.** An audio shape is not a member a group may hold: spec 02's allowed-member rule refuses it, as it refuses pages and motions. A selected audio shape is left out of `Cmd-G`'s wrap and stays on the page when dragged over a group. Groups and presets that hold audio are a later spec (Out of Scope).
- **Copy and paste.** tldraw's copy, then spec 02's fix-ups: a fresh ref. Within a project the copy names the same file, as an image does. Across projects the file is copied with `files.copy` and `from`, and a result's recipe comes along through spec 03's `recipe.copy`. A failed copy pastes the shape empty with spec 02's toast.
- **Context menu.** The Image section's reveal item and "Copy path" (spec 02) apply to a filled audio shape too; the files reveal shows are every selected filled image, video and audio shape. The Reference section's "Copy @<ref>" and "Rename F2" apply as on every shape with an `@id`.
- **Name.** Like every kind but a mark, an audio shape can be named (spec 06): a double-click on its label, Rename, or F2. Its label reads "Audio" until it is named, then `@name`. A `@name` of an audio shape in a prompt or instruction is left as typed, as a page's is (below: audio contributes nothing to a composition).
- **Add menu.** Inputs gains "Audio" after Video, icon lucide `AudioLines`. No single-key shortcut.

### Bringing sound files in

- **Upload naming.** Spec 02's extension table gains `audio/mpeg` mp3, `audio/mp3` mp3, `audio/wav` wav, `audio/x-wav` wav, `audio/wave` wav, `audio/mp4` m4a, `audio/x-m4a` m4a. Spec 01's file route already serves `.mp3`, `.wav` and `.m4a` with their audio types and byte ranges, and spec 09's preview origin already serves mp3 and wav. Neither changes.
- **Drop.** A file whose type starts with `audio/`, or whose name ends `.mp3`, `.wav` or `.m4a` (case-insensitive), becomes an audio shape at the drop point, after its upload answers, with spec 02's 24 px offset for several files and spec 02's failure toast. A sound file dropped onto an audio shape replaces its file. There is no audio size cap beyond spec 02's 500 MB upload body.
- **System paste.** A pasted sound file is uploaded and becomes an audio shape at the pointer, or fills every selected audio shape. A pasted file with no name is named `pasted-audio.<ext>` from its type (`mp3` when unknown).

### Audio in other media's runs

Spec 03's selection to request is unchanged except for one rule: an audio shape contributes nothing to any composition, loose or selected, the way an artifact does. While the Generate tray is open, a selected audio shape shows the unused mark (spec 03's dash glyph), in any medium. A selection holding only audio shapes is not usable, so the toolbar offers Agent only.

### The audio medium

Registered into spec 03's medium registry with label `audio`, catalogue `audio`, dialog title `Audio models`, browse link `Browse on ElevenLabs` to `https://elevenlabs.io/docs/overview/models`. No Runs prop, no Free.

**Text.** The spoken text is spec 03's composition prompt: the selected prompts' resolved text in canvas order, joined with a blank line, with the instruction resolved and appended last. It is sent as typed: bracketed directions such as `[whispers]` reach the model unchanged. Under the box, in `text-xs` muted text, whenever the audio medium is on: `Bracketed directions like [whispers] or [excited] shape the delivery on Eleven v3 and v4.`

**Media.** Every image, video and sketch slot of the composition is unused for audio. The medium's `roles` hook returns the unused mark for every selected media shape, and nothing is rendered or uploaded: an audio send never makes composites or sketches.

**Tray, left to right.** The voice chip, the model chip, one chip per delivery prop in the tray, the `Advanced` chip, then `+ add prop` when a delivery prop is missing. Every chip is spec 03's chip recipe.

- **Voice chip.** Shows the picked voice's name, or `Pick a voice` (Button `outline`, muted text) when none. Opens the voice dialog. There is no default voice: the first audio run asks for one, and the last-used values remember it from then on.
- **Model chip.** Spec 03's model chip, showing the model id (`eleven_v4`). Opens the model dialog.
- **Delivery props**, present in the tray by default when the model declares them, removable and re-addable through `+ add prop`:

| Prop | Key | Offered when | Range | Default | Chip text |
| --- | --- | --- | --- | --- | --- |
| Stability | `stability` | always | 0 to 1, step 0.05 | 0.5 | `Stability 0.50` |
| Style | `style` | the model's `can_use_style` is true | 0 to 1, step 0.05 | 0 | `Style 0.00` |
| Speed | `speed` | the model id is not `eleven_v4` or `eleven_v4_turbo` | 0.7 to 1.2, step 0.05 | 1.0 | `Speed 1.00×` |

  ElevenLabs says Eleven v4 has no Speed setting, but its models list carries no flag for speed, so Speed is hidden on the two v4 model ids by name and offered on every other model, an unknown (`params: null`) row included. A later model id that also lacks speed needs adding to this rule.

  A delivery chip opens a Popover (the kit's, 240 px) holding a labelled range input (the native range in the highlight colour, as spec 02's player), the value as a number in tabular numerals, then a separator, `Reset` (Button `ghost`, sets the default) and `Remove` (Button `ghost`, takes the prop out of the tray). A prop not in the tray is not sent.

- **Advanced chip.** Label `Advanced`, with a count `Advanced · 2` when any advanced prop is set. Opens a Popover (280 px) with one row per advanced prop, each with its own control and a `Reset` that unsets it. An unset advanced prop is not sent.

| Prop | Key | Offered when | Control | Default |
| --- | --- | --- | --- | --- |
| Similarity | `similarity_boost` | always | range 0 to 1, step 0.05 | unset (ElevenLabs uses 0.75) |
| Speaker boost | `use_speaker_boost` | the model's `can_use_speaker_boost` is true | the kit's Switch | unset (ElevenLabs uses on) |
| Format | `output_format` | always | the kit's Select of the formats below | unset (`mp3_44100_128`) |
| Seed | `seed` | always | the kit's NumberField, whole numbers 0 to 4294967295 | unset |
| Language | `language_code` | the model declares at least one language | the kit's Combobox of the model's languages, `name (language_id)` | unset |

  Formats offered: `mp3_44100_128`, `mp3_44100_192`, `mp3_44100_96`, `mp3_44100_64`, `mp3_22050_32`, `wav_44100`, `wav_48000`, `wav_24000`, `wav_16000`. ElevenLabs also offers PCM, Opus, μ-law and A-law, which make files a browser cannot play from disk without a container, so they are not offered. Some formats need a higher ElevenLabs plan; a refusal arrives as an upstream error with ElevenLabs' message. WAV stays offered on every model, Eleven v4 included, until a paid probe shows v4 refuses it: third-party listings of v4 name MP3, PCM, Opus, μ-law and A-law, while the speech endpoint lists `wav_*`. Meanwhile a refusal reaches the person as ElevenLabs' own message.

- **Model change.** Resets every model-driven prop: `style` and `use_speaker_boost` are removed when the new model does not declare them, `speed` is removed when the new model is `eleven_v4` or `eleven_v4_turbo`, `language_code` is unset when the new model does not list it, and the delivery props return to their defaults. The voice, `output_format` and `seed` are not model traits and are kept.
- **Send label** `Generate`, spinner while acknowledging, Cmd+Enter as spec 03.
- **No estimate.** The price slot stays empty: ElevenLabs bills per character in credits at a rate that depends on the model, and the catalogue's rate field is not documented well enough to compute an exact number (spec 03: no guess dressed as a number). A credit estimate is a follow-up (Out of Scope).

**Status lines** (spec 03's band; a blocker disables send):

- No ElevenLabs key (blocker): `No ElevenLabs key yet. Add one in Settings, under ElevenLabs.`
- Empty text (blocker): `Nothing to say. Select a prompt, or type an instruction.`
- No voice (blocker): `Pick a voice for this line.`
- Too long (blocker), when the spoken text's length in characters is above the model's `maximum_text_length_per_request`: `This text is <n> characters, but <model> takes at most <max> in one request. Shorten it, or pick a model that takes more.` Not shown when the model gives no maximum.
- A cycle (blocker): the error line, as spec 03.
- Media selected (warning): `An image is selected, but audio models only read text. It will not be sent.` or `<n> images and clips are selected, but audio models only read text. They will not be sent.` The singular form names `An image` or `A clip` by what it is.

**With only an ElevenLabs key.** The audio medium works in full. Image, video and text keep spec 03's no-key blocker, unchanged, and their catalogues answer only their default rows (specs 03 to 05). When the composer would open on a medium that needs OpenRouter while only the ElevenLabs key exists, it opens on audio instead. The agent is unaffected: it runs on the person's own subscription (spec 07).

**Last-used values.** Spec 01's preference `lastUsed.audio`: spec 03's `{ model?, props }` plus `voice?: { id: string, name: string }`. Written on send from the composer, as spec 03 writes it. A stored voice is shown by its stored name and sent by id; if ElevenLabs no longer has it, the run fails with ElevenLabs' message and the person picks another. Changing the default audio model clears the stored model, as spec 03 does for the other media.

### The voice dialog

The kit's Dialog, 680 px, built like spec 03's model dialog.

- Title `Voices`. Header link `Browse voices on ElevenLabs` to `https://elevenlabs.io/app/voice-library`, opening in a new tab.
- Search field, label `Search voices` (visually hidden), placeholder `Search voices…`. Typing waits 300 ms, then asks the engine again with `search`, so the search is ElevenLabs' own (it matches name, description, labels and category).
- A table with columns **Voice** (the name, an InlineButton that picks the voice and closes the dialog; the current voice bold with a check labelled `Current voice`), **Labels** (the voice's `labels` values joined with ` · `, muted, ellipsised, the full text as tooltip), **Category** (the kit's Badge `outline`: `premade`, `cloned`, `generated`, `professional`, or what ElevenLabs sends), and a **Preview** cell: a ghost icon Button, label `Preview <name>`, that plays the voice's `previewUrl` in one shared audio element and becomes Stop while it plays. No preview URL, no button. Rows keep ElevenLabs' order.
- `Load more` (Button `ghost`, under the table) while the answer says there are more; it asks with the last `nextPageToken` and appends.
- No match: `No voice matches. Clear the search.` A failed load: the kit's Alert `error` with the engine's message above the table.
- Escape closes only the dialog, handled in the capture phase as spec 03's model dialog does.

### The model dialog for audio

Spec 03's model dialog with two changes: ElevenLabs model ids have no provider prefix and the catalogue has no release date, so the columns are **Model** (the id, with the model's `name` as tooltip; picks and closes) and **Languages** (the count of declared languages, right-aligned, 110 px, empty when none). Rows keep the engine's order. No default sort, no Provider column.

### RPC methods

All over spec 01's RPC socket, all failing with spec 01's `UnframedError`.

| Method | Input | Success | Failures |
| --- | --- | --- | --- |
| `models.list` | `{ medium: "audio" }` | `{ models: AudioModel[], default }` | none: falls back like spec 03 |
| `voices.list` | `{ search?: string, pageToken?: string }` | `{ voices: Voice[], nextPageToken: string \| null }` | `unavailable`: `No ElevenLabs key yet. Add one in Settings, under ElevenLabs.`; `upstream`: the ElevenLabs answer messages below |
| `run.audio` | `AudioRunRequest` | `{ runId, batchId, placeholders: [shapeId] }` | the validation list below |
| `elevenlabs.status` | none | `ElevenLabsStatus` | `upstream`: `ElevenLabs answered <status>.` or the network error |
| `settings.removeElevenLabsKey` | none | `{ settings: Settings }` | `internal`: `Could not write .env: <reason>` |

```ts
type AudioModel = {
  id: string; name: string; created: null
  params: { canUseStyle: boolean; canUseSpeakerBoost: boolean
            languages: { id: string; name: string }[]; maxCharacters: number | null } | null
}
type Voice = { id: string; name: string; category: string | null
               labels: Record<string, string>; previewUrl: string | null }
type AudioRunRequest = {
  project: string
  model?: string                       // the default audio model when absent
  voice: { id: string; name: string }
  params: { stability?: number; similarity_boost?: number; style?: number
            use_speaker_boost?: boolean; speed?: number
            output_format?: string; seed?: number; language_code?: string }
  selectionPrompt: string; instruction: string; prompt: string
  sources: string[]
  anchor: { x: number; y: number; w: number; h: number }
  of?: { shapeId: string; action: "regenerate" }   // a send from the composer that Regenerate opened
}
type ElevenLabsStatus =
  | { hasKey: false }
  | { hasKey: true; revoked: true }
  | { hasKey: true; usageHidden: true }
  | { hasKey: true; tier: string | null; creditsUsed: number; creditLimit: number | null; resetsAt: string | null }
```

Run events are spec 03's `run.subscribe` events. An audio `output` event carries `cost: null` and `credits: number | null`.

### ElevenLabs calls

Every call goes to `https://api.elevenlabs.io` (the origin replaced by `UNFRAMED_TEST_ELEVENLABS_ORIGIN` when set, below) with the header `xi-api-key: <key>`. Every call has a 30 second timeout except speech, which has 120 seconds.

- **Models.** `GET /v1/models`. Keep entries whose `can_do_text_to_speech` is true; map `model_id` to `id`, `name` (else the id), `can_use_style`, `can_use_speaker_boost` (false when absent), `languages[]` as `{ id: language_id, name }`, `maximum_text_length_per_request` (else null). Keep ElevenLabs' order. Append the default audio model as `{ id, name: id, params: null }` when missing. Without a key, or on any failure, answer only the default row. A row with `params: null` means "unknown": the tray then offers only the props offered always, and never removes a stored Style or Speaker boost (spec 04's healing rule).
- **Voices.** `GET /v2/voices?page_size=100` plus `search` and `next_page_token` when given. Map each voice's `voice_id`, `name`, `category`, `labels` (string values only), `preview_url`. `nextPageToken` is `next_page_token` when `has_more` is true, else null.
- **Speech.** `POST /v1/text-to-speech/<voice id>?output_format=<format>` with `Content-Type: application/json` and the body `{ text, model_id, voice_settings?, seed?, language_code? }`. `voice_settings` holds exactly the delivery and similarity keys the request sets, and is absent when it sets none, so the voice's own saved settings apply. `seed` and `language_code` are sent only when set. `output_format` defaults to `mp3_44100_128`. The answer body is the audio bytes. The credits are the `character-cost` response header read as a finite number at or above zero, else null. The header is treated as credits (after the model's rate), not raw characters; that is unconfirmed until the person's paid Flash call (Further Notes). The `request-id` header, when present, is kept for the sidecar.
- **Subscription.** `GET /v1/user/subscription`, for Settings only: `tier`, `character_count`, `character_limit`, `next_character_count_reset_unix`.

The upstream message is `detail.message` when `detail` is an object holding a string `message`, else `detail` when it is a string, else the first 300 characters of the body.

### The run, in the engine

Validation before acknowledgement, each failing the call and writing nothing:

- No ElevenLabs key: `unavailable`, `No ElevenLabs key yet. Add one in Settings, under ElevenLabs.`
- Empty prompt after trimming: `bad_request`, `Prompt is empty. Select a prompt, or type an instruction.`
- A voice id not matching `^[A-Za-z0-9_-]{1,100}$`: `bad_request`, `That is not an ElevenLabs voice id.` (it is interpolated into the upstream path).
- A model id not matching `^[\w.-]{1,100}$`: `bad_request`, `That does not look like an ElevenLabs model id.`
- An `output_format` outside the offered list: `bad_request`, `That audio format is not offered here.`
- A param outside its range: `bad_request`, `<Label> has to be between <min> and <max>.`

Then, as spec 03's run: write one audio placeholder at the place spec 03's result placement gives (320 × 64), with origin `run:<runId>`, the run marker and unfilled result meta; acknowledge; make the speech call. A batch id is minted by the engine (`b-<epochMs>`); `runIndex` and `runCount` are 1.

Response handling, each failure becoming the output's `error`, deleting the placeholder, and reaching the tab as spec 03's run report toast (`0 of 1 succeeded. <message>`):

- The fetch throws or times out: `Could not reach ElevenLabs: <message>`
- Reading the body fails: `Lost the connection while reading ElevenLabs' answer: <message>. The line may still have been made and charged. Check your ElevenLabs usage.`
- 401: `ElevenLabs refused the key: <upstream message>. Check the key in Settings.`
- 402, or any status whose `detail.code` or `detail.status` is `insufficient_credits` or `quota_exceeded`: `ElevenLabs has no credits left for this: either the account's quota for this period is used up, or this key has hit its own credit limit. Check your plan and the key's limit at elevenlabs.io. (<upstream message>)`
- Any other non-2xx: `ElevenLabs (<status>): <upstream message>`
- An empty body: `ElevenLabs returned no audio.`
- The file cannot be written: `Generated the audio but failed to write it: <message>`

On success: write the file as `<stamp>-audio-<slug>.<ext>` (spec 03's stamp, slug of the spoken text, `audio` when empty; `ext` is `mp3` for an `mp3_` format and `wav` for a `wav_` format), exclusively, with spec 03's `-2` to `-5` retries; write the sidecar beside it (a write failure is logged and does not fail the output); fill the placeholder in one engine change (spec 03's lifecycle step 2: `file`, result meta with the sidecar, `credits`, `cost: null`, marker removed); send the `output` event; log `  audio →  <n> chars  <model>  (<credits> credits)`, or `(credits unknown)`.

The run registers in spec 03's run registry, so placeholder resolution at boot, an undo restoring a deleted placeholder, `orphaned`, durability with no tab open, and spec 10's live-run conflict for rename, delete and an output folder change all apply unchanged. An audio run is not durable: one call answers with the bytes, so there is no job to resume and contract 5 does not reach it.

### Results, recipes and their actions

An audio result is an audio shape with spec 03's result meta (`medium: "audio"`, `cost: null`, `credits`). Its recipe is spec 03's `ResultRecipe` with `medium: "audio"`, `references: []`, and `params` holding `voice_id`, `voice_name`, and every param that was sent, keyed as in `AudioRunRequest`.

- **Result line**, under a selected result: `<model> · <m:ss> · <n> credits` (`1 credit` singular), any unknown part omitted. The duration is read by the web from the loaded audio's metadata.
- **Toolbar.** Every other result's bar is Regenerate, Agent, then Generate (primary, last, opening the composer with the result as input), as spec 03 builds it for #101. An audio result's bar is **Regenerate** (primary, Button `default`) and **Agent** (Button `outline`), with no Generate: Generate on a result opens the composer with that result as the input, and an audio shape is never an input in this spec (it contributes nothing to a composition, so the composer would open on a selection with nothing to make from). When audio becomes an input (Out of Scope), the audio bar gains Generate like the others. There is no Vary, no separate Recipe button and no one-click exact repeat.
- **Regenerate**: opens the composer in recipe mode over the result (spec 03's recipe mode, as #101 now defines Regenerate): the audio medium, the recorded voice, model, props (a recorded seed included) and instruction prefilled, the source band reading `recipe · 1 source` or `recipe · N sources`, sending the recorded spoken text with whatever the person changed. The output lands beside the result. Sending the recipe unchanged with a recorded seed may give nearly the same take; that is what the recipe says.
- **Tether** (spec 03): drawn to the prompts that are still on the canvas.

**Recipe groups** (spec 06). `GroupRecipe.medium` gains `audio`; its `params` hold the voice as in a result's recipe. The recipe chip reads the model id then the voice name (`eleven_v4 · Rachel`). A recipe group's Generate runs `run.audio` at once, as spec 06 runs other media. The library's medium chip gains `Audio` (lucide `AudioLines`, yellow). A group never holds an audio shape (above); a recipe group with medium audio speaks its prompt members.

### Persisted formats

Audio sidecar, `<final base>.json` beside the file:

```ts
type AudioSidecar = {
  kind: "audio"
  prompt: string                    // the text that was spoken
  model: string
  voice: { id: string; name: string }
  voice_settings: Record<string, number | boolean> | null   // what was sent, null when none
  output_format: string; seed: number | null; language_code: string | null
  characters: number                // the length of the text sent
  billing: "elevenlabs-credits"
  credits: number | null            // from the character-cost header
  requestId: string | null
  batchId: string; runIndex: number; runCount: number
  createdAt: string; file: string
  recipe: ResultRecipe              // medium "audio"
}
```

There is no `cost` field. A spend sum over `cost` is a sum of dollars from OpenRouter; credits are a different unit whose price depends on the plan, and a zero or a credit count in `cost` would corrupt it. This is the agent turn sidecar's rule (spec 07) applied to a second unit.

`ResultMeta` gains `credits?: number | null`, present only on audio results.

### Settings, the key and the status

Two settings variables join spec 01's table:

| Variable | Default | Validator (after trimming) | Editable in app | Clearable with `''` |
| --- | --- | --- | --- | --- |
| `ELEVENLABS_API_KEY` | none | `^[\w-]{20,200}$` | yes | no (removal is its own action) |
| `ELEVENLABS_AUDIO_MODEL` | `eleven_v4` | `^[\w.-]{1,100}$` | yes | no |

ElevenLabs does not document the shape of its keys (today they start `sk_`), so the key validator only guarantees what `.env` and the header need: word characters and hyphens, nothing that can break a line or inject a header. Refusals: `That does not look like an ElevenLabs key.` and `That does not look like an ElevenLabs model id. Expected something like "eleven_v4".` `.env.example` gains `ELEVENLABS_API_KEY=` (empty) and `ELEVENLABS_AUDIO_MODEL=eleven_v4`. Spec 01's banner is unchanged: it is part of the hosting contract, and the shell needs nothing from these lines.

`Settings` gains `hasElevenLabsKey: boolean`, `elevenLabsKeyHint: string` (the last four characters, or `''`) and `audioModel: string`. `SettingsPatch` gains `elevenLabsKey?` and `audioModel?`. A patch carrying `elevenLabsKey` does not cancel a pending OpenRouter connection (spec 10's cancel is about the OpenRouter key only). Writing `audioModel` clears `lastUsed.audio`'s stored model (spec 03's step).

`settings.removeElevenLabsKey`: delete the `ELEVENLABS_API_KEY` line through the write funnel (a null delete), clear the key in the running process, emit on `settings.subscribe`, answer `{ settings }`. Nothing else is resolved: audio runs are not durable, and a live one finishes or fails on its own.

`elevenlabs.status`:

- No key: `{ hasKey: false }`, no upstream call.
- 401: `{ hasKey: true, revoked: true }`.
- 403: `{ hasKey: true, usageHidden: true }`. A restricted key may speak without being allowed to read the account.
- Other non-2xx, or no JSON object: `upstream`, `ElevenLabs answered <status>.` Network failure: `upstream` with the error message.
- 2xx: `tier` (a string, else null), `creditsUsed` (`character_count`, a finite number, else 0), `creditLimit` (`character_limit`, a finite number, else null), `resetsAt` (`next_character_count_reset_unix` as an ISO string, else null).
- Fetched when the settings dialog opens with an ElevenLabs key and after one is saved. Never on a timer.

ElevenLabs status copy (domain), numbers grouped by the locale:

| Condition | Shown |
| --- | --- |
| revoked | `This key no longer works at ElevenLabs. It may have been deleted or disabled there.` |
| usage hidden | `This key cannot read the account's usage, so it is not shown here. Generating works if the key may use text to speech.` |
| usage | `<creditsUsed> of <creditLimit> credits used on this ElevenLabs account this period.` (`<creditsUsed> credits used…` without a limit), then ` Resets on <short date>.` when `resetsAt` is set |
| not fetched or failed, key saved | `A key is already saved (…<hint>). Entering a new one replaces it.` |
| no key | `Make a key at elevenlabs.io (Developers, API keys) and paste it here. Audio generation is billed to that account in credits.` |

The usage line is the account's, not the key's, and says so. Settings makes no per-key read: ElevenLabs documents per-key `character_count` only on the service-account keys endpoint, which needs a workspace admin, and on the deprecated character-stats endpoint, whose `api_keys` breakdown does not say how keys are named.

### The settings dialog

Spec 10's dialog gains an ElevenLabs block after the OpenRouter key section and before Default models. It shows whether or not there is an OpenRouter key, so someone who only wants audio can set ElevenLabs up alone:

- Heading `ElevenLabs`. A password field (the kit Input), accessible label `ElevenLabs API key`, placeholder `sk_…`. Beside it, with a key, a ghost button `Remove key` with spec 10's two-step confirm (`Yes, remove it`, field warning `This deletes the ElevenLabs key from .env. Audio generation is disabled until you add one.`, then `ElevenLabs key removed.`). Under it, the status copy.
- Without an OpenRouter key, the block sits under spec 10's keyless intro, Connect button and paste reveal, with the supporting line `Only want audio? Paste an ElevenLabs key here. Images, video and text still need OpenRouter.` in `text-xs` muted text. Its key field is always shown (there is no reveal step).
- Save (spec 10) sends `elevenLabsKey` when the trimmed field is non-empty, and clears the field and the shown status on success, then refetches the status. Save is shown when there is either key, the OpenRouter paste field is revealed, or the ElevenLabs field holds text.
- Saving a first ElevenLabs key while there is no OpenRouter key closes the dialog with the toast `ElevenLabs key saved. Audio is ready to generate.`

Spec 10's keyless rules change from "no OpenRouter key" to "neither key":

- The dialog opens on its own at first load only when there is no key of either kind.
- The title is `Connect OpenRouter to start` only when there is no key of either kind, else `Settings`.
- The settings button is the primary `Add your API key` only when there is no key of either kind; otherwise it is spec 10's gear, its tooltip naming the keys that exist (spec 10's `Settings: key …<hint>, default models, output folder` with an OpenRouter key; `Settings: ElevenLabs key …<hint>, default models, output folder` with only an ElevenLabs key).
- With only an ElevenLabs key, the dialog shows the OpenRouter keyless intro and Connect (so OpenRouter is one click away), the ElevenLabs block, Default models holding only `Audio`, Output folder and Local agents.


Default models shows when there is either key. It holds spec 10's `Image`, `Text` and `Video` selects with an OpenRouter key, and a fourth searchable select, `Audio`, listing the audio catalogue's model ids, with an ElevenLabs key. Output folder and Local agents show when there is either key.

### The agent

- `canvas_read` reports an audio shape as `{ id, kind: "audio", x, y, w, h, parent?, file, fileName }` (`file` omitted when empty), plus `recipe` and `running` for a result as spec 07 does for any result.
- `canvas_write`'s `create` accepts `kind: "audio"` with `props.file` naming an existing project file; spec 07's refusals for a missing file and for bytes in props apply. `props.url` is refused for audio: `create: audio takes props.file, a file in the project folder`.
- The `canvas_write` description in `assets/prompts/tool-descriptions.md` changes its Kinds sentence to: `Kinds: prompt (props.text), image and video (props.file names an existing project file, or props.url for a clip link), audio (props.file names an existing project file), group (props.name), mark (props.type is geo, note, arrow or line, plus that tldraw type's own props).` Its `rename` op reads `renames a prompt, image, video, audio, page, motion or group`, and the system prompt's sentence on refs (`assets/prompts/agent-system.md`) lists audio among the shapes that have one. The `canvas_read` description is unchanged.
- The selection preamble (spec 07) names an audio shape as `audio <id> ("<label>")` with spec 07's label rule. Nothing else changes for the agent.

### Test hooks

One test-only variable joins spec 01's table:

| Variable | Used by | Effect |
| --- | --- | --- |
| `UNFRAMED_TEST_ELEVENLABS_ORIGIN` | 15 | replaces `https://api.elevenlabs.io` in every ElevenLabs URL the engine builds: models, voices, speech and subscription. No per-URL override. Accepted only under the same rule as `UNFRAMED_TEST_OPENROUTER_ORIGIN` (an `http://127.0.0.1:<port>` or `http://localhost:<port>` origin, one domain function for both); any other value is ignored with `  test origin ignored: <value> is not a loopback origin`, so the variable can never send the ElevenLabs key off this machine |

It is read from the process environment only, never from `.env`, and is inert when unset, like every `UNFRAMED_TEST_` variable. It is not part of the hosting contract: the desktop shell never sets it and never reads it, so nothing shell-facing changes. The engine-seam harness gains an `elevenLabs` stub option beside its OpenRouter stub. Voice preview URLs come back from the stub as loopback URLs and are played as given.

### Rules this spec bends

00-index requires a spec that bends a shared rule to say so and why. This one bends five, and keeps the rest:

1. **Index, The product**: "Generate (one paid model call through OpenRouter)" and "holds your OpenRouter key". Audio's Generate is one paid call through ElevenLabs, and the engine holds an ElevenLabs key too. Why: OpenRouter has no text-to-speech model at the quality the person wants (issue #63, "Alternatives considered"). On build, the line becomes "one paid model call through OpenRouter, or ElevenLabs for audio" and "holds your OpenRouter and ElevenLabs keys".
2. **Index contract 2**, "The OpenRouter key never leaves the engine", is extended, not loosened: the ElevenLabs key never leaves the engine either, and the web learns only `hasElevenLabsKey` and its last four characters.
3. **Index contract 4**, "Every paid run leaves a sidecar with its cost". An audio run leaves a sidecar with its credits: `billing: "elevenlabs-credits"`, `credits`, and no `cost` field. Why: credits are not dollars, and their price depends on the person's ElevenLabs plan, which Unframed cannot see.
4. **Index, Test seams**: "every OpenRouter call … through spec 01's single loopback-only `UNFRAMED_TEST_OPENROUTER_ORIGIN`". A second stub origin, `UNFRAMED_TEST_ELEVENLABS_ORIGIN`, carries every ElevenLabs call under the same loopback rule. Why: a second provider has a second origin, and pointing ElevenLabs' paths at the OpenRouter stub would make one stub answer two APIs' paths and hide a wrong base URL. Test-only, so contract 6 and the shell contract are untouched.
5. **Spec 01's `.env.example`** "contains exactly" six lines; it gains two. **Spec 02's allowed-member rule** and **spec 03's `Medium`** (`["image", "video", "text"]`) each gain a case. **Spec 04's Out of Scope** "Audio references" stays out of scope: audio shapes are never inputs in this spec. **Spec 10's keyless dialog** (opening on its own, its title, the settings button, the sections below the key) keys off "neither key" instead of "no OpenRouter key", so audio can be set up without OpenRouter.

The build updates these documents in the same pull request, so the specs keep describing the app: 00-index (the product line, contract 2, contract 4, the engine seam's two stub origins, the audio shape in the vocabulary), spec 01's settings and test-only tables and `.env.example`, spec 02's member rule, add menu and drop rules, spec 03's `Medium`, spec 06's chips, spec 07's `canvas_read` and `canvas_write` kinds, spec 10's dialog sections, and the Kinds sentence in `assets/prompts/tool-descriptions.md`.

Nothing in spec 01's hosting contract changes: no environment variable the shell sets, no IPC message, no banner line, no DOM hook, no bundle layout. The two new settings variables are additive and live only in `.env`, which the shell never writes.

## Testing Decisions

A good test drives one of the three seams in 00-index and asserts on what it exposes: return values, RPC answers and events, the room's shapes, files and sidecars in the project folder, `.env`, what the stub ElevenLabs received, and what a person sees. No test reaches into the run registry, the ElevenLabs client or React state.

- **Domain seam** for the rules with many cases: audio params from a catalogue entry (style and speaker boost only when declared, languages from the model, a `params: null` entry keeping stored props), defaults, reset and keep; the request builder (spoken text from the composition, `voice_settings` holding exactly the set keys and absent when none, seed and language only when set, the default format, media all unused); the status lines in each condition with exact strings, singular and plural; `creditsFrom` (a number, a decimal, empty, negative, garbage); `elevenLabsMessage` for each body shape; `audioExtension`; the result line; the key and model validators; the status copy for each row; the extended extension table, drop kind and member rule; the audio recipe chip. Table-driven Vitest, one row per case.
- **Engine seam** with the harness forked with `UNFRAMED_TEST_ELEVENLABS_ORIGIN` pointed at an in-test stub that records every request and can answer any status, any body, any headers, drop the body mid-read, or hang past the timeout. Covers settings, removal, status, both catalogues, `run.audio` from validation to filled placeholder, every failure message, naming, run registry behaviour, recipes, the agent tools, uploads.
- **Browser seam** for the audio shape, drop and paste, the composer's audio medium, the voice and model dialogs, the delivery and Advanced popovers, status lines, badges, results and their actions, last-used values, Settings, and recipe groups.
- Prior art: spec 05's text run tests (a run that mirrors spec 03's), spec 04's catalogue tests (a second catalogue shape), spec 10's settings dialog and key status tests, spec 02's video transport tests for the player.

## Tasks

1. Audio params: Stability always, Speed on every model id but `eleven_v4` and `eleven_v4_turbo` (an unknown row included), Style only with `can_use_style`, Speaker boost only with `can_use_speaker_boost`, Language from the model's languages, Format and Seed always; defaults; a `params: null` entry keeps stored Style and Speaker boost. Seam: domain.
2. Audio params: reset on model change removes undeclared props, removes Speed when the new model is a v4 id, and unsets an unlisted language, keeps voice, format and seed; range checks for every param. Seam: domain.
3. Audio request: spoken text is the composition prompt; `voice_settings` holds exactly the set delivery and similarity keys and is absent when none; seed, language and format only when set, format defaulting to `mp3_44100_128`; every media slot gets the unused role. Seam: domain.
4. Audio status: no key, empty text, no voice, too long with both numbers, a cycle, and the media warning in singular and plural, with exact strings. Seam: domain.
5. ElevenLabs answers: `creditsFrom`, `elevenLabsMessage` for an object `detail`, a string `detail`, and a raw body; `audioExtension`; `audioLine` with `1 credit`, `n credits` and missing parts. Seam: domain.
6. Settings rules: the ElevenLabs key and audio model validators and their messages; `.env` upsert of the two variables. Seam: domain.
7. ElevenLabs status copy: revoked, usage hidden, usage with and without a limit and reset date, not fetched with and without a hint, no key. Seam: domain.
8. Media and canvas rules: the audio extension table rows, the audio drop kind by type and by name, the allowed-member rule refusing audio, Reveal offered on a filled audio shape. Seam: domain.
9. Recipe chip for an audio recipe (model then voice name). Seam: domain.
10. Contracts: `Medium` gains `audio`; the audio shape schema with its migration; the room accepts an audio shape naming a project file and refuses one whose `file` holds a path. Seam: engine.
11. Settings: `ELEVENLABS_API_KEY` and `ELEVENLABS_AUDIO_MODEL` are read from `.env`, defaulted, written by `settings.update`, refused with their messages, reported as `hasElevenLabsKey`, `elevenLabsKeyHint` and `audioModel`; the key itself appears in no RPC answer or HTTP response; `.env.example` holds the two new lines. Seam: engine.
12. `settings.update` with `audioModel` clears `lastUsed.audio`'s model; with `elevenLabsKey` it leaves a pending OpenRouter connection waiting. Seam: engine.
13. `settings.removeElevenLabsKey` deletes the line, clears `hasElevenLabsKey` live, emits on `settings.subscribe`, and answers `Could not write .env: <reason>` with the key still live when `.env` cannot be written. Seam: engine.
14. `UNFRAMED_TEST_ELEVENLABS_ORIGIN`: a loopback value redirects every ElevenLabs call; a non-loopback value is ignored with the log line; a `.env` line for it has no effect. Seam: engine.
15. `models.list` for audio: `xi-api-key` sent, text-to-speech models only, mapping, ElevenLabs' order, default appended, only the default row with no key or on failure. Seam: engine.
16. `voices.list`: query (`page_size`, `search`, `next_page_token`), mapping, `nextPageToken` only when `has_more`, the no-key refusal, upstream failures as `upstream` with the message rule. Seam: engine.
17. `elevenlabs.status`: no key without a call; 401 revoked; 403 usage hidden; 2xx coerced; 500 `ElevenLabs answered 500.` Seam: engine.
18. `run.audio` validation: no key, empty prompt, bad voice id, bad model id, unknown format, out-of-range param; nothing written, nothing sent upstream. Seam: engine.
19. `run.audio` happy path: the placeholder in the room before the reply; the stub receives the path with the voice id, `output_format` in the query, `xi-api-key`, and the body rule; the file and the sidecar (no `cost` field, `billing`, `credits` from the header, `requestId`) are written; the placeholder is filled with the file and result meta carrying `credits` and `cost: null`; `output` and `finished` events. Seam: engine.
20. `run.audio` naming: `-audio-` infix, slug of the spoken text, `mp3` or `wav` by format, exclusive write with retries to `-5`; a missing `character-cost` header gives `credits: null` and the log's `credits unknown`. Seam: engine.
21. `run.audio` failures: unreachable, timeout, body lost, 401, 402, `quota_exceeded` and `insufficient_credits` codes on other statuses, other status, empty body, write failure; each deletes its placeholder and reports its message. Seam: engine.
22. Audio runs in the run registry: a run lands with no client connected; a placeholder deleted mid-run is not recreated and counts in `orphaned`; a restored placeholder is filled; stale markers are cleared at boot; spec 10's rename answers the live-run conflict while an audio run is live. Seam: engine.
23. `recipe.read` answers an audio result's recipe; `recipe.copy` brings it across projects. Seam: engine.
24. Agent tools: `canvas_read` reports an audio shape with `file` and `fileName`, and a result with `recipe` and `running`; `canvas_write` creates an audio shape from a project file and refuses `props.url` and a missing file with their messages. Seam: engine.
25. Upload route: `audio/mpeg`, `audio/wav` and `audio/mp4` uploads get `mp3`, `wav` and `m4a` names and upload sidecars; the file route serves them with their types and byte ranges. Seam: engine.
26. Audio shape: the add menu's Audio, the empty state, Choose file, the filled card with title and readout, width-only resize within limits. Seam: browser.
27. Audio player: Play and Pause, the position slider and readout, the controls never dragging the shape and the card dragging it, starting one audio pausing another, Remove keeping the file. Seam: browser.
28. Drop and paste: sound files by type and by name become audio shapes with the multi-drop offset; a drop onto an audio shape replaces its file; a pasted sound file lands at the pointer or fills selected audio shapes. Seam: browser.
29. Context menu Reveal and Copy path on audio, and copy and paste of audio shapes within a project (same file) and across projects (copied file, recipe brought along). Seam: browser.
30. Audio in other media: a selected audio shape shows the unused mark in the image, video and text tray and is not sent; a selection of only audio offers Agent only; `Cmd-G` leaves audio shapes out. Seam: browser.
31. Audio medium in the composer: `audio` in the medium switch, the voice chip reading `Pick a voice`, the model chip on the default, the delivery chips the model declares (no Style for a model without `can_use_style`; no Speed on `eleven_v4`, Speed back on `eleven_multilingual_v2`), the Advanced chip, the tag hint, no price. Seam: browser.
32. Voice dialog: list, labels, category, search after typing, `Load more`, preview plays and stops, pick and close, current voice marked, empty and failure messages, Escape closes only the dialog. Seam: browser.
33. Model dialog for audio: Model and Languages columns, no Provider or Released, browse link, pick. Seam: browser.
34. Delivery and Advanced popovers: slider value shown, Reset, Remove and re-add through `+ add prop`, the Advanced count, each advanced control; a model change resets as the rule says; the stub receives exactly the set values. Seam: browser.
35. Status lines and blockers: no ElevenLabs key, empty text, no voice, too long, media warning; badges show the unused mark on selected media in the audio medium. Seam: browser.
36. Audio run end to end: Generate, the placeholder with `Generating…`, the audio result beside the selection, its line `<model> · <m:ss> · <n> credits`, and the run report toast on failure. Seam: browser.
37. Audio result bar: Regenerate (primary) and Agent only, no Generate, Vary or Recipe; Regenerate opens the composer in recipe mode with voice, model, props and instruction prefilled, and sending lands a second take beside the result. Seam: browser.
38. Last-used audio values: voice, model and props come back on the next open and after an engine restart on a new port. Seam: browser.
39. Settings with an OpenRouter key: the ElevenLabs block with paste, a bad key's error, the two-step remove, the usage line from the stub's subscription answer, revoked and usage-hidden lines, and the `Audio` default model select shown only with an ElevenLabs key. Seam: browser.
40. Settings with only an ElevenLabs key: on a fresh install the keyless dialog shows the ElevenLabs block with its line; saving an ElevenLabs key alone closes the dialog with its toast; after a reload the dialog does not open on its own, the title is `Settings`, the button is the gear, and the dialog shows the OpenRouter intro and Connect, Default models with only `Audio`, Output folder and Local agents. Seam: browser.
41. Composer with only an ElevenLabs key: an audio run lands; image, video and text show spec 03's no-key blocker; the composer opens on audio when it would open on a medium that needs OpenRouter. Seam: browser.
42. Naming audio: the label reads "Audio" until named; a double-click on the label, the context menu's Rename and F2 open the "Audio name" field; Copy @<ref> copies the name; a prompt's `@name` of an audio shape is left as typed in every medium; `canvas_write`'s `rename` op renames an audio shape. Seam: browser.
43. Recipe groups with audio: Save as recipe on the audio medium, the chip `eleven_v4 · <voice>`, Generate from the toolbar runs `run.audio` with the recipe, and the library's `Audio` medium chip. Seam: browser.

## Out of Scope

- **Audio as an input.** An audio shape is never a source of a run: no voiceover for a motion, no audio reference for a video model, no audio attached to a text run. That is a later spec. Spec 04's "Audio references" stays out of scope.
- Audio shapes inside groups, and presets that carry audio files. A later spec decides how a preset stores a shape's `props.file`.
- Pronunciation dictionaries (their own sub-system: create and manage a dictionary).
- Sound effects, music, voice changing, dubbing, voice cloning and voice design. Audio here is text to speech only.
- Multi-speaker dialogue in one request (ElevenLabs' text-to-dialogue endpoint).
- Streaming playback while a line generates, and timestamps or captions.
- Runs above 1, batches and Free for audio.
- A price estimate in credits before sending. A follow-up: the models list's `model_rates.character_cost_multiplier` could give `est. ~<n> credits` once the `character-cost` header is confirmed as credits.
- Per-key credit usage in Settings: a personal key has no documented read for it.
- Converting credits into dollars anywhere.
- A waveform drawing on the audio card.
- An ElevenLabs OAuth or "Connect" flow: ElevenLabs does not offer one for third-party apps.
- Request stitching (`previous_text`, `next_text`, `previous_request_ids`), text normalisation switches, and `optimize_streaming_latency`.
- Any change to the desktop shell.

## Further Notes

### Why no OAuth

ElevenLabs' authentication docs describe API keys sent in the `xi-api-key` header, keys restricted by scope, credit quota or IP, and single-use tokens for some real-time endpoints. They describe no OAuth flow for a third-party app, so the person pastes a key and the engine stores it the way it stores a pasted OpenRouter key.

### Why the delivery and Advanced split

The issue's split is kept: the settings that change how a line sounds (Stability, Style, Speed) are visible chips; the ones that change fidelity or the file (Similarity, Speaker boost, Format, Seed, Language) wait behind Advanced. ElevenLabs' models list declares `can_use_style` and `can_use_speaker_boost`, so those two follow the model the way spec 03's props do.

### To confirm with a paid call

- The `character-cost` header is treated as credits after the model's rate. ElevenLabs' docs call it the generation's "character costs" without saying which; the person's paid call with a Flash model (which bills half) and a known text confirms it. If it turns out to be raw characters, the result line and sidecar multiply by the model's rate instead.
- WAV on Eleven v4: kept until the person's paid probe shows v4 refuses it.

### Facts relied on, from ElevenLabs' docs, checked 2026-10-07

- Text to speech: `POST /v1/text-to-speech/{voice_id}`, `output_format` query (default `mp3_44100_128`; mp3, pcm, opus, wav, μ-law and A-law values), body `text`, `model_id` (default `eleven_multilingual_v2`), `language_code`, `voice_settings` (`stability` 0.5, `similarity_boost` 0.75, `style` 0, `use_speaker_boost` true, `speed` 1.0 by default), `seed` 0 to 4294967295; the answer is the audio file. https://elevenlabs.io/docs/api-reference/text-to-speech/convert
- Default voice settings and their meanings. https://elevenlabs.io/docs/api-reference/voices/settings/get-default
- Speed runs from 0.7 to 1.2; bracketed audio tags such as `[whispers]` and `[excited]`. https://elevenlabs.io/docs/best-practices/prompting/eleven-v4
- Voices: `GET /v2/voices` with `page_size` (at most 100), `search`, `next_page_token`; answers `voices[]` (`voice_id`, `name`, `category`, `labels`, `preview_url`, …), `has_more`, `next_page_token`. https://elevenlabs.io/docs/api-reference/voices/search
- Models: `GET /v1/models`, entries with `model_id`, `name`, `can_do_text_to_speech`, `can_use_style`, `can_use_speaker_boost`, `languages`, `maximum_text_length_per_request`, `model_rates`. https://elevenlabs.io/docs/api-reference/models/list
- The current models, with `eleven_v4` as the flagship and `eleven_v3` as the previous generation. https://elevenlabs.io/docs/overview/models
- Eleven v4 uses Stability and Similarity; Style and Speed sliders are not available. https://elevenlabs.io/docs/help-center/product/core-capabilities/text-to-speech/what-is-eleven-v4
- Response headers `character-cost` and `request-id`. https://elevenlabs.io/docs/api-reference/introduction
- Keys in the `xi-api-key` header; scope, credit quota and IP restrictions; single-use tokens; no OAuth described. https://elevenlabs.io/docs/api-reference/authentication
- Error bodies (`detail` with `type`, `code`, `message`, `request_id`), 401 for `invalid_api_key`, 402 for `insufficient_credits`, 429 for rate and concurrency limits. https://elevenlabs.io/docs/eleven-api/resources/errors
- Account usage: `GET /v1/user/subscription` (`tier`, `character_count`, `character_limit`, `next_character_count_reset_unix`). https://elevenlabs.io/docs/api-reference/user/subscription/get
- Per-key usage: `GET /v1/usage/character-stats` (deprecated, `breakdown_type` includes `api_keys`) https://elevenlabs.io/docs/api-reference/legacy/usage/get ; per-key `character_count` on service-account keys https://elevenlabs.io/docs/api-reference/service-accounts/api-keys/list

### Coordination

Spec 14 (external agents) is being written alongside this one. If it changes `canvas_read`, `canvas_write` or `assets/prompts/tool-descriptions.md`, the Kinds sentence above is applied on top of its text.

The result toolbar follows the decision made for #101, built in its own pull request: on a result the bar is Regenerate, Agent, then Generate (primary, last); Regenerate opens the composer in recipe mode; there is no Vary, no Recipe button and no one-click exact repeat. If spec 03's text has not caught up when this spec is built, #101's wording wins over spec 03's toolbar table.

### Assets this spec needs

- `assets/prompts/tool-descriptions.md`: the `canvas_write` Kinds sentence and `rename` op above, replacing the current ones.
- `assets/prompts/agent-system.md`: audio in the sentence on refs. No other model-facing text.
