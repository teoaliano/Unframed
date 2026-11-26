# Screen load

## Problem Statement

Screens, the live frames of a Repository's dev app behind the `repositories` flag, run in the same renderer process and on the same main thread as the tldraw canvas. A trace of a ComfyUI board with about ten Screens showed the canvas thread 96 to 100 % busy for ten seconds, with freezes of 330 to 540 ms, each one a Screen booting ComfyUI. Four things make it worse than it needs to be:

1. **A WebSocket the app can never open.** On upgrades the Instance proxy rewrites `Origin` to `http://localhost:<upstream>` and keeps `Host` as `127.0.0.1:<proxy>`. ComfyUI's Vite config proxies `/ws` to its backend without `changeOrigin`, so the backend sees a Host that is not the Origin, refuses with 403, and the app reconnects about 2.7 times a second, forever. Each Screen's `backend.log` fills with thousands of lines, and each reconnect is work on the canvas thread.
2. **A load stampede.** When several Screens go live together (zooming in, or coming back to a project tab, which remounts the canvas because `App.tsx` keys it by project), they all boot at once.
3. **A fixed five second step deadline.** `STEP_TIMEOUT_MS` runs from DOMContentLoaded plus two frames. Booting under load takes 8 to 12 seconds, so states fail with "Couldn't reach this state" when nothing is wrong.
4. **Nothing to measure it with.** The `?fps=1` meter knows nothing about Screens, and no performance test covers a board of them.

## Solution

- The proxy hands the upstream an Origin and a Host that agree, so an app that checks Origin against Host accepts its own WebSocket.
- Screens on a canvas load one at a time, nearest to the viewport centre first, the selected Screen ahead of the rest. A Screen waits its turn showing its snapshot, as it does today before it goes live.
- A state's steps keep trying from the first frame, but their deadline only starts once the page has loaded and gone quiet. A replay that still fails gets one fresh load before the Screen shows the failure.
- The `?fps=1` meter shows a second line about Screens, and `pnpm test:perf` pans a board of 24 Screens against the frame budget.

## User Stories

1. As a person with a Repository whose app checks Origin against Host on its WebSocket (ComfyUI), I want the app inside a Screen to connect once and stay connected, so that it works and does not reconnect forever.
2. As a person zooming out over a board of Screens and back in, I want the canvas to keep moving while they load, so that I can keep working.
3. As a person coming back to a project tab full of Screens, I want them to come up one after another, nearest first, so that the canvas does not freeze.
4. As a person who selects a Screen while others are waiting, I want that one to load next, so that the one I care about comes first.
5. As a person, I want a Screen waiting its turn to show its last picture, so that the board still reads.
6. As a person whose app takes ten seconds to boot, I want a Screen's state to be reached anyway, so that I do not see "Couldn't reach this state" when nothing is wrong.
7. As a person, I want a state that fails once to be tried again from a fresh load before I am told, so that a one-off hiccup does not ask me to fix anything.
8. As a person checking performance with `?fps=1`, I want to see how many Screens are live, loading and waiting, and how many replays, retries and failures happened, so that I can tell what a slow board is doing.

## Implementation Decisions

### The proxy's Origin and Host

- `upstreamRequestHeaders` reads the proxy's own port from the request's Host. Where the proxy rewrites (upgrades, and `/_next*` and `/__nextjs*` requests, as today), and only when the request carries an Origin that names the proxy itself, that Origin becomes `http://localhost:<proxy port>`. On an upgrade the Host becomes `localhost:<proxy port>` too, so the two agree. An Origin that is absent, or names anything else, is left alone; the loopback guard already refuses a foreign Origin on exactly these requests before any rewrite.
- `localhost` because Next's dev server trusts only that hostname for its dev resources and hot reload, which is why the proxy rewrites at all. Vite accepts it, and an Origin equal to Host passes ComfyUI's check.
- Plain HTTP requests keep the browser's Host, so the app's redirects and cookies stay on the proxy origin. The proxy writes the upgrade's raw request head itself, so it writes the rewritten Host there as well as the Origin.
- The security property stays: Origin checks apply only on the requests where the proxy rewrites.

### The load queue

- A pure queue in the domain package (`screenLoadQueue`) admits one load at a time. Each waiter brings a rank, read when the queue picks: selected first, then the smallest distance from its centre to the viewport centre. The admitted Screen holds the turn until it reports done (painted, or for a Screen with a state, its steps' result, success or failure), until it leaves, or until a cap of 4 seconds, whichever comes first; then the queue picks again. Timers come in through the interface, so the domain tests drive a fake clock.
- The web package keeps one queue per canvas document (`StoreOwner`). `useScreenView` takes an optional queue: the canvas card passes its canvas's queue and a rank from the tldraw editor; the Screen editor tab passes none and loads at once, since it shows one Screen.
- Only the first load after a Screen becomes eligible waits its turn (eligible: flag on, not an iPad, on screen, and its Instance live). Reloads for a state, navigation and the automatic retry do not queue again. A Screen that leaves the screen gives up its place or its turn, and queues again when it comes back.
- A selected Screen goes to the front of the waiting line; it does not interrupt the one loading.
- A waiting Screen shows its snapshot, or its branch and route when it has none, and carries `data-queued="true"`. `data-live` now means its frame is mounted.

### Step deadlines from quiet

- The bridge watches for quiet: the window's load event, then 500 ms with no new resource entry and no long task, read through `PerformanceObserver`. If the page never goes quiet, quiet is taken at 15 seconds after the bridge started.
- Steps start as soon as they do today. A step that cannot find its target keeps looking; it fails only once `STEP_TIMEOUT_MS` (still 5 seconds) has passed since the later of the step's start and quiet. Before quiet, a step never fails for time.
- The quiet watch and the deadline rule are pure functions in `screenBridge.ts` (`quietWatch`, `stepExpired`), passed into the serialised bridge as `matchMock` and `cutParam` are.
- A failed replay reloads the Screen once, with a fresh state token. Only a second failure in a row shows "Couldn't reach this state". The one retry is reset when the Screen's route or state changes.

### Measuring

- `packages/web/src/fps/screens.ts` counts, always and cheaply: Screens with a frame mounted, Screens loading (admitted, not done), Screens queued, replays (loads that carry a state), retries and failed states. The counters are plain numbers; nothing renders on change.
- With `?fps=1` the meter shows a second line under the frame readout, refreshed twice a second: `screens: live N · loading N · queued N · replays N · retries N · failed N`. It shows only once a Screen has been counted. `window.__fps.screens()` returns the same counts for tests.
- The meter is dev-only chrome and keeps its inline styles and existing `--fps-meter-*` tokens; the new line uses them too, so no new token.

### Delivery

- Everything sits behind the existing `repositories` flag; Screens do not exist without it. The proxy change applies to every live Instance, which only exists with the flag on.
- Lands on `t3/screen-load`, cut from `feat/repositories`.

### Calls made without the person

The person asked for no questions. These are the calls made while writing this spec:

- Origin and Host become `localhost:<proxy port>` rather than the upstream's port: the upstream then sees one consistent address, the proxy's, and the HTTP Next paths use the same Origin rule. Host changes only on upgrades, so plain requests keep today's cookie and redirect behaviour.
- The queue admits one Screen at a time with a 4 second cap, as the brief suggested. A cap means a hung Screen delays the others by at most 4 seconds.
- Only the first load waits its turn. A state reload of a Screen already showing is the person's own action and should not wait behind others.
- The Screen editor tab skips the queue: it shows one Screen and is what the person is looking at.
- Quiet is 500 ms after load, capped at 15 seconds. The cap is long enough for a slow boot and still ends for an app that polls forever.
- `STEP_TIMEOUT_MS` stays 5 seconds; it now measures time after quiet, which is what it meant.
- The perf board uses 24 Screens on one Instance of the fake dev server, so CI runs one server, not 24.

## Testing Decisions

- Tests check what a caller sees: what the upstream receives, which frames the page holds and in what order, what the Screen shows, the meter's counts.
- **Engine seam (Vitest)**, `instanceProxy.test.ts`: the fake dev server checks Origin against Host on `/ws` upgrades, as ComfyUI does, and answers 403 on a mismatch. Through the proxy, an upgrade from the Screen's own page reaches it with matching Origin and Host; the Next paths see the localhost Origin; a foreign Origin is still refused before any rewrite.
- **Domain seam (Vitest)**: the upstream headers rule; the load queue (one at a time, nearest first, selected first, done, leave, cap); `quietWatch` and `stepExpired`.
- **Browser seam (Playwright)**, new `screenLoad.spec.ts`: three Screens on a slow page load one at a time, nearest first, the selected one first; a slow app that boots for about eight seconds while busy on the network still reaches its state; a state that fails once and works on the second load shows no failure; a state that keeps failing shows it after one retry; the meter's Screen line with `?fps=1`.
- **Performance**, new `screenPerformance.spec.ts` in `pnpm test:perf`: a board with 24 Screens pans for 4 seconds within the frame budget; the meter reports them. On CI the timing thresholds are skipped as for the other budgets.
- Prior art: `instanceProxy.test.ts`, `screenStates.test.ts`, `screens.spec.ts`, `screenStates.spec.ts`, `artifactPerformance.spec.ts`, `frameMeter.spec.ts`.

## Tasks

1. Rewrite Origin and Host consistently on the proxy's rewritten requests, with the fake dev server's Origin check. Seam: domain, then engine.
2. Build the pure load queue. Seam: domain.
3. Queue Screens on the canvas: one queue per canvas document, the rank from the editor, `data-queued`, the editor tab exempt. Seam: browser.
4. Add `quietWatch` and `stepExpired` and start step deadlines from quiet in the bridge. Seam: domain, then browser (a slow app reaches its state).
5. Retry a failed replay once with a fresh load. Seam: browser.
6. Count Screens and show the meter's Screen line. Seam: browser.
7. Add the 24 Screen pan to `pnpm test:perf`. Seam: browser (performance).
8. Update `docs/specs/repositories.md` where it describes the proxy's Origin rewrite.

## Out of Scope

- Changing when Screens are live (for example, only when selected).
- Pixel-exact pictures of Screens.
- Separate hosts or processes for frames.
- Keeping the canvas mounted across project tabs.

## Further Notes

- Builds on `docs/specs/repositories.md`, `docs/specs/screen-states-and-branches.md` and `docs/specs/screen-editor.md`.
- ComfyUI itself stays out of CI; the fake dev server's Origin check stands in for it. Check a real ComfyUI board in the dev app before merging.
