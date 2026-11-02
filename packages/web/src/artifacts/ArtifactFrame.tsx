import { artifactUrl, defaultDialValues, liveViewerUrl, normaliseDials, type ArtifactKind, type DialsAnnouncement } from "@unframed/domain";
import { useEffect, useRef, useState } from "react";

export interface ArtifactFrameProps {
  readonly project: string;
  readonly kind: ArtifactKind;
  readonly file: string;
  readonly previewPort: number;
  /** The shape's saved parameter values, sent to the frame whenever it announces and whenever they change. */
  readonly dials: Readonly<Record<string, unknown>> | undefined;
  readonly interactive: boolean;
  /** The canvas loads its frames lazily; the editor's frame is live from the start. */
  readonly lazy: boolean;
  readonly onAnnounce?: (announcement: DialsAnnouncement) => void;
  /** Hands the parent a way to post `unframed:dials:set` to this frame. */
  readonly onReady?: (post: (values: unknown) => void) => void;
  /** The editor's frame: says `unframed:edit:hello` so the edit bridge loads (spec 18). */
  readonly editable?: boolean;
  /** Every `unframed:edit:*` message the frame sends, after the origin and window checks. */
  readonly onEdit?: (message: EditMessage) => void;
  /** Hands the parent a way to post an `unframed:edit:*` message to this frame. */
  readonly onEditReady?: (post: (message: unknown) => void) => void;
  /** Called when a new version takes the shown frame's place without having announced its parameters. */
  readonly onSwapped?: () => void;
}

/** A loading document that has not said ready by now is swapped in anyway (a motion's composition can load late). */
const SWAP_WAIT_MS = 2_000;

/** A message the edit bridge or a motion's viewer sends the editor (spec 18, the protocol table). */
export interface EditMessage {
  readonly type: string;
  readonly [key: string]: unknown;
}

const nonEmpty = (dials: Readonly<Record<string, unknown>> | undefined) => dials !== undefined && Object.keys(dials).length > 0;

/** An artifact's URL on the preview origin, under the loopback name the app is not using. */
export const urlOf = (project: string, kind: ArtifactKind, file: string, port: number, editor = false): string =>
  artifactUrl({ appHostname: window.location.hostname, previewPort: port, project, file, kind, editor });

/**
 * What "Open in a new tab" opens: the shape's live viewer, which follows its newest file and
 * dials, or the file itself for a shape id the viewer cannot be named by.
 */
export const outsideUrlOf = (project: string, shapeId: string, kind: ArtifactKind, file: string, port: number): string =>
  liveViewerUrl({ appHostname: window.location.hostname, previewPort: port, project, shapeId }) ?? urlOf(project, kind, file, port);

interface FrameWheel {
  readonly type: "unframed:wheel";
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly deltaX: number;
  readonly deltaY: number;
  readonly deltaZ: number;
  readonly deltaMode: number;
  readonly clientX: number;
  readonly clientY: number;
}

const isWheel = (data: unknown): data is FrameWheel => typeof data === "object" && data !== null && (data as { type?: unknown }).type === "unframed:wheel";

/**
 * A pinch the frame's bridge kept from zooming the app: replayed on the canvas under the
 * frame, at the same point on screen, so the canvas zooms. In the editor there is no canvas
 * under the frame, and the pinch does nothing.
 */
const zoomCanvas = (frame: HTMLIFrameElement, wheel: FrameWheel) => {
  const canvas = canvasUnder(frame);
  if (!canvas) return;
  canvas.dispatchEvent(
    new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      ...onScreen(frame, wheel.clientX, wheel.clientY),
      deltaX: wheel.deltaX,
      deltaY: wheel.deltaY,
      deltaZ: wheel.deltaZ,
      deltaMode: wheel.deltaMode,
      ctrlKey: wheel.ctrlKey,
      metaKey: wheel.metaKey,
      shiftKey: wheel.shiftKey,
      altKey: wheel.altKey,
    }),
  );
};

interface FrameMenu {
  readonly type: "unframed:contextmenu";
  readonly clientX: number;
  readonly clientY: number;
}

const isEdit = (data: unknown): data is EditMessage =>
  typeof data === "object" && data !== null && typeof (data as { type?: unknown }).type === "string" && (data as { type: string }).type.startsWith("unframed:edit:");

const isScroll = (data: unknown): data is { readonly type: "unframed:edit:scroll"; readonly x: number; readonly y: number } =>
  typeof data === "object" && data !== null && (data as { type?: unknown }).type === "unframed:edit:scroll" && typeof (data as { x?: unknown }).x === "number" && typeof (data as { y?: unknown }).y === "number";

const isEditReady = (data: unknown): boolean => typeof data === "object" && data !== null && (data as { type?: unknown }).type === "unframed:edit:ready";

const isMenu = (data: unknown): data is FrameMenu =>
  typeof data === "object" && data !== null && (data as { type?: unknown }).type === "unframed:contextmenu" && typeof (data as FrameMenu).clientX === "number" && typeof (data as FrameMenu).clientY === "number";

/** The canvas under a frame, when the frame is on the canvas rather than in the editor. */
const canvasUnder = (frame: HTMLIFrameElement): Element | null | undefined => frame.closest(".tl-container")?.querySelector(".tl-canvas");

/** A point in the frame's document, on the app's screen. */
const onScreen = (frame: HTMLIFrameElement, x: number, y: number) => {
  const rect = frame.getBoundingClientRect();
  const scale = frame.offsetWidth > 0 ? rect.width / frame.offsetWidth : 1;
  return { clientX: rect.left + x * scale, clientY: rect.top + y * scale };
};

/**
 * A right-click the frame's bridge kept from the page (a selected frame takes the pointer):
 * replayed on the canvas as the press and release a right-click makes there, so the shape's
 * menu opens at the same point.
 */
const openShapeMenu = (frame: HTMLIFrameElement, menu: FrameMenu) => {
  const canvas = canvasUnder(frame);
  if (!canvas) return;
  const at = onScreen(frame, menu.clientX, menu.clientY);
  const init = { bubbles: true, cancelable: true, ...at, button: 2, pointerId: 1, pointerType: "mouse", isPrimary: true };
  canvas.dispatchEvent(new PointerEvent("pointerdown", { ...init, buttons: 2 }));
  canvas.dispatchEvent(new PointerEvent("pointerup", { ...init, buttons: 0 }));
};

/**
 * An artifact document, framed from the preview origin in a sandbox. It says hello at mount
 * and on load, answers an announcement with the shape's saved values, and sends them again
 * the moment they change. It accepts `unframed:dials` only from its own frame's window.
 *
 * The editor's frame (`editable`) swaps (spec 18, The swap): a new file loads in a second frame,
 * hidden, with the saved dials sent at its load. It takes the shown frame's place once its edit
 * bridge says ready (or after SWAP_WAIT_MS), and the last scroll the shown frame reported goes in
 * its hello first. The shown frame is the only one whose edit messages count, so a loading
 * document's boxes never reach the editor. Other frames show `file` and remount when it changes.
 */
export const ArtifactFrame = ({ project, kind, file, previewPort, dials, interactive, lazy, onAnnounce, onReady, editable = false, onEdit, onEditReady, onSwapped }: ArtifactFrameProps) => {
  const url = urlOf(project, kind, file, previewPort, editable);
  const [shownUrl, setShownUrl] = useState(url);
  const displayed = editable ? shownUrl : url;
  const incoming = editable && url !== shownUrl ? url : undefined;
  const target = new URL(url).origin;
  const frames = useRef(new Map<string, HTMLIFrameElement>());
  const displayedRef = useRef(displayed);
  displayedRef.current = displayed;
  const saved = useRef(dials);
  saved.current = dials;
  const announce = useRef(onAnnounce);
  announce.current = onAnnounce;
  const heard = useRef<DialsAnnouncement | undefined>(undefined);
  const editing = useRef(editable);
  editing.current = editable;
  const onEditMessage = useRef(onEdit);
  onEditMessage.current = onEdit;
  const swapped = useRef(onSwapped);
  swapped.current = onSwapped;
  // The last scroll the shown frame reported, sent to the frame that takes its place.
  const scrolled = useRef<{ x: number; y: number } | undefined>(undefined);
  // The frame whose parameters were announced while it loaded, so the swap knows they are current.
  const announcedBy = useRef<string | undefined>(undefined);
  const swappingTo = useRef<string | undefined>(undefined);
  // The shown motion's playhead, from its player's state (spec 21): a swap seeks the incoming motion to it.
  const playhead = useRef<{ time: number; playing: boolean } | undefined>(undefined);

  const post = (frame: HTMLIFrameElement | undefined, message: unknown) => {
    try {
      frame?.contentWindow?.postMessage(message, target);
    } catch {
      // A frame mid-navigation has no window to post to.
    }
  };
  const shown = () => frames.current.get(displayedRef.current);
  // On the canvas the frame also asks for right-clicks, so a selected frame still opens its shape's menu.
  const hello = (frame: HTMLIFrameElement) => {
    post(frame, { type: "unframed:dials:hello", ...(canvasUnder(frame) ? { menus: true } : {}) });
    // The edit bridge loads on this hello (spec 18). Canvas frames never say it, so they carry no edit code.
    if (editing.current) post(frame, { type: "unframed:edit:hello" });
    // A motion's editor frame also takes the player's transport (spec 21).
    if (editing.current && kind === "motion") post(frame, { type: "unframed:player:hello" });
  };
  const set = (values: unknown) => post(shown(), { type: "unframed:dials:set", values });

  // The parent's ways to post follow the shown frame, so a swap re-points them.
  useEffect(() => {
    onReady?.(set);
    onEditReady?.((message) => post(shown(), message));
    const current = shown();
    if (current) hello(current);
    swappingTo.current = undefined;
    // Only the shown frame is re-pointed: the swap is the one change of frame.
  }, [displayed]);

  // The swap: the loading frame gets the shown frame's last scroll in its hello, then takes its place.
  const swapTo = (src: string) => {
    const frame = frames.current.get(src);
    if (!frame || src === displayedRef.current || swappingTo.current === src) return;
    swappingTo.current = src;
    if (scrolled.current !== undefined) post(frame, { type: "unframed:edit:hello", scroll: scrolled.current });
    if (announcedBy.current !== src) swapped.current?.();
    setShownUrl(src);
  };

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const found = [...frames.current].find(([, frame]) => frame.contentWindow === event.source);
      if (!found) return;
      const [src, frame] = found;
      const isShown = src === displayedRef.current;
      if (isShown && isWheel(event.data)) return zoomCanvas(frame, event.data);
      if (isShown && isMenu(event.data)) return openShapeMenu(frame, event.data);
      if (isShown && isScroll(event.data)) {
        scrolled.current = { x: event.data.x, y: event.data.y };
        return;
      }
      const player = event.data as { type?: unknown; time?: unknown; playing?: unknown } | null;
      if (isShown && player?.type === "unframed:player:state" && typeof player.time === "number") {
        playhead.current = { time: player.time, playing: player.playing === true };
        return;
      }
      if (!isShown && editing.current && player?.type === "unframed:player:timeline" && playhead.current !== undefined) {
        // The swap keeps the playhead: the incoming motion goes to the time the shown one was at (spec 21).
        post(frame, { type: "unframed:player:control", action: "seek", seconds: playhead.current.time });
        if (playhead.current.playing) post(frame, { type: "unframed:player:control", action: "play" });
        return;
      }
      if (isShown && isEdit(event.data)) return onEditMessage.current?.(event.data);
      if (!isShown && editing.current && isEditReady(event.data)) return swapTo(src);
      const data = event.data as DialsAnnouncement | null;
      if (typeof data !== "object" || data === null || data.type !== "unframed:dials") return;
      // A loading frame announces too, so the parameters it declares are known when it is swapped in.
      if (!isShown) announcedBy.current = src;
      heard.current = data;
      if (nonEmpty(saved.current)) post(frame, { type: "unframed:dials:set", values: saved.current });
      announce.current?.(data);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const serialised = JSON.stringify(dials ?? null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (nonEmpty(dials)) {
      set(dials);
      return;
    }
    // Cleared, by an undo of the first change: back to the defaults the artifact declared.
    const declared = heard.current === undefined ? undefined : normaliseDials(heard.current.config);
    if (declared?.ok) set(defaultDialValues(declared.schema));
  }, [serialised]);

  // A frame's load: say hello and send the saved dials. A loading frame is swapped in once its bridge says ready.
  const loaded = (src: string) => {
    const frame = frames.current.get(src);
    if (!frame) return;
    hello(frame);
    if (nonEmpty(saved.current)) post(frame, { type: "unframed:dials:set", values: saved.current });
    if (src !== displayedRef.current) window.setTimeout(() => swapTo(src), SWAP_WAIT_MS);
  };

  // The shown frame comes last in the stack's order only when nothing is loading: a loading one is hidden behind it.
  const stack = incoming === undefined ? [displayed] : [displayed, incoming];
  return (
    <>
      {stack.map((src) => {
        const showing = src === displayed;
        return (
          <iframe
            key={src}
            ref={(frame) => {
              if (frame) frames.current.set(src, frame);
              else frames.current.delete(src);
            }}
            className={showing ? "block size-full border-0 bg-artifact-page" : "invisible absolute inset-0 block size-full border-0 bg-artifact-page"}
            {...(showing ? { "data-artifact-frame": "" } : { "data-artifact-frame-incoming": "" })}
            title={file}
            src={src}
            sandbox="allow-scripts allow-same-origin"
            referrerPolicy="no-referrer"
            allow=""
            {...(lazy ? { loading: "lazy" as const } : {})}
            data-interactive={interactive && showing ? "true" : undefined}
            style={{ pointerEvents: interactive && showing ? "auto" : "none" }}
            onLoad={() => loaded(src)}
          />
        );
      })}
    </>
  );
};
