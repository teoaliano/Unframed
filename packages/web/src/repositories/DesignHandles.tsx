import {
  cursorOf,
  distanceBetween,
  gapFromDrag,
  handlesOf,
  paddingFromDrag,
  radiusFromDrag,
  radiusHandleAt,
  RADIUS_REACH,
  resizeFromDrag,
  snapToken,
  type Corner,
  type EditBox,
  type LayoutOf,
  type ResizeHandle,
  type Side,
  type SnappedToken,
  type TokenScale,
} from "@unframed/domain";
import { useState, type PointerEvent as ReactPointerEvent } from "react";
import { useValue, type Atom } from "tldraw";
import type { EditReport, EditSession } from "../artifacts/editor/editSession.ts";
import { isFlexLike, mainAxis, type ElementLayout } from "./designLayout.ts";
import { Chip, Pinned, placed, ring } from "./DesignOverlay.tsx";

const SIDES: readonly Side[] = ["top", "right", "bottom", "left"];
const CORNERS: readonly Corner[] = ["nw", "ne", "se", "sw"];
const CURSOR: Readonly<Record<string, string>> = {
  "ew-resize": "cursor-ew-resize",
  "ns-resize": "cursor-ns-resize",
  "nwse-resize": "cursor-nwse-resize",
  "nesw-resize": "cursor-nesw-resize",
  default: "cursor-default",
};

const rounded = (value: number): string => String(Math.round(value * 10) / 10);

const valued = (value: number, token: SnappedToken | undefined): string => (token === undefined ? rounded(value) : `${rounded(value)} · ${token.label}`);

export const layoutFor = (layout: ElementLayout, box: EditBox, report: EditReport | undefined): LayoutOf => {
  const direction = mainAxis(layout);
  const [top, right, bottom, left] = layout.padding;
  return {
    box,
    display: layout.display,
    direction,
    padding: { top, right, bottom, left },
    gap: direction === "row" ? layout.gap.column : layout.gap.row,
    radius: Math.max(...layout.radius),
    text: report?.text !== null && report?.text !== undefined,
    children: layout.children.map((child) => child.box),
  };
};

type Gesture =
  | { readonly kind: "padding"; readonly side: Side }
  | { readonly kind: "gap" }
  | { readonly kind: "resize"; readonly handle: ResizeHandle }
  | { readonly kind: "radius"; readonly corner: Corner };

interface Active {
  readonly gesture: Gesture;
  readonly pointer: number;
  readonly from: { readonly x: number; readonly y: number };
  readonly scale: number;
  readonly layout: LayoutOf;
  readonly chip: string;
  readonly at: { readonly x: number; readonly y: number };
}

const hostScale = (element: Element): number => {
  const host = element.closest<HTMLElement>("[data-screen-of]");
  if (host === null || host.offsetWidth === 0) return 1;
  return host.getBoundingClientRect().width / host.offsetWidth;
};

const cornerPoint = (box: EditBox, corner: Corner) => ({ x: corner === "nw" || corner === "sw" ? box.x : box.x + box.w, y: corner === "nw" || corner === "ne" ? box.y : box.y + box.h });

const handleOf = (side: Side): ResizeHandle => ({ kind: "edge", side });

export interface HandleProps {
  readonly session: EditSession;
  readonly id: string;
  readonly box: EditBox;
  readonly layout: ElementLayout;
  readonly report: EditReport | undefined;
  readonly tokens: TokenScale;
  readonly pointer: Atom<{ readonly x: number; readonly y: number } | null>;
  readonly onResize: (text: string | null) => void;
}

export const DesignHandles = ({ session, id, box, layout, report, tokens, pointer, onResize }: HandleProps) => {
  const [active, setActive] = useState<Active | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const shape = active?.layout ?? layoutFor(layout, box, report);
  const handles = handlesOf(layoutFor(layout, box, report));
  const container = isFlexLike(layout.display);
  const near = useValue(
    "design radius corner",
    () => {
      const at = pointer.get();
      if (at === null || !handles.radius) return null;
      return CORNERS.find((corner) => {
        const point = cornerPoint(box, corner);
        return Math.abs(at.x - point.x) <= RADIUS_REACH && Math.abs(at.y - point.y) <= RADIUS_REACH && at.x >= box.x && at.x <= box.x + box.w && at.y >= box.y && at.y <= box.y + box.h;
      }) ?? null;
    },
    [pointer, box.x, box.y, box.w, box.h, handles.radius],
  );

  const apply = (gesture: Gesture, start: LayoutOf, delta: { readonly x: number; readonly y: number }): { chip: string; at: { x: number; y: number } } => {
    if (gesture.kind === "padding") {
      const property = `padding-${gesture.side}`;
      const px = paddingFromDrag(gesture.side, start.padding[gesture.side], delta);
      const token = snapToken(tokens, property, px);
      const value = token?.px ?? px;
      session.patch({ type: "style", elementId: id, property, value: `${value}px` }, token);
      const bar = handlesOf(start).padding.find((each) => each.side === gesture.side);
      return { chip: valued(value, token), at: bar === undefined ? { x: start.box.x, y: start.box.y } : { x: bar.box.x + bar.box.w / 2, y: bar.box.y + bar.box.h / 2 } };
    }
    if (gesture.kind === "gap") {
      const px = gapFromDrag(start.direction, start.gap, delta);
      const token = snapToken(tokens, "gap", px);
      const value = token?.px ?? px;
      session.patch({ type: "style", elementId: id, property: "gap", value: `${value}px` }, token);
      const bar = handlesOf(start).gaps[0];
      return { chip: valued(value, token), at: bar === undefined ? { x: start.box.x, y: start.box.y } : { x: bar.box.x + bar.box.w / 2, y: bar.box.y + bar.box.h / 2 } };
    }
    if (gesture.kind === "radius") {
      const px = radiusFromDrag(gesture.corner, start.radius, start.box, delta);
      const token = snapToken(tokens, "border-radius", px);
      const value = token?.px ?? px;
      session.patch({ type: "style", elementId: id, property: "border-radius", value: `${value}px` }, token);
      const point = radiusHandleAt(start, gesture.corner);
      return { chip: `Radius ${rounded(value)}`, at: point };
    }
    const next = resizeFromDrag(gesture.handle, start.box, delta);
    const sides = gesture.handle.kind === "edge" ? [gesture.handle.side] : [];
    const width = gesture.handle.kind === "corner" || sides.includes("left") || sides.includes("right");
    const height = gesture.handle.kind === "corner" || sides.includes("top") || sides.includes("bottom");
    const wToken = width ? snapToken(tokens, "width", next.w) : undefined;
    const hToken = height ? snapToken(tokens, "height", next.h) : undefined;
    const w = wToken?.px ?? next.w;
    const h = hToken?.px ?? next.h;
    if (width) session.patch({ type: "style", elementId: id, property: "width", value: `${w}px` }, wToken);
    if (height) session.patch({ type: "style", elementId: id, property: "height", value: `${h}px` }, hToken);
    return { chip: `${width ? valued(w, wToken) : rounded(start.box.w)} × ${height ? valued(h, hToken) : rounded(start.box.h)}`, at: { x: start.box.x + start.box.w / 2, y: start.box.y + start.box.h } };
  };

  const begin = (gesture: Gesture) => (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const start = layoutFor(layout, box, report);
    setActive({ gesture, pointer: event.pointerId, from: { x: event.clientX, y: event.clientY }, scale: hostScale(event.currentTarget), layout: start, chip: "", at: { x: start.box.x, y: start.box.y } });
  };
  const move = (event: ReactPointerEvent<HTMLElement>) => {
    if (active === null || event.pointerId !== active.pointer) return;
    const delta = { x: (event.clientX - active.from.x) / active.scale, y: (event.clientY - active.from.y) / active.scale };
    if (Math.abs(delta.x) + Math.abs(delta.y) < 0.5 && active.chip === "") return;
    const shown = apply(active.gesture, active.layout, delta);
    setActive({ ...active, chip: shown.chip, at: shown.at });
    if (active.gesture.kind === "resize") onResize(shown.chip);
  };
  const end = (event: ReactPointerEvent<HTMLElement>) => {
    if (active === null || event.pointerId !== active.pointer) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setActive(null);
    setOver(null);
    onResize(null);
  };
  const drag = (gesture: Gesture, key: string) => ({
    onPointerDown: begin(gesture),
    onPointerMove: move,
    onPointerUp: end,
    onPointerCancel: end,
    onPointerEnter: () => setOver(key),
    onPointerLeave: () => setOver((current) => (current === key ? null : current)),
  });

  const activeKind = active?.gesture.kind;
  const tintSide = active?.gesture.kind === "padding" ? active.gesture.side : over?.startsWith("padding:") === true ? (over.slice(8) as Side) : null;
  const hatched = activeKind === "gap" || over?.startsWith("gap:") === true;
  const shown = handlesOf(shape);
  const activeCursor =
    active === null
      ? ""
      : CURSOR[
          cursorOf(
            active.gesture.kind === "padding"
              ? { kind: "padding", side: active.gesture.side }
              : active.gesture.kind === "gap"
                ? { kind: "gap", index: 0, direction: shape.direction }
                : active.gesture.kind === "radius"
                  ? { kind: "radius", corner: active.gesture.corner }
                  : active.gesture.handle.kind === "edge"
                    ? { kind: "edge", side: active.gesture.handle.side }
                    : { kind: "corner", corner: active.gesture.handle.corner },
          )
        ];

  return (
    <>
      {active !== null && <div data-design-cover="" className={`pointer-events-auto absolute inset-0 ${activeCursor}`} onPointerMove={move} onPointerUp={end} onPointerCancel={end} />}
      {tintSide !== null &&
        (() => {
          const bar = shown.padding.find((each) => each.side === tintSide);
          return bar === undefined ? null : <div data-design-tint="padding" className="absolute bg-(--edit-overlay-border-selected)" style={{ ...placed(bar.area), opacity: 0.15 }} />;
        })()}
      {hatched &&
        shown.gaps.map((gap) => (
          <div
            key={gap.index}
            data-design-hatch=""
            className="absolute"
            style={{ ...placed(gap.area), backgroundImage: "repeating-linear-gradient(45deg, var(--edit-overlay-border-selected) 0 1px, transparent 1px 6px)", opacity: 0.5 }}
          />
        ))}
      {SIDES.map((side) => {
        const vertical = side === "left" || side === "right";
        const cursor = CURSOR[cursorOf({ kind: "edge", side })];
        return (
          <div
            key={side}
            data-design-edge={side}
            className={`pointer-events-auto absolute ${cursor}`}
            style={
              vertical
                ? { left: side === "left" ? box.x : box.x + box.w, top: box.y, height: box.h, width: ring(12), transform: "translateX(-50%)" }
                : { left: box.x, top: side === "top" ? box.y : box.y + box.h, width: box.w, height: ring(12), transform: "translateY(-50%)" }
            }
            {...drag({ kind: "resize", handle: handleOf(side) }, `edge:${side}`)}
          />
        );
      })}
      {CORNERS.map((corner) => {
        const point = cornerPoint(box, corner);
        return (
          <Pinned key={corner} x={point.x} y={point.y} origin="0 0" shift="translate(-50%, -50%)">
            <span data-design-resize={corner} className={`pointer-events-auto block size-3 ${CURSOR[cursorOf({ kind: "corner", corner })]}`} {...drag({ kind: "resize", handle: { kind: "corner", corner } }, `corner:${corner}`)} />
          </Pinned>
        );
      })}
      {container &&
        handles.padding.map((bar) => (
          <Pinned key={bar.side} x={bar.box.x + bar.box.w / 2} y={bar.box.y + bar.box.h / 2} origin="0 0" shift="translate(-50%, -50%)">
            <span
              data-design-padding={bar.side}
              aria-label={`Padding ${bar.side} ${rounded(bar.value)}`}
              className={`pointer-events-auto flex items-center justify-center p-1 ${CURSOR[cursorOf({ kind: "padding", side: bar.side })]}`}
              {...drag({ kind: "padding", side: bar.side }, `padding:${bar.side}`)}
            >
              <span className={`block rounded-full bg-(--edit-overlay-border-selected) ${bar.side === "left" || bar.side === "right" ? "h-3.5 w-1" : "h-1 w-3.5"}`} />
            </span>
          </Pinned>
        ))}
      {container &&
        handles.gaps.map((bar) => (
          <Pinned key={bar.index} x={bar.box.x + bar.box.w / 2} y={bar.box.y + bar.box.h / 2} origin="0 0" shift="translate(-50%, -50%)">
            <span
              data-design-gap={bar.index}
              aria-label={`Gap ${rounded(bar.value)}`}
              className={`pointer-events-auto flex items-center justify-center p-1 ${CURSOR[cursorOf({ kind: "gap", index: bar.index, direction: shape.direction })]}`}
              {...drag({ kind: "gap" }, `gap:${bar.index}`)}
            >
              <span className={`block rounded-full bg-(--edit-overlay-border-selected) ${shape.direction === "row" ? "h-3.5 w-1" : "h-1 w-3.5"}`} />
            </span>
          </Pinned>
        ))}
      {handles.radius &&
        CORNERS.filter((corner) => corner === near || (active?.gesture.kind === "radius" && active.gesture.corner === corner)).map((corner) => {
          const point = radiusHandleAt(shape, corner);
          return (
            <Pinned key={`radius-${corner}`} x={point.x} y={point.y} origin="0 0" shift="translate(-50%, -50%)">
              <span
                data-design-radius={corner}
                aria-label="Corner radius"
                className={`pointer-events-auto block size-2.5 rounded-full border border-(--edit-overlay-border-selected) bg-(--edit-overlay-halo-inner) ${CURSOR[cursorOf({ kind: "radius", corner })]}`}
                {...drag({ kind: "radius", corner }, `radius:${corner}`)}
              />
            </Pinned>
          );
        })}
      {active !== null && active.chip !== "" && active.gesture.kind !== "resize" && (
        <Pinned x={active.at.x} y={active.at.y} origin="0 0" shift="translate(8px, -50%)">
          <Chip testId="design-drag-chip">{active.chip}</Chip>
        </Pinned>
      )}
      {active === null &&
        over !== null &&
        (() => {
          const padding = over.startsWith("padding:") ? shown.padding.find((each) => `padding:${each.side}` === over) : undefined;
          const gap = over.startsWith("gap:") ? shown.gaps.find((each) => `gap:${each.index}` === over) : undefined;
          const bar = padding ?? gap;
          return bar === undefined ? null : (
            <Pinned x={bar.box.x + bar.box.w / 2} y={bar.box.y + bar.box.h / 2} origin="0 0" shift="translate(8px, -50%)">
              <Chip testId="design-value-chip">{rounded(bar.value)}</Chip>
            </Pinned>
          );
        })()}
    </>
  );
};

export const AltDistance = ({ from, to }: { readonly from: EditBox; readonly to: EditBox }) => {
  const distance = distanceBetween(from, to);
  if (distance === undefined || distance.px <= 0) return null;
  const horizontal = distance.from.y === distance.to.y;
  const line = horizontal
    ? { left: Math.min(distance.from.x, distance.to.x), top: distance.from.y, width: Math.abs(distance.to.x - distance.from.x), height: ring(1) }
    : { left: distance.from.x, top: Math.min(distance.from.y, distance.to.y), height: Math.abs(distance.to.y - distance.from.y), width: ring(1) };
  return (
    <>
      <div data-design-distance="" className="absolute bg-(--edit-overlay-border-selected)" style={line} />
      <Pinned x={(distance.from.x + distance.to.x) / 2} y={(distance.from.y + distance.to.y) / 2} origin="0 0" shift="translate(-50%, -50%)">
        <Chip testId="design-distance-chip">{rounded(distance.px)}</Chip>
      </Pinned>
    </>
  );
};
