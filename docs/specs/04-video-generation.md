# 04 · Video generation

Depends on: 01 Engine foundation, 02 Canvas, 03 Image generation

## Problem Statement

A person wants to turn a selection on the canvas into a video clip: a prompt, maybe a still or two, maybe an existing clip to match. Video generation is not like image generation. The upstream call returns a job, the clip exists only minutes later, and it is sold by the second, so one click can cost a dollar or more. Several things go wrong without care:

- The provider accepts exactly one kind of request at a time: references, a first frame, or a first and last frame. A person who selects five images and asks for a first-frame video needs to see which one image will be used and that the other four will not be sent.
- The browser tab that started a render may be closed, reloaded or pointed at another project before the clip is ready. A paid render must still land in its project.
- OpenRouter's video endpoint takes a reference clip only as a public `https://` URL. A clip on this machine cannot reach it unless the engine serves it publicly for the life of the job, and that must never expose anything else the engine holds.
- The price is knowable before the click, and the person should see it.

## Solution

The Generate tray from spec 03 gains the **video** medium. With video chosen, the tray shows the video model, the model-driven props (Input, Seconds, Audio, Size, Ratio), the per-second estimate, and the warnings this medium needs. While the composer is open on the video medium, every selected source shows its **role badge** ("image 1", "video 1", "first", "last", or the unused mark), computed from Y order over the selection, so the canvas says what each item will do before any money is spent.

Clicking Generate starts a **render job**. The engine creates the upstream job, writes a pending record to `jobs.json` in the output folder before it answers, and puts a **render placeholder** on the canvas at the landing spot: a video shape with no file yet, showing "Rendering… (N min)" and "Forget this job". From then on the engine owns the job. A 30 second sweep (also run once at boot) polls every pending render job and collects finished clips into the project folder with their sidecar, and turns the placeholder into an ordinary video result carrying its recipe, whether or not any tab is open. A tab that is open also polls, every 4 s for up to 15 minutes, so a clip appears promptly.

When a selected clip is a local file, the tray offers **"Share via temporary link while generating"**, on by default. The engine then copies the clip to a temporary file, serves it from a dedicated share server that answers one route shape only, opens a public tunnel to that server, proves the link is reachable from outside before creating the job, and tears it all down when the job ends.

What is kept from the old app and what changes:

| Capability | Status |
| --- | --- |
| Video model catalogue, video-input detection through the unofficial find endpoint | kept |
| Input modes References / First frame / First and last frame, gated by the model's supported frame images, self-healing | kept |
| Roles by Y order, per-kind numbering, the unused mark for inputs a mode has no room for | kept, now drawn over the selection while the composer is open instead of on wired input nodes |
| Red edges for ignored inputs | changed: there are no edges; the unused badge and one tray warning replace them |
| Seconds, Audio, Size, Ratio; exact sizes replace tier plus ratio | kept |
| Estimate from per-second pricing SKUs | kept |
| Video-into-video phrasing warning, "not known to accept video" warning, "will not be sent" warning | kept, wording changed from "wired" to "selected" |
| Local clip refused unless sharing is on; share link, tunnel, probe, TTL | kept |
| Durable render jobs, sweep, poll, locks, prune, give-up, lenient and strict reads | kept |
| "Rendering… (N min)", "Forget this job", resume after reload | kept, now on the render placeholder |
| Result shown inside the output node, "Add this video to the canvas", Clear | changed: the result IS a video shape on the canvas, so neither button exists |
| One render at a time per output node | changed: each render has its own placeholder, so several can run at once |

## User Stories

1. As a person, I want to pick "video" as the medium in the Generate tray, so that the same selection can become a clip instead of a picture.
2. As a person, I want the video model picker to list OpenRouter's video models, so that I can choose any of them.
3. As a person, I want a fresh tray to start on the default video model from settings, so that I do not pick a model every time.
4. As a person, I want the model dialog to sort video models by release date, newest first, and link to OpenRouter's video listing, so that I can find new ones.
5. As a person, I want only the props the chosen model declares to appear, so that I never set something the model ignores.
6. As a person, I want a Seconds prop listing exactly the durations the model supports, so that I cannot ask for an impossible length.
7. As a person, I want Seconds to default to the model's first declared duration, so that the estimate is never blank for lack of a duration.
8. As a person, I want an Audio checkbox when the model can generate audio, so that I can turn sound on.
9. As a person, I want a Size prop with exact pixel sizes when the model declares them, labelled with their ratio, so that I can choose by shape.
10. As a person, I want tier and ratio props instead when the model has no exact sizes, so that I can still control resolution and shape.
11. As a person, I want exact sizes to replace the tier and ratio pair rather than join it, so that I cannot ask for a combination the model does not render.
12. As a person, I want an Input prop offering References, First frame, and First and last frame when the model supports frames, so that I can choose image-to-video instead of reference-to-video.
13. As a person, I want no Input prop at all on a model without frame support, so that I am not shown a choice with one option.
14. As a person, I want switching the model to reset every model-dependent prop, so that a mode or size the new model cannot honour is never carried over.
15. As a person, I want a stored input mode the current model cannot honour to clear itself once the catalogue is known, so that badges and request never disagree.
16. As a person, I want an OpenRouter outage not to wipe my input mode, so that "unknown" is never treated as "unsupported".
17. As a person, I want every selected image and clip to show a role badge while the composer is open, so that I can read off the canvas what each item will do.
18. As a person, I want reference-mode badges to number images and videos separately ("image 1", "video 1"), so that my instruction can name them.
19. As a person, I want first-frame mode to use the topmost selected image as the first frame, so that I control it by moving shapes.
20. As a person, I want first-and-last mode to use the top two images as first and last, so that the order on the canvas decides.
21. As a person, I want images and clips a frame mode has no room for to show the unused mark, so that I know they will not be sent.
22. As a person, I want dragging an image above another to swap their roles live, so that I can fix the order without leaving the composer.
23. As a person, I want the badges to disappear when the composer closes, so that the canvas stays clean.
24. As a person, I want one warning line when some selected inputs will not be sent, so that I notice before paying.
25. As a person, I want a warning when a clip goes in as a reference that I should describe the result rather than instruct an edit, so that my run does not fail with a duration error.
26. As a person, I want a warning when the model is known not to accept video input, so that I am not surprised when the clip is ignored.
27. As a person, I want no such warning when video-input support is unknown, so that an outage does not produce a false warning.
28. As a person, I want to see "est. ~$x.xx" before I click, computed from the model's per-second price and my duration, so that I know what the clip will cost.
29. As a person, I want no estimate when the model's pricing cannot answer, so that a guess is never dressed as a number.
30. As a person, I want the Generate button to read "Starting…" and stay disabled while the engine creates the job, so that a double click cannot start two paid renders.
31. As a person, I want a placeholder to appear on the canvas as soon as the job exists, so that I can see where the clip will land.
32. As a person, I want the placeholder to say "Rendering… (N min)", so that I know it is still going and for how long.
33. As a person, I want the finished clip to replace the placeholder in place, so that I do not have to find it.
34. As a person, I want the result to carry its recipe, so that Regenerate, Vary and Recipe work on video as they do on images.
35. As a person, I want the clip to land in its project even if I closed the tab, so that a paid render is never lost.
36. As a person, I want the clip to land even if the engine restarted in between, so that a restart does not strand a render.
37. As a person, I want a reloaded tab to pick up a render in flight and show its progress, so that I never lose track.
38. As a person, I want "Forget this job" on the placeholder, so that I can stop waiting on a render the provider never finishes.
39. As a person, I want Forget to explain that it does not cancel the render and that a finished clip is still saved in the project folder, so that I know what I gave up.
40. As a person, I want a failed render's placeholder to say why, in the provider's own words, so that I can fix the prompt or the inputs.
41. As a person, I want a render the engine could not ask about for 24 hours to fail with a message saying so, so that it does not sit "rendering" forever.
42. As a person, I want a network blip shorter than 24 hours not to fail my render, so that a paid clip is not thrown away early.
43. As a person, I want to start several renders at once, so that I can try variants in parallel.
44. As a person, I want a local clip to be refused for video generation unless sharing is on, with a message saying why and what to do, so that I do not get an opaque upstream error.
45. As a person, I want the share checkbox on by default when a local clip is selected, so that the default is the one that works.
46. As a person, I want an expandable "What sharing does" explanation next to the checkbox, so that I can decide knowingly.
47. As a person, I want the explanation to change when I turn sharing off, so that I know generating will fail.
48. As a person, I want no share checkbox when no local clip will be sent, so that the tray only asks what matters.
49. As a person, I want a pasted `https://` video link used as a reference directly, so that hosted clips need no sharing.
50. As a person, I want the share link to die when the job ends, so that my clip is public only as long as needed.
51. As a person, I want the temporary copy of my clip deleted when the share ends, so that nothing is left behind.
52. As a person, I want the engine to check the link is reachable from outside before creating the job, so that the provider does not fail with "resource download failed".
53. As a person, I want a tunnel that does not come up to be retried, and then reported instead of spending a generation, so that a flaky free tunnel does not cost me.
54. As a person, I want nothing but the shared clip reachable through the tunnel, so that my key, projects and generation routes stay private.
55. As a person, I want the sidecar next to every clip to record the prompt, model, parameters, what was sent and the cost, so that I can audit spend and repeat a run.
56. As a maintainer, I want every render job to be written as pending before the start call answers, so that a crash one moment later still leaves it recoverable.
57. As a maintainer, I want the sweep and a tab's poll never to download the same clip twice, so that a finished job is never saved under two names.
58. As a maintainer, I want writes to `jobs.json` serialised and atomic, so that two jobs finishing at once cannot drop an update and a crash cannot leave half a file.
59. As a maintainer, I want done and failed records pruned seven days after they resolved, so that `jobs.json` does not grow forever.
60. As a maintainer, I want a pending record never pruned for age, so that a slow render is never forgotten.
61. As a maintainer, I want a damaged `jobs.json` not to stop the engine booting, so that one bad file does not take the app down.
62. As a maintainer, I want lifecycle actions (spec 10) to read the store strictly, so that a damaged store is never read as "nothing in flight".
63. As a maintainer, I want the sweep never to overlap itself, so that a slow download cannot race the next tick.
64. As a maintainer, I want an unrecognised upstream status treated as still rendering, so that a new provider status never fails a paid job.
65. As a maintainer, I want the engine to close the tunnel when it exits, so that no orphan tunnel outlives the process.

## Implementation Decisions

### Terms this spec adds

- **Render placeholder**: spec 03's placeholder, as a video shape, for a render job. It is where the clip will land. Its run marker is spec 03's `meta.unframed.run` with `runId` set to the render job id, `runIndex` 1, and `durable: { params }`, where `params` is `{ prompt, model, duration, resolution, size }`, the same object the job record holds. A failed render sets spec 03's `meta.unframed.runError`. This spec adds no field of its own to the shape.
- **Role**: what one selected source will do in this run. One of: "image N", "video N", "first", "last", or the **unused mark**, which is the single character U+2014 (em dash).
- **Local clip**: a video source that names a file in the project folder. A video shape holding an `https://` link is not local.

### Modules

**Video request composition (domain).** Deep module. Interface: given the ordered sources of a selection (spec 03's source ordering: prompts, images, videos, sketch images, and later groups expanding in place), the chosen input mode, the model's catalogue entry and the tray's prop values, it returns:

- `roles`: one role per media source, keyed by shape id (a loose-mark sketch image is keyed as spec 03 keys it).
- `request`: `{ prompt, input_references, frame_images, duration, resolution?, aspect_ratio?, size?, generate_audio? }`.
- `counts`: `{ referencedImages, referencedVideos, localVideos, frames, unused }`.

Rules, all inside this module so badges, warnings and request can never disagree:

- Only media sources that hold something are sources. An empty image or video shape gets no role and is not sent.
- Reference mode (the default, and the meaning of an absent mode): every media source is a reference in Y order. Numbering is per kind: the first image is "image 1", the first video is "video 1". No reference cap is enforced.
- `first_frame`: the topmost image is "first". Every other image and every video is unused.
- `first_last`: the top two images are "first" and "last". With only one image, it is "first" and no last frame is sent. Every other image and every video is unused.
- A frame mode sends `frame_images` and an empty `input_references`. Reference mode sends `input_references` and no `frame_images`. Never both, because the provider treats a request with frames as image-to-video and discards references.
- A frame entry is `{ type: "image_url", image_url: { url }, frame_type: "first_frame" | "last_frame" }`. A reference entry is `{ type: "image_url", image_url: { url } }` or `{ type: "video_url", video_url: { url } }`. `url` is spec 03's project-file marker for a file, or the `https://` link a video shape holds.
- An image with marks on it, a cropped image and a loose-mark sketch are sent as spec 03 composes them (the composite is the file sent). A sketch image is an image for every rule here, so it can be a frame.
- Prompt text is spec 03's composition (selected prompts in Y order joined by a blank line, `@id` resolved, the per-run instruction appended).
- `duration` is the chosen value when the model declares it, else the model's first declared duration.
- When the model declares exact sizes, only `size` is sent, and only when the person set it to a declared value. Otherwise `resolution` and `aspect_ratio` are each sent only when set to a declared value. Unset props send nothing, so the model's own default applies.
- `generate_audio` is sent, as a boolean (false when unticked), only when the model declares audio.

**Video tray props (domain).** Given a catalogue entry, it returns which props exist and their options:

- Input: options "References" (`reference`), "First frame" (`first_frame`, when `frame_images` includes `first_frame`), "First and last frame" (`first_last`, when it includes both `first_frame` and `last_frame`). The prop is shown only when there are two or more options, or when a stored mode exists. A stored mode the model does not declare is still listed as an extra option labelled with its name, so it can be changed away.
- Healing decision: clear the stored mode only when the catalogue has loaded AND the entry has a `params` object AND the mode is not among the options. An entry without `params` (the engine's bare fallback row during an outage) means "unknown" and never clears anything.
- Seconds: the model's `duration` list as strings, labelled "Seconds". Always shown when the model declares durations.
- Audio: a checkbox labelled "Audio" when `generate_audio` is true. Default off.
- Size: when the model declares `size`, a prop labelled "Size" whose options are the exact sizes labelled `WIDTHxHEIGHT · R` (for example `1470x630 · 21:9`), where R is the nearest of 21:9, 16:9, 3:2, 4:3, 1:1, 3:4, 2:3, 9:16, 9:21 within 2% of width divided by height; no ratio suffix when none is within 2%. No tier or ratio prop then.
- Otherwise a prop labelled "Size" with the model's `resolution` tiers, and a prop labelled "Ratio" with its `aspect_ratio` values.
- Model change reset: switching the model clears size, resolution, aspect_ratio, duration, generateAudio, quality and inputMode. It does not touch the share consent, the per-run instruction or the medium.

The tray presents these through spec 03's prop tray ("+ add prop"): Seconds is always present; Input appears when the Input prop exists; the others are added by the person and are absent (and unsent) until added. The tray has no Runs prop for video. A clip takes minutes and is billed by the second, so a Runs control would be a way to spend ten dollars by mistake. The model and prop values are remembered in spec 03's `lastUsed.video` preference, which this spec extends with `shareLocalVideos: boolean` for the share consent.

**Video estimate (domain).** Input: the entry's `pricing` (OpenRouter's `pricing_skus` object), the set resolution tier (or none) and the effective duration. Output: dollars or null.

- Per-second price: `cents_per_second_output_<resolution lowercased>` when a tier is set and that key exists, else `cents_per_second_output`, divided by 100. Failing both, `duration_seconds` read as dollars per second. Failing that, null.
- Estimate = per-second price times duration. Null when either is missing.
- Shown in the tray's cost slot as `est. ~$` plus two decimals, for example `est. ~$1.21`. After a run, the result shows the actual cost as `$` plus four decimals (spec 03's result cost format).

**Video warnings (domain).** From `counts`, the entry and the share consent, it returns the ordered list of tray status lines:

1. When `referencedVideos > 0`, a warning: `Describe the result you want, not a change to make. An instruction like "edit this video to..." switches the model into editing mode, which OpenRouter cannot currently express and which fails with a duration error.`
2. When `unused > 0`, a warning: `One or more selected inputs will not be sent`. It names no count on purpose: the badges say which.
3. When `localVideos > 0`, the share block (below).
4. When `referencedVideos > 0` and `localVideos == 0` and the entry's `acceptsVideo` is exactly `false`: `A video is selected, but this model is not known to accept video input. It will be sent and probably ignored.` or, for N greater than one, `N videos are selected, but this model is not known to accept video input. It will be sent and probably ignored.` Never shown for `acceptsVideo: null`.
5. An error line with the last start error, if any.

`localVideos` counts only local clips that will actually be sent as references. In a frame mode a clip is unused, so no share block appears.

**Share block (web).** Shown only when `localVideos > 0`. A checkbox labelled `Share via temporary link while generating`, default on (only an explicit off is off), with an expandable note labelled `What sharing does`. Expanded, it shows:

- On: an info line `While this generates, the clip is served from this machine through a temporary public link only the model provider receives. Nothing is uploaded to storage, and the link stops working when the job ends.`
- Off: a warning line `Video generation only accepts a reference video as a public https:// link, and this one is a local file. Generating will fail unless you tick this, or use the clip in a text run instead, which does take local files.`

**Role badges (web).** While the composer is open with the video medium, every selected media source shows its role in the badge spot spec 03 uses for "image N". The badges are derived on every render from the video request composition, never stored. They follow live Y changes. They vanish when the composer closes or the medium changes to one that does not use them.

**Video catalogue (engine).** Extends spec 03's `models.list` RPC with `kind: "video"`.

- Upstream: `GET https://openrouter.ai/api/v1/videos/models` (no key needed). Each upstream model maps to `{ id, name (falls back to id), created (Unix seconds or null), params: { duration, resolution, aspect_ratio, size, frame_images, generate_audio (boolean), seed (boolean) }, pricing (pricing_skus or null), acceptsVideo }`, where each list comes from `supported_durations`, `supported_resolutions`, `supported_aspect_ratios`, `supported_sizes`, `supported_frame_images` (null when absent).
- `acceptsVideo` comes from the unofficial endpoint behind OpenRouter's own site filter, because the documented video catalogue has no modality field and video models are absent from the general models listing: `GET https://openrouter.ai/api/frontend/v1/models/find?active=true&fmt=cards&input_modalities=video`. Take `data.models[]`, keep entries whose `input_modalities` includes `video`, collect their `slug`s. Cache the set for the process lifetime. On any failure (network, non-JSON, `data.models` not a list) cache an empty set and log `  video input modalities unavailable (<message>); warnings disabled`. `acceptsVideo` is `true` or `false` when the set is non-empty, and `null` for every model when it is empty. Unknown must never read as "does not accept". Do not replace this with a guess from pricing SKUs: that was tried, matched the count and missed the set.
- The configured default video model (`OPENROUTER_VIDEO_MODEL`, spec 01) is appended as `{ id, name: id }` when the catalogue lacks it. The list is sorted by id. On upstream failure the answer is only that one row. The answer is `{ models, default }`.
- The model dialog (spec 03) links `Browse on OpenRouter` to `https://openrouter.ai/models?output_modalities=video` for this medium.

**Render job starter (engine).** RPC `video.start`. Input:

```ts
{ project: string, prompt: string,
  input_references: Ref[], frame_images: FrameRef[],
  model?: string, duration?: number, resolution?: string, aspect_ratio?: string,
  size?: string, generate_audio?: boolean, shareLocalVideos?: boolean,
  landing: { x: number, y: number, w: number, h: number },
  recipe: ResultRecipe }   // spec 03's recipe schema
```

Output: `{ jobId, status, shapeId }`. Every failure is spec 01's `UnframedError`, with `details.reason` naming which one, so the web can tell failures with the same code apart:

| `details.reason` | `code` |
| --- | --- |
| `no_key` | `unavailable` |
| `invalid` | `bad_request`, except a project file that is not in the folder, which is `not_found` (as spec 03) |
| `local_clip` | `bad_request` |
| `share_failed`, `unreachable`, `upstream`, `unpaid` | `upstream` |

The steps below name each failure as `<reason>, <message>`.

Steps, in this order:

1. No key: `no_key`, `No OpenRouter key yet. Add one with the key icon in the top right (it becomes a settings gear once saved).` (the same refusal spec 03 uses).
2. Resolve project-file markers in references and frames (spec 03's boundary inliner). Image markers become base64 data URLs. A missing file fails with `invalid` and the inliner's message. A null or non-list array counts as empty.
3. Empty or whitespace prompt: `invalid`, `Prompt is empty. Select at least one prompt, or type an instruction.`
4. Local clips (video references whose URL is not `https://`). If any exist and `shareLocalVideos` is not exactly `true`: `local_clip`, `Video generation only accepts a reference video as a public https:// link, and this one is a local file. Tick "Share via temporary link while generating" in the Generate tray, or use the clip in a text run instead, which does take local clips.` The consent is re-sent with every request; the engine never remembers it.
5. If local clips exist and consent is given, create a share per clip (share link service below), then bring the tunnel up in at most 3 attempts. Each attempt ensures a tunnel (closing the previous one first on attempts 2 and 3) and probes `<base>/share/<first token>` for up to 30 s. When no attempt succeeds: revoke every share just minted and fail `share_failed`, `Could not share the clip: the temporary link did not come up. The tunnel service is best-effort, so trying again usually works`. Any other share error revokes the same way and fails `share_failed`, `Could not share the clip: <message>`. On success each local clip's URL becomes `<base>/share/<token>`. Log `  tunnel attempt N never came up; retrying` for each failed attempt.
6. Build the payload `{ model (default model when absent), prompt }` plus `duration` when truthy, `size`, `resolution`, `aspect_ratio` when set, `generate_audio` when not null, `input_references` when non-empty, `frame_images` when non-empty. Log `  video job →  <model>  (sent <i> image, <v> video refs, <f> frames)`.
7. `POST https://openrouter.ai/api/v1/videos` with the bearer key. Every failure below revokes this job's shares first:
   - network failure: `unreachable`, `Could not reach OpenRouter: <message>`
   - body lost mid-read: `upstream`, `Lost the connection while reading OpenRouter's answer: <message>. The render may still have completed and been charged. Check your OpenRouter activity page.`
   - non-JSON body: `upstream`, `Unexpected response from OpenRouter: <first 300 chars>`
   - 402: `unpaid`, spec 03's two-cause unpaid message
   - other non-2xx: `upstream`, `OpenRouter (<status>): <message>`, where message is `error.message`, else a string `error`, else the first 300 chars of the body
   - no `id`: `upstream`, `OpenRouter did not return a video job id.`
8. Write the pending record (render job store, below) with `project`, `params`, `startedAt` (now), `status: "pending"`, `refs: { images, videos, frames }` (counts of what went out), `landing` and `recipe`. A store write failure is logged (`  job store write failed: <message>`) and does not fail the call: the placeholder's marker is a second durable copy, and the poll can collect a job the store never learned about.
9. Write the render placeholder by spec 03's placeholder lifecycle (an engine change with origin `run:<jobId>`, so it is in no tab's undo and no agent turn's Revert): a video shape at `landing`, with no file, the durable run marker, and result meta with `sidecar: null`. Its recipe is the one in the pending record, which `recipe.read` answers from until the sidecar exists (spec 03). Record the shape's id in the pending record as `landing.shapeId`.
10. Answer `{ jobId, status (upstream status or "pending"), shapeId }`.

The web computes `landing` with spec 03's result placement rule. The placeholder's height follows the chosen ratio or exact size; with neither, 16:9. The web keeps Generate disabled and labelled `Starting…` until `video.start` answers (the tunnel can take up to 90 s). A start error shows in the tray's error line.

**Share link service (engine).** Deep module. Interface: `mint(projectFile) -> token`, `revoke(token)`, `ensureTunnel() -> baseUrl`, `waitUntilPublic(url, timeoutMs) -> boolean`, `closeTunnel()`. Behind it:

- A dedicated HTTP server bound to `127.0.0.1` on an OS-assigned port, started on first use. Its only route is `GET` or `HEAD` `/share/<token>`, where token is exactly 43 characters of `[A-Za-z0-9_-]`, matched against the raw request path. Everything else, including an unknown or expired token, answers 404 `text/plain` `not found`. A hit answers 200 with the clip's MIME type (from its extension: mp4 `video/mp4`, mov `video/quicktime`, webm `video/webm`) and `Content-Length`; HEAD sends no body.
- This server bends contract 1 on purpose: it applies no `Host` or `Origin` check, because the tunnel forwards a public hostname to it. That is safe because the API is never mounted on it. The guarantee is structural, not a path filter: nothing else exists on this server.
- `mint` generates a token from 32 cryptographically random bytes (base64url), copies the project file to `<os temp dir>/unframed-share-<token>.bin`, and registers `{ file, mime, expiresAt: now + 30 min }`.
- `revoke` removes the registration and deletes the temp copy (ignoring a missing file). When no registration remains, the tunnel closes, which kills the public URL itself.
- A timer every 60 s (not keeping the process alive) revokes expired registrations. The 30 minute TTL is a backstop; the normal end is revocation when the job ends.
- The tunnel is localtunnel (an npm dependency, no binary), pointed at the share server's port. One tunnel at a time, reused while shares exist. Its browser interstitial does not matter, because providers fetch with FFmpeg, not a browser.
- `waitUntilPublic` must not use the local resolver, which can answer NXDOMAIN for a hostname already live at the edge. It resolves A records over DNS-over-HTTPS (`GET https://cloudflare-dns.com/dns-query?name=<host>&type=A`, `accept: application/dns-json`, answers of type 1), then sends an HTTPS `HEAD` for the path to each IP with SNI and `Host` set to the hostname, 8 s timeout each. A 200 means up. Otherwise it waits 2 s and tries again until the deadline.
- On process `exit`, `SIGINT` and `SIGTERM` the tunnel closes; on the two signals the process then exits 0.
- A restart mid-job breaks a shared link, unavoidably: registrations are in memory and the tunnel hostname is ephemeral.
- Per-job bookkeeping in the engine maps job id to its tokens, and revokes them all when the job becomes done or failed, whichever path resolves it.

The share registry's rules (token shape, expiry, "tunnel needed while any registration is live") are a pure domain module, so they are testable without a tunnel.

**Upstream status reader (engine).** One implementation of "ask OpenRouter about a job", shared by the poll and the sweep. `GET https://openrouter.ai/api/v1/videos/<id>` with the bearer key and a 30 s timeout. It never throws. It returns one of: answered `{ data }`; no answer from a network error or a body lost mid-read (`could not read the status answer: <message>`); non-JSON (`Unexpected response from OpenRouter: <first 300 chars>`); non-2xx (`OpenRouter (<status>): <message>`). The last three are "not answered" for the give-up clock.

Status classification, one home for both callers: `completed` is done; `failed`, `expired`, `cancelled`, `canceled` are terminal failures, with message `data.error.message`, else a string `data.error`, else `Generation failed.`; anything else, including a status nobody has seen, is still in flight. A new provider status must default to "keep waiting".

**Collector (engine).** The only implementation of "a completed job becomes files, a record and a canvas result". Used by the poll and the sweep.

1. Download URL: `data.unsigned_urls[0]`, else `data.urls[0]`; none fails with `Job completed without a video URL.` Fetch it with the bearer key and a 300 s total timeout; non-2xx fails with `Could not download the video (<status>).`
2. After the download, re-read the store for the job's current `project` (a rename may have landed during the download; spec 10 repoints pending records). Fall back to the handed record when the store lacks it. A record the store already holds as done or failed (spec 10 fails the records of a project deleted during the download) keeps that outcome: the clip is dropped and nothing below runs.
3. Write `<stamp>-<slug(prompt)>.mp4` into that project's folder, where stamp is the ISO time with `:` and `.` replaced by `-`, and slug is spec 01's slug rule. Use spec 03's exclusive-create collision rule for the name. When the folder is gone (the render moved with an output folder change, or the folder was removed by hand), make it again: the paid clip is kept, and the sweep does not download it again on every tick.
4. Write the sidecar next to it (format below). A sidecar write failure is logged (`  sidecar not written: <message>`) and does not fail collection.
5. Persist the done record: `project` (the folder actually used), `status: "done"`, `savedPath` (absolute), `cost` (`data.usage.cost`, else `data.cost`, else null), `resolvedAt`. Add `params` and `refs` only when the handed record has them, so a merge never erases stored values.
6. Revoke the job's shares.
7. Land the result in the project's sync room as an engine change. If a shape carries this job's marker, fill it by spec 03's lifecycle (file, result meta with the new sidecar, marker removed), keeping its position and width. If none does, the placeholder was deleted, and spec 03's lifecycle step 4 applies: no shape is recreated, the clip and sidecar stay in the folder. The one exception is a record that never had a placeholder (no `landing.shapeId`, from an older store) and is not `forgotten`: it gets a new video result at `landing`, or, without `landing`, to the right of the rightmost shape on the canvas, top-aligned with the topmost. When the room's project folder no longer exists, skip this step. The web corrects the shape's height to the clip's aspect the first time it loads the clip, as spec 02 does for any video of unknown aspect.

**Failing a job (engine).** One implementation for every path (poll, sweep, and spec 10's lifecycle actions): revoke the job's shares, persist `status: "failed"`, `error`, `resolvedAt`, and, as an engine change, set spec 03's `runError` on the shape carrying the job's marker and remove the marker (spec 03's failure step for a durable placeholder).

**Poll (engine).** RPC `video.poll`. Input `{ jobId, project, params }` (the marker's `durable.params`, the fallback for a job the store never learned about). Output one of `{ status: "completed", cost, savedPath, url }` (url is spec 01's project file URL), `{ status: "failed", error }`, `{ status: <raw upstream status>, progress }` (in flight). Failures are spec 01's `UnframedError` with `details.reason`, coded as for `video.start`.

1. Read the store leniently. A `done` record answers completed from the record; a `failed` record answers failed with its `error` (or `Generation failed.`). This comes before the key check: answering from the store needs no key, and that is how a tab learns its render ended after the key was removed.
2. No key: `no_key`, `No OpenRouter key yet.`
3. Ask upstream. Not answered: network errors fail `unreachable`, `Could not reach OpenRouter: <message>`; the others fail `upstream` with their message.
4. Terminal failure: fail the job (above) and answer failed. If recording the failure throws: `upstream`, `The render failed upstream (<message>), but recording that failed too: <error>`.
5. In flight: answer the raw status string and `progress` (or null), so an unusual status reads as unusual.
6. Completed: if this job id is in the in-process collecting set, answer `{ status: "pending", progress: null }`. Otherwise add it, re-read the store (the earlier read is a network round trip old), answer from a record that is now done or failed, else collect using the fresh record or, when absent, one built from the input (`project`, `params`, and the refs remembered in memory at start, if any). Remove the id from the set whatever happens. A collection error fails `upstream` with its message.

**Forget (engine).** RPC `video.forget { project, jobId }`. Sets `forgotten: true` on the record and removes the placeholder carrying that marker, as an engine change. The render is not cancelled (OpenRouter has no cancel). The sweep still collects the clip and its sidecar into the project folder, and puts no shape on the canvas.

**Sweep (engine).** Runs once at boot and then every 30 s. It does nothing without a key, and nothing while a previous sweep is still running (a flag, so a slow tick never overlaps the next). It reads the store leniently and visits every pending record one at a time, never in parallel. Each visit has its own error catch (logging `  sweep failed for <id>: <message>`), so one job's failure never skips the jobs behind it.

A visit:

1. Ask upstream. Not answered: when `givenUp` holds, fail the job with `Stopped checking after 24 hours with no answer about this render. The last attempt said: <why>` (why is the reader's message, else `no answer`) and log `  video job <id> gave up: unreachable for 24h (<why>)`. Otherwise, only when the record has no `unreachableSince`, stamp it now. Later misses in the same run write nothing.
2. Answered: when the record has `unreachableSince`, clear it (any answer, even "queued", resets the clock).
3. Terminal failure: fail the job with the provider's message.
4. In flight: nothing.
5. Completed: skip when the id is in the collecting set. Otherwise add it, re-read the store, stop when the fresh record exists and is not pending, else collect with the fresh record (or the snapshot if the store lacks it). Log `  video job <id> collected by the sweep → <path>` or `  sweep could not collect <id>: <message>`. Remove the id from the set.

**Render job store (engine, with a pure domain half).** One JSON array in `<output folder>/jobs.json`, pretty-printed with two-space indent.

```ts
type RenderJob = {
  id: string                       // OpenRouter's job id
  project: string | null           // project folder name; missing and '' are one bucket
  params: { prompt: string, model: string, duration: number | null,
            resolution: string | null, size: string | null }
  startedAt: number                // epoch ms, never changes
  status: 'pending' | 'done' | 'failed'
  refs?: { images: number, videos: number, frames: number } | null
  savedPath?: string               // done
  cost?: number | null             // done
  resolvedAt?: number              // epoch ms, stamped on done or failed
  error?: string                   // failed
  unreachableSince?: number        // epoch ms, first unanswered poll in the current run of them
  landing?: { shapeId?: string, x: number, y: number, w: number, h: number }
  recipe?: ResultRecipe            // spec 03's recipe schema
  forgotten?: true
}
```

The first eleven fields are the old app's format exactly; spec 11 and old stores rely on that. `landing`, `recipe` and `forgotten` are new and optional.

Pure rules (domain):

- `upsert(jobs, job)`: replaces the record with the same id, else appends.
- `merge(existing, patch, now)`: `{ startedAt: now, ...existing, ...patch, id }`, where a patch key set to undefined removes that key from the written file (that is how `unreachableSince` is cleared).
- `prune(jobs, now)`: keeps every pending record; keeps a done or failed record while `now - (resolvedAt ?? startedAt)` is under 7 days; keeps any record whose age is not a finite number. Age counts from `resolvedAt` so a render that sat pending for a week is not deleted in the write that resolves it.
- `givenUp(job, now)`: true when `now - unreachableSince` is a finite number of at least 24 hours. A record without the stamp is never given up.
- `pendingFor(jobs, project?)`: pending records, all of them when project is omitted or null, else those whose project (missing treated as '') matches.
- `parseLenient(text)`: a list, or `[]` for anything that is not a JSON list.
- `parseStrict(text, path)`: a list, or an error: `The job store at <path> is not valid JSON: <message>` or `The job store at <path> is not a list of jobs.`

I/O half (engine):

- **Lenient read**: missing, unreadable, corrupt or non-list reads as `[]`. Used by the sweep, the poll, the collector and every store write. Refusing to boot or sweep over one bad file is worse than losing the ability to resume. The accepted cost: if something outside this process corrupts the file, the next write merges onto `[]` and forgets every other record in it. A placeholder's marker still lets an open tab collect its own job through the poll.
- **Strict read**: only a missing file reads as `[]`; an unreadable file fails with `The job store at <path> could not be read: <message>`, and bad content with `parseStrict`'s errors. Used by every lifecycle action that could strand a render (spec 10), because "0 pending" from a damaged store reads exactly like "nothing in flight".
- **persistJob(dir, id, patch)**: queued on one module-level promise chain, so no two read-modify-writes interleave; a failed write does not poison later ones. Each run reads leniently, merges, upserts, prunes, then writes via a temp file in the same folder (`jobs.json.<pid>-<epoch ms>.tmp`) renamed over `jobs.json`, creating the folder when missing. Returns the merged record.
- Spec 10's lifecycle operations (copy pending records to a new output folder, drop copied ids, fail pending records for a project or for all, repoint a project's pending records) run on the same chain with strict reads. Spec 10 owns them; this spec owns the chain, the reads and the format.

**Video sidecar.** Written by the collector as `<stamp>-<slug>.json` next to the clip:

```ts
{ kind: 'video', prompt: string, model: string,
  duration: number | null, resolution: string | null, size: string | null,
  aspect_ratio: string | null, generate_audio: boolean | null,
  inputMode: 'reference' | 'first_frame' | 'first_last',
  references: { images: number, videos: number, frames: number } | null,
  usage: object | null,     // upstream usage block, verbatim
  cost: number | null,
  createdAt: string,        // ISO
  file: string,             // the clip's file name
  jobId: string,
  recipe: ResultRecipe }    // spec 03's recipe schema, including composite and original files
```

`usage` is kept verbatim because it is the only evidence that footage was consumed: models that charge for video input bill it under their own SKU. The first ten fields match the old format; `aspect_ratio`, `generate_audio`, `inputMode`, `file`, `jobId` and `recipe` are new (taken from the record's recipe).

**Render placeholder (web).** The extended video shape (spec 02) renders these states from its `meta.unframed` fields (spec 03), so every tab and every reload agrees:

- Pending (marker present): a box the size of the landing spot showing the status line `Rendering… (N min)`, where N is whole minutes since `startedAt`, floored, updated at least once a minute. Below it a small ghost button `Forget this job` with tooltip `Stops tracking this job here. It does not cancel the render upstream. If it finishes anyway, the clip is still saved in the project folder but will not appear on the canvas.` Clicking it calls `video.forget`.
- Failed (`runError` set): the same box with an error status line holding `runError`. It keeps its recipe (the job record's), so spec 03's Regenerate and Recipe work on it. Deleting it is an ordinary delete.
- Done: an ordinary video result.

Copying and deleting a placeholder follow spec 03's rules: a copy loses the marker, the run error and the unfilled result meta; a deleted placeholder is an ordinary undoable delete and is not recreated when the clip is collected (the clip and sidecar still land in the project folder); undo that restores it restores its marker, and the resume below picks it up. Forget is the explicit form of the same thing, which also tells the store.

**Client poll (web).** For each render placeholder in the open project, the tab runs at most one poll loop per job id:

- Check once immediately, then every 4 s, for up to 15 minutes.
- A transport error or unreadable answer counts as still pending, never as a failure: the engine may just be restarting.
- `completed` and `failed` end the loop. The shape's own update from the engine is what the tab displays; the poll only makes it happen sooner.
- When the 15 minutes run out with the job still pending, the marker stays and the tab checks once more every 2 minutes (a single check each time, never a second loop) until the job ends, the marker disappears, or the tab closes.
- On opening a project, loops start for every placeholder already there. That is the resume after a reload or a project switch.

### Limits and constants

| What | Value |
| --- | --- |
| Sweep interval | 30 s, plus once at boot |
| Upstream status timeout | 30 s |
| Clip download timeout | 300 s total |
| Client poll | immediately, then every 4 s for 15 min, then one check every 2 min |
| Give-up window | 24 h of continuous unanswered polls |
| Prune | done and failed, 7 days after `resolvedAt` |
| Share token | 32 random bytes, 43 base64url characters |
| Share TTL | 30 min backstop; expiry check every 60 s |
| Tunnel attempts | 3, each probed up to 30 s, so 90 s in all |
| Probe | DoH A lookup, HTTPS HEAD per IP with SNI, 8 s each, 2 s between rounds |
| Local clip size | spec 02's 25MB cap on video files |

### Test hooks

Every OpenRouter call in this spec (video create, status and catalogue, and the find endpoint) goes through spec 01's `UNFRAMED_TEST_OPENROUTER_ORIGIN`; there is no per-URL override. The share tunnel, the sweep interval and the share TTL are driven by `UNFRAMED_TEST_TUNNEL`, `UNFRAMED_TEST_SWEEP_MS` and `UNFRAMED_TEST_SHARE_TTL_MS`, defined in spec 01's test-only table.

## Testing Decisions

A good test drives one of the three seams from spec 00 and asserts on what that interface shows: RPC answers, the sync room's shapes, the files in the project folder and `jobs.json`, and what the stub upstream received. It never reaches into the collecting set, the share registry's memory or the promise chain.

- **Domain seam** for rules with many cases: request composition and roles over every mode and mix of images, clips, sketches and empty shapes; prop options and healing; model-change reset; the estimate; the warning list; the ratio label; the store's pure rules (merge, prune, givenUp, pendingFor, both parsers); the share registry's token and expiry rules. Assert that roles and request agree for every case: a source with a numbered role is in `input_references` at that position, "first" and "last" are the frames, and the unused mark means the source is in neither array.
- **Engine seam** for the catalogue mapping, `video.start`, the share server, the poll, the sweep, the collector, Forget and the store's I/O. Fork the engine with spec 01's `UNFRAMED_TEST_OPENROUTER_ORIGIN` pointing at an in-test stub that records every request and can hold a download open, answer any status, or return any body. Seed `jobs.json` by writing it before the fork (the old app's tests did this: a record 25 hours unreachable, a record with no stamp, a record already done). Read the room over the sync socket. Set `TMPDIR` for the forked engine to watch temp copies.
- **Browser seam** for the tray, badges, warnings, share block, estimate, placeholder states, Forget, resume and the poll cadence (Playwright's clock control for the 4 s, 15 minute and 2 minute timings).

Prior art: the old app pinned request composition with plain assertion tests over hand-built node lists, and pinned the hosting and render-job contract by forking the real server into a temp folder against a seeded store and letting the real boot sweep run. Copy both shapes.

## Tasks

1. The video catalogue maps upstream models to `{ id, name, created, params, pricing, acceptsVideo }`, sorted by id. Seam: engine.
2. `acceptsVideo` is true or false from the find endpoint's slugs, cached for the process. Seam: engine.
3. A failing find endpoint makes every `acceptsVideo` null and logs the warnings-disabled line. Seam: engine.
4. The configured default is appended when missing, and an upstream failure answers only the default row. Seam: engine.
5. Prop options from an entry: Seconds, Audio, exact Size with ratio labels, or tier Size plus Ratio. Seam: domain.
6. The ratio label snaps within 2% and stays bare otherwise. Seam: domain.
7. Input options follow `frame_images`; a model without frames has no Input prop; a stored unsupported mode is listed as an extra option. Seam: domain.
8. The healing decision clears only when the entry has params and lacks the mode. Seam: domain.
9. A model change clears every model-dependent value and keeps the share consent. Seam: domain.
10. Reference mode numbers images and videos per kind in Y order and sends them all as references. Seam: domain.
11. First-frame mode sends the topmost image as the first frame and marks everything else unused. Seam: domain.
12. First-and-last mode sends the top two images as first and last; one image sends only a first frame. Seam: domain.
13. Clips are unused in both frame modes; empty media shapes get no role; a sketch image can be a frame. Seam: domain.
14. The request never carries both references and frames, nor size with tier or ratio; audio only when declared; duration defaults to the first declared. Seam: domain.
15. Roles and request agree for every generated case. Seam: domain.
16. The estimate uses the tier SKU, then the generic SKU, then dollars per second, else null. Seam: domain.
17. The warning list shows the right lines for video references, unused inputs, local clips and `acceptsVideo: false`, and none for null. Seam: domain.
18. Choosing the video medium shows the video model and only the props that model declares, with Seconds always present and no Runs prop. Seam: browser.
19. Changing the model resets the props in the tray. Seam: browser.
20. Opening the composer on video shows role badges on selected media; closing it removes them. Seam: browser.
21. Dragging one selected image above another swaps "first" and "last" live. Seam: browser.
22. The tray shows the unused warning, the video-into-video warning and the not-accepted warning when their conditions hold. Seam: browser.
23. The share block appears only for a local clip that will be sent, is on by default, expands to the on text, and shows the off warning when unticked. Seam: browser.
24. The estimate reads `est. ~$x.xx` and changes with Seconds and Size. Seam: browser.
25. The share registry mints 43-character tokens, expires them after the TTL, and reports the tunnel needed only while a registration lives. Seam: domain.
26. `video.start` refuses without a key. Seam: engine.
27. `video.start` refuses an empty prompt and a missing project file. Seam: engine.
28. `video.start` forwards exactly the payload rules to the stub, with image markers inlined. Seam: engine.
29. `video.start` has written the pending record with params, refs, landing and recipe by the time it answers. Seam: engine.
30. `video.start` maps network failure, non-JSON, 402, other non-2xx and a missing id to their messages. Seam: engine.
31. `video.start` refuses a local clip without consent. Seam: engine.
32. With consent and `UNFRAMED_TEST_TUNNEL=loopback`, the stub receives a share URL that serves the clip byte for byte with its MIME type to GET and HEAD. Seam: engine.
33. The share server answers 404 `not found` to every other method, path and malformed or unknown token, and exposes no API route. Seam: engine.
34. With `UNFRAMED_TEST_TUNNEL=never`, start makes 3 attempts, fails with the tunnel message, and leaves no temp copy. Seam: engine.
35. A failed upstream create revokes the shares it minted and deletes their temp copies. Seam: engine.
36. A share past its TTL answers 404 and its temp copy is gone. Seam: engine.
37. `video.start` writes the render placeholder into the room at the landing spot with spec 03's durable marker (`runId` = the job id, `durable.params`) and unfilled result meta, and `recipe.read` answers the job record's recipe for it. Seam: engine.
38. `video.poll` answers a done or failed record from the store, even with no key. Seam: engine.
39. `video.poll` without a key and with a pending record refuses with the short no-key message. Seam: engine.
40. `video.poll` passes an in-flight status through raw, including an unknown status, and leaves the record pending. Seam: engine.
41. `video.poll` fails the record with the provider's message for failed, expired, cancelled and canceled. Seam: engine.
42. `video.poll` on a completed job writes the clip, the sidecar in the documented format and the done record, and revokes shares. Seam: engine.
43. A second poll of a collected job downloads nothing. Seam: engine.
44. `video.poll` collects a job missing from the store using the params it carries. Seam: engine.
45. Collection turns the placeholder into a video result with the file and recipe, keeping its position. Seam: engine.
46. Collection with the placeholder deleted recreates no shape and leaves the clip and sidecar in the folder; a seeded record with no `landing.shapeId` gets a new result at its landing spot. Seam: engine.
47. A forgotten job loses its placeholder, is still collected to disk, and adds no shape. Seam: engine.
48. Failing a job sets the placeholder's `runError` and removes its marker; boot resolves a durable marker against the store (pending left, done filled, failed given `runError`). Seam: engine.
49. The boot sweep collects a seeded pending job with no client connected. Seam: engine.
50. The sweep fails a seeded job on a terminal status with the provider's message. Seam: engine.
51. The sweep stamps `unreachableSince` on the first miss and leaves it byte-identical on the next. Seam: engine.
52. The sweep clears `unreachableSince` when upstream answers "queued". Seam: engine.
53. The sweep fails a job 25 hours unreachable with the give-up message. Seam: engine.
54. `givenUp`, `prune` and `merge` hold their rules, including NaN ages kept and undefined keys removed. Seam: domain.
55. Both parsers: lenient turns anything but a list into `[]`, strict names the path and the fault. Seam: domain.
56. A corrupt `jobs.json` does not stop boot, and the sweep treats it as empty. Seam: engine.
57. Two jobs completing in the same moment both end done in `jobs.json`, and no temp file is left behind. Seam: engine.
58. A download held longer than the sweep interval is downloaded once, and a poll arriving meanwhile answers pending. Seam: engine.
59. A record's project changed during a held download sends the clip to the new project's folder and records that project. Seam: engine.
60. A placeholder shows `Rendering… (N min)` and the count advances with the clock. Seam: browser.
61. Reloading the tab resumes the poll for an existing placeholder, and the clip appears when the stub completes. Seam: browser.
62. `Forget this job` removes the placeholder and the tooltip text is shown. Seam: browser.
63. A failed render shows its error on the placeholder. Seam: browser.
64. A result collected by the sweep appears in an open tab that never polled it. Seam: browser.
65. The tab polls immediately, then every 4 s, stops after 15 minutes, then checks once every 2 minutes. Seam: browser.
66. Generate reads `Starting…` and is disabled until `video.start` answers, and a start error shows in the tray. Seam: browser.

## Out of Scope

- Audio references (a separate input kind with its own caps).
- Enforcing per-model reference caps. OpenRouter's catalogue does not publish them for video, and hard-coded numbers would rot silently.
- Negative prompts.
- Seedance's `@ImageN` addressing. Prompts say "image 1" as plain text.
- Video editing mode. The provider demands `duration: -1`, which OpenRouter's validation rejects; the tray warns about phrasing instead. Do not "fix" it by dropping params: that was tried and bought nothing.
- Portrait-tier or consent-gated real-person routes. OpenRouter does not expose them.
- Cancelling a render upstream. OpenRouter has no cancel.
- Keeping a share link alive across an engine restart.
- A Runs prop, batches or Free mode for video.
- Lifecycle actions that end or move records (output folder change, project rename and delete, key removal): spec 10, on this spec's store.

## Further Notes

**Why frames and references cannot combine.** Seedance offers four mutually exclusive task types: omni reference-to-video, image-to-video from a first frame, image-to-video from first and last frames, and text-to-video. OpenRouter exposes them as `input_references` and `frame_images` and documents that frames win when both are sent. A paid probe on 2026-08-15 confirmed it: a request with a reference plus a first frame produced a clip containing only the frame, and the reference was discarded. The Input prop is a property of the request, not of each image, because the provider accepts exactly one task type per request. A UI that can express an impossible request has to explain itself afterwards.

**Moderation fires twice.** Input moderation arrives at create as an HTTP 400 quoting the provider (for example `InputVideoSensitiveContentDetected.PrivacyInformation`, which names the request's `content[1]`, the first attached media). Output moderation arrives minutes later as `status: "failed"` with an error. Both are covered by the paths above; anything that explains a moderation failure must cover both. Reference-to-video has the strictest real-person classifier, which is one reason First frame exists.

**Provider limits worth knowing.** A reference clip must be at least 1.8 s long and 300 px wide.

**Why the sweep and the poll both exist.** The sweep is what guarantees landing with no tab open. The tab's poll only shortens the wait from up to 30 s to up to 4 s, and surfaces failures sooner.

**Manual external check for the share link.** Run after any change to the share service or tunnel flow, because only an outside caller can prove it. Select a local clip, leave sharing on, Generate, and take the tunnel URL from the engine log. From outside this machine (a phone on cellular is ideal): `GET https://<tunnel>/share/<token>` during the job answers 200 with bytes identical to the clip; `/`, and every RPC and HTTP route path the engine has, answer 404; the engine's own port is not reachable through the tunnel host. After the job ends the share URL answers 404 while other shares keep the tunnel up, and is unreachable once the last share is revoked. No `unframed-share-*` file remains in the temp folder.

**Contract notes.** Contract 1 is bent for the share server only, as described in the share link service. Contract 5 is kept by writing the pending record before `video.start` answers; the placeholder's marker is a second durable copy for the rare store write failure.

### Assets this spec needs

None. This spec has no model-facing prompt text.
