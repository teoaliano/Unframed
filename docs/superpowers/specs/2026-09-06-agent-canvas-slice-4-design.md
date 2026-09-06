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

- **Chrome is the person's own.** The producer needs a Chromium to capture frames;
  `findChrome` (server/motion.js) looks where each platform installs Google Chrome,
  Chromium, Edge or Brave, then in the puppeteer and HyperFrames caches, and
  `UNFRAMED_CHROME_PATH` names a binary outright. `.puppeteerrc.cjs` at the root stops
  puppeteer (a dependency of the producer) downloading Chrome for Testing on `npm install`
  -- ~170MB that nearly every user already has an equivalent of. A machine with none gets
  a plain message from the Render button. Matteo, 2026-09-06: "most users that are going
  to use it already have Chrome installed anyways, and we can always add an alert."
  Verified: a render through `/Applications/Google Chrome.app` completes; a wrong path
  fails cleanly with the producer's own message. The desktop shell can hand its own
  Chromium over the same variable.

## Stitching, and a reversed decision

Matteo's workflow (2026-09-06): split scenes into separate motion nodes to A/B them, then
select several on the canvas and ask the agent to stitch them into one new composition.
The mechanism was already there -- `motion_read` on each scene, HyperFrames' inline nested
compositions with `data-start="<previous-id>"` chaining -- but the composer refused the
starting selection: slice 1 decided *several artifacts selected → the agent must ask*, and
the To line read "pick one". That rule was written for the edit ("which page do you
mean?"); several motions and "stitch these" is not ambiguous. Reversed: several artifacts
→ target `new`, all of them "with", To reads "new asset from N artifacts", and the agent
is told that several motions "with" a stitch/combine/sequence message means one new motion
containing them in order -- and to ask in its reply when a message reads as an edit,
which is a better place for that question than a warning under the composer.

Inline nesting first (one self-contained file), not `data-composition-src`: referenced
scenes must be `<template>`-wrapped, which agent-written compositions are not. A
"sequence" whose scenes stay live is the follow-up.

## Rejected

- **Letting puppeteer download Chrome for Testing on install** — the first cut, for
  zero-setup rendering. Rejected the same day: ~170MB charged to every install, for the
  few users without a Chromium of their own.

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
