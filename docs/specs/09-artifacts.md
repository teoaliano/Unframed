# 09 · Artifacts

Depends on: 01 to 08 (read 00-index first). It uses spec 03's composer, result placement and placeholders, and spec 07's MCP server and spec 08's rail.

## Problem Statement

The agent can write things that are not pictures: an HTML page, or a short animated video built as HTML (a HyperFrames motion composition). A person needs to see those on the canvas next to their images, open one full screen, tune it by hand, and turn a motion into an MP4 that they can select into the next run like any other clip.

HTML runs code. A page served from the app's origin would be Unframed to the browser. It could read the project folder, spend the OpenRouter key, or install a key of its own through the OAuth flow. So artifacts need their own origin, their own sandbox and their own file rules. A motion also needs a player, a runtime and GSAP beside it, and none of them may come from the network.

Tuning is the other half. A person wants to drag a slider and see the accent colour change without asking the agent, and have that value survive the agent rewriting the file, reach every open tab, go into the render, and undo like any other edit.

## Solution

Two shape kinds, **page** and **motion**, together called artifacts. Each names one HTML file in the project folder. Every edit writes a new file and points the shape at it, so no file is ever overwritten and undo (or an agent turn's Revert) shows the previous version.

Artifact files are served only by the **preview origin**: a second loopback HTTP server on its own OS-assigned port that answers one path shape, from an extension allow-list, with a content policy that forbids all network access. The canvas and the editor frame artifacts from there in a sandboxed iframe.

A motion's player, runtime, GSAP and a small viewer page are plain files copied into the project folder beside the compositions, so the preview server never needs a second route and a project folder renders outside Unframed too. Rendering runs HyperFrames' producer against the person's own Chrome, in the engine, and the MP4 lands as a video shape beside the motion.

**Dials** are parameters an artifact declares with one call (`unframed.dials(name, config, apply)`) in a shorthand the agent writes. The values live on the shape, not in the file. The **editor** is the full-screen view of one artifact: chat on the left, the artifact in the centre, DialKit controls on the right, with a box that asks the agent to add a parameter.

This spec also owns the agent's artifact tools (`page_write`, `page_read`, `motion_write`, `motion_read`), which join spec 07's MCP server here, and, built last because they need the preview origin and the Chrome finder, t3code's preview tools, which let the agent open what it made in a headless browser and check it.

## User Stories

1. As a person, I want to add an empty page shape from the add menu, so that I have a place for the agent to write into.
2. As a person, I want to add an empty motion shape from the add menu, so that I can ask for an animation in a specific spot.
3. As a person, I want an empty artifact to show only its kind, and Agent in the selection toolbar when I select it, so that the card stays quiet until I act on it.
4. As a person, I want the toolbar's Agent on a selected empty artifact to open the composer's Agent tray on it, so that my message is about that artifact.
5. As a person, I want an empty artifact to keep its frame and name tab, so that it reads as a box asking to be filled.
6. As a person, I want a filled artifact to drop its card chrome and show only its content, so that the page is the thing I look at.
7. As a person, I want the artifact's title shown where the tab used to be, so that I can tell pages apart.
8. As a person, I want to resize an artifact freely on both axes, so that I can give a page the shape it needs.
9. As a person, I want a page on the canvas to ignore my pointer until I select it, so that clicking it selects the shape instead of clicking a link inside it.
10. As a person, I want a selected artifact to become interactive, so that I can scroll a page or use the player controls.
11. As a person, I want the artifact to stop taking pointer events while I drag it, so that the drag is not swallowed by the frame.
12. As a person, I want to drop an `.html` file on the empty canvas and get a page shape at the drop point, so that I can bring in a page I already have.
13. As a person, I want several dropped `.html` files to land offset from each other, so that they do not stack exactly.
14. As a person, I want to drop an `.html` file onto an existing page shape to replace its content, so that I can swap versions by hand.
15. As a person, I want to drop an `.html` composition onto a motion shape and have it play, so that a composition made elsewhere works here.
16. As a person, I want a failed upload to say why, so that I am not left with a silent empty shape.
17. As a person, I want Cmd-Z after replacing a page by drop to show the previous version, so that a replace is never destructive.
18. As a person, I want an agent turn's Revert to point an artifact back at the file it had before that turn, so that I can reject an agent edit.
19. As a person, I want pasting an artifact to give the copy its own file, so that editing one copy never changes the other.
20. As a person, I want a paste whose file copy fails to still paste an empty shape and tell me, so that I know what happened.
21. As a person, I want deleting an artifact to need no confirmation and to keep its files and chats on disk, so that undo brings it back whole.
22. As an agent, I want a page write tool, so that I can create a page beside the selection or write a new version of an existing one.
23. As an agent, I want a motion write tool whose description states the HyperFrames composition contract, so that my compositions play and render.
24. As an agent, I want page and motion read tools, so that an edit starts from the current file.
25. As an agent, I want clear refusals (empty HTML, too large, unknown shape, wrong kind, no file yet), so that I can correct myself.
26. As an agent, I want the write result to include the preview URL, so that I can refer to what I made.
27. As an agent, I want the runtime and parameters bridge added to my file for me, so that I do not have to remember script tags.
28. As a person, I want each agent-written file to have a sidecar naming the chat and turn that wrote it, so that I can trace any version.
29. As a person, I want a page to be unable to reach the engine, the network or my other files, so that model-written HTML cannot do harm.
30. As a person, I want a page to still load the pictures and clips beside it in the project folder, so that it can show my material.
31. As a person, I want no other local web page to be able to embed my project's pictures, so that another dev server cannot read them.
32. As a person, I want only the canvas (a loopback page) to be able to frame an artifact, so that no website can.
33. As a person, I want a new version of a page to show up without a stale cache, so that I always see the current file.
34. As a person, I want a motion shape to play the composition with player controls, muted by default, so that it can autoplay and I can unmute.
35. As a person, I want Render in a selected motion's toolbar and in its editor's header, so that I can turn it into an MP4.
36. As a person, I want to see render progress as a percentage and a status message, so that I know it is working.
37. As a person, I want the finished MP4 to appear as a video shape beside the motion, so that I can select it into a video run.
38. As a person, I want the render to go to the project I started it in even if I switch projects, and add no shape to the wrong one, so that files do not land in the wrong place.
39. As a person, I want a failed render to leave no partial file and to show the reason on the shape, so that the folder stays clean.
40. As a person without a Chromium browser, I want a plain message saying to install one or set `UNFRAMED_CHROME_PATH`, so that I know how to fix it.
41. As a person, I want rendering to use the Chrome, Chromium, Edge or Brave I already have, so that the install does not download 170 MB.
42. As a person, I want the render to use my tuned parameter values from the first frame, so that the MP4 matches what I see.
43. As a person, I want the render's sidecar to record the parameter values, so that the same file at two settings is traceable to two videos.
44. As a person, I want renders to carry no cost field, so that my spend sums stay correct.
45. As an agent, I want to declare parameters with one call in a short form (hex colour, `[value, min, max, step]`, string, list, number, boolean, nested object), so that I do not write DialKit's verbose config.
46. As an agent, I want a malformed parameter to be refused with its path, so that a typo becomes a message and not a dead control.
47. As a person, I want the parameters I set to be stored on the shape, so that they survive the agent rewriting the file.
48. As a person, I want a saved value that the new version no longer declares, or declares with another type, to be dropped, so that nothing is applied to the wrong control.
49. As a person, I want the canvas frame of an artifact to show my tuned values, not the file's defaults, so that coming back from the editor shows my work.
50. As a person, I want a tuning made in one tab to show in every other tab, so that tabs agree.
51. As a person, I want a whole slider drag to be one undo step, so that Cmd-Z does not replay every pixel.
52. As a person, I want a change made in the last moment before I close the editor to be saved, so that closing never drops my last tweak.
53. As a person, I want to double-click an artifact to open it in the full-screen editor, so that it gets room.
54. As a person, I want the editor's left column to be the chat rail showing the chats about this artifact, so that I can talk to the agent while I look.
55. As a person, I want the editor header to show Back (Esc), the kind icon, the title, the kind and "Open in a new tab", so that I know where I am and can leave.
56. As a person, I want an artifact with no file to say so in the editor, so that an empty centre is explained.
57. As a person, I want the editor's right column to show the artifact's parameters as DialKit controls, so that I can tune by hand.
58. As a person, I want "No parameters yet." when the artifact declares none, so that the empty column is explained.
59. As a person, I want to describe a parameter in a box and have the agent add it through the artifact's own chat, so that adding a control is one sentence.
60. As a person, I want that request to continue the artifact's existing idle chat, or start one tagged with it, so that it lands in a conversation I can see.
61. As a person, I want the canvas camera restored exactly when I close the editor, so that I return to where I was.
62. As a person, I want Cmd-Z on the canvas after closing the editor to undo my dial change, so that the editor is not an undo dead end.
63. As a person, I want the editor to close itself if its artifact is deleted elsewhere, so that I never look at a dead frame.
64. As a person, I want canvas shortcuts (Delete, tool keys) to do nothing while the editor is open, so that typing or pressing Backspace cannot delete the artifact I am editing.
65. As a person, I want an artifact opened outside the app to play with the values it was written with and show no panel, so that the file is self-contained.
66. As a maintainer, I want a project folder with motions to render with `npx hyperframes render` outside Unframed, so that the folder is self-contained.
67. As a person, I want the agent to open a page or motion it wrote in a browser, look at it and click through it, so that it checks its own work before telling me it is done.
68. As a person, I want a board full of pages and motions to pan and zoom as smoothly as an empty one, so that artifacts never make the canvas heavy.
69. As a person, I want artifacts I am not working with to show a still snapshot that runs nothing, so that ten animated pages cost what ten pictures cost.
70. As a person, I want a selected artifact to come alive, so that I can scroll it, click it and watch it play.
71. As a person, I want to pin a few artifacts with "Keep playing", so that the ones I am presenting keep moving while I work elsewhere.
72. As a person, I want a snapshot to follow my saved dials and my resizes, so that the still picture matches what the artifact shows live.
73. As a maintainer, I want artifact documents to run in a different browser process from the canvas, so that no page script, however heavy, can freeze the canvas.

## Implementation Decisions

### Shapes

Two custom tldraw shapes, `page` and `motion`, both artifacts. They are the one shape family that is neither media nor text. Their props are spec 02's schema (`w`, `h`, `file`, `title`, `fileName`, and `dials`, which this spec is the first to write: the saved parameter values, absent when never tuned). This spec adds no prop.

- Default size from the add menu: 480 by 320 for both kinds. Agent-created: page 480 by 320, motion 480 by 300.
- Resize is free on both axes. No aspect lock.
- **Title shown on canvas and in the editor**: `title`, else `fileName` without `.html`/`.htm`, else nothing on the canvas and the shape id in the editor.
- **Empty** (`file` is ""): the card (spec 12: `--card` fill, the kit border, 14 px radius) keeps its frame and name tab (the kind word, "Page" or "Motion") and shows its kind icon, centred, with no button. Selected, it shows Agent alone in the selection toolbar (spec 03), which opens the composer (spec 08) in its Agent tray with that shape as context.
- **Filled**: no card, no tab, no border. The frame fills the shape. The title sits where spec 02 puts a shape's label, above the top-left corner, and follows spec 02's labels-by-zoom rule.
- The frame: an iframe with `src` set to the artifact URL on the preview origin, `sandbox="allow-scripts allow-same-origin"`, `referrerpolicy="no-referrer"`, `allow=""`, `loading="lazy"`, white background (the `--artifact-page` token, white in both schemes), no border. It is keyed by `file`, so a new version is a fresh document. It exists only while the shape is live (see "Keeping artifacts off the canvas thread" below); otherwise the shape shows its snapshot.
- The frame takes pointer events only when the shape is selected and not being dragged or resized. Otherwise every pointer event goes to tldraw.
- Double-click on an artifact opens the editor. It never enters tldraw's text-edit state.
- **Render** is the kit's small outline Button with the Clapperboard icon, in the selection toolbar after Open when one filled motion is selected (spec 03), and in the editor's header when a filled motion is open. It is disabled while that motion renders. While a render runs, a row under the shape (outside it, like the video transport) shows the kit's progress look (spec 12): a Spinner, a thin bar filling in `--highlight` over `--input`, and the text `{progress}%` or `{progress}% · {message}` in extra-small muted text. Every Render and the row read one render state per motion, so they agree.
- Errors from an upload or render show in a status line under the shape (outside it, below the render row on a motion), in the error text colour, until the next upload or render starts.
- **Context menu.** Right-clicking a filled page or motion gives a section headed "Page" or "Motion", ahead of spec 02's Edit section: "Keep playing" (below), then spec 02's reveal item ("Reveal in Finder" and its platform variants), whose files are every selected filled page and motion, else the right-clicked one, and "Copy path", which copies the right-clicked one's absolute path from spec 02's `files.path`. Their failures read as spec 02's.
- Delete is tldraw's ordinary delete, with no confirmation. Files, sidecars and chats stay on disk. Undo brings the shape back and its chat tags match again. Nothing deletes superseded or orphaned artifact files.

### Keeping artifacts off the canvas thread

This section exists because of a measured failure in the old app, and every rule in it is load-bearing. The old app mounted every page and motion as a live frame at all times and served the preview origin on `127.0.0.1`, the same host as the app in the desktop shell. Ports do not separate sites, so the browser ran every artifact's scripts on the canvas's own thread. A project with ten pages, five of them running a `requestAnimationFrame` loop that read canvas pixels, panned at 15 frames per second (median frame gap 66.7 ms, every frame over 33 ms, 4 s of long tasks in a 4 s pan). The same board with the preview origin on another site panned at 120 (8.3 ms, no long tasks). Hiding the frames with CSS changed nothing, because a hidden frame keeps running its scripts. Only not running them, or running them in another process, helps.

1. **The preview origin is always a different site from the app.** The web builds every artifact URL with the loopback name the app is NOT using: when the app's own hostname is `127.0.0.1` or `[::1]`, artifact URLs use `localhost`; when it is `localhost`, they use `127.0.0.1`. The browser then runs artifact documents in a separate renderer process, so no artifact script can block panning, zooming, dragging or typing. The preview server listens on `127.0.0.1` and, where the machine has it, `[::1]` on the same port, so `localhost` answers whichever address it resolves to. Its Host check and `frame-ancestors` already accept all three names. The dials bridge's origin rules already accept either name.
2. **A frame is live only when it has to be.** An artifact shape is live when it is selected (at most three artifact shapes are live through selection; with more selected, the three nearest the viewport centre are live and the rest show snapshots), when the person pinned it with the context menu item "Keep playing" (toggle; at most three pinned per project, the menu item is disabled at three with the tooltip "Three are already playing. Stop one first."), or when it is open in the editor. Every other artifact shape shows its snapshot and runs no scripts. Live frames also unmount when the shape leaves the viewport by more than one viewport width, and remount when it comes back.
3. **Snapshots.** Whenever an artifact shape has no snapshot for its current file and size (a first open, an imported project, a cleared cache), and after every artifact write, every file replacement, every saved dial change (after the 400 ms write) and every resize that changes the shape's width or height by more than 10 %, the engine renders a snapshot in the same engine-owned headless Chrome the preview tools use (found by this spec's Chrome finder, launched on first need, closed after 5 minutes without work; at the engine seam the renderer test hook in spec 01's table stands in for it): it loads the artifact from the preview origin at the shape's size at 2x device scale, applies the shape's saved dials by posting `unframed:dials:set`, waits for the load event plus 500 ms (a motion: seeks the player to 1 s, or to half the duration when shorter), and writes a PNG into the project folder's regenerable cache, `.cache/snapshots/`, named after the artifact file and size. Work is debounced 1 s per shape and runs one at a time per engine. The shape shows the newest snapshot for its current file; while none exists yet it shows the previous one, and with none at all a plain card with the title and the hint "Select to preview". With no Chrome on the machine there are no snapshots, and the hint stays. Snapshots are never sent to a model and never get sidecars. The web follows them with the stream RPC `artifact.snapshots { project }`, which answers every snapshot in the cache as `{ file, w, h, at }` and then one item per snapshot written, and loads the picture from the app file route (spec 01) with `?snapshot=<w>x<h>`, which serves it from `.cache/snapshots/` the way `?preview=` serves image previews (spec 02), or answers 404 when there is none.
4. **The editor unloads the canvas's frames** while it is open (already stated above), so at most one artifact document runs while editing.
5. **Guidance to the agent.** The page and motion write tool descriptions include the performance paragraph in `assets/prompts/artifact-performance.md`: animate on demand, stop work when the document is hidden or off screen, never read pixels back every frame.

**Artifact URLs** (the web builds them from `previewPort` and the project's slug):
- page: `http://127.0.0.1:<previewPort>/p/<project>/<file>`
- motion: `http://127.0.0.1:<previewPort>/p/<project>/hyperframes-viewer.html?c=<file>`
with each segment URL-encoded.

### Artifact files

**Every edit is a new file.** No artifact file is ever overwritten or deleted by Unframed. An agent write opens the file with exclusive create (`wx`) and retries with the next suffix on `EEXIST`. A shape changes version only by its `file` prop changing, so tldraw's local undo (for a person's edit) and an agent turn's Revert (spec 07, for an agent's edit) both restore the previous version by restoring the prop.

**Names**: `<epochMs>-<slug>[-<n>].html`, where slug is spec 01's slug rule applied to the title, or to `page`/`motion` when the title is empty. If the slug is empty, the base is `upload`. `n` starts at 1 on collision.

**Size limit**: 2 MiB (2,097,152 bytes) after the runtime and bridge tags are injected.

**Agent sidecar**, next to the file with `.json` in place of `.html`:

```ts
{ source: "agent", kind: "page" | "motion", chatId: string, turn: number,
  shapeId: string | null /* the shape updated, null when creating */,
  title: string, bytes: number, at: string /* ISO */ }
```

**Upload and copy sidecars** are spec 02's (`source: "upload"` for a dropped `.html` or an uploaded composition, `source: "copy"` with `of` for a pasted artifact). This spec adds none.

### Dropping and pasting

- Dropping `.html` files on empty canvas is spec 02's drop rule (a page at the drop point with `file`, `fileName` and `title`, offset 24 px per extra file, the same failure toast). A dropped page gets no injected tags.
- Dropping an `.html` onto a page shape uploads it the same way and sets `file` and `fileName`. `title` keeps its current value if it has one, else takes the name without extension. It is one person edit, one undo step.
- Dropping an `.html` onto a motion shape goes through the motion upload (below), not the plain upload, then sets the same props.
- Pasting an artifact copies its file by spec 02's paste rule, so two shapes never share one artifact file; a failed copy pastes the shape empty with spec 02's toast.

### The preview origin

A second HTTP server inside the engine process, bound to `127.0.0.1` (and `[::1]` on the same port where available, see "Keeping artifacts off the canvas thread") on an OS-assigned port. Spec 01 already starts this listener (answering 404 to everything, with the Host check) and reports its port as `previewPort` in the `ready` IPC message and in `server.health`; this spec adds its one route and its headers. It reads the output folder through a getter, so a settings change moves it without a restart.

It answers exactly one path shape and nothing else, and it must never gain a second route:

- `GET` or `HEAD` `/p/<project>/<file>`, optionally followed by a query or fragment. Any other method or path: 404.
- `<project>` is URL-decoded and slugged with the project rule. Empty after slugging: 404.
- `<file>` is URL-decoded and must match `^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$`. This rules out `..`, separators and anything that decodes to something odd. A decode error: 404.
- The extension (case-insensitive) must be in the allow-list, each with its `Content-Type`:
  html `text/html; charset=utf-8`, js `text/javascript; charset=utf-8`, png `image/png`, jpg and jpeg `image/jpeg`, webp `image/webp`, gif `image/gif`, svg `image/svg+xml`, mp4 `video/mp4`, webm `video/webm`, mov `video/quicktime`, mp3 `audio/mpeg`, wav `audio/wav`, woff `font/woff`, woff2 `font/woff2`. Everything else is 404, which is what keeps sidecars, the project database, chat records and temp files unservable.
- A missing file or a directory: 404.
- `Host` must be loopback (`localhost`, `127.0.0.1` or `[::1]`, optional port, case-insensitive), using the same check the app origin uses (one definition, shared). Otherwise 403.
- Errors are `text/plain` with `Cache-Control: no-store`. The 403 body is `Unframed answers only requests addressed to localhost.` The 404 body is `not found`.

Every 200 and 304 carries:

| Header | Value |
| --- | --- |
| `Content-Security-Policy` | `default-src 'none'; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; frame-src 'self'; connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'; frame-ancestors http://localhost:* http://127.0.0.1:* http://[::1]:*` |
| `Cross-Origin-Resource-Policy` | `same-origin` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `no-referrer` |
| `Cache-Control` | `no-cache` |
| `ETag` | `"<size in hex>-<floor(mtime ms) in hex>"` |
| `Content-Type` | from the allow-list |

- A 200 also carries `Content-Length`. `HEAD` sends headers only.
- A request whose `If-None-Match` equals the ETag gets 304 with the same headers minus `Content-Length`, and no body.
- `connect-src 'none'` means a page cannot fetch, open sockets or send beacons, so the engine is unreachable from a page even by URL. `frame-src 'self'` exists so the motion viewer can frame its sibling composition. `allow-same-origin` in the iframe sandbox is required: without it the document has an opaque origin and CORP blocks its own sibling pictures. With it the document sits on the preview origin, which is not the app's, and cannot lift its own sandbox.
- **Never route an artifact through the app origin**: no app-origin file route may serve `.html` as a document, and the web never frames anything but the preview origin in an artifact frame.

### Motion

A motion is a HyperFrames composition: one HTML file. The contract given to the agent (in its tool description, see assets):

- the root is `<div id="root" data-composition-id="main" data-start="0" data-duration="SECONDS" data-width="PX" data-height="PX">`, sized to those pixels with overflow hidden. `data-duration` is the render length;
- every timed element inside has an id, `class="clip"`, `data-start` and `data-duration` in seconds;
- media clips reference project files by the exact names the canvas read reports. A `<video>` is `muted playsinline`, plus `data-has-audio="true"` when its sound should be heard;
- animation is one paused GSAP timeline registered synchronously as `window.__timelines.main`;
- GSAP loads with `<script src="gsap.js"></script>` and nothing else external loads;
- no imperative media control (`play()`, `pause()`, `currentTime`), no wall-clock time, no unseeded randomness, no infinite repeats.

**Tag injection**, a pure domain rule used on every motion write and motion upload:
- The runtime tag is `<script src="hyperframes-runtime.js" data-hyperframes-preview-runtime></script>`. It is skipped if the document already matches (case-insensitive) `data-hyperframes-preview-runtime`, `hyperframes-runtime.js` or `hyperframe.runtime.iife.js`. The attribute is the marker HyperFrames' renderer strips by, so a render removes this copy and injects its own.
- The bridge tag is `<script src="unframed-dials.js"></script>`. It is skipped if the document already mentions `unframed-dials.js`.
- A tag goes immediately before the first `</head>` (whitespace allowed before `>`, case-insensitive), followed by a newline. With no `</head>`, it goes just after the opening `<body ...>` tag, preceded by a newline. With neither, it goes at the very top, followed by a newline.
- A motion gets the runtime tag first, then the bridge tag. A page written by the agent gets only the bridge tag. Injection is idempotent: reading a file back and writing it again adds nothing.

**The motion library**: five files in the project folder under fixed names.

| File | Source |
| --- | --- |
| `hyperframes-viewer.html` | generated by the engine |
| `unframed-dials.js` | the bridge, generated from the domain dial module |
| `hyperframes-player.js` | the global build of the installed `@hyperframes/player` (its `hyperframes-player.global.js`, found beside the package entry) |
| `hyperframes-runtime.js` | the installed `@hyperframes/core`'s `dist/hyperframe.runtime.iife.js` |
| `gsap.js` | the installed `gsap`'s `dist/gsap.min.js` |

- "Ensure library" creates the folder if needed and writes each file whose on-disk byte size differs from its source (or that is missing). Unchanged files are left alone. It is idempotent and cheap. A dependency bump or a generator change refreshes the copies.
- A motion write, a motion upload and a render start each ensure the library first.
- A page write ensures only the bridge file (same size rule). A page never gets the player, runtime or GSAP.
- Nothing is vendored in this repo and nothing loads from a CDN, in the preview or in a render.
- The engine install must not download a browser: configure puppeteer (a dependency of the producer) to skip its download.

**The viewer page** (`hyperframes-viewer.html`), generated:
- Title `motion`. `html` and `body` have no margin, full height, black background, hidden overflow. The player fills the page.
- Loads `hyperframes-player.js` and mounts `<hyperframes-player runtime-src="hyperframes-runtime.js" controls muted autoplay>`. `runtime-src` points at the sibling because the player's default is a CDN the policy refuses. The player plays on its own only with `autoplay`, and `muted` lets the browser allow it.
- Reads the `c` query parameter and sets it as the player's `src` only if it matches `^[A-Za-z0-9][A-Za-z0-9._-]*\.html?$`.
- Relays dial messages (protocol below): a `unframed:dials` message from its own origin records the composition's window and the message, and forwards it to the canvas if one has said hello. From a loopback origin only: `unframed:dials:hello` records the sender and its origin as the canvas and replays the last announcement to it. `unframed:dials:set` is forwarded to the composition at the viewer's own origin. Everything else is ignored.
- With no canvas above it, the viewer relays nothing and shows no controls.

**Motion upload** (RPC `motion.upload { project, fileName, html }`): refuses empty or whitespace-only `html` with `No composition in the request body.`, and anything over 20 MB. `fileName` is reduced to its basename, default `motion.html`. The engine ensures the library, injects the runtime and bridge tags, and saves the result as an upload (naming and sidecar above). Returns `{ file, fileName, bytes, mime: "text/html" }`. Failure: `Could not save the composition: {message}`.

### Rendering

RPC `motion.renderStart { project, file, title?, dials?, shapeId }` (`shapeId` is the motion) returns `{ id, status, placeholder }` once the render's placeholder is in the room. Failures are spec 01's `UnframedError`: a bad or missing file is `bad_request` or `not_found`, a library failure `internal`, an unknown id `not_found`. RPC `motion.renderStatus { project, id }` returns `{ id, file, status, progress, message, output, error }`.

- `file` must match `^[A-Za-z0-9][A-Za-z0-9._-]*\.html?$`, else `Which composition? Pass its .html file name.` A missing file: `No file {file} in this project.` A library failure: `Could not prepare the motion library: {message}`. An unknown id: `No such render.`
- `title` is cut to 120 characters. `dials` is used only if it is a plain object (not an array), otherwise null.
- Render job record: `id` is `r-<epochMs base36>-<6 random base36 chars>`; `status` is `queued`, then `rendering`, then `done` or `failed`; `progress` is 0 to 100, never decreases, capped at 99 until done, then 100; `message` is the producer's latest status text; `output` is the placed MP4 name when done; `error` is the failure text.
- Render jobs are an in-memory map, not the durable render-job store of spec 04. A render is free local compute on files still on disk, so one lost to a restart costs a click. They are not cancellable. Each registers in spec 03's run registry, so its placeholder is resolved like any non-durable run (a render lost to a restart has its placeholder removed at boot). This spec registers a closer per project with spec 01's open-project registry that stops tracking the project's renders in the web-facing map; a render in flight still writes its file into the folder it started in.
- **The render's placeholder** is spec 03's placeholder mechanism, unchanged: before `motion.renderStart` answers, the engine writes a video shape with no file and the run marker `{ runId: <render id>, runIndex: 1, startedAt }` (not durable, and carrying no result meta, since a render is not a paid result), 320 wide with the composition's aspect from its root `data-width` and `data-height` (16:9 when absent), placed by spec 03's result placement anchored on the motion. On `done` the engine fills it with the MP4 (`file` and asset `name` both the output name) and removes the marker; on `failed` it deletes it. The shape stays a plain video, not a result. Because the engine writes it into the room of the project the render started in, switching projects in the tab cannot misplace it.
- The producer (`@hyperframes/producer`, with `@hyperframes/engine` for its config) is imported only when a render starts. It renders at 30 fps, `standard` quality, format `mp4`, entry file = the composition, with the found Chrome as its browser, and with its own logging silenced except errors. When `dials` is a non-empty object it is passed as the render's variables under `unframedDials`, which the producer injects as `window.__hfVariables` before any page script runs, so the bridge's first apply already uses the tuned values.
- Output goes to a fresh temp folder (`unframed-render-` prefix), then is copied into the project with exclusive create as `<epochMs>-<slug of title, or motion>[-<n>].mp4`, with a sidecar:

```ts
{ source: "render", of: <composition file>, title: string, mime: "video/mp4",
  fps: 30, quality: "standard", bytes: number,
  dials?: object /* present only when non-empty */, at: string }
```

  There is no `cost` field. The temp folder is removed in every outcome, so a failed render leaves nothing in the project.
- **Finding Chrome** (candidate list pure in domain, existence check in the engine), first existing wins:
  1. `UNFRAMED_CHROME_PATH` when set (skipped if it does not exist).
  2. macOS: under `/Applications` then `~/Applications`, in order: `Google Chrome.app/Contents/MacOS/Google Chrome`, `Chromium.app/Contents/MacOS/Chromium`, `Microsoft Edge.app/Contents/MacOS/Microsoft Edge`, `Brave Browser.app/Contents/MacOS/Brave Browser`, `Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary`.
     Windows: under each of `%PROGRAMFILES%`, `%PROGRAMFILES(X86)%`, `%LOCALAPPDATA%` that is set: `Google/Chrome/Application/chrome.exe`, `Microsoft/Edge/Application/msedge.exe`, `BraveSoftware/Brave-Browser/Application/brave.exe`, `Chromium/Application/chrome.exe`.
     Linux: each of `google-chrome`, `google-chrome-stable`, `chromium`, `chromium-browser`, `microsoft-edge`, `brave-browser` under `/usr/bin`, `/usr/local/bin`, `/snap/bin`, `/opt/google/chrome`.
  3. Headless shell caches `~/.cache/puppeteer/chrome-headless-shell` then `~/.cache/hyperframes/chrome/chrome-headless-shell`: version folders sorted descending, and in each the platform folder (`chrome-headless-shell-mac-arm64`, `chrome-headless-shell-mac-x64`; `chrome-headless-shell-linux64`; `chrome-headless-shell-win64`) holding `chrome-headless-shell` (`.exe` on Windows).
- None found: the render fails with `Rendering needs a Chromium browser on this computer: Google Chrome, Chromium, Edge or Brave. Install one, or point UNFRAMED_CHROME_PATH at its binary, and render again.`
- **Test hook**: `UNFRAMED_TEST_RENDERER` (spec 01's test-only table) replaces the producer and the Chrome search. `ok` reports progress 25, 50, 75 with messages `Capturing frames`, `Encoding`, `Finishing`, then writes a small fixture MP4; its final message is `variables: <JSON of the variables it received, or null>`. `fail` fails with `Stub render failed.` `no-chrome` behaves as if no browser were found.

**The web side of a render**: Render sends `motion.renderStart` with the motion's `shapeId`, `file`, title and `dials`, then polls `motion.renderStatus` every 700 ms. Button disabled while rendering. On `failed` the shape shows `error`, or `The render failed.` when there is none. On `done` there is nothing for the web to create: the engine has already filled the placeholder, and every tab of that project sees it. Polling only drives the render row and stops when the shape unmounts.

### Agent tools for artifacts

This spec owns the four artifact tools, `page_write`, `page_read`, `motion_write` and `motion_read`, and adds them to spec 07's Unframed MCP server. Spec 07 builds only the two canvas tools; its required-tool check covers every tool the server registers, so from this spec on it covers these four (and the preview tools below) too. Both kinds are built from one definition so the new-file rule, placement, result and event cannot drift.

Descriptions are model-facing and composed from assets: `page_write` is the text in `assets/prompts/page-write-tool.md`, one space, then `assets/prompts/dials-contract.md`; `motion_write` is `assets/prompts/motion-write-tool.md`, then `dials-contract.md`, then `assets/prompts/dials-timeline.md`; `page_read` and `motion_read` are in `assets/prompts/artifact-read-tools.md`. Each file states how it is joined.

`<kind>_write { html: string, shapeId?: string, title?: string (max 120) }`:
1. `html` not a non-empty string: `html must be a non-empty string`.
2. Inject tags (bridge for page, runtime then bridge for motion). Over 2 MiB: `the {kind} is too large ({n} bytes; the limit is 2097152)`.
3. `shapeId` given but no such shape: `no shape {shapeId}`. Wrong kind: `shape {shapeId} is a {its kind}, not a {kind}`.
4. Title = (`title` if given, else the shape's current title, else "") trimmed.
5. Ensure the bridge (page) or the library (motion), then write the new file with exclusive create and its agent sidecar.
6. Update: set `file`, and `title` only if `title` was given and differs. Create: a new shape of that kind at the default agent size with `{ file, title, fileName: "" }`, placed to the right of the selection's bounding box (right edge + 60, top of the topmost selected shape), or at (80, 80) with nothing selected. Written through spec 02's `apply` with origin `chat:<chatId>` and recorded in spec 07's turn changes, so it is one change the turn's Revert undoes.
7. A failed write: `the change could not be applied`, or the room's rejection reason.
8. Tags the chat with the artifact (create or update) through spec 07's tag reactor, and records a tool activity with summary `Created {kind}` or `Updated {kind}`, followed by ` · {title}` when there is a title, and an artifact field `{ shapeId, file, title, kind, created }`.
9. Returns `{ ok: true, shapeId, file, title, previewUrl, clock }`, `previewUrl` being the artifact URL above and `clock` the room clock after the write, as spec 07's `canvas_write` reports it.

`<kind>_read { shapeId }` returns the file's HTML. Refusals: `no shape {shapeId}`, `shape {shapeId} is a {its kind}, not a {kind}`, `{kind} {shapeId} has no file yet`, `the file {file} could not be read`. The file name is reduced to its basename before reading.

Refusals are tool errors carrying `{ "error": <message> }`, as spec 07's other tools report them. In plan interaction mode the two write tools are refused by spec 07's permission policy.

### Dials

**The declaration**, available in every artifact that carries the bridge: `unframed.dials(name, config, apply)`.

**Shorthand normalisation** (pure, in domain; the bridge is built from the same module). Each value in `config` is read by its shape:

| Value | Schema kind | DialKit config |
| --- | --- | --- |
| number | `number` | the number |
| boolean | `boolean` | the boolean |
| string matching `^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$` | `color` | `{ type: "color", default }` |
| any other string | `text` | `{ type: "text", default }` |
| array of 3 or 4 numbers `[value, min, max, step?]` | `range` (`value`, `min`, `max`, `step` when given) | the array as is |
| non-empty array of strings | `select` (`value` = first, `options`) | `{ type: "select", options, default: first }` |
| object | `folder` (`of`: nested schema) | nested config |

Refusals name the path from the root `dials`, and the first one stops normalisation:
- config not an object (or null, or an array): `{path}: the parameters must be an object`
- other arrays: `{path}: an array must be [value, min, max] numbers or a list of strings`
- anything else: `{path}: a parameter must be a number, a switch, text, a colour, a range or a list`

For example `dials.scene.speed: an array must be ...`.

**Values**: default values are a plain nested object (folders as nested objects) of each entry's `value`. **Merge rule**: for each key the schema names, take the saved value if present and of the same JS type as the default, else the default; recurse into folders; drop keys the schema does not name. Values are stored on the shape as `dials`, never in the file.

**The bridge** (`unframed-dials.js`), generated at engine build from the domain dial module so the shipped copy and the tested definition are one. It starts with a comment saying it is generated and rewritten on every write, so it must not be edited in the project folder. It defines `window.unframed.dials` and `window.unframed.defaultDials`.

**Pinch to zoom.** In a framed artifact the bridge keeps a wheel with Ctrl or Cmd (a trackpad pinch) from the browser, which would zoom the whole app, and posts it to the canvas that said hello as `{ type: "unframed:wheel" }` with the wheel's deltas, modifiers and position. The canvas replays it on the canvas at the same point on screen, so a pinch over a selected page or motion zooms the canvas as it does with nothing selected; in the editor it does nothing. A plain scroll still scrolls the document.

**Right-click.** A selected frame takes the pointer, so a right-click in it would reach the page, not the canvas. On the canvas the frame's hello carries `menus: true`; the bridge then keeps a right-click from the page's own menu and posts it to that canvas as `{ type: "unframed:contextmenu", clientX, clientY }`. The canvas replays it as a right-click's press and release on the canvas at the same point on screen, so the shape's menu opens there (with several selected, the menu acts on all of them, as on the canvas). The editor's frame does not ask, so a right-click there stays the page's. This keeps the live and interactive rules above unchanged: a selected artifact still scrolls and plays at once. A page whose file has no bridge tag (an uploaded HTML file never written by the agent) keeps the page's own menu; its label above the corner still opens the shape menu. The preview origin refreshes `unframed-dials.js` from the current source whenever a frame requests it, so artifacts written before a bridge change get the new one.
- `dials(name, config, apply)`: normalise. On error, `console.error("[unframed] " + error)` and return null. Otherwise the state is name (`String(name)`, or `Parameters` when null), config, schema, values = merge(schema, `window.__hfVariables.unframedDials` or null), apply (a no-op when not a function). It calls apply with the values first (errors logged as `[unframed] applying parameters failed`), then announces, then returns `{ values, set(next) }`.
- Announce posts `{ type: "unframed:dials", name, config, schema, values }` to `window.parent`, only when framed, addressed to a given origin, else to the other-origin canvas that last said hello, else its own. So a page framed directly by the canvas still reaches it with a declaration made after its load event.
- It accepts a message only when `event.source` is `window.parent` and the origin is its own or loopback (`^http://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$`, case-insensitive). `unframed:dials:hello` answers with an announcement addressed to the asker's origin. `unframed:dials:set` merges `values` over the current values (a deep assign one level per folder, so a partial set keeps what it does not name), re-merges against the schema, and applies.
- The last declaration wins.

**Protocol summary**:

| Message | From, to | Body |
| --- | --- | --- |
| `unframed:dials` | artifact to its framer (viewer relays to canvas) | `name, config, schema, values` |
| `unframed:dials:hello` | canvas to frame | none |
| `unframed:dials:set` | canvas to frame (viewer relays to composition) | `values` |

The canvas side addresses hello and set to the preview origin and accepts `unframed:dials` only when `event.source` is that frame's window. A page is framed directly by the canvas across origins. A motion is framed by the viewer, which is same-origin with the composition.

**Saved values in canvas frames**: every artifact frame (on the canvas and in the editor) sends hello at mount and on the frame's load event. On receiving an announcement from its frame, it sends `unframed:dials:set` with the shape's `dials` if non-empty. When `dials` changes (editor, another tab, undo) it sends set at once.

**Canvas writes**: a dial change writes the whole values object to the shape's `dials` prop, debounced 400 ms from the last change, as one tldraw history step. A pending write is flushed, never cancelled, when the parameters column unmounts (Back, Esc, deletion, switching artifact). The change syncs to every tab through the room.

### The editor

Opened by double-click on an artifact, by the selection toolbar's Open on one filled artifact (spec 03 and 08 call this entry point), and by the chat recap card's Open (spec 08). Opening: save the tldraw camera, select the artifact alone, close the composer, check providers if not yet checked, then show the editor.

- **Full screen, replacing the canvas on screen.** The canvas's own artifact frames and players unload while it is open. The tldraw editor instance and its local undo history survive, so Cmd-Z after closing undoes a dial change. Canvas keyboard shortcuts are inactive while the editor is open.
- **Layout**: a three-column grid, 360 px, flexible, 320 px, gap 12 px, padding 12 px, on the body background. Each column is a card on `--card` with the kit border and a 14 px radius (spec 12).
- **Left column**: spec 08's chat rail in embedded mode, without its own floating card styling, filtered by the selection (this artifact alone).
- **Centre header**, one row, 48 px over a border: ghost icon button (the kit Button, `ghost`, 32 px) ArrowLeft, label `Back to canvas`, tooltip `Back to canvas (Esc)`; the kind icon (page AppWindow, motion Clapperboard); the title; the kind word (`page` or `motion`) in secondary text; then, right-aligned and only when the artifact has a file, ghost icon button ExternalLink, label and tooltip `Open in a new tab`, which opens the artifact URL with `noopener,noreferrer`.
- **Centre body**: the artifact frame (same attributes as on the canvas, live from the start, not lazy), keyed by file. With no file: `This {kind} has no file yet. Ask the agent to write one.`
- The region has `aria-label` `Editing {title}`.
- **Esc** closes the editor unless the event was already handled or the focus is in an input, textarea or contenteditable.
- If the artifact disappears (deleted by the agent, another tab, or an undo), the editor closes itself.
- **Close** restores the saved camera exactly.
- **Right column, Parameters**: header with the SlidersHorizontal icon and `Parameters`. Body: DialKit's vanilla build mounted inline with the dark theme, its CSS variables set from the kit's dark tokens (spec 12: panel on the dark `--card`, controls on the dark `--accent`, text in the dark `--foreground` and `--muted-foreground`, the kit's sans font), so it stays dark in both schemes, on the config the artifact last announced, named by the announced name (or `Parameters`) with id `unframed-<name>`. The shape's saved `dials` are set on it after mounting (a refused value is ignored). Every change posts set to the frame and schedules the debounced canvas write. The DialKit controller is rebuilt only when a new announcement arrives, never on a re-render or a saved-value change, since a rebuild pushes values down and would reset a drag. The column is keyed by the artifact's file, so a new version gets a fresh panel. With no announcement: `No parameters yet.` DialKit and its stylesheet load only with the editor and are never copied into a project folder.
- **Add a parameter box**, at the foot of the column: the kit's small Textarea labelled `Add a parameter`, placeholder `Add a parameter… (e.g. the background colour, the title size)` when parameters exist, else `Describe a parameter… (e.g. the accent colour and the intro speed)`. Beneath: muted text `The agent writes it` and a small outline button (the kit Button, `outline`, `xs`) `Add` with the Sparkles icon, which reads `Asking…` while sending and is disabled when the box is empty or a request is in flight. Enter sends (not with Shift, Option or during IME composition). Sending builds the premade instruction from the artifact's title (or id), its kind and the text (asset below; it says "parameters" when the text contains the word "and" or a comma, else "a parameter"). The instruction goes to the artifact's own chat: the newest idle chat whose tags include this artifact (spec 08's continuable-chat rule), or a new chat tagged with it. The rail opens on that chat, then the message is sent with the artifact as selection. On success the box clears. With no ready provider: `Connect Claude or Codex first.` Any error shows under the box.

### Preview tools for the agent

Built last in this spec, because they need its preview origin and its Chrome finder. Spec 07's MCP server gains t3code's preview toolkit, bound to artifacts instead of arbitrary URLs. The browser is a headless Chrome the engine starts on demand, found by this spec's Chrome finder (the same candidate list motion rendering uses, `UNFRAMED_CHROME_PATH` first), one tab per chat, closed when the chat's session closes. This spec registers a closer with spec 01's open-project registry that closes every preview tab of the project. It loads artifacts only from the preview origin, so every rule of that origin still holds.

| Tool | Input | Does |
| --- | --- | --- |
| `preview_status` | `{}` | whether the chat's preview tab exists, its artifact, URL, title, loading state and viewport size |
| `preview_open` | `{shapeId}` | opens (or reuses) the chat's tab on that page or motion; a motion opens its viewer. Errors: `no shape <id>`, `shape <id> is a <kind>, not a page or motion`, `<kind> <id> has no file yet` |
| `preview_navigate` | `{shapeId}` | switches the tab to another artifact of this project; no other destinations exist |
| `preview_resize` | `{mode: "fill"}` or `{mode: "freeform", width, height}` or `{mode: "preset", preset, orientation?}` | changes the viewport |
| `preview_set_appearance` | `{colorScheme: "light" \| "dark" \| "system"}` | emulates `prefers-color-scheme` |
| `preview_snapshot` | `{includeImage?: boolean}` | page state, semantic elements, console diagnostics, action history, and a PNG screenshot unless `includeImage` is false |
| `preview_click` | `{locator}` or `{selector}` or `{x, y}` | clicks exactly one target |
| `preview_type` | `{locator \| selector, text, clear?}` | inserts literal text |
| `preview_press` | `{key, modifiers?}` | presses one key |
| `preview_scroll` | `{deltaX?, deltaY?, locator? \| selector?}` | scrolls the page or a container |
| `preview_evaluate` | `{expression}` | evaluates JavaScript in the artifact and returns `{value}` (JSON, at most 64 KB) |
| `preview_wait_for` | `{locator?, selector?, text?, timeoutMs?}` | waits until every given condition holds |

Tool descriptions are model-facing: use the text in `assets/prompts/preview-tool-descriptions.md`. Preview tools read and never write the canvas, so they are auto-approved in every mode, like the canvas tools (spec 07's permission policy), and add nothing to a chat's tags or turn changes. Spec 08's work log already labels them ("Looked at <title> in a browser"). With no Chrome found, every preview tool answers `No Chrome, Chromium, Edge or Brave was found on this machine, so the agent cannot open a preview.` Recording (`preview_recording_*`) is out of scope.

### Modules

- **Preview origin** (engine): deep module, interface = start with an output-folder getter, returns the port; one pure resolve step (URL, Host, folder to file-or-status) behind it.
- **Artifact store** (engine): write new artifact file with sidecar, read artifact, ensure bridge, ensure library, motion upload. Adapter over the file system.
- **Renderer** (engine): start and status, with the producer behind a seam the test hook replaces.
- **Artifact rules** (domain): file names, tag injection, Chrome candidate list, placement beside selection, the add-a-parameter instruction builder. (A render's placeholder is placed by spec 03's result placement.)
- **Dials** (domain): normalise, default values, merge, and the bridge built from them.
- **Artifact shapes, frame, editor, parameters column** (web).

## Testing Decisions

A good test drives one of the three seams from 00-index and asserts only on what that seam exposes: HTTP responses, RPC replies, files written, what is on screen. Prior art in the old app: the preview origin tested by resolving requests and asserting status, headers and body; the dial rules tested case by case; the shipped bridge tested by evaluating its actual source against a stub `window` and driving it with messages; renders tested with the producer replaced.

- **Domain**: naming, tag injection, dial normalisation, defaults and merge, Chrome candidates per platform, placement, the instruction builder. Also the built bridge file, evaluated against a stub window (parent, origin, `postMessage`, `__hfVariables`), because it is a domain artefact.
- **Engine**: the preview origin over real HTTP (fetch with a crafted `Host` header), the four artifact tools and the preview tools through the scripted agent (fixtures `dials`, `revise`, `stitch` exist in `assets/fixtures/`), motion upload and render RPCs with `UNFRAMED_TEST_RENDERER`, and the files each leaves in the project folder.
- **Browser**: shapes, drop, paste, delete, the frame's live state, the sandbox probe, render from the button, the editor, dials end to end, the add-a-parameter box. A real render (Chrome plus ffmpeg) is a manual check, not a test.

## Tasks

1. The preview listener spec 01 starts serves this spec's route on the port reported as `previewPort` in the `ready` message and `server.health`. Seam: engine
2. The preview origin serves an existing project `.html` at `/p/<project>/<file>` with `text/html; charset=utf-8`, and 404 `not found` for any other path shape or method. Seam: engine
3. File names outside `^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$`, `..`, encoded separators and bad encodings are 404. Seam: engine
4. The extension allow-list serves each listed type with its Content-Type and 404s `.json`, `.log`, `.sqlite`, `.tmp` and extensionless names. Seam: engine
5. Every served response carries the exact CSP, CORP, nosniff, Referrer-Policy and Cache-Control values. Seam: engine
6. ETag from size and mtime; a matching `If-None-Match` gets 304 without body or Content-Length; HEAD sends headers only. Seam: engine
7. A non-loopback `Host` gets 403 with `Unframed answers only requests addressed to localhost.` Seam: engine
8. The preview origin follows an output folder change without restart. Seam: engine
9. Artifact file names: slug of title, `page`/`motion` default, `upload` when slug is empty, `-n` suffix. Seam: domain
10. Tag injection: before `</head>`, after `<body>`, at top; runtime before bridge; skip when present by each marker; idempotent. Seam: domain
11. Dial shorthand: each value shape maps to its schema kind and DialKit config. Seam: domain
12. Dial refusals name the path, for each of the three messages, including nested folders. Seam: domain
13. Default values and the merge rule (type mismatch dropped, unknown keys dropped, folders recurse). Seam: domain
14. Chrome candidate list per platform, `UNFRAMED_CHROME_PATH` first, caches last with newest version first. Seam: domain
15. Placement beside the selection (right edge + 60, top) and at (80, 80) with nothing selected. Seam: domain
16. The add-a-parameter instruction: title, kind, singular versus plural rule, asset text. Seam: domain
17. The built bridge: declare applies before announcing, reads `__hfVariables.unframedDials`, refuses a bad config with a console error and null. Seam: domain
18. The built bridge: accepts only from its parent with own or loopback origin; hello announces to the asker's origin; a partial set keeps other values. Seam: domain
19. `page_write` without `shapeId` creates a page shape beside the selection with a new file carrying the bridge tag, the agent sidecar, and only `unframed-dials.js` beside it. Seam: engine
20. `page_write` with `shapeId` writes a new file, points the shape at it, keeps the old file, and the turn's Revert points it back. Seam: engine
21. `page_write` refusals: empty html, over 2 MiB after injection, unknown shape, wrong kind. Seam: engine
22. `page_write` tags the chat and records the canvas-change event with summary and artifact field; the result carries the preview URL. Seam: engine
23. `page_read` and `motion_read` return the current HTML and refuse unknown shape, wrong kind, no file. Seam: engine
24. `motion_write` writes the runtime and bridge tags and puts all five library files beside it. Seam: engine
25. A library file whose size differs from its source is rewritten; unchanged files are not touched. Seam: engine
26. `motion.upload` injects tags, ensures the library, saves an upload with sidecar; empty body and over-20 MB are refused. Seam: engine
27. `motion.renderStart` refuses a bad file name, a missing file, and reports a library failure; `motion.renderStatus` answers `No such render.` for an unknown id. Seam: engine
28. A stub render goes queued, rendering, done with non-decreasing progress capped at 99 until 100, places `<ms>-<slug>.mp4` and a render sidecar with no `cost`. Seam: engine
29. Render `dials` reach the producer as `unframedDials` and are recorded in the sidecar; absent when empty. Seam: engine
30. A failed render leaves no file in the project and reports the error; `no-chrome` reports the no-Chromium message. Seam: engine
31. The add menu creates empty page and motion shapes at 480 by 320 showing the kind tab and icon and no button. Seam: browser
32. A selected empty artifact's toolbar Agent opens the composer's Agent tray on it. Seam: browser
33. A filled artifact drops its chrome, shows its title line, and resizes freely on both axes. Seam: browser
34. The frame takes pointer events only when the shape is selected and not dragging. Seam: browser
34a. Right-clicking inside a selected, live page whose file carries the bridge opens its shape menu; with two selected the reveal item counts both. The bridge hands a right-click to a canvas that asked for menus and leaves it to the page otherwise. Seams: browser, domain
35. Dropping `.html` files on the canvas creates page shapes at the drop point, offset 24 each; a failed upload shows the toast. Seam: browser
36. Dropping `.html` on a page shape replaces its file, keeps an existing title, and Cmd-Z restores the previous version. Seam: browser
37. Dropping a composition on a motion shape plays it in the viewer. Seam: browser
38. Pasting an artifact creates a copy file with a `copy` sidecar naming `of`; a failed copy pastes an empty shape with the toast. Seam: browser
39. Deleting an artifact asks nothing, leaves its files and chats on disk, and undo restores the shape with its chat tags. Seam: browser
40. Sandbox probe: a page cannot fetch the engine, load an engine file route as an image, navigate top, open a window, read `parent.document` or load a sidecar; a sibling picture loads. Seam: browser
41. Render from the button puts a placeholder video beside the motion at once, shows percentage and message on the render row, and the engine fills the placeholder with the output when done; a failed render removes it. Seam: browser
42. Switching project during a render adds no shape to the new project; the file and the filled placeholder land in the original; an engine restart mid-render removes the placeholder at boot. Seam: browser
43. A failed render shows its error, or `The render failed.`, on the shape. Seam: browser
44. Double-click opens the editor with the three columns, header controls and live frame; Back and Esc close it and restore the camera. Seam: browser
45. Esc typed in the composer or the parameter box does not close the editor; canvas shortcuts are inactive while it is open. Seam: browser
46. An artifact with no file shows the no-file message and no "Open in a new tab"; "Open in a new tab" opens the artifact URL. Seam: browser
47. Deleting the artifact from another tab closes the editor. Seam: browser
48. An artifact that declares dials shows DialKit controls; one that does not shows `No parameters yet.` Seam: browser
49. Dragging a dial updates the frame live and writes `dials` once, 400 ms after the drag stops, as one undo step that Cmd-Z on the canvas reverts after closing. Seam: browser
50. A change made less than 400 ms before closing the editor is saved. Seam: browser
51. Saved values show in canvas frames for both a page and a motion, and a change in one tab reaches the other tab's frame. Seam: browser
52. A new version that drops or retypes a parameter keeps the rest and rebuilds the panel. Seam: browser
53. The add-a-parameter box sends the instruction into the artifact's continuable chat or a new chat tagged with it, opens the rail on it, clears on success, and shows `Connect Claude or Codex first.` with no provider. Seam: browser
54. The four artifact tools are registered on spec 07's MCP server and in its required-tool check: a session missing one fails with spec 07's canvas tools sentence naming it. Seam: engine
55. `preview_open` on a page, `preview_snapshot` returning elements and a PNG, `preview_click` and `preview_evaluate` inside it, the errors for a missing shape and a wrong kind, and the no-Chrome sentence when none is found. The tests need a Chrome on the machine and are skipped, saying so, where there is none. Seam: engine
56. A preview tab loads only preview-origin URLs, is closed when its chat's session closes, and is closed by the project's registry closer. Seam: engine
57. Artifact diffs through the real tools: for a turn that rewrites a page with `page_write` and creates a motion with `motion_write`, spec 08's `getTurnDiff` returns both, the new motion as an added file. Seam: engine
58. Artifact URLs use the other loopback name from the app's own hostname, and in the hosted shape (app on `127.0.0.1` served by the engine) every artifact frame is an out-of-process frame. Seam: browser
59. Only selected (at most three), pinned (at most three, "Keep playing") and editor artifacts have a frame; every other artifact shape shows its snapshot, the hint card, or nothing that runs script. Seam: browser
60. A live frame more than one viewport width off screen unmounts and remounts on return. Seam: browser
61. Snapshots render after a write, a file replacement, a saved dial change and a resize over 10 %, with the saved dials applied, into `.cache/snapshots/`, debounced per shape and one at a time; no Chrome means no snapshot and the hint card. Seam: engine
62. Artifact performance budget: a board with ten pages each running the busy fixture from `assets/perf/` and five motions pans for 4 s in the hosted shape with the median frame gap at or under 16.7 ms, no more than 2 % of frames over 33 ms, and no long task on the canvas thread over 50 ms. The frame-gap and long-task thresholds are enforced by `pnpm test:perf` on real hardware, not on shared CI runners (spec 02's performance budget); the live frame caps are asserted everywhere. Seam: browser

## Out of Scope

- Deleting superseded or orphaned artifact files and their chats (compaction). Nothing deletes them.
- Durable, listed or cancellable renders. Render jobs live in memory.
- Keyframe or curve controls in the parameters column.
- DialKit or any control panel inside an artifact or in a project folder.
- Diffs of page and motion files between turns: spec 08 owns them.
- Preview recording (`preview_recording_start` and `preview_recording_stop`): a motion already renders to MP4, and snapshots at chosen times cover checking one.
- The desktop shell allowing its window to frame the preview origin: a change in the private shell repo.

## Further Notes

- Three kinds of parameter, which the tool descriptions teach and the add-a-parameter instruction repeats: a value nothing animates goes straight to the DOM in the callback; a value the animation is made of is fed into the timeline, which the callback rebuilds from the values (keep the playhead, clear, re-add tweens, seek back); a value that changes over time is its start, its end and a duration as separate controls. GSAP rewrites `transform` on every tweened element each frame, so a DOM write beside a tween holds while the clip is still and is lost the moment it plays.
- The canvas read (spec 07) reports `dials` on an artifact that has them, and spec 07's system prompt tells the agent to carry current values into anything built from an artifact. The file the agent reads back holds the defaults.
- Known HyperFrames quirks, not chased: in the preview a `<video>` clip's `currentTime` may not follow a seek (renders are unaffected); the player may report the timeline's length rather than the root's `data-duration` when shorter (the render uses `data-duration`).
- In the packaged shell, `window.open` from "Open in a new tab" becomes the shell's external-open handler.

**Licences** (list each in the third-party notices):
- HyperFrames (`@hyperframes/core`, `@hyperframes/player`, `@hyperframes/producer`, `@hyperframes/engine`): Apache-2.0. The player and runtime builds are copied into project folders.
- GSAP (`gsap`): the GSAP standard no-charge licence (Webflow), free for commercial use since 3.13. Not MIT or Apache. `gsap.min.js` is copied into project folders, the same standing as any installed dependency.
- DialKit (`dialkit`): MIT. Bundled with the web only, never copied into a project folder.

### Assets this spec needs

- `assets/prompts/dials-contract.md`: the parameters paragraph appended to both write tools. Source: old `server/agentTools.js` `DIALS_CONTRACT`.
- `assets/prompts/dials-timeline.md`: the timeline paragraph appended to `motion_write` only. Source: `server/agentTools.js` `DIALS_TIMELINE`.
- `assets/prompts/preview-tool-descriptions.md`: t3code `apps/server/src/mcp/toolkits/preview/tools.ts` tool descriptions (MIT), rewritten to take `shapeId` instead of URLs and tab ids.
- `assets/prompts/page-write-tool.md`: `page_write` description (followed by the dials contract) and its three argument descriptions (`html`, `shapeId`, `title`). The full description is this file, one space, then `dials-contract.md`. Source: `server/agentTools.js` `ARTIFACTS.page.describeWrite` and the argument describes in `artifactTools`, the old `nodeId` renamed `shapeId`.
- `assets/prompts/motion-write-tool.md`: `motion_write` description, composition contract included (followed by the dials contract, then the timeline paragraph), and argument descriptions. Source: `server/agentTools.js` `ARTIFACTS.motion.describeWrite`.
- `assets/prompts/artifact-read-tools.md`: `page_read` and `motion_read` descriptions and the `shapeId` argument description (the old `nodeId`). Source: `server/agentTools.js` `ARTIFACTS.*.describeRead`.
- `assets/prompts/add-parameter-instruction.md`: the premade add-a-parameter instruction, with placeholders for wanted text, singular or plural, kind and title. Source: `client/src/editor/Dials.jsx` `ASK`.
- A small MP4 fixture for the `ok` stub renderer: `assets/fixtures/render-stub.mp4` (any 1 s clip; none exists in the old repo, the coordinator makes one).
