/**
 * The motion viewer (spec 09), `hyperframes-viewer.html`: a page on the preview origin that
 * plays one composition in HyperFrames' player and relays dial and kit (spec 19) messages between the canvas
 * above it and the composition inside it. Opened outside Unframed it relays nothing. With
 * `ui=editor` (spec 21) the editor drives the player through `unframed:player:*` messages, and
 * the runtime's state and timeline come back the same way.
 */

export interface ViewerWindow {
  readonly location: { readonly origin: string; readonly search: string };
  addEventListener(type: "message", listener: (event: { source: unknown; origin: string; data: unknown }) => void): void;
  /** The frame clock the backward shuttle seeks on. */
  requestAnimationFrame?(callback: (now: number) => void): unknown;
}

export interface ViewerRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface ViewerPlayer {
  setAttribute(name: string, value: string): void;
  play?(): void;
  pause?(): void;
  seek?(seconds: number): void;
  playbackRate?: number;
  muted?: boolean;
  rangeStart?: number | null;
  rangeEnd?: number | null;
  loop?: boolean;
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
  // The editor's transport (spec 21): the editor that said player hello controls the player and gets the runtime's last state and timeline.
  let controller: { window: Target; origin: string } | undefined;
  let lastState: Loose | undefined;
  let lastTimeline: Loose | undefined;
  let shuttle: { rate: number; time: number; prev: number | undefined } | undefined;
  let framing = false;
  // Between a drag seek and the next commit, the runtime's states go to the editor as their time only (spec 21, scrub).
  let scrubbing = false;

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

  const playerFrame = (): unknown => player.iframeElement?.contentWindow;
  const toController = (message: Loose): void => {
    if (controller !== undefined) controller.window.postMessage(message, controller.origin);
  };

  // The backward shuttle seeks the player on each animation frame, since the player plays forward only.
  const schedule = (): void => {
    if (framing || shuttle === undefined || win.requestAnimationFrame === undefined) return;
    framing = true;
    win.requestAnimationFrame(step);
  };
  const step = (now: number): void => {
    framing = false;
    if (shuttle === undefined) return;
    const previous = shuttle.prev ?? now;
    shuttle.time = Math.max(0, shuttle.time + shuttle.rate * ((now - previous) / 1000));
    shuttle.prev = now;
    player.seek?.(shuttle.time);
    schedule();
  };
  const startShuttle = (rate: number): void => {
    player.pause?.();
    const base = typeof lastState?.time === "number" ? lastState.time : 0;
    shuttle = { rate, time: shuttle?.time ?? base, prev: undefined };
    schedule();
  };

  // One player control from the editor (spec 21). `seek` lands paused; `root-duration` is the runtime's own control.
  // A `drag` seek (the scrub while the person moves) is cheap: the runtime seeks its own timeline, and the player
  // keeps its play state and media, which its seek would resync. Only the time goes back to the editor.
  const control = (data: Loose): void => {
    if (data.action === "play") {
      shuttle = undefined;
      scrubbing = false;
      player.play?.();
    } else if (data.action === "pause") {
      shuttle = undefined;
      scrubbing = false;
      player.pause?.();
    } else if (data.action === "seek" && typeof data.seconds === "number") {
      const seconds = Math.max(0, data.seconds);
      shuttle = undefined;
      if (data.mode === "drag") {
        scrubbing = true;
        (playerFrame() as Target | undefined)?.postMessage({ source: "hf-parent", type: "control", action: "seek", timeSeconds: seconds, seekMode: "drag" }, own);
        lastState = { ...lastState, time: seconds };
        toController({ type: "unframed:player:state", time: seconds });
        return;
      }
      scrubbing = false;
      player.pause?.();
      player.seek?.(seconds);
    } else if (data.action === "rate" && typeof data.rate === "number" && Number.isFinite(data.rate)) {
      if (data.rate < 0) startShuttle(data.rate);
      else {
        shuttle = undefined;
        player.playbackRate = data.rate;
      }
    } else if (data.action === "mute") {
      player.muted = data.muted === true;
    } else if (data.action === "range") {
      player.rangeStart = typeof data.start === "number" ? data.start : null;
      player.rangeEnd = typeof data.end === "number" ? data.end : null;
      player.loop = data.loop === true;
    } else if (data.action === "root-duration" && typeof data.seconds === "number") {
      (playerFrame() as Target | undefined)?.postMessage({ source: "hf-parent", type: "control", action: "set-root-duration", durationSeconds: data.seconds }, own);
    }
  };

  win.addEventListener("message", (event) => {
    const data = event.data as { type?: unknown } | null;
    if (typeof data !== "object" || data === null) return;
    // The runtime's state and timeline come from the player's own frame only, and go to the editor.
    const runtime = data as Loose;
    if (runtime.source === "hf-preview" && event.source !== undefined && event.source === playerFrame()) {
      if (runtime.type === "state") {
        lastState = { type: "unframed:player:state", time: runtime.currentTime, frame: runtime.frame, playing: runtime.isPlaying, rate: runtime.playbackRate, muted: runtime.muted, ended: runtime.ended };
        toController(scrubbing ? { type: "unframed:player:state", time: runtime.currentTime } : lastState);
      } else if (runtime.type === "timeline") {
        lastTimeline = { type: "unframed:player:timeline", clips: runtime.clips, duration: runtime.durationSeconds, size: { width: runtime.compositionWidth, height: runtime.compositionHeight } };
        toController(lastTimeline);
      }
      return;
    }
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
    // The composition is never a controller or a peer, whether or not it has announced its dials yet.
    if (!LOOPBACK.test(event.origin) || event.source === composition || event.source === playerFrame()) return;
    if (data.type === "unframed:dials:hello") {
      canvas = { window: event.source as Target, origin: event.origin };
      if (announcement !== undefined) canvas.window.postMessage(announcement, canvas.origin);
    } else if (data.type === "unframed:dials:set") {
      const target = composition ?? (player.iframeElement?.contentWindow as Target | undefined);
      target?.postMessage(data, own);
    } else if (type === "unframed:player:hello") {
      controller = { window: event.source as Target, origin: event.origin };
      if (lastTimeline !== undefined) controller.window.postMessage(lastTimeline, controller.origin);
      if (lastState !== undefined) controller.window.postMessage(lastState, controller.origin);
    } else if (type === "unframed:player:control") {
      if (controller !== undefined && event.source === controller.window) control(data as Loose);
    } else if ((data.type === "unframed:tokens:mode" || data.type === "unframed:tokens:set") && event.source === canvas?.window) {
      // Only the canvas that said hello drives the tokens: the kit and the mode come from the app.
      const target = composition ?? (player.iframeElement?.contentWindow as Target | undefined);
      target?.postMessage(data, own);
    } else if (type.startsWith("unframed:edit:")) {
      if (type === "unframed:edit:hello") canvas = { window: event.source as Target, origin: event.origin };
      // Edit mode holds the motion still. The pointer reaches the composition in both modes: Edit picks through the bridge, and
      // Interact is the motion itself (the player's own rule would turn the pointer off, so a click would never reach it).
      if (type === "unframed:edit:mode") {
        if ((data as Loose).mode === "edit") player.pause?.();
        const style = player.iframeElement?.style;
        if (style !== undefined) style.pointerEvents = "auto";
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

/** The viewer page's HTML, as the engine writes it into the motion library. The player is made from script: with `ui=editor` it has no controls and no autoplay, so the editor's transport starts it. */
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
    "<script>",
    "(function (win) {",
    '  var editor = new URLSearchParams(win.location.search).get("ui") === "editor";',
    '  var player = document.createElement("hyperframes-player");',
    '  player.setAttribute("runtime-src", "hyperframes-runtime.js");',
    '  player.setAttribute("muted", "");',
    '  if (!editor) { player.setAttribute("controls", ""); player.setAttribute("autoplay", ""); }',
    "  document.body.appendChild(player);",
    `  (${viewerRelay.toString()})(win, player);`,
    "})(window);",
    "</script>",
    "</body>",
    "</html>",
    "",
  ].join("\n");
