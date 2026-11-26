# Screens in their own process, loaded until far away

## Problem

After Screens learned to load one at a time (`docs/specs/screen-load.md`), panning a ComfyUI board still lagged, and loaded Screens went back to their app's boot splash:

- **Every Screen ran on the canvas thread.** The canvas is served from `127.0.0.1` and so were the Screen proxies. Same site means same renderer process, so every app's JavaScript (a ComfyUI boot is seconds of it) shared one main thread with tldraw. Panning and zooming waited on it.
- **Screens unloaded on small moves.** A Screen stayed loaded only while it was within one viewport width of the view. Zoomed in, that is a short pan. Opening a panel narrows the canvas, which moves the edge, so Screens near it unloaded and booted again.

## Solution

- **Another site, another process.** The canvas loads a Screen from the other loopback name, the rule pages already use: `localhost` when the canvas is on `127.0.0.1`, and the reverse. Chromium's site isolation (on in Electron 44, checked by experiment) then puts every Screen in a renderer process of its own, apart from the canvas. The engine's headless Chrome keeps `127.0.0.1`.
- **Cookies cross the site line.** In a cross-site frame Chromium drops `SameSite=Lax` and `Strict` cookies, so a login inside a Screen would not hold. The proxy rewrites every `Set-Cookie` it passes on: it removes `SameSite` and `Secure` and appends `SameSite=None; Secure`. Chromium accepts `Secure` cookies on `http://localhost` and `http://127.0.0.1`.
- **Loaded until far away.** A Screen loads when it comes within one viewport width of the view, as before, and once loaded stays loaded until it is three viewport widths away. Panning back and forth and opening panels no longer reload it.

## Costs

- Storage moves with the origin. An app's `localStorage` and cookies from before this change stay on the old origin, so each app asks for its login and settings once more.
- `SameSite=Strict` cookies lose their protection inside the proxy. The proxy only answers same-machine requests, so this stays local.
- A frame in its own process costs memory per process. Chromium may group same-site frames into one process.

## Tests

- Browser: a Screen loads from the other loopback host, and a login made inside it (a Lax cookie set on a redirect) holds.
- Browser: a loaded Screen keeps its page (no reload) when the canvas narrows and when it is panned two viewport widths away and back, and unloads past three.
- Domain: cookies are rewritten; `screenUrl` takes a host; `farOffscreen` takes a reach.
