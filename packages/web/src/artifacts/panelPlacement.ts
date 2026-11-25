import { keepPanelOnScreen, PANEL_MARGIN, PARAMETERS_PANEL_LIMITS, panelSize, resizePanel, type PanelEdge, type PanelLimits, type PanelPrefs, type PanelRoom } from "@unframed/domain";
import { useLayoutEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import type { Editor } from "tldraw";
import { TOP_BAR_HEIGHT } from "~/components/ui/top-bar";
import { canvasRoom } from "../generate/floating.ts";

const KEY_STEP = 16;
const MIN_SHOWN_HEIGHT = 120;

const ARROWS: Readonly<Record<string, readonly [number, number]>> = {
  ArrowLeft: [-KEY_STEP, 0],
  ArrowRight: [KEY_STEP, 0],
  ArrowUp: [0, -KEY_STEP],
  ArrowDown: [0, KEY_STEP],
};

interface Floating {
  x: number;
  y: number;
  w: number;
  h: number | undefined;
}

const roomOf = (editor: Editor): PanelRoom => {
  const canvas = canvasRoom(editor);
  return { x: 0, y: TOP_BAR_HEIGHT, w: canvas.w, h: Math.max(0, canvas.h - TOP_BAR_HEIGHT) };
};

export const useFloatingPlacement = ({
  editor,
  element,
  firstPlace,
  floating: on,
  prefs,
  save,
  limits = PARAMETERS_PANEL_LIMITS,
}: {
  readonly editor: Editor;
  readonly element: HTMLElement | null;
  readonly firstPlace: (size: { readonly w: number; readonly h: number }) => { readonly left: number; readonly top: number };
  readonly floating: boolean;
  readonly prefs: PanelPrefs | undefined;
  readonly save: (next: PanelPrefs) => void;
  readonly limits?: PanelLimits;
}) => {
  const box = useRef<Floating | undefined>(undefined);
  const prefsNow = useRef(prefs);
  prefsNow.current = prefs;
  const saveNow = useRef(save);
  saveNow.current = save;
  const placeNow = useRef(firstPlace);
  placeNow.current = firstPlace;

  const paint = () => {
    const current = box.current;
    if (!element || !current) return;
    const room = roomOf(editor);
    element.style.transform = `translate(${current.x}px, ${current.y}px)`;
    element.style.width = `${current.w}px`;
    element.style.height = current.h === undefined ? "" : `${current.h}px`;
    element.style.maxHeight = `${Math.max(MIN_SHOWN_HEIGHT, room.y + room.h - PANEL_MARGIN - current.y)}px`;
    element.style.visibility = "visible";
  };

  const settle = (next: Floating): Floating => {
    const room = roomOf(editor);
    const size = panelSize({ w: next.w, h: next.h }, room, limits);
    const shown = { w: size.w, h: size.h ?? Math.min(element?.offsetHeight ?? 0, room.h - 2 * PANEL_MARGIN) };
    return { ...keepPanelOnScreen(next, shown, room), w: size.w, h: size.h };
  };

  const remember = (next: Floating) => {
    const dockW = prefsNow.current?.dockW;
    const place: PanelPrefs = { mode: "float", x: next.x, y: next.y, w: next.w, ...(dockW === undefined ? {} : { dockW }) };
    saveNow.current(next.h === undefined ? place : { ...place, h: next.h });
  };

  useLayoutEffect(() => {
    const saved = prefsNow.current;
    if (!on || !element || !saved) return;
    const room = roomOf(editor);
    const size = panelSize({ w: saved.w, h: saved.h }, room, limits);
    element.style.width = `${size.w}px`;
    element.style.height = size.h === undefined ? "" : `${size.h}px`;
    if (saved.x === undefined || saved.y === undefined) {
      const beside = placeNow.current({ w: size.w, h: element.offsetHeight });
      box.current = settle({ x: beside.left, y: beside.top, w: size.w, h: size.h });
      remember(box.current);
    } else {
      box.current = settle({ x: saved.x, y: saved.y, w: size.w, h: size.h });
    }
    paint();
    const observer = new ResizeObserver(() => {
      if (!box.current) return;
      editor.updateViewportScreenBounds(editor.getContainer());
      box.current = settle(box.current);
      paint();
    });
    observer.observe(editor.getContainer());
    return () => {
      observer.disconnect();
      box.current = undefined;
      for (const property of ["transform", "width", "height", "max-height", "visibility"]) element.style.removeProperty(property);
    };
  }, [editor, element, on]);

  const track = (event: ReactPointerEvent<HTMLElement>, move: (start: Floating, dx: number, dy: number) => Floating) => {
    const current = box.current;
    if (event.button !== 0 || !current || !element) return;
    event.preventDefault();
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const start = { ...current, h: current.h ?? element.offsetHeight };
    const from = { x: event.clientX, y: event.clientY };
    const onMove = (next: PointerEvent) => {
      box.current = settle(move(start, next.clientX - from.x, next.clientY - from.y));
      paint();
    };
    const onEnd = () => {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onEnd);
      target.removeEventListener("pointercancel", onEnd);
      target.removeEventListener("lostpointercapture", onEnd);
      if (box.current) remember(box.current);
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onEnd);
    target.addEventListener("pointercancel", onEnd);
    target.addEventListener("lostpointercapture", onEnd);
  };

  const startMove = (event: ReactPointerEvent<HTMLElement>) => {
    const keep = box.current?.h;
    track(event, (start, dx, dy) => ({ ...start, x: start.x + dx, y: start.y + dy, h: keep }));
  };

  const startResize = (event: ReactPointerEvent<HTMLElement>, edge: PanelEdge) =>
    track(event, (start, dx, dy) => resizePanel({ ...start, h: start.h ?? 0 }, edge, dx, dy, roomOf(editor), limits));

  const nudge = (key: string, kind: "move" | "resize"): boolean => {
    const step = ARROWS[key];
    const current = box.current;
    if (step === undefined || !current || !element) return false;
    const [dx, dy] = step;
    box.current = settle(
      kind === "move" ? { ...current, x: current.x + dx, y: current.y + dy } : resizePanel({ ...current, h: current.h ?? element.offsetHeight }, "se", dx, dy, roomOf(editor), limits),
    );
    paint();
    remember(box.current);
    return true;
  };

  return { startMove, startResize, nudge };
};
