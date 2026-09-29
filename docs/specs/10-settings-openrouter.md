# 10 · Settings and OpenRouter

Depends on: 01 to 09 (read 00-index first)

## Problem Statement

A person cannot generate anything until Unframed holds an OpenRouter key, and making one by hand (go to openrouter.ai, create a key, copy it, paste it) is where newcomers give up. Once there is a key, the person needs to know whether it still works, whether the account has credit, how much the key has spent against its cap, and when it expires, because a key that lapses is indistinguishable from a revoked one afterwards. They also need one place to change the default models, the output folder and the local agent paths.

Several of these settings, and two project actions, can strand paid work. A video render in flight is recorded in the output folder's job store; changing the output folder, renaming or deleting a project, or removing the key can leave that record where nothing will ever look at it again, and the render is paid for whether or not anyone collects it. Each of those changes must resolve its render jobs visibly, in an order where no failure loses a record.

## Solution

A settings dialog with an OpenRouter block that offers one-click connection through OpenRouter's PKCE browser flow, a paste fallback, key removal with a confirm step, and a live status of the key (revoked, free tier, spend and cap, expiry). Below it: default models for image, text and video, the output folder with a native Browse, and the local agents section. The flow follows OpenRouter's real protocol (a `callback_url` parameter, no `state`, a single-use nonce in the callback path, a verifier that never leaves the engine), keeps exactly one attempt alive, and settles races between a late approval and a person's own choice of key in favour of the person.

Every lifecycle change that could orphan a render job reads the job store strictly, touches the job records first and takes the destructive step last, compensating when a later step fails, and says plainly what happened when compensation is impossible. The project menu gives rename, delete and add project, with the confirm copy that tells a person what a delete would abandon.

## User Stories

1. As a new person with no key, I want the settings dialog to open on its own at first launch, titled "Connect OpenRouter to start", so that setup is the first thing I see.
2. As a new person, I want one "Connect OpenRouter" button that sends me to OpenRouter to approve Unframed, so that I never copy a key by hand.
3. As a new person, I want a plain paragraph saying what OpenRouter is, that it bills my own account, and that the key stays on this machine, so that I know what I am agreeing to.
4. As a person connecting, I want a "Didn't open?" link to the approval page, so that a blocked popup does not strand me.
5. As a person connecting, I want to close the settings dialog and still have the connection finish, so that I am not forced to watch it.
6. As a person connecting, I want a toast saying "Connected to OpenRouter." when the approval lands, so that I know it worked even with the dialog closed.
7. As a person connecting, I want to cancel, and have an approval that arrives afterwards refused, so that the app never claims the attempt was cancelled while holding a key from it.
8. As a person, I want a failed connection (refused code, unreachable OpenRouter, a key the engine could not save) reported in the dialog, or as a toast when the dialog is closed, so that the app never keeps saying "waiting" about a dead attempt.
9. As a person, I want the app to give up after ten minutes, matching OpenRouter's code lifetime, so that a slow approval (finding a password) still works but a forgotten one ends.
10. As a person who clicked Connect twice, I want only the latest attempt to be live, so that two tabs never race to install keys.
11. As a person, I want the browser tab the callback lands in to show a readable page for every outcome, in dark colours matching the app, so that I am never left on a bare error.
12. As a person whose approval landed after I removed or pasted a key, I want that tab to tell me nothing was saved and that OpenRouter did mint a key I should delete, so that I can clean up my account.
13. As a person, I want "or paste a key instead", so that I can still use a key I already have.
14. As a person pasting a key, I want a clear error if it does not look like an OpenRouter key, so that a typo is caught at once.
15. As a new person who saved a first key, I want a toast "Key saved. Unframed is ready to generate." and the dialog closed, so that I can start.
16. As a person with a key, I want to see how much it has spent, its cap and what remains, so that I know when generation will stop.
17. As a person on the free tier, I want to be told that generating will fail until I buy credit, with a link to OpenRouter's Credits page, so that I find out now and not after a failed run.
18. As a person with an expiring key, I want a warning when it expires within a fortnight, in hours when under two days, so that I can reconnect before it dies.
19. As a person whose key was revoked or expired upstream, I want the dialog to say it no longer works and offer "Reconnect OpenRouter", so that a mystery failure becomes an obvious fix.
20. As a person, I want removing the key to need a second click on "Yes, remove it", so that a stray click does not send me back to openrouter.ai.
21. As a person removing a key, I want every render in progress to be marked as stopped with a reason, so that nothing sits pending forever against a key that is gone.
22. As a person removing a key after a leak, I want the removal to succeed even if the render bookkeeping cannot be read, with that failure stated, so that a corrupt file never blocks a security action.
23. As a person, I want to pick default image, text and video models from searchable lists, so that new runs start on the models I prefer.
24. As a person, I want to choose the output folder by typing it or with a native Browse dialog, so that my projects live where I want.
25. As a person changing the output folder while videos render, I want those renders moved with me, so that they still land when they finish.
26. As a person changing the output folder, I want the project menu to show the projects in the new folder, so that what I see matches where files go.
27. As a person, I want to see whether Claude and Codex are installed and signed in, point Unframed at their commands if PATH does not find them, set a Claude config folder, and check again, so that the agent can run on my own plan.
28. As a person, I want a "Saved to .env" confirmation that says the change applied without a restart, or the error if it did not, so that I know where I stand.
29. As a person, I want Save to send only what I changed, so that saving a model never rewrites my key and an empty key field never wipes it.
30. As a person, I want to rename a project from the project menu, so that names stay meaningful.
31. As a person renaming a project with renders in flight, I want those renders to follow the new name, so that a finishing render does not recreate the old folder.
32. As a person whose rename failed, I want the render records put back, or told exactly how to reunite them if even that failed, so that nothing is silently split.
33. As a person deleting a project, I want a confirm that says it permanently removes the project and its images, so that I do not delete by accident.
34. As a person deleting a project with renders in progress, I want a second confirm saying those renders will stop being tracked, so that I decide knowingly about paid work.
35. As a person whose delete half-failed, I want to be told the renders were stopped but the folder remains, and that deleting again is safe, so that my retry is informed.
36. As a person, I want renaming a project to use the same name dialog as adding one (spec 02), with Enter submitting, so that the two never disagree about what a valid name is.
37. As a person, I want the current project marked in the menu with a check, so that I can tell it from the others.
38. As a person, I want the settings button to read "Add your API key" and stand out while there is no key, so that I know why nothing generates.
39. As a maintainer, I want the PKCE verifier to never leave the engine process, so that a code in any log or public page cannot be redeemed.
40. As a maintainer, I want the key OpenRouter returns validated at the same boundary as a pasted one, so that a provider's answer cannot inject a line into `.env` or a header.
41. As a maintainer, I want the consent screen able to show a real app name through a public bounce page while a clone keeps direct loopback, so that neither path is a second code path.
42. As a maintainer, I want every lifecycle change that can strand a render to read the job store strictly, so that "0 pending" from a damaged store never waves the change through.
43. As a test author, I want the whole connect flow driveable against a stub OpenRouter, including a stub consent page, so that every branch is testable without a human or money.
44. As a person, I want to choose in settings whether a message I send while the agent works waits for the turn or steers it, and have the choice kept across relaunches, so that the composer behaves the way I work.

## Implementation Decisions

### Modules

- **OAuth attempt** (domain, pure, time and randomness as parameters): the single pending attempt and its state machine; PKCE challenge derivation; the authorize and callback URL builders. Deep: the interface is `start`, `claim`, `commit`, `resolve`, `peek`, `cancel`, and the invariants below are unbreakable from outside.
- **Key status** (engine): one call to OpenRouter's key endpoint, coerced into a `KeyStatus`.
- **Key status copy** (domain): turns a `KeyStatus` into the lines the dialog shows, including the expiry note.
- **Job lifecycle** (domain for the pure operations, engine for the serialised I/O on the job store spec 04 owns): pending-for-project, copy pending into another store, drop given pending ids, fail pending (all or one project), reassign pending to another project. Every write goes through spec 04's single store queue and temp-then-rename write, and prunes as spec 04 does.
- **Project lifecycle** (engine): rename and delete, built on the job lifecycle, the open-project registry from spec 01 and spec 04's share revocation.
- **Settings dialog and project menu** (web).

### RPC methods

Added to the group from spec 01:

| Method | Input | Success | Notes |
| --- | --- | --- | --- |
| `settings.removeKey` | none | `{ settings: Settings, endedRenders: number, renderCleanupError?: string }` | |
| `oauth.start` | none | `{ authorizeUrl: string }` | never fails |
| `oauth.pending` | none | `{ state: "none" \| "waiting" \| "done" \| "failed", reason: string }` | `reason` is `''` unless failed |
| `oauth.cancel` | none | `{ endedRenders: number, renderCleanupError?: string }` | `endedRenders` is 0 when the attempt wrote no key |
| `oauth.status` | none | `KeyStatus` | |
| `projects.rename` | `{ name: string, to: string }` | `{ name: string, movedRenders: number }` | |
| `projects.delete` | `{ name: string, confirmRenders?: boolean }` | `{ endedRenders: number }` | |

```
KeyStatus =
  | { hasKey: false }
  | { hasKey: true, revoked: true }
  | { hasKey: true, usage: number, limit: number | null, limitRemaining: number | null, expiresAt: string | null, isFreeTier: boolean }
```

HTTP route (a person's browser lands on it, so it answers HTML): `GET /api/oauth/callback/<nonce>?code=<code>`.

Model catalogues for the dialog come from the catalogue methods of specs 03 (image), 05 (text) and 04 (video). Provider statuses come from spec 07's provider status method, with its refresh flag for "Check again".

### The OAuth flow

OpenRouter's flow is not RFC 6749. The parameter is `callback_url`, not `redirect_uri`. There is no `state`. The credential returned is an ordinary long-lived user-owned key, with no refresh and no way to fetch it again, so it is stored once, exactly like a pasted one, through the settings store's write funnel. Nothing records whether a key was connected or pasted.

Attempt store (in memory, never on disk; a restart mid-flow is a flow the person retries):

- At most one attempt, held in one slot: `{ nonce, verifier, expiresAt, state, reason }`. States: `waiting` until the callback commits to writing, `committed` while that write is in flight, then `done` or `failed`.
- `start(now)`: verifier = 32 random bytes as unpadded base64url (43 characters); nonce = 16 random bytes as lowercase hex (32 characters); `expiresAt = now + 10 minutes`; state `waiting`. Replaces any existing attempt, so two clicks leave one live. Returns the nonce and the challenge: unpadded base64url of the SHA-256 of the verifier.
- `claim(nonce, now)`: returns the verifier exactly once, for the current attempt only, and forgets it. A second claim, a claim for a superseded, cancelled or never-issued nonce: null. If the attempt has expired, it becomes `failed` with reason `That took too long. The approval expired. Try connecting again.` and claim returns null.
- `commit(nonce, now)`: true only if the nonce is the current attempt, its state is `waiting`, and it has not expired; then the state becomes `committed`. Expired: becomes `failed` with the same "took too long" reason, returns false. Must be called with no asynchronous step between its answer and the start of the key write.
- `resolve(nonce, state, reason)`: records `done` or `failed`. A no-op for a nonce that is not current (so a stranger guessing at the callback cannot fail a real attempt) and a no-op once the state is terminal (so a replay cannot rewrite a success). Clears the verifier.
- `peek(now)`: null when there is no attempt. A `waiting` attempt past its expiry reads as `failed` with `Nothing came back from OpenRouter. Try connecting again.` `committed` reads as `waiting`. Otherwise the state and reason. It never returns the verifier, the nonce or a key.
- `cancel()`: clears the slot and returns true when the attempt was `committed` or `done` (a key write for it is in flight or landed), false otherwise.

Authorize URL: `https://openrouter.ai/auth` (origin replaced by `UNFRAMED_TEST_OPENROUTER_ORIGIN` when set) with query `callback_url`, `code_challenge`, and `code_challenge_method=S256`. The method must be echoed on the exchange, or OpenRouter answers 400.

Callback URL, built by the engine because only it knows its own port:

- `UNFRAMED_OAUTH_BOUNCE` unset: `http://127.0.0.1:<engine port>/api/oauth/callback/<nonce>`.
- set: `<bounce with trailing slashes removed>/<engine port>-<nonce>`. OpenRouter appends `?code=` to whatever it is given, and whether it keeps existing query parameters is undocumented, so the port and nonce travel in the path.

`oauth.start`: runs `start`, builds both URLs, answers `{ authorizeUrl }`. Its answer carries the challenge, which is why spec 01 echoes nothing cross-origin: anything that can read it can approve that challenge against its own OpenRouter account and have the engine install that account's key. A page on another loopback port can still fire the method without reading the answer (it would supersede a live attempt), but cannot learn the nonce, so it cannot install a key.

`oauth.pending`: `peek`, or `{ state: "none", reason: "" }` when null.

`oauth.cancel`: if `cancel()` returns true, delete the key line through the settings write funnel and clear the key in the running process. That write queues behind the callback's own key write, so the key ends up removed either way. On write failure: `internal`, `Could not remove the key the cancelled connection had written: <reason>`. A key deleted this way is a key removal (index contract 5): it then runs steps 4 and 5 of Removing the key below, failing every pending render job with the same error, and answers `{ endedRenders }` plus `renderCleanupError` when the store could not be read. A `waiting` attempt wrote nothing, so cancelling it leaves any existing key alone and ends no renders.

Callback route, in order. Every failure below except the first calls `resolve(nonce, "failed", <detail>)` so the app learns the outcome; each answers HTML.

1. `claim`. Null: 400, heading `That link is no longer valid`, detail `Close this tab and press Connect in Unframed again.` (No resolve: the nonce may belong to nobody.)
2. No `code` query parameter: 400, `OpenRouter did not send a code`, `Close this tab and press Connect in Unframed again.`
3. `POST <origin>/api/v1/auth/keys` with JSON `{ code, code_verifier, code_challenge_method: "S256" }`, header `Content-Type: application/json`, 30 second timeout. Network failure or timeout: 502, `Could not reach OpenRouter`, detail is the error message.
4. Not 2xx, or no `key` in the JSON body: 502, `OpenRouter could not complete the connection`, detail is OpenRouter's own message (`error.message` when `error` is an object, or `error` when it is a string, or `message`), else `It answered <status>. Try connecting again.` An expired code arrives here with OpenRouter's own wording; there is no special case for it.
5. `key` fails the key validator from spec 01: 502, `OpenRouter returned a key in a shape Unframed does not recognise`, `Nothing was saved. You can paste a key manually in Unframed's settings instead.` (The `sk-or-v1-` prefix is not a documented contract, so this failure is about our expectation, not the person's typing.)
6. `commit(nonce)`. False: 409, `That connection was cancelled`, `Nothing was saved, and Unframed is still using whichever key you chose instead. OpenRouter did create a key just now, so delete that row at openrouter.ai/settings/keys.` Up to 30 seconds pass between claim and here, and in that time a key removal or a pasted key may have settled which key the app uses. Both cancel the attempt, and this check is what makes that cancel reach the write path.
7. Write the key through the settings write funnel, enqueued synchronously right after `commit`. Failure: 500, `OpenRouter created a key, but Unframed could not save it`, detail `<reason>. The key exists in your OpenRouter account. You can delete it at openrouter.ai/settings/keys and try connecting again.`
8. Apply the key to the running process, emit on `settings.subscribe`, `resolve(nonce, "done")`, log `  oauth:    connected, key saved`, answer 200 `Connected to OpenRouter`, `You can close this tab and return to Unframed.`

Callback page: a complete HTML document, UTF-8, title `Unframed`, body background `#111112`, text `#DFE2E5`, `color-scheme: dark`, margin 0; one centred column (system UI font, 16 px, line height 1.5, max width 32em, top margin 12vh, side padding 1.5em) with the heading as an `h1` at 1.3em and the detail as a paragraph. Heading and detail are HTML-escaped (`&`, `<`, `>`), because the detail can carry OpenRouter's text or an error message and the page is served from the engine's origin. The page links nowhere and redirects nowhere: the engine does not know where the web is served.

Choosing a key cancels a pending attempt:

- `settings.removeKey` calls `cancel()` first (its return value is ignored; the key is being removed anyway).
- `settings.update` with a `key` in the patch calls `cancel()` right after validation and before any other step that waits, so a save made just before a Connect cannot cancel the attempt that Connect created afterwards.
- A model or folder save leaves a pending attempt alone.

The bounce page lives outside this repository (on the public site the app is downloaded from). It is described here because the flow's safety depends on it: it builds the loopback URL from a template and never accepts one (port as digits 1024 to 65535, nonce as exactly 32 hex characters, host hardcoded to `127.0.0.1`), redirects with the code onward, carries no third-party script, and logs nothing it receives. The verifier never reaches it, so it cannot redeem a code; the challenge must never reach it either, which today rests on browsers' default referrer policy on OpenRouter's redirect. Without JavaScript it shows the code, which is OpenRouter's documented headless mode.

### Key status

`oauth.status`:

- No key: `{ hasKey: false }`, without calling upstream.
- `GET <origin>/api/v1/key` with `Authorization: Bearer <key>`, 10 second timeout.
- 401 or 403: `{ hasKey: true, revoked: true }`. (Which one a dead key earns is not documented; both mean reconnect.)
- Otherwise not 2xx, or no `data` object: `upstream`, `OpenRouter answered <status>.`
- Network failure or timeout: `upstream`, with the error message.
- 2xx: `usage` (a finite number, else 0), `limit` and `limitRemaining` (finite numbers, else null), `expiresAt` (a string, else null), `isFreeTier` (boolean). Everything else in the answer is dropped, including `label` (a truncated form of the key itself, never the name the person gave it) and `limit_reset` (an undocumented string not fit to put in a sentence).
- Fetched when the settings dialog opens with a key, and right after a connection lands. Never on a timer: inference answers carry no quota information, and nothing outside the dialog needs it. `server.health` never calls OpenRouter.

Key status copy (domain), all money to 2 decimals:

| Condition | Shown |
| --- | --- |
| revoked | `This key no longer works at OpenRouter. It may have been deleted or disabled there.` and a primary button `Reconnect OpenRouter` (hidden while a connection is pending) |
| free tier | `You have not bought any credit yet, so generating will fail. Add some under Credits.` with `Credits` linking to `https://openrouter.ai/credits`. Replaces the spend line, never stacks with it |
| not free tier | `Connected to OpenRouter. $<usage> spent with this key`, then `, of a $<limit> cap` when limit is set, then `, $<limitRemaining> still available` when both are set, then `.` |
| status not fetched or failed, key saved | `A key is already saved (…<keyHint>). Entering a new one replaces it.` (the parenthesis omitted when there is no hint) |
| no key | `Make a key at openrouter.ai/keys and paste it here. It starts with sk-or-.` with `openrouter.ai/keys` linking to `https://openrouter.ai/keys` |

Expiry note, a separate line under the spend or free-tier line, from `expiresAt` and now:

- absent or unparseable: nothing.
- hours until expiry `<= 0`: `This key has expired at OpenRouter. Reconnect to keep generating.`
- hours `< 48`: `This key expires in <h> hour<s>, and nothing renews it. Reconnect before then.` where h is the hours rounded up, at least 1, and "hour" is singular only for 1.
- else days = whole days rounded down; days `<= 14`: `This key expires in <days> days, and nothing renews it.`
- else nothing (a warning nobody can act on yet is noise).

Re-authorising mints a new key at OpenRouter every time, so reconnect is offered only when the key is revoked.

### Removing the key

`settings.removeKey`, in order:

1. `cancel()` the OAuth attempt.
2. Delete the `OPENROUTER_API_KEY` line through the write funnel (a null delete, so a key the shell environment provides is not shadowed by an empty line). Failure: `internal`, `Could not write .env: <reason>`, and the key stays live.
3. Clear the key in the running process; emit on `settings.subscribe`.
4. Fail every pending render job in the output folder's store (all projects) with error `Stopped tracking this render: the OpenRouter key was removed, so its progress can no longer be checked. It may still finish upstream, but nothing here will save the result.` The sweep cannot poll without a key, so leaving them pending strands them for 24 hours.
5. If step 4 fails (the store is unreadable), the removal still stands: answer success with `renderCleanupError: "The key was removed, but renders already in progress could not be stopped: <reason>"`. This is the one lifecycle change that proceeds on a store it cannot read, because removing a key is a security action.
6. Answer `{ settings, endedRenders }`.

Replacing a key with a new one does not fail pending jobs: a replacement is usually a renewed key for the same account.

### Changing the output folder

Inside `settings.update` when the patch has a new `outputDir`, after validation, after the OAuth cancel for a key, and after spec 01's "create the folder first" step:

1. If the old and new folders are the same directory (same device and inode, whatever the spelling), skip the job steps.
2. Copy: read the old store strictly and the new store strictly; merge every pending job from the old store into the new one by id; write the new store. Failure: `internal`, `Could not move the renders already in progress to that folder, so the folder was not changed: <reason>`, and nothing else happens.
3. Commit: write `.env`. Failure: drop the copied ids from the new store (a failure of that rollback is logged as `  could not roll back copied jobs: <reason>`), then answer `internal`, `Could not write .env: <reason>`.
4. Apply the other changed settings to the running process.
5. Close every open project (the open-project registry from spec 01: sync rooms flushed and their clients disconnected, database handles closed, chat subscriptions ended, agent sessions ended). A closer that fails is logged as `  could not flush <folder> before changing the output folder: <reason>` and does not stop the change, since every committed change is already on disk.
6. Switch the running process to the new folder. From here the new store is the one the sweep reads.
7. If there is no key now and jobs were copied, fail the copies in the new store with `The OpenRouter key was removed while this render was being moved to a new folder.` (A key removal that ran during this move failed only the old store it could see.) A failure here is logged, not answered.
8. Strip: drop the copied ids (pending only) from the old store. Best effort: a failure is logged as `  left <n> job record(s) behind in the old folder: <reason>`, since the records are safe in the store being swept and only duplicated in one nothing reads. Success logs `  moved <n> pending video job(s) to the new output folder`.
9. Emit on `settings.subscribe` and answer the new `Settings`.

The strip is the commit point and comes last, so no failing step loses a record; the worst outcome of a failure is a duplicate in a store nothing reads. `done` and `failed` jobs stay in the old store as history. One narrow window is accepted rather than closed: a render created between the copy's read and the `.env` commit is written into the old store, never copied and never stripped. A tab still watching that render collects it anyway through spec 04's poll, which falls back to the parameters it was given when the store has no record; what is lost is one stray `pending` line in the old store.

The web, after a successful folder change, reloads the project list from the new folder and opens the remembered project (spec 02's `project.active` preference) if the new folder has it, else the first project, else creates `default` with spec 02's starter content.

### Renaming a project

`projects.rename { name, to }`:

1. Slug both (spec 01's rule). Using the slug for both the folder path and the job record match keeps the two from disagreeing about which project this is.
2. `to` empty: `bad_request`, `New name is empty.`
3. A folder named `to` exists: `conflict`, `A project named "<to>" already exists.`
4. Repoint: read the store strictly; set `project` to `to` on every pending job whose project is `name`; write. Failure: `internal`, `Could not update the renders in progress for this project, so it was not renamed: <reason>`, nothing changed. Records go first because a render finishing after the rename would otherwise recreate the old folder and write itself into a project the person no longer has, and because the rollback of a record write is another record write, which is more reliable than undoing a folder rename.
5. Close the project (registry), then rename the folder.
6. If step 5 fails, repoint the jobs back from `to` to `name`. Answer `internal` with `Could not rename: <reason>` when the repoint back worked, else `Could not rename (<reason>), and <n> render(s) in progress are now recorded under "<to>". Renaming the project to "<to>" by hand will reunite them.` (a rollback failure is also logged as `  could not restore job records after a failed rename: <reason>`).
7. Answer `{ name: to, movedRenders: <n> }`.

The web: renaming to the same slug closes the dialog without a call. After success it replaces the name in the project list; if it was the active project it becomes active under the new name, the `project.active` preference is updated, and the canvas reopens under the new name. It is not treated as switching to a different project: runs and render polling in progress keep going.

**Runs still generating.** Image, text and motion-render runs are not durable (spec 03's run registry), so they have no job record to move or fail. Before rename, delete or an output folder change touches a project, the engine asks spec 03's run registry whether any run in that project is still live. If one is, the action answers `conflict` with `Wait for the <n> run<s> still generating in this project to finish, then try again.` and `details: { liveRuns: <n> }`, and changes nothing. The web shows the message in the dialog. This check comes before every step above, including the render-job checks.

### Deleting a project

`projects.delete { name, confirmRenders }`:

1. Slug the name once and use it for both the record lookup and the folder, so the confirm gate cannot check one spelling and remove another.
2. Read the store strictly; collect pending jobs for this project. Failure: `internal`, `Could not check whether this project has renders in progress, so nothing was deleted: <reason>`.
3. Pending jobs and `confirmRenders` not true: `conflict`, `This project has <n> video render<s> in progress.`, `details: { pendingRenders: <n> }`. Nothing changes. The gate is in the engine, not only in the web, so a caller that forgets to ask cannot silently abandon a render.
4. With pending jobs: fail them with `Stopped tracking this render: the project it belonged to was deleted. It may still finish upstream, but nothing here will save the result.` Failure: `internal`, `Could not stop the renders in progress, so the project was not deleted: <reason>`. Then revoke every share link of those jobs (spec 04).
5. Close the project (registry), then remove the folder recursively.
6. If step 5 fails: when jobs were ended, `internal`, `Stopped <n> render(s), but the project folder could not be deleted: <reason>. Deleting again is safe.`; otherwise `Could not delete the project: <reason>`. This is the one partial outcome with no compensation: un-failing a record would claim a render is still being watched when its project may be half-deleted, so both facts are stated instead.
7. Answer `{ endedRenders: <n> }`.

Records first, folder second: if the removal fails, the person retries on a project that is intact; the other order leaves records pointing at a folder that is gone, and the sweep would recreate it as a ghost holding one clip.

### Job store reads for these changes

Every lifecycle change in this spec reads the store with the strict read: a missing file is an empty list; an unreadable file fails with `The job store at <path> could not be read: <reason>`; invalid JSON fails with `The job store at <path> is not valid JSON: <reason>`; anything but a JSON array fails with `The job store at <path> is not a list of jobs.` Spec 04's lenient read (which turns corruption into an empty list so the sweep can boot) is never used here, because "0 pending" from a damaged store reads exactly like "nothing in flight". Removing the key is the one change that proceeds past a strict-read failure, and it reports it.

The fields these operations touch on a job record (spec 04 owns the full format): `id`, `project` (the slug), `status` (`pending`, `done`, `failed`), `error`, `resolvedAt` (epoch ms, set when failing). Every write prunes as spec 04 does.

### The settings dialog

The settings entry in the top-right chrome card: with a key, a ghost icon button with a gear icon, label `Settings`, tooltip `Settings: key …<keyHint>, default models, output folder` (the `…<keyHint>` part omitted when there is no hint). Without a key, a primary icon button with a key icon, label `Add your API key`, tooltip `No OpenRouter key yet. Click to add one`. Until the first settings answer arrives the web assumes a key exists, so the keyless dialog does not flash for everyone at load; when the first answer says there is no key, the dialog opens on its own.

Dialog: 480 px wide. Title `Settings` with a key, `Connect OpenRouter to start` without. The form scrolls inside the dialog; the banner and the buttons stay fixed below it, so a short window never hides Save.

Sections, top to bottom:

1. **Keyless intro** (no key, no connection pending): the paragraph `Unframed has no image model of its own. It sends your prompts to OpenRouter, which runs the model and bills your OpenRouter account per image (a few cents for most models). Connecting takes you there to approve Unframed; the key it gives back is saved on this machine and used only by your local server.` with `OpenRouter` linking to `https://openrouter.ai`, then a primary button `Connect OpenRouter`.
2. **Waiting** (a connection pending, shown with or without a key): `Waiting for OpenRouter in your browser…`, then `Didn't open? Approve Unframed at OpenRouter.` where `Approve Unframed at OpenRouter` links to the authorize URL (a real link, always shown, because whether the tab opened cannot be detected), then a ghost button `Cancel`.
3. **Paste reveal** (no key, field not revealed): a ghost button `or paste a key instead`. The reveal resets each time the dialog opens.
4. **Key section** (a key exists, or the field was revealed): heading `OpenRouter` with a key, `API key` without. A password field, visually unlabelled with accessible label `API key`, placeholder `sk-or-v1-…`, autofocused. Beside it, with a key, a ghost button `Remove key`. Under it, the key status copy. The field and Save stay usable while a connection is pending (that is the fallback for a browser that never opens).
5. **Default models** (key only): heading `Default models`; three searchable selects labelled `Image`, `Text`, `Video`, each listing the model ids of its catalogue, showing the saved model, placeholder `Pick a model` once the catalogue has loaded and `Loading models…` before (the saved model is the only option until then).
6. **Output folder** (key only): heading `Output folder`; a text field, accessible label `Output folder`, placeholder `./output`, showing the resolved folder; a secondary button `Browse…` with a folder icon.
7. **Local agents** (key only): heading `Local agents` with a small ghost button `Check again` at the row's end (showing a loading state while checking); the supporting line `Claude Code or Codex installed and signed in on this Mac lets the agent run on your own plan. Nothing here is sent to OpenRouter.`; then for Claude and for Codex: a 6 px status dot (accent when ready, red when not, a neutral border colour when not yet checked), the name, and the status text (`checking…` while the first check runs, `not checked yet` before it, `ready` plus ` · <version>`, ` · <plan>`, ` · <email>` for each one known when ready, else the provider's own message from spec 07), plus a `How to install` link when the status is not installed and an install URL is known; under it a text field with accessible label `<Name> command or path` and placeholder `claude (found on PATH)` or `codex (found on PATH)`. Last, a text field labelled `Claude config folder (optional)` with placeholder `Leave empty for the default ~/.claude`. Then a select labelled `Follow-up behavior` with two options, `Queue` (hint `Wait for the running turn, then send`) and `Steer` (hint `Send into the running turn`), showing spec 08's `agent.followUp` preference (Queue when unset). It is not a `.env` setting: changing it writes the preference at once through `preferences.set` and is not part of Save.
8. **Banner**: after a failure, an error banner with the message; after a successful save, a success banner `Saved to .env` with description `Applied right away, no restart needed.` Editing any field clears it.
9. **Buttons**, right-aligned: ghost `Close`; primary `Save`, shown when there is a key or the paste field is revealed, disabled and loading while saving.

Sections 5 to 7 are hidden without a key: their catalogues are fetched with the key, and a first-time person is not there for them. Saving a first key closes the dialog, so the full form is one reopen away.

Opening the dialog: the draft is filled from the current settings (key field empty); catalogues are loaded (once per session, cached); provider statuses are checked (without refresh); with a key, the key status is fetched, and only the latest of overlapping fetches is shown.

Save sends only what changed: the key when the trimmed field is non-empty; each model and the output folder when non-empty and different from the saved value; each of the three agent fields when different from the saved value, including `''` (which clears it). Nothing changed: the dialog closes without a call. Then:

- Success, and there was no key before: toast `Key saved. Unframed is ready to generate.` and close.
- Success otherwise: the key field empties, the success banner shows, and a sent key clears the shown key status (it described the old key). A changed agent field re-checks the providers.
- A key was sent while a connection was pending: stop polling (the engine cancelled the attempt, and the next poll would otherwise read `none` and report a lost connection about a key that just saved). A model or folder save leaves the poll running.
- Failure: the error banner with the engine's message.

Browse: calls `settings.pickFolder`; a non-empty path fills the output folder field (not saved until Save); `''` changes nothing; an error shows in the banner.

Remove key: the first click turns the button into a destructive `Yes, remove it` and shows the field warning `This deletes the key from .env. You will need to paste it again, or make a new one at openrouter.ai/keys.` Typing in the key field cancels the confirm. The second click calls `settings.removeKey`; on success the key field empties, the key status clears, and the field warning becomes `Key removed. Generate is disabled until you add one.`; a `renderCleanupError` shows in the error banner (its wording already says the key was removed). On failure the confirm resets and the banner shows the error.

### Connecting, in the web

- Connect (the keyless button or `Reconnect OpenRouter`): clears the key draft, the banner and the saved state. Opens a blank tab synchronously inside the click (`window.open("", "_blank")`, then severs its opener), because a popup opened after an asynchronous step is blocked by Safari and Firefox. Waits for any cancel still in flight, then calls `oauth.start` and navigates the tab to the authorize URL. On failure it closes the tab and shows the error in the banner.
- The pending connection (`since`, the authorize URL, and whether there was a key when it started) lives at the app level, not in the dialog, so closing the dialog does not abandon it.
- Every 1.5 seconds it calls `oauth.pending`. A failed call is not an answer: wait for the next tick.
  - `failed`: stop; report the reason, or `Connecting failed. Try again.` when empty.
  - `none`: stop; report `That connection was lost before it finished. Try connecting again.` (cancelled from another window, superseded, or the engine restarted).
  - `done`: fetch the settings and the key status together, then stop. Update the settings and the key status; toast `Connected to OpenRouter.` If there was no key at the start and the account is not on the free tier, close the dialog. If there was no key at the start and it is on the free tier, keep the dialog open (a toast cannot carry the Credits link) and load the catalogues. With a key at the start (a reconnect), keep the dialog and whatever the person typed into the other fields, and clear only the key draft and the banner.
  - More than 10 minutes since `since`: stop; report `Nothing came back from OpenRouter. Try connecting again.` (a backstop; the engine fails its own attempt on the same clock).
  - "Report" means the dialog's error banner when the dialog is open, else a toast.
- Cancel: stops polling at once, calls `oauth.cancel` (its failure is swallowed), then refreshes the settings, since the cancel may have removed a key a committed callback had written. The next Connect waits for this cancel to finish before starting, so a cancel that the engine serves second cannot wipe the new attempt.

### The project menu

In the top-left chrome card, beside the logo: a small secondary dropdown button labelled with the current project's name.

- One row per project. The current project has a check icon in the row's leading slot and a tint, so it is told apart by more than colour. Clicking a row switches to that project (spec 02's open-project behaviour).
- At each row's end, two small ghost icon buttons: a pencil, tooltip `Rename`, accessible label `Rename <project>`; a trash can, tooltip `Delete`, accessible label `Delete <project>`. Clicking either does not switch projects.

Add project and its `New project` dialog are spec 02's. Rename reuses that dialog (360 px) with the title `Rename project`, the field prefilled with the current name and the primary button `Rename`; the name is slugged with spec 01's rule, an empty one shows spec 02's `Enter a project name.`, and the engine's error message shows as the field error while the dialog stays open.

Delete confirm: the kit's alert dialog (spec 12) with a destructive action, titled `Delete project?`, description `This permanently removes "<name>" and its generated images. This can't be undone.`, action `Delete project`. On the engine's `conflict` with `pendingRenders`, a second alert dialog titled `Stop renders and delete?`, description `This stops tracking <n> video render<s>. They may still complete upstream, but their results will not be saved here.`, action `Stop renders and delete`, which calls delete again with `confirmRenders: true`. Any other failure: a toast with the message, and the project stays in the list. After a delete succeeds the project leaves the list; if it was active, the first remaining project opens, or `default` is created with the starter content when none remain.

## Testing Decisions

Good tests drive the three seams from 00-index and assert on answers, HTML pages, `.env` and `jobs.json` contents, log lines, and what a person sees. None reaches into the attempt store, the job lifecycle module or React state.

- **Domain seam** for the OAuth attempt state machine with an injected clock and injected random bytes (supersede, single claim, replay, expiry at claim, at commit and at peek, resolve no-ops, cancel's return), the PKCE challenge against a known vector, both URL builders, the key status copy and every expiry boundary (exactly 0 hours, 40 minutes, 47.5 hours, exactly 48 hours, 14 days, 14 days plus one hour), and the pure job lifecycle operations.
- **Engine seam** with the stub OpenRouter from spec 01's harness. The stub serves `/auth` (answers 302 to `callback_url` with `?code=<code>`), `/api/v1/auth/keys` (checks that the verifier's challenge matches the one it saw at `/auth`, then answers a configurable key, error or delay; a delay the test releases is how the mid-exchange races are driven), and `/api/v1/key`. Render jobs are seeded by writing `jobs.json` into the temp output folder before the operation; the store is read fresh by every operation. Folder removal failure is provoked with a read-only parent folder.
- **Browser seam** for the dialog, the connect flow (Playwright follows the popup to the stub consent page, which redirects to the engine's callback), the poll timeout (Playwright's clock), and the project menu. Assert on visible text, toasts, and then on what the engine holds (`settings.get`, `.env`, `projects.list`).
- Prior art: spec 01's engine-seam harness, and spec 04's tests for the job store.

## Tasks

1. PKCE challenge and ids: verifier is 43 base64url characters from 32 bytes, nonce is 32 hex characters from 16 bytes, challenge matches the RFC 7636 test vector encoding (unpadded base64url of SHA-256). Seam: domain.
2. Authorize URL carries `callback_url`, `code_challenge` and `code_challenge_method=S256`, correctly encoded, on the default or test origin. Seam: domain.
3. Callback URL: direct loopback form without a bounce; `<bounce>/<port>-<nonce>` with trailing slashes stripped when set. Seam: domain.
4. Attempt store: `start` supersedes, `claim` succeeds once, a replay and a stranger's nonce get null, an expired claim fails the attempt with the "took too long" reason. Seam: domain.
5. Attempt store: `peek` answers null with no attempt, expired `waiting` as failed with "Nothing came back", `committed` as waiting, and never exposes the verifier or nonce. Seam: domain.
6. Attempt store: `commit` only for the current unexpired waiting attempt; `resolve` is a no-op for a stranger's nonce and after a terminal state; `cancel` returns true only for committed or done. Seam: domain.
7. Expiry note at every boundary. Seam: domain.
8. Key status copy: revoked, free tier (no spend line), spend alone, spend with cap, spend with cap and remaining, not fetched with and without a hint, no key. Seam: domain.
9. Job lifecycle operations: pending-for-project, copy merge by id, drop only pending ids given, fail pending for all or one project with `resolvedAt`, reassign. Seam: domain.
10. `oauth.start` answers an authorize URL whose callback points at the engine's real port; `oauth.pending` reads waiting. Seam: engine.
11. Happy path: the callback with a code makes the stub receive the matching verifier and `S256`; `.env` holds the key at mode 0600; the page says `Connected to OpenRouter`; `oauth.pending` reads done; `settings.subscribe` emits `hasKey: true`; the log line appears. Seam: engine.
12. Replaying the same callback answers `That link is no longer valid`, leaves the key and the done state unchanged, and makes no second exchange. Seam: engine.
13. A second `oauth.start` supersedes the first: the first attempt's callback is refused as no longer valid. Seam: engine.
14. A callback without a code answers 400 `OpenRouter did not send a code` and `oauth.pending` reads failed with that detail. Seam: engine.
15. Exchange failures: the stub dropping the connection gives 502 `Could not reach OpenRouter`; a 403 with an error body gives `OpenRouter could not complete the connection` with OpenRouter's message; a 500 with no body gives `It answered 500. Try connecting again.`; each fails the attempt and the engine keeps answering. Seam: engine.
16. A returned key that fails the validator gives 502 with the "shape Unframed does not recognise" page and nothing in `.env`. Seam: engine.
17. `settings.removeKey` while the exchange is held: after release the callback answers 409 `That connection was cancelled` and `.env` has no key. Seam: engine.
18. `settings.update` with a pasted key while the exchange is held: after release the callback answers 409 and `.env` holds the pasted key. Seam: engine.
19. `settings.update` with only a model change leaves a pending attempt waiting. Seam: engine.
20. `oauth.cancel` while waiting leaves an existing key untouched and a later callback is refused; `oauth.cancel` after done removes the key and `hasKey` becomes false. Seam: engine.
21. A key write failure in the callback (`.env` made unreadable) answers 500 `OpenRouter created a key, but Unframed could not save it` with the cleanup detail, and the attempt reads failed. Seam: engine.
22. The callback page is dark, titled `Unframed`, and escapes an OpenRouter error message containing `<script>`. Seam: engine.
23. With `UNFRAMED_OAUTH_BOUNCE` set, the authorize URL's `callback_url` is the bounce form and the loopback callback route still completes the flow. Seam: engine.
24. `oauth.status`: no key answers `hasKey: false` without an upstream call; 401 and 403 answer revoked; a 2xx is coerced (a string `usage` becomes 0, missing `limit` becomes null) and carries no `label` or `limit_reset`; a 500 answers `upstream` `OpenRouter answered 500.` Seam: engine.
25. `settings.removeKey` deletes the key line, clears `hasKey` live, fails every pending job in every project with the key-removed error and `resolvedAt`, leaves done and failed jobs alone, and answers `endedRenders`. Seam: engine.
26. `settings.removeKey` with an invalid `jobs.json` still removes the key and answers `renderCleanupError`. Seam: engine.
27. `settings.removeKey` with an unwritable `.env` answers `Could not write .env: <reason>` and the key stays live. Seam: engine.
28. Changing the output folder moves pending jobs: the new store has them, the old store keeps only done and failed ones, and the log says how many moved. Seam: engine.
29. Changing the output folder to the same directory by another spelling (a symlink) copies and strips nothing and loses nothing. Seam: engine.
30. An invalid old `jobs.json` refuses the folder change with `Could not move the renders already in progress to that folder, so the folder was not changed: <reason>` and `.env` is unchanged. Seam: engine.
31. A `.env` write failure during a folder change rolls the copies out of the new store and leaves the old store as it was. Seam: engine.
32. A folder change closes every open project: an open sync connection and an open chat subscription for a project in the old folder are ended, and `projects.list` then reads the new folder. Seam: engine.
33. A folder change with no key and pending jobs in the old store fails the copies in the new store with the moved-while-removed error. Seam: engine.
34. Invalid job stores refuse rename and delete with their own messages and change nothing. Seam: engine.
35. `projects.rename` renames the folder, repoints pending jobs to the new slug, answers `movedRenders`, and ends open connections to the project. Seam: engine.
36. `projects.rename` refuses an empty target and an existing target. Seam: engine.
37. `projects.rename` whose folder rename fails puts the job records back and answers `Could not rename: <reason>`. Seam: engine.
38. `projects.delete` with pending renders and no confirm answers `conflict` with `pendingRenders` and changes nothing. Seam: engine.
39. `projects.delete` confirmed fails that project's pending jobs only, revokes their share links, removes the folder and answers `endedRenders`. Seam: engine.
40. `projects.delete` whose folder removal fails after ending renders answers `Stopped <n> render(s), but the project folder could not be deleted: <reason>. Deleting again is safe.`, and a retry once the folder is removable succeeds with `endedRenders: 0`. Seam: engine.
41. Keyless first load: the dialog opens by itself titled `Connect OpenRouter to start` with the intro paragraph and `Connect OpenRouter`; the settings button reads `Add your API key`; sections 5 to 7 are absent; Save is absent until `or paste a key instead` is clicked. Seam: browser.
42. Paste path: a bad key shows the key error in the banner; a good key closes the dialog with the `Key saved. Unframed is ready to generate.` toast and the settings button becomes `Settings`. Seam: browser.
43. Connect happy path: a popup opens and lands on the stub consent page, which redirects to the callback; the dialog shows the waiting block with the approve link and Cancel; then the `Connected to OpenRouter.` toast appears and the dialog closes. Seam: browser.
44. Connect on a free-tier account keeps the dialog open with the free-tier line, the Credits link and loaded model catalogues. Seam: browser.
45. A refused exchange shows its reason in the banner; with the dialog closed during the wait, it shows as a toast instead. Seam: browser.
46. Cancel returns the dialog to the Connect state, and a Connect clicked straight after still completes. Seam: browser.
47. With Playwright's clock advanced past 10 minutes the poll stops with `Nothing came back from OpenRouter. Try connecting again.`; with the engine restarted mid-wait it stops with `That connection was lost before it finished. Try connecting again.` Seam: browser.
48. With a key: title `Settings`, heading `OpenRouter`, the spend, cap and remaining line, and an expiry note for a key the stub says expires in 30 hours; a revoked key shows the reconnect button, hidden while a connection is pending. Seam: browser.
49. Remove key: the two-step confirm with its warning, the removed warning after, typing cancels a pending confirm, and a `renderCleanupError` shows in the banner. Seam: browser.
50. Default models: the three searchable selects list their catalogues, a changed model saves alone (the engine receives only that field), and the success banner shows. Seam: browser.
51. Browse fills the output folder field with the picked path, cancel leaves it, and a missing picker shows `No folder picker available here. Type the path instead.` in the banner. Seam: browser.
52. Local agents: statuses and dots per provider, `Check again` refreshes, and saving a changed command path re-checks. Seam: browser.
53. After saving a new output folder, the project menu lists the new folder's projects and the canvas opens one of them, or `default` when the folder is empty. Seam: browser.
54. Project menu: the current project has the check, each row has Rename and Delete buttons with their labels, and clicking them does not switch projects. Seam: browser.
55. Follow-up behavior: the select shows Queue by default, choosing Steer writes the `agent.followUp` preference at once without Save, and the choice is still shown after an engine restart on a new port. Seam: browser.
56. Rename project: success updates the list and the active project; an engine error shows on the field and the dialog stays. Seam: browser.
57. Delete project: `Delete project?` then, with seeded pending renders, `Stop renders and delete?`; after it, the next project opens, or `default` is created when it was the last one. Seam: browser.
58. Rename, delete and an output folder change each answer `conflict` with the live-run message while an image, text or render run in that project is still live, and change nothing. Seam: engine

## Out of Scope

- The bounce page itself: it lives on the public website, outside this repository. Only the engine's side of it (the callback URL form) is built here.
- OpenRouter management keys, provisioning keys, or any key held on a server: never built. Unframed is not a custodian of anyone's key.
- Showing the account's credit balance (`/api/v1/credits`): not shown. The free-tier flag answers the question the dialog asks, and a second number beside a per-key cap invites reading one for the other.
- Showing the key's human name: not reachable with a user key.
- Recording whether a key was connected or pasted.
- Any account or sign-in system. Connect must never require one.
- The job store format, the render sweep, share links and the poll fallback (spec 04); provider detection (spec 07); model catalogues (specs 03 to 05); project switching and starter content (spec 02).

## Further Notes

- Facts about OpenRouter this spec relies on, verified against a real account on 2026-08-20: the consent screen names a loopback app `127.0.0.1:<port>` (which is why the bounce page exists); every authorisation mints a new key; the approval page lets the person name the key, set a spending cap and set an expiry, so a capped key is the common case; the exchange refuses a code whose verifier does not match the challenge (403 `Invalid code or code_verifier`), and a missing `code_challenge_method` gives 400 `Invalid code_challenge_method`; codes expire 10 minutes after issue.
- A 402 from a generation has two causes, an empty balance and an exhausted per-key cap. The generation routes (spec 03) name both and pass OpenRouter's reason through; adding credit fixes only the first.
- Old copy that contained em dashes has been rewritten with periods or commas: the "took too long" reason, the spend line's remaining part, the revoked line, and the cleanup detail on the key-save failure page. Curly quotes in old messages became straight quotes.
- The supporting line in Local agents says "this Mac" on every platform, as the old app did. Kept for parity; change it only on purpose.
- Coordination with spec 02: this spec owns the project menu's rename and delete, and their confirm copy. Spec 02 owns the menu in the top-left card, switching projects, Add project with its dialog, and starter content.
- Closing a project is spec 01's open-project registry, to which spec 01 (the database handle), spec 02 (the sync room), spec 07 (chat subscriptions, provider sessions, MCP tokens) and spec 09 (preview tabs, render tracking) register their closers. This spec only calls it; tasks 32 and 35 check that it ends every one of them.

### Assets this spec needs

- None. No model-facing prompt text. The callback page colours are given above.
