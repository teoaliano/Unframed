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
| `jobs.json` is damaged — by one of the mutations above, or by nothing at all, while renders are pending | every mutation above refuses on it, except key removal, which proceeds regardless and reports the failure — but records already inside an unreadable file are invisible to the sweep too, and stay pending forever until the file is repaired or replaced | partial [^17] |

[^1]: The shared collection primitives (`collectVideo`, `fetchVideoStatus`, terminal-status classification) are tested via `host.test.js`'s route-driven cases and `jobs.test.js`. The unattended collect path is now partly exercised too: the sweep-race test added alongside `850666b` (see the rename row) forks a server with a job already `pending` in its store and lets the real BOOT invocation of `sweepJobs`/`sweepOneInner` collect it on its own, with zero client requests polling video status — `sweepJobs` is the identical function whether called once at boot or from its 30s `setInterval`, so this exercises the same code the recurring timer runs. What it does not do: let that `setInterval` actually fire on its own rather than the one boot-time call, or reproduce a real browser tab that was polling and then disconnected, rather than a job that was never polled by a client to begin with.
[^2]: Resume effect in `VideoOutputNode`; verified in app 2026-08-15.
[^3]: `canvasGeneration` remount; verified in app 2026-08-15.
[^4]: `keepLiveRunMarkers` cases in `resolve.test.js`, including the restore-from-delete split (`ghostVideo` keeps `job`, `ghostRun` drops `running`); verified in app 2026-08-16.
[^5]: Strip cases in `resolve.test.js`.
[^6]: Inbound-strip case in `resolve.test.js`.
[^7]: `host.test.js` exercises the happy path (pending records land at the new folder, still `pending`) and two failures at the COPY step: a destination that can't accept it (500, folder and `.env` both untouched) and a source store `readJobsStrict` can't read (500). Untested: `writeEnv` failing AFTER a successful copy, which is what actually exercises the rollback (`dropPendingJobs(nextOutputDir, copied.ids)`) — a rollback aimed at the wrong store would lose records outright, the exact direction this row promises against, and nothing but reading the code confirms it is aimed correctly; and the final best-effort strip of the old store failing, which is caught and only logged. Separately, and not a matter of test coverage at all — two things this protocol does not claim to close: a render created in the roughly-1ms window between the copy's read and the setting's commit is written straight into the OLD store and never copied — a tab still watching that job is unaffected, since the poll route falls back to its own query-string params rather than this store lookup, but nothing here will ever mark the stray record resolved; and the old store's now-orphaned pending records stay inert only while the folder stays changed, so pointing the output folder back at that old location later has the sweep re-poll and re-collect an already-finished clip a second time, under a fresh timestamp. Duplication, never loss, in both cases.
[^8]: Terminal-status classification and message handling are tested on both paths: via the poll route (`expired-job`/`cancelled-job`/`failed-job`/`still-going-job` cases in `host.test.js` — all three names this row's "fails, expires, or is cancelled" enumerates, not just `expired`) and, since 2026-08-17, via the sweep itself — the sweep-branches block forks a server against a seeded store and asserts the real boot sweep fails the record with the provider's own message, no browser involved.
[^9]: All three links in the give-up chain are tested end to end. The 24h threshold itself is unit-tested (`givenUp` cases in `jobs.test.js`), and the sweep-branches block in `host.test.js` seeds a record 25 hours unreachable, lets the real boot sweep poll a stub that 404s it, and asserts the record ends `failed` with the give-up message and what the last attempt said — and a second record with no `unreachableSince` yet, asserting the sweep's first unanswered poll actually STARTS that clock rather than leaving it unset forever (in which case `givenUp`'s `now - undefined` is `NaN` and the job is never given up on at all). The middle link — that the same `if (!job.unreachableSince)` guard stops a SECOND and later miss from rewriting the stamp forward — is exercised separately, since 2026-08-17, by forking the real server TWICE in sequence against one seeded store (a boot sweep is a tick, so two forks are two ticks with no 30s wait) and asserting the stamp is byte-for-byte unchanged between them, with a sentinel job answered only on the second fork as positive proof that fork's sweep actually ran rather than the assertion passing on a no-op. That guard is not cosmetic: `givenUp` is checked BEFORE the stamp write, so a rewritten stamp means `now - unreachableSince` never reaches 24 hours and the job is not given up on late — it is never given up on at all, silently, forever `pending`, which is exactly the outcome this row's `yes` rules out.
[^10]: Clearing the flag on disk is unit-tested (clock-clear case in `jobs.test.js`), and since 2026-08-17 the sweep-branches block in `host.test.js` seeds a record mid-silence, has the stub answer "queued", and asserts the real sweep clears `unreachableSince` while leaving the record pending.
[^11]: `jobs.json`'s durability is tested (`jobs.test.js`'s write/read/corruption cases), and the boot sweep resuming a pending job is now tested too, incidentally: the sweep-race test added alongside `850666b` (see the rename row) forks a fresh server with a `pending` job already written to `jobs.json` before the process ever starts, and confirms the boot-time `sweepJobs()` call — the exact line that runs on a real restart — picks it up and collects it. That is a fresh, independent process rather than a literal kill-and-refork of the one that created the job, but the two are indistinguishable from the server's own perspective: nothing about a pending job survives anywhere but that file, so a process that finds it on boot behaves identically regardless of how it got there.
[^12]: The store-consulted-first layer is what `host.test.js`'s already-done case actually tests (one sequential request against a job already `done`); the in-process `collecting` lock and the re-read-after-lock step in both `sweepOneInner` and the poll route are not exercised by any test — the race itself is not reproduced in CI.
[^13]: Tested in `host.test.js`: removing the key ends every readable pending record, whatever project it belongs to (`endedRenders` matches the count, each record's error naming the key), and — when `jobs.json` is unreadable — the key still goes, proceeding regardless being the one documented exception among these mutations, but nothing is ended: `failPendingJobs` never completes, so the response carries `renderCleanupError` instead of an `endedRenders` count (see the damaged-store row for what that costs long-term). Also tested: that a card still polling one of those renders is actually told. `GET /api/video/:id` used to answer 400 for a missing key BEFORE consulting the store, so the record said `failed` while the only route that could have reported it refused the question for the very reason the record existed — the card read "Rendering…" until a reload. The store answer now comes first (reading a resolved record needs no key), and two cases pin it: a `failed` record is served keyless, and an id the store has never heard of still 400s rather than reaching upstream without a key. Not verified: that the React card, handed that response, visibly shows the failure — `pollVideo` throws on a `failed` body and `VideoOutputNode`'s catch renders the message, but node components have no unit tests by design and this path has no in-app verification note. This row now ends the record AND answers the poll; the last step to the pixels is read from code.
[^14]: That replacement ends nothing is tested directly in `host.test.js` (pending count unchanged after the key swap, with the live key hint confirmed changed first, so the assertion means something). That a different account's 404 is then absorbed by the same 24-hour give-up clock as any other unpollable id is not exercised end to end — it shares the `givenUp` logic unit-tested in `jobs.test.js`, but no test replaces a key with a genuinely different account's and lets, or fast-forwards, that clock run out.
[^15]: Tested in `host.test.js`: the happy path (record repointed to the new name, still `pending`, another project's record untouched), an unreadable store blocking the rename outright (500, folder unmoved), the single-failure rollback — a project with a pending record but no folder on disk, so `fs.rename` itself fails (ENOENT), asserting the record lands back at its OLD name rather than the new one it never reached — and, added alongside the fix in `850666b`, a sweep-race test that forks a real server with a job already `pending` in its store, races an actual rename against the real boot-time sweep, and asserts which project's folder the clip's `savedPath` actually lands in, and that the OLD folder is not recreated as a ghost. Not tested: the second-order case where the put-back call itself also fails too — the route's error message then names both facts (the moved count and the name to reunite them under by hand), but no test exercises that branch. Closed 2026-08-17: `collectVideo` now re-reads the store after its download and resolves the folder from that, and both callers persist the project it actually used into the `done` record — the held-download TESTS in `host.test.js`, one per caller, each park a real download, land a real rename while it is parked, and assert the clip and its record both name the new project. It is the poll-route one (`poll-held-download-job`, in the "poll-route collect-to-done coverage" block) that actually backs the "both callers" half of this claim: the sweep-driven one (`held-download-job`, in the "rename during the download window" block) only proves the sweep's own caller, since it never calls `GET /api/video/:id` at all. What remains is only the instant between that final read and the `fs.writeFile` — no longer a network-length window, and a record can no longer disagree with its own `savedPath` either way.
[^16]: `host.test.js`: the 409 refusal and its `pendingRenders` count, the confirmed delete (records end `failed` naming the deletion, another project's record untouched, folder removed), a damaged store blocking the delete outright (500), and the `fs.rm`-failed branch — asserting the response names both that records ended and that the folder still couldn't be removed.
[^17]: `host.test.js` asserts the routes directly: an unreadable store returns 500 for the folder change, the rename, and the delete; the same damaged store still lets key removal succeed (200, key gone), reporting `renderCleanupError` rather than blocking — but per [^13], that path itself ends nothing either, since `failPendingJobs` needs the same read the other three routes just refused over. What no test exercises, because it is not a guarantee this contract makes: the sweep reads `jobs.json` through the lenient `readJobs` (`server/jobs.js`), which treats a parse failure exactly like an empty file, so any records already pending inside a store that stays unreadable are invisible to the sweep too — neither collected nor failed — until a person repairs or replaces the file by hand. This is the one hole in the header's promise above: nothing on this row is excused by any of the three preconditions (the server runs, storage is writable, credentials are untouched), and it applies identically whether the damage came from one of the mutations above or from nothing at all.

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
