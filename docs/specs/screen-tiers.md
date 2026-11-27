# Screen tiers: one live Screen, pictures for the rest

## Problem

A Repository's board runs every Screen near the view as a live iframe of the person's app. With the load queue (`screen-load.md`) and Screens in their own process (`screen-process.md`) the canvas no longer freezes while they boot, but a board with many Screens still costs what many running apps cost:

- **Every visible Screen runs its app.** A board of 200 Screens of a page with a spinner mounted 86 iframes at once, and panning it at fit missed a frame in 7 % of frames (p95 33 ms on a 120 Hz display). Each Screen keeps animating, polling and holding memory while nobody looks at it.
- **A duplicate starts from nothing.** A snapshot belongs to one shape id. Duplicating 200 Screens showed 0 pictures 300 ms later: each copy waits for its own load or its own headless capture.
- **Coming back to a board loads it again.** The canvas remounts on a project switch or after the editor tab, and every Screen boots again, one at a time, behind its last snapshot.
- **Zoomed out, a Screen is still a full app.** A Screen 40 pixels wide on screen runs the same page as one filling the window.

## Solution

Only the Screen the person is using runs. Every other Screen shows a picture that costs about what an image costs.

- **One live Screen.** Selecting a Screen (or double-clicking it, or an agent's edit landing on a Screen when nothing else is live) makes it the live Screen. Its iframe mounts behind its picture and is revealed once the app has painted. Escape, a click on empty canvas, or selecting something else demotes it: its iframe stays in view while the bridge takes a fresh capture, and is parked once the Screen shows that capture.
- **Parked, not gone.** Up to three recently live Screens keep their iframe mounted but hidden, so selecting one of them again shows it at once. The oldest is dropped past three. A parked Screen does not animate or update.
- **Frames outlive the canvas.** The few frames the tiers allow live in the project's pool (`screen-frames.md`), not inside the Screen's shape, so a live or parked Screen keeps its page across its editor tab, the way back to the canvas and a project tab switch.
- **The editor tab holds its Screen.** Opening a Screen's editor tab makes it the live Screen and keeps it live until the tab closes.
- **Pictures by size on screen.** A Screen that is tiny on screen shows a 128 pixel wide image, a small one a 384 pixel wide image, and one wider than about 230 css pixels a static copy of its page: the app's DOM and styles, without scripts, in a closed shadow root. Levels change only when the camera stops.
- **Pictures addressed by content.** The engine stores every picture under the hash of its content and serves it as immutable. A Screen records its picture key in its tldraw record, so a duplicate shows the original's picture at once, and opening a board paints every visible Screen's picture from the HTTP cache with no load.
- **Fresh by key, not by invalidation.** The engine knows which picture belongs to which state of which Instance: the Instance, its worktree revision, the route, the Steps and Mocks, the viewport and the Parameters. A copy with the same state reuses the key. A change of code, route or state captures a new picture, and the old one stays on screen until the new one is ready.

## User Stories

1. As a person with a board of hundreds of Screens, I want panning and zooming to stay smooth, so that the board feels like a canvas of images.
2. As a person, I want the Screen I select to become the running app, so that I can click through it on the canvas.
3. As a person, I want a Screen I just used to come back instantly when I select it again, so that switching between a few Screens does not reload them.
4. As a person, I want Screens I am not using to stay still, so that a board is calm and my Mac is quiet.
5. As a person, I want a demoted Screen to keep showing what I last saw in it, so that the board reads as I left it.
6. As a person who duplicates Screens, I want the copies to show their picture at once, so that I can lay out variations without waiting.
7. As a person switching back to a board, I want its Screens to show their pictures straight away, so that I never see a loading board.
8. As a person zooming out, I want small Screens to be cheap images, and zooming in to show a sharp copy of the page, so that the board reads at any zoom.
9. As a person, I want the live app to replace its picture without a flash, so that selecting a Screen feels like it was already running.
10. As a person, I want a Screen I open in its editor tab, or leave behind in another project tab, to come back with no reload, so that the app keeps the state I left it in.
11. As a person whose agent edits the code, I want the Screen it works on to go live when nothing else is, and every picture of that branch to refresh, so that the board shows the new code.
12. As a person, I want dev servers to start only for the Screen I use or for Screens that have never been pictured, so that opening a board does not start every branch.

## Implementation Decisions

### The tier scheduler (domain, `screenTiers.ts`)

- A pure reducer: `reduceTiers(state, event) → state`. Each Screen has a frame state (`none`, `warming`, `live`, `demoting`, `parked`), a picture level (`tiny`, `small`, `page`), a page copy state (`none`, `queued`, `loading`, `built`, `missing`) and whether a capture is wanted. Its tier is what it shows: `live`, `warming`, `demoting` or `parked` from its frame, else `snapshot` when its page copy is built, else `picture`.
- Events: `view` (each Screen's on-screen width in device pixels, whether it is near the view, and its distance from the view's centre), `camera` (moving or still), `activate`, `edited` (an agent's edit landed on the Screen), `deactivate`, `hold` (the Screen's editor tab opened, or closed with no id), `ready`, `loadFailed`, `pageBuilt`, `pageMissing`, `captured`, `captureFailed` and `hidden` (the tab is hidden or shown). A Screen missing from a `view` is forgotten, so a deleted Screen leaves with the next one.
- Budgets: one live Screen, one warming, three parked, four page copies loading at once. `edited` activates only when no Screen is active.
- `hold` activates its Screen and makes the reducer ignore `activate` and `deactivate` until the hold is released. Releasing it leaves the Screen live; the canvas's selection then keeps or parks it.
- `activate` on a parked or demoting Screen makes it live at once. On any other Screen it starts `warming`; the iframe mounts and the picture stays on top. `ready` turns the warming Screen live. A new activation drops a Screen still warming.
- `deactivate` demotes the live Screen: its frame stays shown, a capture is wanted, and it goes to the front of the parked list. Past three, the least recently live loses its frame, so a demoting frame counts against the parked budget.
- A demoting Screen parks on `captureFailed` (which the pool also sends 2.5 seconds after the demotion), or on `captured` once nothing more is pending: a Screen that wants a page copy waits for `pageBuilt` or `pageMissing` of its new picture first.
- A hidden tab drops every parked frame. A demoting frame finishes its capture and parks.
- `view` events wait while the camera moves and apply once it is still. A Screen's level comes from its on-screen width: up to 160 device pixels is `tiny`, up to 230 css pixels is `small`, wider is `page`. Page copies are queued for near Screens at level `page` that have a picture, nearest first, four loading at once. A Screen that leaves the view drops its page copy.
- The reducer keeps each Screen's entry object when nothing about it changed, so the canvas re-renders only the Screens whose tier changed.

### Picture levels on the canvas

- The scheduler's state belongs to the project, one per open project tab, so it outlives the canvas while the editor tab is open or another project tab shows. A mounted canvas sends `view` when the camera becomes still (tldraw's `getCameraState`), when Screens are added, removed or resized, and when the window's pixel ratio changes. Its selection drives `activate` and `deactivate`. The editor tab sends `hold`. The project's pool sends `hidden` on `visibilitychange`, and closing the project tab clears the state.
- A Screen shape reads only its own entry with `useValue`. Nothing in the shape reads the camera, so panning and zooming re-render no Screen. The shape's container has `contain: strict`. The label stays in `ShapeLabel` as today.
- The static layer is an `<img>` of `<key>.w128.png` or `<key>.w384.png`, or, at level `page`, the page copy over the 384 image. While a new key's image loads, the last image the Screen drew at that size stays under it, so a new picture whose rasters are still being drawn never leaves the card empty. Before a Screen has a scheduler entry it uses the level the current zoom gives, once the canvas has placed its camera, so a board's first frame already has its pictures at the right size.
- Page copies are built by one queue per document, nearest first, at most 6 ms of work per animation frame. The prepared copy of a key is shared: one parsed template and one constructed stylesheet per key, cloned into each Screen's closed shadow root, with `@font-face` rules hoisted to the document once, renamed to the copy.
- A Screen with no picture yet shows its branch and route, as today.

### The live frame

- The project's pool (`screen-frames.md`) renders a frame for each live, warming or parked Screen and for nothing else. `useScreenFrame` keeps everything a frame did before (state tokens, Steps, Mocks, navigation following, Parameters, the one retry, the editor tab). The load queue and the reach rules are removed: the scheduler admits one frame at a time.
- The pool lays the frame over the Screen's card, with the frame transparent until the app has painted. The card's static layer is removed when the Screen is live and its page has painted, so the app replaces its picture with no blank frame. While the Screen demotes, the static layer mounts again under the frame, so the new picture is ready when the frame parks. A parked frame's host is hidden and its iframe gets `visibility: hidden`, so Chromium stops painting it and throttles its animation frames.
- The pool asks the bridge for captures: it turns the bridge's watch on while its Screen is live and painted, and takes a final capture when the tiers want one. It sends `captured` once the Screen's record carries the key that capture stored, one animation frame later, and `captureFailed` when the capture fails or 2.5 seconds after the demotion.
- Pointer events reach a live Screen after the double-click delay, while it is selected and the camera is still.

### Capturing the page copy (the bridge)

- `snapshotPage` in `pageSnapshot.ts` serialises the document as inert HTML. It removes scripts, `noscript`, frames, preloads, event handler attributes and `srcset`. It collects every readable stylesheet, keeps `@media` rules that match the page's viewport and drops the rest, writes viewport units as pixels, keeps `@font-face`, and writes the values of form fields as attributes. Images, CSS `url()` references and fonts become numbered parts (`uf-part:N`), fetched by the page itself. Scroll positions are kept as `data-uf-scroll`.
- Canvas elements become images. A canvas that reads as blank (every pixel of a 32 pixel probe black with one alpha) is read again inside the next animation frames, up to 60 frames or one second, and one still blank becomes an image with no source, so the element's own background shows instead of black. Canvas and video pictures keep their `id`, `class`, `style`, size, `role`, `aria-*`, `data-*`, `hidden`, `title` and `slot`, and carry `data-uf-stand-in`. The copy's `canvas` and `video` type selectors become `:is(canvas, img:where([data-uf-stand-in="canvas"]))` and the like, so the page's own rules still place and round the picture, with the same specificity.
- In a framed Screen and in a headless capture, the bridge asks every WebGL context for `preserveDrawingBuffer: true` before the app's scripts run, so a WebGL canvas reads as what it drew. A page opened in a browser tab is left alone.
- Animations are pinned. Each animated property is written inline with `!important`: a paused animation at its current time, a running animation that ends at its end, and a running loop at its most opaque keyframe, or its start when its opacity does not change. The capture seeks each animation to read its values and puts it back in the same task. The copy also stops every animation when it is shown.
- `@property` rules have no effect in a shadow root. When the canvas builds a copy, each one becomes a default in the copy's first cascade layer: non-inheriting properties on every element and pseudo-element of the copy, inheriting ones on its root. Nothing is registered in the canvas document, which has registered properties of its own.
- The bridge serialises the page while its Screen is live: after changes settle (300 ms with no mutation, scroll or input), and at most every 800 ms. It serialises once more when the Screen is demoted. It posts `unframed:snapshot` with the HTML and the parts' bytes. The canvas forwards a copy that differs from the last one to the engine.
- The same function runs in the engine's headless Chrome through `window.__unframedSnapshot()`.

### Storing and serving pictures (the engine)

- `PictureStore` keeps `<project>/.cache/pictures/`: `<key>.html`, `<key>.png`, `<key>.w384.png`, `<key>.w128.png`, `parts/<hash>.<ext>` and `signatures/<hash>` (a state's signature to its key). A part's name is the SHA-256 of its bytes. A picture's key is the SHA-256 of its viewport size and its HTML with its parts resolved, or of its PNG when the page has no bridge, so the same page at another size gets its own rasters. Keys and part names are 40 hex characters.
- `screenSignature` (domain) writes the state a picture shows as canonical JSON: Instance, worktree revision, route, Steps, Mocks, width, height and Parameters. The revision grows each time the Instance's worktree is touched.
- A headless capture ends by writing every file, then the signature, then the Screen's `picture` prop through the canvas room with a system origin, which no undo stack records. A Screen whose signature already has a key gets that key with no capture, which is how a duplicate stays free.
- A live capture writes its parts and HTML, sets the Screen's `picture` at once, and draws its three rasters in the background. A request for a raster still being drawn waits for it. A live capture is not remembered under the Screen's signature: it shows the state the person left, not the state's default, so a copy of the Screen does not inherit it.
- The engine keeps each Screen's latest live picture and the signature it was taken under. A headless render skips a Screen whose picture is still that live capture of the same signature, or whose live capture is in flight, and a headless render that started before a live capture of its Screen landed stores its picture without setting it.
- Headless captures run as today, one at a time, only for Screens of a live Instance, and only when the Screen's signature has no key. Rasters of a live capture come from loading its HTML in headless Chrome with requests answered from the store.
- `GET /api/pictures/<project>/<file>` serves the store with `Cache-Control: private, max-age=31536000, immutable`, an ETag of the hash and `X-Content-Type-Options: nosniff`. Every response carries a Content Security Policy that allows nothing but its own images, fonts and inline styles, inside a sandbox. Names outside the store's patterns answer 404.
- `screens.capture` takes a live capture from the canvas and answers its key once the page is stored. When live captures of one Screen overlap, only the latest one sets its picture. It is refused when the `repositories` flag is off.

### Demand

- A window demands the Instances of its live, warming and parked Screens, and of near Screens with no picture. The pool sends the first, so they stay demanded while their canvas is not shown; the canvas sends the second. The editor tab demands its own Instance as today. The engine's budget, idle stop and one-start-at-a-time rules are unchanged.
- The "Starting N dev servers…" cover over the canvas counts only the Screens in view that have no picture, so a board whose visible Screens are all pictured opens with no cover.

### Measuring

- The `?fps=1` meter's Screen line counts tiers: `screens: live N · warming N · parked N · snapshot N · picture N · replays N · retries N · failed N`.
- `pnpm test:perf` gains a board of 200 Screens of a busy page: pan and zoom at fit and pan zoomed in within the frame budget, Cmd+D of all 200 within budget with every copy pictured, and at most one iframe outside the parked ones.

### Delivery

- Everything sits behind the existing `repositories` flag. With the flag off a Screen shows its picture, from its key or its old snapshot, with no frame, no page copy and no capture.
- Shapes from before this change have no `picture` prop and keep their old snapshot until their next capture.

### Calls made without the person

- A Screen becomes active on a single selection. Selecting several Screens, or anything else, demotes the live one. This keeps "one live" true while the person arranges Screens.
- "An agent's edit lands on a Screen" means its Instance's worktree changed while that Screen is the nearest visible Screen of that Instance; it goes live only if no Screen is active.
- Near Screens with no picture still wake their Instance, so a new board gets its first pictures. Without that, a Screen would show only its branch and route until someone selects it.
- Rasters come from headless Chrome, which already captures Screens. Rasterising in the canvas through SVG `foreignObject` would add main-thread work and taint rules for little gain on a local machine.
- A page copy that fails to parse or has no HTML shows the full PNG at level `page`.
- Fonts are hoisted to the document under a name of their own copy (`uf<n>-<i>`), and the copy's `font-family` values, custom properties, inline styles and SVG `font-family` attributes are rewritten to it. A copy cannot change the fonts of the canvas or of another copy, even when it declares a family the canvas uses, such as `-apple-system`.
- The camera predictor is left for later; levels change on settle.

## Testing

- Tests check what the person sees: which Screens have a frame, which picture a Screen shows, what the engine serves and stores.
- **Domain**: the reducer (activate, warming to live, demoting until the capture lands and the new copy is built, park and LRU with demoting frames counted, capture wanted, page copy budget and order, camera freeze, hidden tab, `edited` only when free, entry identity), the level choice, `screenSignature`, the CSS helpers of `pageSnapshot.ts` (viewport units, `url()` rewriting, root selectors, stand-in selectors, font family names), the blank canvas check, and the WebGL wrapper (framed and headless only, first in the bridge).
- **Engine**: the store names parts and pictures by content; a second Screen with the same signature gets the key without a capture; a changed revision captures again; `/api/pictures` serves immutable files with the strict policy and refuses other names; a headless capture writes HTML with parts and three rasters; `screens.capture` stores a live copy, sets the Screen's key before its rasters exist, and serves the rasters once drawn; a headless render never replaces a live capture that landed during it, and a copy of a Screen does not inherit its live picture; in headless Chrome, a WebGL canvas keeps what it drew, a canvas's picture keeps its rules and attributes, a never-drawn canvas shows its own background, and animations are pinned; `screens.capture` is refused with the flag off.
- **Browser**: selecting Screens keeps at most one live iframe; selecting five in turn leaves one live and three parked; a reselected parked Screen shows its page with no reload; the editor tab makes its Screen live and parked frames survive it and a project tab switch; Escape demotes and captures, with the frame in view until the new picture has landed; a WebGL Screen left with Escape keeps its drawing; a duplicate shows the original's picture at once; switching back to a board shows every visible picture in its first frame; zooming in shows the page copy in a closed shadow root; a copy that declares a font the canvas uses leaves the canvas fonts alone and uses its own; a copy's registered properties keep their defaults and register nothing in the canvas document; the flag off shows pictures and no frame.
- **Performance**: `screenBoardPerformance.spec.ts` in `pnpm test:perf`.

## Out of scope

- Predicting the camera to fetch pictures early.
- Pixel-exact page copies of pages whose stylesheets come from another origin.
- Watching shadow roots, resizes, font loads and pixel-only changes while live (#324), iframes in page copies (#325), and reporting what a copy lost (#326).
- Sharing pictures between projects.
- Keeping the canvas itself mounted across project tabs. Its frames stay in the pool instead.
