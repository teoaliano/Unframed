# Agent on the canvas — slice 4: the motion asset

Designed and built 2026-09-06 as an MVP straight from the slice-1 north star ("Motion
asset on HyperFrames: player in a node, render to MP4"), at Matteo's ask to build rather
than plan. Builds on the page asset of slice 2 without changing it. This file records the
decisions and what was rejected; `docs/agent.md` owns present-tense behaviour.

## What it is

A **motion** is a HyperFrames composition — one HTML file, timed by `data-start` /
`data-duration` attributes, animated by one paused GSAP timeline — that lives in the
project folder like a page, is shown live in a node, and renders to an MP4 that joins the
canvas as an ordinary `video` node. The agent writes it (`motion_write` / `motion_read`,
the page tools' twins); a person can also drop one onto a motion node.

## Decisions

- **Same origin, same frame, same file rules as a page.** A composition is HTML the model
  wrote, so everything the slice-2 spec says about the preview origin applies verbatim:
  served from `server/preview.js`, framed with the same sandbox, never from `/api/file`,
  a new file on every write. Nothing about the security model moved.

- **The library is files in the project folder, not a route.** The player
  (`@hyperframes/player`), the runtime it injects (`@hyperframes/core`), GSAP, and a
  one-page viewer are copied beside the compositions under fixed names
  (`server/motion.js`, `ensureLibrary`). Two reasons over serving them from a fixed path:
  "never add a route to the preview server" (CLAUDE.md) stays literally true, and a
  project folder is then self-contained — `npx hyperframes render` on it works outside
  Unframed. The cost is ~540KB per project that has a motion, once. The preview's
  allow-list gained `js` for this; that was anticipated in `status.md` when slice 2 wrote
  `script-src 'self'`.

- **The viewer frames the composition; the canvas does not host the player.** The player
  must be same-origin with the composition to drive it (it reaches into the frame for
  `__timelines` / `__hf`), and the canvas must never be same-origin with either. So the
  node frames `hyperframes-viewer.html?c=<file>` on the preview origin, and the viewer
  mounts the player on the composition. That required one CSP addition: `frame-src
  'self'` — with `default-src 'none'` Chrome refused the inner frame outright (found in
  the headless probe). A sibling file may now frame a sibling file; nothing else changed.

- **The runtime is embedded at write time, under the renderer's marker.** The player
  injects HyperFrames' runtime only into a composition with no timeline of its own; a
  real composition has one, so without the runtime the player drove GSAP and showed no
  timed clip (probe: both clips visible at every time). `withRuntime` adds `<script
  src="hyperframes-runtime.js" data-hyperframes-preview-runtime>` once, on the agent's
  writes and on uploads; the attribute is the one `@hyperframes/core`'s
  `stripEmbeddedRuntimeScripts` looks for, so the renderer strips this copy and injects
  its own (verified: a 3s composition with a video clip rendered to a 3.0s MP4).

- **Rendering is `@hyperframes/producer`, imported lazily, in-memory jobs.** The
  producer drives Chrome's BeginFrame API and ffmpeg; it is imported only when a render
  starts because it is the heaviest module in the package. A render is local compute on
  files still on disk, so a record lost to a restart costs a click, not money — a Map,
  not `jobs.js`. Output is rendered to a temp folder and only then placed in the project
  under `<timestamp>-<slug>.mp4` with a sidecar (`source: 'render'`, no `cost`), so a
  failure leaves nothing behind. The browser polls, then adds a `video` node beside the
  motion, the way a video output's Add to canvas does.

- **Chrome is puppeteer's.** `@hyperframes/producer` depends on `puppeteer`, which
  downloads Chrome for Testing and chrome-headless-shell on `npm install`. That is what
  makes Render work in a clone with no setup; the price is a slower first install. The
  desktop shell will need its own answer (it has Chromium, but not this one) — noted in
  `status.md` as a follow-up outside this repo.

## Rejected

- **Player in the canvas bundle, pointed at the preview URL.** Cross-origin to the
  composition, so the player cannot drive it; and the `srcdoc` path that would make it
  same-origin would run the composition on the canvas's origin, which is the one thing
  the preview origin exists to prevent.
- **Writing my own renderer on `@hyperframes/engine` to skip the producer's fonts and
  weight.** The producer's video frame extraction and audio mix are exactly the parts
  that would be got wrong; ~100MB of `@fontsource` packages is the price of not
  rewriting them.
- **Serving the library from a fixed path (`/lib/…`) on the preview server.** A second
  path shape on a server whose whole point is one path shape.
- **Letting the agent inline GSAP and the runtime into every composition.** 470KB per
  write, through the model's context; and it would still need the player.

## Open

- GSAP's licence is not Apache/MIT (Webflow's standard licence, free for commercial use
  since 3.13). It is an npm dependency copied into the user's own folders, the same
  standing as any other dependency — flagged for Matteo's licensing pass rather than
  decided here.
- In the preview, a `<video>` clip's `currentTime` did not follow a seek in the headless
  probe (the runtime routes media through its own audio group); the render is
  unaffected. Not chased for the MVP.
- Renders are not durable, not cancellable, and not listed anywhere but the node that
  started them.
- The player reports the GSAP timeline's length as `duration` when it is shorter than
  the root's `data-duration`; the render uses `data-duration`.
