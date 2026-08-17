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

There is one way for the sweep to finish a job it can never get an answer about.
An id OpenRouter no longer knows answers 404 to every poll, and since a pending
record is kept regardless of age, that job would be re-polled every 30 seconds for
as long as the server runs. So the sweep keeps a clock: the first poll that fails
to get any answer stamps the record, any poll that *does* get one — even one that
only says "still queued" — clears it, and 24 continuous hours with no answer at
all marks the job failed, with an error saying that is what happened. The window
is deliberately long. Giving up early on a render that was merely unreachable
throws away a clip already paid for; giving up late costs one line in `jobs.json`.

## The contract, in one table

Every render started ends in exactly one of two visible states — clip + sidecar
on disk, or a `failed` record that says why — under every disruption below,
provided three things hold for the render's lifetime: **the server must
eventually be able to run again** (a sleeping laptop, a closed tab, a restart, or
a temporary network outage are covered by design and do not count against this
— see the sections above); **the output storage must stay writable**; and
**Unframed must go on holding credentials for the same OpenRouter account that
started the job**. This table is the scope: a new "what if X happens
mid-render" belongs here as a row (with its guarantee and its test) before it
becomes work anywhere else.

`Tested?` is `yes` when the row's guarantee is exercised end to end (an
automated test, or an in-app run logged as verified), `partial` when part of
it is and part isn't, and `no` when nothing exercises it. The footnotes below
say exactly which part is which; the column is only a place to look first.

| Mid-render… | What happens | Tested? |
| --- | --- | --- |
| the user closes the tab or laptop | the server's sweep collects it; files land in the project | partial [^1] |
| the user reloads the page | the node resumes watching via `data.job` | yes [^2] |
| the user switches projects | the canvas remounts; the job stays with its project's record | yes [^3] |
| the user presses undo/redo | live run markers win over the snapshot; restoring a node that a delete removed has no live value to prefer, so `job` is kept (durable server-side) and `running` is dropped (tied to a request instance that no longer exists) | yes [^4] |
| the user copies the node or saves it as a preset | markers stripped; the copy is a fresh node | yes [^5] |
| the user inserts a preset saved mid-render years ago | markers stripped again on the way in | yes [^6] |
| the user changes the output folder in Settings | records copy into the new store, then the source is stripped — a failure anywhere duplicates a record rather than losing it; a destination or source it can't read fails outright and moves nothing | partial [^7] |
| the provider ends the job (fails, expires, or is cancelled) | the record fails with the provider's own message | yes [^8] |
| the provider forgets the job id entirely (every poll answers with no match) | failed after 24h of continuous silence, saying so | yes [^9] |
| the connection to the provider blips for less than 24 hours | the silence clock resets on the first answer that gets through | yes [^10] |
| this machine's server restarts | the store is durable; the boot sweep resumes | yes [^11] |
| two watchers race to collect the same finished job (a sweep tick and a browser poll, or two tabs) | one download: the store is consulted first, then an in-process lock | partial [^12] |
| the user removes the OpenRouter key | every pending record it can read ends immediately in the job store, `failed`, saying the key was removed — and a card still polling that render is told, since reading an already-resolved record needs no key | partial [^13] |
| the user replaces the key with a different account's | replacement ends nothing by itself; an id the new account can't see 404s like a forgotten job and still resolves eventually via the 24h silence clock, just without naming why | partial [^14] |
| the user renames the project | records repoint to the new name before the folder moves, and are put back if the move fails — no ghost project, unless the put-back itself also fails, in which case the records are left under the new name with no folder yet, and the error says so. Since 2026-08-17 the download window is closed too: `collectVideo` re-reads the project from the store after the download, immediately before writing, and the done record names the folder the clip actually went into. | partial [^15] |
| the user deletes the project | the route itself refuses with a 409 naming how many renders are at stake until the caller confirms — a client that forgets to ask cannot abandon a render silently; confirmed, records end before the folder is removed, and a failed removal says so instead of looking clean | yes [^16] |
| `jobs.json` is damaged — by one of the mutations above, or by nothing at all, while renders are pending | every mutation above refuses on it, except key removal, which proceeds regardless and reports the failure — but records already inside an unreadable file are invisible to the sweep too, and are lost outright as soon as anything else writes, including that same key-removal path: the next `persistJob` rewrites the file from the empty list it just read, so repairing the file only helps if nothing has written first | partial [^17] |

[^1]: The shared collection primitives (`collectVideo`, `fetchVideoStatus`, terminal-status classification) are tested via `host.test.js`'s route-driven cases — `jobs.test.js` tests `givenUp`/`pruneJobs`/`persistJob`, none of these. The unattended collect path — the sweep, with no client polling — is exercised end to end by three blocks that fork a server against a seeded store and let the real boot-time `sweepJobs()` run: the sweep-race test added alongside `850666b`, the sweep-branches block, and the held-download block. A boot sweep runs the identical function the 30s `setInterval` runs. Not exercised: the interval firing on its own, and a browser tab that was polling and then disconnected (vs. a job never polled at all).
[^2]: Resume effect in `VideoOutputNode`; verified in app 2026-08-15.
[^3]: `canvasGeneration` remount; verified in app 2026-08-15.
[^4]: `keepLiveRunMarkers` cases in `resolve.test.js`, including the restore-from-delete split (`ghostVideo` keeps `job`, `ghostRun` drops `running`); verified in app 2026-08-16.
[^5]: Strip cases in `resolve.test.js`.
[^6]: Inbound-strip case in `resolve.test.js`.
[^7]: `host.test.js` covers the happy path (pending records land at the new folder, still `pending`) and two COPY-step failures: an unwritable destination (500, folder and `.env` untouched) and a source store `readJobsStrict` can't read (500). Untested: `writeEnv` failing after a successful copy — the branch that actually exercises the rollback (`dropPendingJobs(nextOutputDir, copied.ids)`), whose aim only reading the code confirms — and the final best-effort strip of the old store failing (caught, logged). Two gaps the protocol does not claim to close, both duplication-never-loss: a render created in the ~1ms window between the copy's read and the commit stays in the OLD store, never marked resolved (a watching tab still collects it via the poll route's query-string fallback); and pointing the output folder back there later has the sweep re-collect an already-finished clip under a fresh timestamp.
[^8]: Terminal-status classification and message handling are tested on both paths: via the poll route (`expired-job`/`cancelled-job`/`failed-job`/`still-going-job` cases in `host.test.js` — all three names this row's "fails, expires, or is cancelled" enumerates, not just `expired`) and, since 2026-08-17, via the sweep itself — the sweep-branches block forks a server against a seeded store and asserts the real boot sweep fails the record with the provider's own message, no browser involved.
[^9]: All three links in the give-up chain are tested end to end. Threshold: `givenUp` units in `jobs.test.js`. Start: the sweep-branches block seeds a record 25h unreachable (real boot sweep, stub 404s it → `failed` with the give-up message and the last attempt's words) plus a record with no `unreachableSince`, proving the first unanswered poll STARTS the clock — left unset, `givenUp`'s `now - undefined` is `NaN` and the job is never given up at all. Middle: two sequential forks against one seeded store prove a second miss leaves the stamp byte-identical, with a sentinel job answered only on the second fork as proof that sweep actually ran. The guard is not cosmetic: `givenUp` is checked BEFORE the stamp write, so a rewritten stamp means the job is never failed — silently, forever `pending` — the outcome this row's `yes` rules out.
[^10]: Clearing the flag on disk is unit-tested (clock-clear case in `jobs.test.js`), and since 2026-08-17 the sweep-branches block in `host.test.js` seeds a record mid-silence, has the stub answer "queued", and asserts the real sweep clears `unreachableSince` while leaving the record pending.
[^11]: `jobs.json`'s durability is tested (`jobs.test.js`'s write/read/corruption cases), and the boot sweep resuming a pending job is proven three times over: the sweep-race, sweep-branches and held-download blocks each fork a fresh server with pending job(s) pre-written to `jobs.json` and confirm the boot-time `sweepJobs()` call — the exact line a real restart runs — picks them up. A fresh process rather than a literal kill-and-refork, but the two are indistinguishable server-side: nothing about a pending job survives anywhere but that file.
[^12]: The store-consulted-first layer is what `host.test.js`'s already-done case actually tests (one sequential request against a job already `done`); the in-process `collecting` lock and the re-read-after-lock step in both `sweepOneInner` and the poll route are not exercised by any test — the race itself is not reproduced in CI.
[^13]: Tested in `host.test.js`: removing the key ends every readable pending record whatever its project (`endedRenders` matches the count, each error naming the key); with `jobs.json` unreadable the key still goes — the one documented exception among these mutations — but nothing is ended, and the response carries `renderCleanupError` alongside an `endedRenders` of 0 (see the damaged-store row for the long-term cost). Also tested: a still-polling card is actually told. The store answer now precedes the key check (reading a resolved record needs no key), pinned by two cases: a `failed` record served keyless, and an unknown id still 400ing rather than reaching upstream keyless. Not verified: the React card visibly rendering the failure — node components have no unit tests by design, and this path has no in-app verification note; the last step to the pixels is read from code.
[^14]: That replacement ends nothing is tested directly in `host.test.js` (pending count unchanged after the key swap, with the live key hint confirmed changed first, so the assertion means something). That a different account's 404 is then absorbed by the same 24-hour give-up clock as any other unpollable id is not exercised end to end — it shares the `givenUp` logic unit-tested in `jobs.test.js`, but no test replaces a key with a genuinely different account's and lets, or fast-forwards, that clock run out.
[^15]: Tested in `host.test.js`: the happy path (record repointed, still `pending`, another project's record untouched), an unreadable store blocking the rename outright (500, folder unmoved), the single-failure rollback (ENOENT on `fs.rename`; the record lands back at its OLD name), and the `850666b` sweep-race test — a real rename raced against the real boot sweep, asserting which folder the clip's `savedPath` lands in and that the old folder is not recreated as a ghost. Not tested: the put-back itself also failing — the route's error names both the moved count and the name to reunite them under, but no test reaches that branch. Closed 2026-08-17: `collectVideo` re-reads the store after its download and both callers persist the project it actually used — the held-download tests, one per caller, park a real download, land a real rename inside it, and assert clip and record both name the new project (`poll-held-download-job` backs the poll route; `held-download-job` backs the sweep, which never calls `GET /api/video/:id`). What remains is the instant between that final read and the `fs.writeFile` — no longer a network-length window — and a record can no longer disagree with its own `savedPath`.
[^16]: `host.test.js`: the 409 refusal and its `pendingRenders` count, the confirmed delete (records end `failed` naming the deletion, another project's record untouched, folder removed), a damaged store blocking the delete outright (500), and the `fs.rm`-failed branch — asserting the response names both that records ended and that the folder still couldn't be removed.
[^17]: `host.test.js` asserts the routes directly: an unreadable store returns 500 for the folder change, the rename and the delete; the same damaged store still lets key removal succeed (200, key gone, `renderCleanupError` reported rather than blocking) — though per [^13] that path ends nothing either, needing the same read the other three refused over. Untested, because it is not a guarantee this contract makes: the sweep reads through the lenient `readJobs` (`server/jobs.js`), so records inside a store that stays unreadable are invisible — neither collected nor failed — and the next `persistJob` call for ANY job reads the same `[]` and rewrites the file over them, silently erasing every other pending record (`server/jobs.js`'s own header describes this). Repairing the file helps only if nothing has written first. This is the one hole in the header's promise: nothing on this row is excused by any of the three preconditions, and it applies whether the damage came from a mutation above or from nothing at all.

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
