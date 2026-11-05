"use client";

import { tabGroup } from "@unframed/domain";
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import { useLayoutEffect, useRef } from "react";

const THRESHOLD = 4;
const SLIDE = "transform 200ms cubic-bezier(0.2, 0, 0, 1)";
const SETTLE_MS = 200;
const SETTLE_EASE = "cubic-bezier(0.2, 0, 0, 1)";

interface Slot {
  readonly name: string;
  readonly element: HTMLElement;
  readonly left: number;
  readonly width: number;
}

interface Drag {
  readonly name: string;
  readonly pointerId: number;
  readonly startX: number;
  active: boolean;
  slots: ReadonlyArray<Slot>;
  from: number;
  low: number;
  high: number;
  target: number;
  clientX: number;
}

const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

const itemSelector = (name: string) => `[data-tab-item="${CSS.escape(name)}"]`;

const contentX = (root: HTMLElement, clientX: number) => clientX - root.getBoundingClientRect().left + root.scrollLeft;

const layoutAfter = (slots: ReadonlyArray<Slot>, from: number, to: number): Map<string, number> => {
  const gap = slots.length > 1 ? slots[1]!.left - (slots[0]!.left + slots[0]!.width) : 0;
  const order = [...slots];
  const [moved] = order.splice(from, 1);
  order.splice(to, 0, moved!);
  const lefts = new Map<string, number>();
  let left = slots[0]?.left ?? 0;
  for (const slot of order) {
    lefts.set(slot.name, left);
    left += slot.width + gap;
  }
  return lefts;
};

const contentLefts = (root: HTMLElement, names: ReadonlyArray<string>) => {
  const origin = root.getBoundingClientRect().left - root.scrollLeft;
  const lefts = new Map<string, { readonly element: HTMLElement; readonly left: number; readonly width: number }>();
  for (const name of names) {
    const element = root.querySelector<HTMLElement>(itemSelector(name));
    if (element === null) continue;
    const rect = element.getBoundingClientRect();
    lefts.set(name, { element, left: rect.left - origin, width: rect.width });
  }
  return lefts;
};

const settle = (element: HTMLElement, offset: number) => {
  if (Math.abs(offset) <= 0.5 || reducedMotion()) return;
  element.animate([{ transform: `translateX(${offset}px)` }, { transform: "translateX(0)" }], { duration: SETTLE_MS, easing: SETTLE_EASE });
};

export const useTabReorder = ({
  list,
  names,
  pinned,
  onMove,
}: {
  readonly list: RefObject<HTMLElement | null>;
  readonly names: ReadonlyArray<string>;
  readonly pinned: ReadonlyArray<string>;
  readonly onMove: ((name: string, to: number) => void) | undefined;
}) => {
  const drag = useRef<Drag | undefined>(undefined);
  const restingLefts = useRef(new Map<string, number>());
  const leftsAtDrop = useRef<Map<string, number> | undefined>(undefined);
  const strip = useRef({ names, pinned, onMove });
  strip.current = { names, pinned, onMove };
  const orderKey = names.join("\u0000");
  const measuredKey = useRef<string | undefined>(undefined);

  useLayoutEffect(() => {
    if (measuredKey.current === orderKey) return;
    const root = list.current;
    if (root === null) return;
    const firstMeasure = measuredKey.current === undefined;
    measuredKey.current = orderKey;
    const now = contentLefts(root, names);
    const before = leftsAtDrop.current ?? restingLefts.current;
    leftsAtDrop.current = undefined;
    restingLefts.current = new Map([...now].map(([name, { left }]) => [name, left]));
    const sameSet = before.size === now.size && [...now.keys()].every((name) => before.has(name));
    if (firstMeasure || !sameSet) return;
    for (const [name, { element, left }] of now) settle(element, (before.get(name) ?? left) - left);
  });

  const reset = (slots: ReadonlyArray<Slot>) => {
    for (const slot of slots) {
      slot.element.style.transform = "";
      slot.element.style.transition = "";
      delete slot.element.dataset.dragging;
    }
    if (list.current) delete list.current.dataset.reordering;
  };

  const begin = (current: Drag): boolean => {
    const root = list.current;
    if (root === null) return false;
    const measured = contentLefts(root, strip.current.names);
    const slots: Slot[] = [];
    for (const name of strip.current.names) {
      const found = measured.get(name);
      if (found === undefined) return false;
      slots.push({ name, element: found.element, left: found.left, width: found.width });
    }
    const from = slots.findIndex((slot) => slot.name === current.name);
    if (from === -1) return false;
    const { low, high } = tabGroup({ order: strip.current.names, pinned: strip.current.pinned }, current.name);
    current.slots = slots;
    current.from = from;
    current.target = from;
    current.low = low;
    current.high = high;
    current.active = true;
    root.dataset.reordering = "";
    slots[from]!.element.dataset.dragging = "";
    return true;
  };

  const follow = (current: Drag) => {
    const root = list.current;
    if (root === null) return;
    const { slots, from, low, high } = current;
    const dragged = slots[from]!;
    const min = slots[low]!.left - dragged.left;
    const max = slots[high]!.left + slots[high]!.width - (dragged.left + dragged.width);
    const dx = Math.max(min, Math.min(max, contentX(root, current.clientX) - current.startX));
    dragged.element.style.transition = "none";
    dragged.element.style.transform = `translateX(${dx}px)`;
    const leading = dx < 0 ? dragged.left + dx : dragged.left + dragged.width + dx;
    let target = from;
    if (dx > 0) for (let index = from + 1; index <= high; index++) if (leading > slots[index]!.left + slots[index]!.width / 2) target = index;
    if (dx < 0) for (let index = from - 1; index >= low; index--) if (leading < slots[index]!.left + slots[index]!.width / 2) target = index;
    if (target === current.target) return;
    current.target = target;
    const after = layoutAfter(slots, from, target);
    const slide = reducedMotion() ? "none" : SLIDE;
    for (const slot of slots) {
      if (slot === dragged) continue;
      slot.element.style.transition = slide;
      slot.element.style.transform = `translateX(${(after.get(slot.name) ?? slot.left) - slot.left}px)`;
    }
  };

  const swallowClick = () => {
    const swallow = (event: MouseEvent) => {
      event.stopPropagation();
      event.preventDefault();
    };
    window.addEventListener("click", swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
  };

  const finish = (current: Drag, commit: boolean) => {
    const { slots, from } = current;
    const root = list.current;
    const target = commit ? current.target : from;
    if (target === from || root === null || strip.current.onMove === undefined) {
      const dragged = slots[from]!;
      const visualLeft = root === null ? dragged.left : (contentLefts(root, [current.name]).get(current.name)?.left ?? dragged.left);
      reset(slots);
      settle(dragged.element, visualLeft - dragged.left);
      return;
    }
    const visual = new Map([...contentLefts(root, strip.current.names)].map(([name, { left }]) => [name, left]));
    reset(slots);
    leftsAtDrop.current = visual;
    strip.current.onMove(current.name, target);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    const root = list.current;
    if (event.button !== 0 || drag.current !== undefined || strip.current.onMove === undefined || root === null) return;
    if (!(event.target instanceof Element) || event.target.closest("[data-close]") !== null) return;
    const name = event.target.closest<HTMLElement>("[data-tab-item]")?.dataset.tabItem;
    if (name === undefined) return;
    const downX = event.clientX;
    const current: Drag = { name, pointerId: event.pointerId, startX: contentX(root, downX), active: false, slots: [], from: -1, low: 0, high: 0, target: -1, clientX: downX };
    drag.current = current;

    const stop = () => {
      window.removeEventListener("pointermove", onMoveEvent);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("keydown", onKey, { capture: true });
      root.removeEventListener("lostpointercapture", onLost);
      root.removeEventListener("scroll", onScroll);
      if (root.hasPointerCapture(current.pointerId)) root.releasePointerCapture(current.pointerId);
      drag.current = undefined;
    };
    const cancel = () => {
      stop();
      if (current.active) finish(current, false);
    };
    const onMoveEvent = (move: PointerEvent) => {
      if (move.pointerId !== current.pointerId) return;
      current.clientX = move.clientX;
      if (!current.active) {
        if (Math.abs(move.clientX - downX) < THRESHOLD) return;
        if (!begin(current)) return stop();
        try {
          root.setPointerCapture(current.pointerId);
          root.addEventListener("lostpointercapture", onLost);
        } catch {
          return cancel();
        }
      }
      move.preventDefault();
      follow(current);
    };
    const onUp = (up: PointerEvent) => {
      if (up.pointerId !== current.pointerId) return;
      stop();
      if (!current.active) return;
      swallowClick();
      finish(current, true);
    };
    const onCancel = (event: PointerEvent) => {
      if (event.pointerId === current.pointerId) cancel();
    };
    const onLost = (event: PointerEvent) => {
      if (event.pointerId === current.pointerId) cancel();
    };
    const onScroll = () => {
      if (current.active) follow(current);
    };
    const onKey = (key: KeyboardEvent) => {
      if (key.key !== "Escape" || !current.active) return;
      key.preventDefault();
      key.stopPropagation();
      cancel();
    };
    window.addEventListener("pointermove", onMoveEvent);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("blur", cancel);
    window.addEventListener("keydown", onKey, { capture: true });
    root.addEventListener("scroll", onScroll);
  };

  return { onPointerDown };
};
