import { DRAWER_MAX_WIDTH, DRAWER_MIN_WIDTH, DRAWER_WIDTH, drawerWidth } from "@unframed/domain";
import { useCallback, useEffect, useState, type PointerEvent as ReactPointerEvent } from "react";
import { cn } from "~/lib/utils";

const KEY_STEP = 16;

const widthOf = (cssVar: string): number => {
  const read = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(cssVar));
  return Number.isFinite(read) ? read : DRAWER_WIDTH;
};

const setWidth = (cssVar: string, want: number): number => {
  const next = drawerWidth(want, window.innerWidth);
  document.documentElement.style.setProperty(cssVar, `${next}px`);
  return next;
};

export const useDrawerWidth = (cssVar: string, saved: number | undefined) => {
  useEffect(() => {
    const apply = () => setWidth(cssVar, saved ?? DRAWER_WIDTH);
    apply();
    window.addEventListener("resize", apply);
    return () => window.removeEventListener("resize", apply);
  }, [cssVar, saved]);
};

export const DrawerGrip = ({
  edge,
  label,
  cssVar,
  onCommit,
}: {
  readonly edge: "left" | "right";
  readonly label: string;
  readonly cssVar: string;
  readonly onCommit: (width: number) => void;
}) => {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [now, setNow] = useState(DRAWER_WIDTH);
  const grow = edge === "right" ? 1 : -1;
  const commit = useCallback(
    (want: number) => {
      const next = setWidth(cssVar, want);
      setNow(next);
      onCommit(next);
    },
    [cssVar, onCommit],
  );

  useEffect(() => {
    setNow(widthOf(cssVar));
  }, [cssVar]);

  useEffect(() => {
    if (!element) return;
    const onKey = (event: KeyboardEvent) => {
      const step = event.key === "ArrowRight" ? KEY_STEP : event.key === "ArrowLeft" ? -KEY_STEP : 0;
      if (step === 0) return;
      event.preventDefault();
      event.stopPropagation();
      commit(widthOf(cssVar) + grow * step);
    };
    element.addEventListener("keydown", onKey);
    return () => element.removeEventListener("keydown", onKey);
  }, [element, commit, cssVar, grow]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (event.button !== 0) return;
    event.preventDefault();
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const start = widthOf(cssVar);
    const from = event.clientX;
    target.dataset.dragging = "";
    const onMove = (next: PointerEvent) => setNow(setWidth(cssVar, start + grow * (next.clientX - from)));
    const onEnd = () => {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onEnd);
      target.removeEventListener("pointercancel", onEnd);
      target.removeEventListener("lostpointercapture", onEnd);
      delete target.dataset.dragging;
      commit(widthOf(cssVar));
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onEnd);
    target.addEventListener("pointercancel", onEnd);
    target.addEventListener("lostpointercapture", onEnd);
  };

  return (
    <div
      ref={setElement}
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={DRAWER_MIN_WIDTH}
      aria-valuemax={DRAWER_MAX_WIDTH}
      aria-valuenow={now}
      aria-keyshortcuts="ArrowLeft ArrowRight"
      tabIndex={0}
      data-drawer-grip={edge}
      className={cn(
        "absolute inset-y-0 z-10 w-1.5 cursor-ew-resize touch-none outline-none after:absolute after:inset-y-0 after:left-0.5 after:w-px after:bg-transparent after:transition-colors after:duration-150 hover:after:bg-(--drawer-grip-indicator-hover) focus-visible:after:bg-(--drawer-grip-indicator-focus) data-[dragging]:after:bg-(--drawer-grip-indicator-dragging)",
        edge === "right" ? "-right-0.5" : "-left-0.5",
      )}
      onPointerDown={onPointerDown}
      onDoubleClick={(event) => {
        event.stopPropagation();
        commit(DRAWER_WIDTH);
      }}
    />
  );
};
