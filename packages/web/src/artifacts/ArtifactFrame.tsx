import { artifactUrl, type ArtifactKind, type DialsAnnouncement } from "@unframed/domain";
import { useEffect, useRef } from "react";

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
}

const nonEmpty = (dials: Readonly<Record<string, unknown>> | undefined) => dials !== undefined && Object.keys(dials).length > 0;

/** An artifact's URL on the preview origin, under the loopback name the app is not using. */
export const urlOf = (project: string, kind: ArtifactKind, file: string, port: number): string =>
  artifactUrl({ appHostname: window.location.hostname, previewPort: port, project, file, kind });

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
 */
export const ArtifactFrame = ({ project, kind, file, previewPort, dials, interactive, lazy, onAnnounce, onReady }: ArtifactFrameProps) => {
  const frame = useRef<HTMLIFrameElement>(null);
  const url = urlOf(project, kind, file, previewPort);
  const target = new URL(url).origin;
  const saved = useRef(dials);
  saved.current = dials;
  const announce = useRef(onAnnounce);
  announce.current = onAnnounce;

  const post = (message: unknown) => {
    try {
      frame.current?.contentWindow?.postMessage(message, target);
    } catch {
      // A frame mid-navigation has no window to post to.
    }
  };
  // On the canvas the frame also asks for right-clicks, so a selected frame still opens its shape's menu.
  const hello = () => post({ type: "unframed:dials:hello", ...(frame.current && canvasUnder(frame.current) ? { menus: true } : {}) });
  const set = (values: unknown) => post({ type: "unframed:dials:set", values });

  useEffect(() => {
    onReady?.(set);
    hello();
    const onMessage = (event: MessageEvent) => {
      if (!frame.current || event.source !== frame.current.contentWindow) return;
      if (isWheel(event.data)) return zoomCanvas(frame.current, event.data);
      if (isMenu(event.data)) return openShapeMenu(frame.current, event.data);
      const data = event.data as DialsAnnouncement | null;
      if (typeof data !== "object" || data === null || data.type !== "unframed:dials") return;
      if (nonEmpty(saved.current)) set(saved.current);
      announce.current?.(data);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
    // A new file is a fresh document, keyed by the parent.
  }, [url]);

  const serialised = JSON.stringify(dials ?? null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (nonEmpty(dials)) set(dials);
  }, [serialised]);

  return (
    <iframe
      ref={frame}
      className="block size-full border-0 bg-artifact-page"
      data-artifact-frame=""
      title={file}
      src={url}
      sandbox="allow-scripts allow-same-origin"
      referrerPolicy="no-referrer"
      allow=""
      {...(lazy ? { loading: "lazy" as const } : {})}
      data-interactive={interactive ? "true" : undefined}
      style={{ pointerEvents: interactive ? "auto" : "none" }}
      onLoad={hello}
    />
  );
};
