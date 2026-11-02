/**
 * The motion viewer (spec 09), `hyperframes-viewer.html`: a page on the preview origin that
 * plays one composition in HyperFrames' player and relays dial and kit (spec 19) messages between the canvas
 * above it and the composition inside it. Opened outside Unframed it relays nothing.
 */

export interface ViewerWindow {
  readonly location: { readonly origin: string; readonly search: string };
  addEventListener(type: "message", listener: (event: { source: unknown; origin: string; data: unknown }) => void): void;
}

export interface ViewerRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface ViewerPlayer {
  setAttribute(name: string, value: string): void;
  pause?(): void;
  readonly iframeElement?: { readonly contentWindow?: unknown; readonly offsetWidth?: number; readonly style?: { pointerEvents: string }; getBoundingClientRect?(): ViewerRect } | null;
}

/**
 * The relay. Self-contained on purpose: the viewer page embeds this function's source text.
 * Edit messages (spec 18) go both ways, and the boxes in them are mapped from the composition's
 * coordinates into the viewer's: scaled by the frame's size and moved by where the frame sits.
 */
export function viewerRelay(win: ViewerWindow, player: ViewerPlayer): void {
  const LOOPBACK = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
  const COMPOSITION = /^[A-Za-z0-9][A-Za-z0-9._-]*\.html?$/;
  type Target = { postMessage(message: unknown, targetOrigin: string): void };
  type Frame = { readonly x: number; readonly y: number; readonly scale: number };
  type Loose = Record<string, unknown>;
  const own = win.location.origin;
  let composition: Target | undefined;
  let announcement: unknown;
  let canvas: { window: Target; origin: string } | undefined;

  const wanted = new URLSearchParams(win.location.search).get("c");
  if (wanted !== null && COMPOSITION.test(wanted)) player.setAttribute("src", wanted);

  const isObject = (value: unknown): value is Loose => typeof value === "object" && value !== null && !Array.isArray(value);

  const frameNow = (): Frame => {
    const element = player.iframeElement;
    const rect = element?.getBoundingClientRect?.();
    if (element === undefined || element === null || rect === undefined) return { x: 0, y: 0, scale: 1 };
    const scale = element.offsetWidth ? rect.width / element.offsetWidth : 1;
    return { x: rect.left, y: rect.top, scale: scale > 0 ? scale : 1 };
  };

  const mapBox = (box: unknown, frame: Frame): unknown => {
    if (!isObject(box) || typeof box.x !== "number" || typeof box.y !== "number") return box;
    return {
      x: box.x * frame.scale + frame.x,
      y: box.y * frame.scale + frame.y,
      w: typeof box.w === "number" ? box.w * frame.scale : box.w,
      h: typeof box.h === "number" ? box.h * frame.scale : box.h,
    };
  };

  // A composition's message on its way to the canvas: every box it carries moves into viewer coordinates.
  const outward = (data: Loose, frame: Frame): Loose => {
    const copy: Loose = { ...data };
    if ("box" in data) copy.box = mapBox(data.box, frame);
    if (isObject(data.boxes)) {
      const boxes: Loose = {};
      for (const key of Object.keys(data.boxes)) boxes[key] = mapBox(data.boxes[key], frame);
      copy.boxes = boxes;
    }
    if (isObject(data.element)) copy.element = { ...data.element, box: mapBox(data.element.box, frame) };
    if (Array.isArray(data.elements)) copy.elements = data.elements.map((item) => (isObject(item) ? { ...item, box: mapBox(item.box, frame) } : item));
    return copy;
  };

  win.addEventListener("message", (event) => {
    const data = event.data as { type?: unknown } | null;
    if (typeof data !== "object" || data === null) return;
    if (data.type === "unframed:dials" && event.origin === own) {
      composition = event.source as Target;
      announcement = data;
      canvas?.window.postMessage(data, canvas.origin);
      return;
    }
    const type = typeof data.type === "string" ? data.type : "";
    if (type.startsWith("unframed:edit:") && event.origin === own) {
      // From the composition, which shares this origin.
      if (canvas !== undefined) canvas.window.postMessage(outward(data as Loose, frameNow()), canvas.origin);
      return;
    }
    if (!LOOPBACK.test(event.origin) || event.source === composition) return;
    if (data.type === "unframed:dials:hello") {
      canvas = { window: event.source as Target, origin: event.origin };
      if (announcement !== undefined) canvas.window.postMessage(announcement, canvas.origin);
    } else if (data.type === "unframed:dials:set") {
      const target = composition ?? (player.iframeElement?.contentWindow as Target | undefined);
      target?.postMessage(data, own);
    } else if ((data.type === "unframed:tokens:mode" || data.type === "unframed:tokens:set") && event.source === canvas?.window) {
      // Only the canvas that said hello drives the tokens: the kit and the mode come from the app.
      const target = composition ?? (player.iframeElement?.contentWindow as Target | undefined);
      target?.postMessage(data, own);
    } else if (type.startsWith("unframed:edit:")) {
      if (type === "unframed:edit:hello") canvas = { window: event.source as Target, origin: event.origin };
      // Edit mode holds the motion still and lets the pointer reach it (the player turns it off); Interact leaves the player as the person left it.
      if (type === "unframed:edit:mode") {
        const editing = (data as Loose).mode === "edit";
        if (editing) player.pause?.();
        const style = player.iframeElement?.style;
        if (style !== undefined) style.pointerEvents = editing ? "auto" : "";
      }
      let message: unknown = data;
      if (type === "unframed:edit:hitTest" && typeof (data as Loose).x === "number" && typeof (data as Loose).y === "number") {
        // The editor's point is in viewer coordinates; the composition's own are the inverse.
        const at = frameNow();
        const point = data as Loose & { x: number; y: number };
        message = { ...point, x: (point.x - at.x) / at.scale, y: (point.y - at.y) / at.scale };
      }
      const target = composition ?? (player.iframeElement?.contentWindow as Target | undefined);
      target?.postMessage(message, own);
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
