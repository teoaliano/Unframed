import { artifactUrl, defaultDialValues, liveViewerUrl, normaliseDials, type ArtifactKind, type DialsAnnouncement, type Kit } from "@unframed/domain";
import { useEffect, useRef, useState } from "react";
import { previewOriginForWindow } from "./previewOrigin.ts";

export interface ArtifactFrameProps {
  readonly project: string;
  readonly kind: ArtifactKind;
  readonly file: string;
  readonly previewPort: number;
  readonly dials: Readonly<Record<string, unknown>> | undefined;
  readonly kit?: Kit | null | undefined;
  readonly mode?: string | undefined;
  readonly interactive: boolean;
  readonly lazy: boolean;
  readonly onAnnounce?: (announcement: DialsAnnouncement) => void;
  readonly onReady?: (post: (values: unknown) => void) => void;
  readonly editable?: boolean;
  readonly onEdit?: (message: EditMessage) => void;
  readonly onEditReady?: (post: (message: unknown) => void) => void;
  readonly onSwapped?: () => void;
  readonly onPlayer?: (message: unknown) => void;
  readonly onPlayerReady?: (post: (message: unknown) => void) => void;
}

const SWAP_WAIT_MS = 2_000;

export interface EditMessage {
  readonly type: string;
  readonly [key: string]: unknown;
}

const nonEmpty = (dials: Readonly<Record<string, unknown>> | undefined) => dials !== undefined && Object.keys(dials).length > 0;

export const urlOf = (project: string, kind: ArtifactKind, file: string, port: number, editor = false): string =>
  artifactUrl({ appHostname: window.location.hostname, previewPort: port, project, file, kind, editor, previewOrigin: previewOriginForWindow() });

export const outsideUrlOf = (project: string, shapeId: string, kind: ArtifactKind, file: string, port: number): string =>
  liveViewerUrl({ appHostname: window.location.hostname, previewPort: port, project, shapeId, previewOrigin: previewOriginForWindow() }) ?? urlOf(project, kind, file, port);

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

const canvasUnder = (frame: HTMLIFrameElement): Element | null | undefined => frame.closest(".tl-container")?.querySelector(".tl-canvas");

const onScreen = (frame: HTMLIFrameElement, x: number, y: number) => {
  const rect = frame.getBoundingClientRect();
  const scale = frame.offsetWidth > 0 ? rect.width / frame.offsetWidth : 1;
  return { clientX: rect.left + x * scale, clientY: rect.top + y * scale };
};

const openShapeMenu = (frame: HTMLIFrameElement, menu: FrameMenu) => {
  const canvas = canvasUnder(frame);
  if (!canvas) return;
  const at = onScreen(frame, menu.clientX, menu.clientY);
  const init = { bubbles: true, cancelable: true, ...at, button: 2, pointerId: 1, pointerType: "mouse", isPrimary: true };
  canvas.dispatchEvent(new PointerEvent("pointerdown", { ...init, buttons: 2 }));
  canvas.dispatchEvent(new PointerEvent("pointerup", { ...init, buttons: 0 }));
};

export const ArtifactFrame = ({ project, kind, file, previewPort, dials, kit, mode, interactive, lazy, onAnnounce, onReady, editable = false, onEdit, onEditReady, onSwapped, onPlayer, onPlayerReady }: ArtifactFrameProps) => {
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
  const playerMessages = useRef(onPlayer);
  playerMessages.current = onPlayer;
  const scrolled = useRef<{ x: number; y: number } | undefined>(undefined);
  const announcedBy = useRef<string | undefined>(undefined);
  const swappingTo = useRef<string | undefined>(undefined);
  const playhead = useRef<{ time: number; playing: boolean } | undefined>(undefined);

  const post = (frame: HTMLIFrameElement | undefined, message: unknown) => {
    try {
      frame?.contentWindow?.postMessage(message, target);
    } catch {
    }
  };
  const shown = () => frames.current.get(displayedRef.current);
  const postAll = (message: unknown) => frames.current.forEach((frame) => post(frame, message));
  const hello = (frame: HTMLIFrameElement) => {
    post(frame, { type: "unframed:dials:hello", ...(canvasUnder(frame) ? { menus: true } : {}) });
    if (editing.current) post(frame, { type: "unframed:edit:hello" });
    if (editing.current && kind === "motion") post(frame, { type: "unframed:player:hello" });
    post(frame, { type: "unframed:tokens:mode", mode: mode ?? null });
  };
  const set = (values: unknown) => post(shown(), { type: "unframed:dials:set", values });

  useEffect(() => {
    onReady?.(set);
    onEditReady?.((message) => post(shown(), message));
    onPlayerReady?.((message) => post(shown(), message));
    const current = shown();
    if (current) hello(current);
    swappingTo.current = undefined;
  }, [displayed]);

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
      const message = event.data as { type?: unknown; time?: unknown; playing?: unknown } | null;
      if (isShown && typeof message?.type === "string" && message.type.startsWith("unframed:player:")) {
        if (message.type === "unframed:player:state" && typeof message.time === "number") {
          playhead.current = { time: message.time, playing: typeof message.playing === "boolean" ? message.playing : playhead.current?.playing === true };
        }
        playerMessages.current?.(event.data);
        return;
      }
      if (!isShown && editing.current && message?.type === "unframed:player:timeline" && playhead.current !== undefined) {
        post(frame, { type: "unframed:player:control", action: "seek", seconds: playhead.current.time });
        if (playhead.current.playing) post(frame, { type: "unframed:player:control", action: "play" });
        return;
      }
      if (isShown && isEdit(event.data)) return onEditMessage.current?.(event.data);
      if (!isShown && editing.current && isEditReady(event.data)) return swapTo(src);
      const data = event.data as DialsAnnouncement | null;
      if (typeof data !== "object" || data === null || data.type !== "unframed:dials") return;
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
    const declared = heard.current === undefined ? undefined : normaliseDials(heard.current.config);
    if (declared?.ok) set(defaultDialValues(declared.schema));
  }, [serialised]);

  const modeFirst = useRef(true);
  useEffect(() => {
    if (modeFirst.current) {
      modeFirst.current = false;
      return;
    }
    postAll({ type: "unframed:tokens:mode", mode: mode ?? null });
  }, [mode]);

  const kitText = JSON.stringify(kit ?? null);
  const kitFirst = useRef(true);
  useEffect(() => {
    if (kitFirst.current) {
      kitFirst.current = false;
      return;
    }
    postAll({ type: "unframed:tokens:set", kit: kit ? { format: kit.format, name: kit.name, modes: kit.modes, tokens: kit.tokens } : null });
  }, [kitText]);

  const loaded = (src: string) => {
    const frame = frames.current.get(src);
    if (!frame) return;
    hello(frame);
    if (nonEmpty(saved.current)) post(frame, { type: "unframed:dials:set", values: saved.current });
    if (src !== displayedRef.current) window.setTimeout(() => swapTo(src), SWAP_WAIT_MS);
  };

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
            className={showing ? "block size-full border-0 bg-(--canvas-artifact-page)" : "invisible absolute inset-0 block size-full border-0 bg-(--canvas-artifact-page)"}
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
