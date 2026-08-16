# Video references, and the temporary share tunnel

Everything about getting a clip *into* a generation. Read this before touching
`server/share.js`, `VideoNode.jsx`, `VideoOutputNode.jsx` or `/api/video`. Core
rules are in `CLAUDE.md`.

## Reference media are base64 data URLs

Carried in `node.data.dataUrl`, images and videos alike, which is why the server
sets a 60mb JSON body limit. Videos are the sizing case: the client caps a clip at
25MB raw (`MAX_VIDEO_BYTES` in `VideoNode.jsx`) since base64 inflates ~4/3 and the
whole graph also lands in `graph.json` on every autosave.

A video node also accepts a pasted `https://` link directly — `dataUrl` holds the
URL, opaque to everything downstream.

Reference numbering is per kind: "image 1" and "video 1" coexist on one consumer
(`sourceRoles(nodes, edges, id)`, which reads the kind off the node).

**A local clip can reach a text output but not video generation.** Video references
reach a text model as OpenRouter's `video_url` chat content part (verified live:
Gemini described a test clip). They cannot reach `/videos`, which takes `video_url`
only as a public `https://` URL and rejects a data URL outright; the undocumented
Files API that might have hosted one takes images, audio and documents but **not
video**. Reference *images* as base64 are fine there, which is why image-to-video
works. Both the video output and `POST /api/video` refuse a local clip with that
explanation rather than letting it become an opaque upstream 400 — unless sharing is
ticked.

## Input modes

Seedance offers four task types and a request is exactly one of them: omni
reference-to-video, image-to-video from a first frame, image-to-video from first and
last frames, or text-to-video. There is no mode that takes frames *and* references —
send both and the references are discarded, which is ByteDance's design rather than
OpenRouter's. Verified against the live API; the evidence is in
`docs/superpowers/specs/2026-08-15-video-input-mode-design.md`.

The video output node's **Input** selector picks the type. Options appear only where
the model declares them in `supported_frame_images`, so a model without frame support
shows no selector at all. Absent on a saved graph means References, which is what
every graph did before the selector existed.

**A mode never outlives the model it was picked for.** Switching the node's model clears
`inputMode` along with every other model-dependent setting (`resetModelParams` in
`client/src/nodes/output/defaults.js`), so a fresh model starts at its own defaults rather
than inheriting a mode it may not support. A node that keeps its *stored* model but
whose *effective* model changes underneath it — the global default moved in Settings,
or the catalogue came back with different capabilities after being unavailable — heals
the same way on next open: a mode the model can no longer honour is cleared, the same
self-correction `migrateNodes` does for an old graph shape. The healing is deliberately
cautious about what "can no longer honour" means: a catalogue fetch that fails or omits
the configured model is treated as "unknown," not "unsupported," so an OpenRouter outage
does not itself wipe a perfectly good setting.

Which image is which comes from canvas position, top to bottom — the same rule that
orders prompts and numbers references. In first-frame mode the topmost wired image is
the frame; in first-and-last mode the top two are first and last.

Anything the mode has no room for keeps its connection and is marked instead of
dropped: the edge turns red and stops animating, its tooltip says why, and the input
node's badge reads `—`. The video output's own StatusLine stays count-free on
purpose ("One or more inputs connected will not be sent") — the red edges already
say which ones, and that changes as you rewire. Nothing marked is sent.

## Only one of the two video-to-video modes is reachable

Seedance picks its mode from the PROMPT:

- Describing a result is **reference-to-video** and works, with size and duration
  honoured.
- Instructing a change ("edit this video to…") is **video editing**, which then
  demands `duration: -1` — rejected by OpenRouter's own validation
  (`expected number to be >=1`), whether we send a duration or omit it.

So the controls stay enabled and `wiredVideoIntoVideo` in `VideoOutputNode` warns
about prompt phrasing instead. Verified with zero-cost probes; **do not "fix" this by
dropping params**, which was tried and bought nothing.

Provider limits on a reference clip, worth knowing before spending a generation:
duration >= 1.8s, width >= 300px (and 4–30s for the editing path).

## A render outlives the browser

A video job is asynchronous upstream and can run for minutes. The node persists
its job id (`data.job`) so a reload can resume watching one already in flight,
but that alone still needs someone to reopen the app before a finished clip
gets collected. It doesn't anymore: the **server** owns the job too.

`POST /api/video` writes the job to `<OUTPUT_DIR>/jobs.json` as `pending` before
it replies. From then on, a 30-second sweep — running independently of any
browser tab, starting once at boot so a job that finished while the app was
closed doesn't wait for the first tick — polls every pending job the exact way
`GET /api/video/:id` does, and on completion downloads the clip and writes it
plus its sidecar, the same as if a tab had been watching. A render finishes and
lands in your project whether or not the app is open, and survives a restart.

This is also why re-polling a finished job is safe: asking about a job the
sweep already collected returns the file it already saved rather than
downloading it again. That alone isn't the whole guarantee, though — a sweep
tick can be mid-download when a browser's own poll finishes the very same job
first, so both sides also re-check the store immediately before they'd start
downloading and back off if the other already finished, and every write to
`jobs.json` is queued through one chain so two jobs finishing seconds apart
can't have their updates overwrite each other. Together, that's what stops the
browser's own resume and the sweep from ever writing the same clip to disk
under two different timestamps.

`done` and `failed` jobs are cleared out of `jobs.json` after seven days,
counted from the moment a job actually finished rather than from when it was
started — a render that sat queued for a week and then completed is not
deleted in the same breath. A `pending` one is never dropped for age alone — only the sweep actually
finishing it, one way or the other, retires it.

## The share tunnel

Ticking **"Share via temporary link"** on a video output makes `server/share.js`
serve the clip through a temporary localtunnel for the life of the job.

**The security guarantee is structural, not a filter.** The tunnel points at a
dedicated 127.0.0.1 server whose only route is `GET/HEAD /share/<256-bit token>` —
the Express API is never mounted behind it, so no path-filter bug can expose it.
Tokens are `crypto.randomBytes(32)`; files are tmp copies deleted on revoke; revoke
happens when the job completes or fails (the poll handler), with a 30-min TTL
backstop; the tunnel closes with the last share, which kills the URL itself.
`server/share.test.js` asserts that surface in `npm test`.

localtunnel needs no binary installed, and its 511 interstitial never fires because
the provider fetches with FFmpeg, not a browser.

### Gotchas, learned the hard way

- **A fresh tunnel hostname is handed back before it is fetchable**, and the provider
  pulls the reference almost immediately after the job is created. Creating the job
  first loses that race: the provider reports
  `content[1].video_url ... resource download failed`. Hence `waitUntilPublic()`,
  which blocks job creation until the link actually serves. (Found on cloudflared,
  where the gap was seconds; localtunnel is far quicker, but the guard is cheap and
  the race is the provider's, not the tunnel's.)
- **That probe must NOT use the local resolver.** This machine answered NXDOMAIN for
  a hostname already live at the edge, so a plain fetch reported "not ready" for 90s
  while `curl --resolve` fetched it fine. The probe resolves over DoH (1.1.1.1) and
  connects to that IP with SNI and Host set, which is what a provider's own resolver
  would see.
- Free tunnels are best-effort and can fail to come up at all. The 90s timeout then
  reports it instead of spending a generation.
- **Restarting the server mid-job breaks a shared link, unavoidably**: the share map
  is in memory AND the tunnel hostname is ephemeral, so a new process cannot resume
  the old URL. `node --watch` restarts on every server edit, so do not edit server
  files while a shared generation is running. The tunnel closes on
  exit/SIGINT/SIGTERM.

### Manual external check — run after any change to `share.js` or the tunnel flow

`share.test.js` covers the surface from inside this machine; this is the part only an
outside caller can prove.

1. Wire a local clip into a video output, tick "Share via temporary link", Generate.
   Grab the tunnel URL from the server log.
2. From OUTSIDE this machine (a phone on cellular is ideal; same machine via
   `curl --resolve host:443:$(dig +short @1.1.1.1 host | head -1)` if local DNS lags
   a fresh hostname):
   - `GET https://<tunnel>/share/<token>` while the job runs → 200 video/mp4,
     byte-identical to the source clip.
   - `GET https://<tunnel>/api/health`, `/api/config`, `/api/projects`,
     `/api/generate`, `/` → ALL must be 404. Anything else is a regression: stop and
     fix before shipping.
   - Port 8787 must not be reachable through the tunnel host at all.
3. After the job completes (or you kill the poll), the same `/share` URL must die —
   404 while other shares keep the tunnel up, unreachable once the last share revokes.
4. `ls /tmp/unframed-share-*` → nothing after revoke.
