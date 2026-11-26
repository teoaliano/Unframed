# Screens in their own process

## Problem

After Screens learned to load one at a time (`docs/specs/screen-load.md`), panning a ComfyUI board still lagged, and loaded Screens went back to their app's boot splash:

- **Every Screen ran on the canvas thread.** The canvas is served from `127.0.0.1` and so were the Screen proxies. Same site means same renderer process, so every app's JavaScript (a ComfyUI boot is seconds of it) shared one main thread with tldraw. Panning and zooming waited on it.
- **Screens unloaded on small moves.** A Screen stayed loaded only while it was within one viewport width of the view. Zoomed in, that is a short pan. Opening a panel narrows the canvas, which moves the edge, so Screens near it unloaded and booted again.

## Solution

- **Another site, another process.** The canvas loads a Screen from the other loopback name, the rule pages already use: `localhost` when the canvas is on `127.0.0.1`, and the reverse. Chromium's site isolation (on in Electron 44, checked by experiment) then puts every Screen in a renderer process of its own, apart from the canvas. The engine's headless Chrome keeps `127.0.0.1`.
- **Cookies cross the site line.** In a cross-site frame Chromium drops `SameSite=Lax` and `Strict` cookies, so a login inside a Screen would not hold. The proxy rewrites every `Set-Cookie` it passes on: it removes `SameSite` and `Secure` and appends `SameSite=None; Secure`. The bridge script does the same to every cookie the page writes through `document.cookie`. Chromium accepts `Secure` cookies on `http://localhost` and `http://127.0.0.1`.
- **Lax, kept by the proxy.** With every cookie `SameSite=None`, a page on any site could post to the dev app with its session, for example after "Open in browser". On an unsafe request (not GET, HEAD or OPTIONS) whose `Sec-Fetch-Site` is `cross-site` and whose Origin is not a loopback origin, the proxy drops every cookie except those the app last set as `SameSite=None` itself, which is what the app's own attributes would have done. A sign-in that posts back from its provider (`form_post`) keeps its state cookie. The proxy remembers those names while it runs; after a restart it drops them too until the app sets them again.
- **Both loopback addresses.** The proxy listens on `::1` as well as `127.0.0.1`, at the same port, like the preview origin, so `localhost` reaches it whichever address the browser tries first.
- **Loaded once.** Screens no longer unload when they go far off screen. See `docs/specs/screen-frames.md`.
- "Open in browser" uses the same host as the Screen.

## Costs

- Storage moves with the origin. An app's `localStorage` and cookies from before this change stay on the old origin, so each app asks for its login and settings once more.
- `SameSite=Strict` cookies become Lax-like: the proxy drops them only from unsafe cross-site requests. Cross-site GET requests and frames from other sites carry the session, which `Lax` would have stopped. The proxy already strips `X-Frame-Options`.
- Cookies written with the Cookie Store API (`cookieStore.set`) are not rewritten.
- A frame in its own process costs memory per process. Chromium may group same-site frames into one process.

## Tests

- Browser: a Screen loads from the other loopback host, and a login made inside it (a Lax cookie set on a redirect) holds.
- Domain: cookies are rewritten, in headers and through `document.cookie`; an unsafe cross-site request loses its cookies; `screenUrl` takes a host.
- Engine: the proxy answers on `[::1]` at its port.
