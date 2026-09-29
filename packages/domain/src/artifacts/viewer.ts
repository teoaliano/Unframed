/**
 * The motion viewer (spec 09), `hyperframes-viewer.html`: a page on the preview origin that
 * plays one composition in HyperFrames' player and relays dial messages between the canvas
 * above it and the composition inside it. Opened outside Unframed it relays nothing.
 */

export interface ViewerWindow {
  readonly location: { readonly origin: string; readonly search: string };
  addEventListener(type: "message", listener: (event: { source: unknown; origin: string; data: unknown }) => void): void;
}

export interface ViewerPlayer {
  setAttribute(name: string, value: string): void;
  readonly iframeElement?: { readonly contentWindow?: unknown } | null;
}

/** The relay. Self-contained on purpose: the viewer page embeds this function's source text. */
export function viewerRelay(win: ViewerWindow, player: ViewerPlayer): void {
  const LOOPBACK = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
  const COMPOSITION = /^[A-Za-z0-9][A-Za-z0-9._-]*\.html?$/;
  type Target = { postMessage(message: unknown, targetOrigin: string): void };
  const own = win.location.origin;
  let composition: Target | undefined;
  let announcement: unknown;
  let canvas: { window: Target; origin: string } | undefined;

  const wanted = new URLSearchParams(win.location.search).get("c");
  if (wanted !== null && COMPOSITION.test(wanted)) player.setAttribute("src", wanted);

  win.addEventListener("message", (event) => {
    const data = event.data as { type?: unknown } | null;
    if (typeof data !== "object" || data === null) return;
    if (data.type === "unframed:dials" && event.origin === own) {
      composition = event.source as Target;
      announcement = data;
      canvas?.window.postMessage(data, canvas.origin);
      return;
    }
    if (!LOOPBACK.test(event.origin) || event.source === composition) return;
    if (data.type === "unframed:dials:hello") {
      canvas = { window: event.source as Target, origin: event.origin };
      if (announcement !== undefined) canvas.window.postMessage(announcement, canvas.origin);
    } else if (data.type === "unframed:dials:set") {
      const target = composition ?? (player.iframeElement?.contentWindow as Target | undefined);
      target?.postMessage(data, own);
    }
  });
}

/** The viewer page's HTML, as the engine writes it into the motion library. */
export const viewerPageSource = (): string =>
  [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    "<title>motion</title>",
    "<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}hyperframes-player{display:block;width:100%;height:100%}</style>",
    '<script src="hyperframes-player.js"></script>',
    "</head>",
    "<body>",
    '<hyperframes-player runtime-src="hyperframes-runtime.js" controls muted autoplay></hyperframes-player>',
    "<script>",
    `(${viewerRelay.toString()})(window, document.querySelector("hyperframes-player"));`,
    "</script>",
    "</body>",
    "</html>",
    "",
  ].join("\n");
