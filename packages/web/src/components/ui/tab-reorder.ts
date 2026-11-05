"use client";

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
}

const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

const itemSelector = (name: string) => `[data-tab-item="${CSS.escape(name)}"]`;

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

export const useTabReorder = ({
  list,
  names,
  pinnedCount,
  onMove,
}: {
  readonly list: RefObject<HTMLElement | null>;
  readonly names: ReadonlyArray<string>;
  readonly pinnedCount: number;
  readonly onMove: ((name: string, to: number) => void) | undefined;
}) => {
  const drag = useRef<Drag | undefined>(undefined);
  const rested = useRef(new Map<string, number>());
  const dropped = useRef<Map<string, number> | undefined>(undefined);
  const latest = useRef({ names, pinnedCount, onMove });
  latest.current = { names, pinnedCount, onMove };
  const key = names.join("\u0000");
  const lastKey = useRef(key);

  const offsetsOf = (root: HTMLElement, current: ReadonlyArray<string>) => {
    const origin = root.getBoundingClientRect().left - root.scrollLeft;
    const lefts = new Map<string, { readonly element: HTMLElement; readonly left: number }>();
    for (const name of current) {
      const element = root.querySelector<HTMLElement>(itemSelector(name));
      if (element !== null) lefts.set(name, { element, left: element.getBoundingClientRect().left - origin });
    }
    return lefts;
  };

  useLayoutEffect(() => {
    const root = list.current;
    if (root === null) return;
    const now = offsetsOf(root, names);
    const before = dropped.current ?? rested.current;
    const changed = lastKey.current !== key;
    dropped.current = undefined;
    lastKey.current = key;
    rested.current = new Map([...now].map(([name, { left }]) => [name, left]));
    const sameSet = before.size === now.size && [...now.keys()].every((name) => before.has(name));
    if (!changed || !sameSet || reducedMotion()) return;
    for (const [name, { element, left }] of now) {
      const offset = (before.get(name) ?? left) - left;
      if (Math.abs(offset) > 0.5) element.animate([{ transform: `translateX(${offset}px)` }, { transform: "translateX(0)" }], { duration: SETTLE_MS, easing: SETTLE_EASE });
    }
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
    const slots: Slot[] = [];
    for (const name of latest.current.names) {
      const element = root.querySelector<HTMLElement>(itemSelector(name));
      if (element === null) return false;
      const rect = element.getBoundingClientRect();
      slots.push({ name, element, left: rect.left, width: rect.width });
    }
    const from = slots.findIndex((slot) => slot.name === current.name);
    if (from === -1) return false;
    const pinned = from < latest.current.pinnedCount;
    current.slots = slots;
    current.from = from;
    current.target = from;
    current.low = pinned ? 0 : latest.current.pinnedCount;
    current.high = pinned ? latest.current.pinnedCount - 1 : slots.length - 1;
    current.active = true;
    root.dataset.reordering = "";
    slots[from]!.element.dataset.dragging = "";
    return true;
  };

  const follow = (current: Drag, clientX: number) => {
    const { slots, from, low, high } = current;
    const dragged = slots[from]!;
    const min = slots[low]!.left - dragged.left;
    const max = slots[high]!.left + slots[high]!.width - (dragged.left + dragged.width);
    const dx = Math.max(min, Math.min(max, clientX - current.startX));
    dragged.element.style.transition = "none";
    dragged.element.style.transform = `translateX(${dx}px)`;
    const leading = dx < 0 ? dragged.left + dx : dragged.left + dragged.width + dx;
    let target = from;
    if (dx > 0) for (let index = from + 1; index <= high; index++) if (leading > slots[index]!.left + slots[index]!.width / 2) target = index;
    if (dx < 0) for (let index = from - 1; index >= low; index--) if (leading < slots[index]!.left + slots[index]!.width / 2) target = index;
    if (target === current.target) return;
    current.target = target;
    const lefts = layoutAfter(slots, from, target);
    const slide = reducedMotion() ? "none" : SLIDE;
    for (const slot of slots) {
      if (slot === dragged) continue;
      slot.element.style.transition = slide;
      slot.element.style.transform = `translateX(${(lefts.get(slot.name) ?? slot.left) - slot.left}px)`;
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
    const target = commit ? current.target : from;
    if (target === from) {
      const dragged = slots[from]!.element;
      const offset = dragged.getBoundingClientRect().left - slots[from]!.left;
      reset(slots);
      if (Math.abs(offset) > 0.5 && !reducedMotion()) {
        dragged.animate([{ transform: `translateX(${offset}px)` }, { transform: "translateX(0)" }], { duration: SETTLE_MS, easing: SETTLE_EASE });
      }
      return;
    }
    const root = list.current;
    const visual = root === null ? new Map<string, number>() : new Map([...offsetsOf(root, latest.current.names)].map(([name, { left }]) => [name, left]));
    reset(slots);
    dropped.current = visual;
    const { onMove: move } = latest.current;
    if (move === undefined) {
      dropped.current = undefined;
      return;
    }
    move(current.name, target);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || drag.current !== undefined || latest.current.onMove === undefined) return;
    if (!(event.target instanceof Element) || event.target.closest("[data-close]") !== null) return;
    const name = event.target.closest<HTMLElement>("[data-tab-item]")?.dataset.tabItem;
    if (name === undefined) return;
    const current: Drag = { name, pointerId: event.pointerId, startX: event.clientX, active: false, slots: [], from: -1, low: 0, high: 0, target: -1 };
    drag.current = current;

    const stop = () => {
      window.removeEventListener("pointermove", onMoveEvent);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey, { capture: true });
      drag.current = undefined;
    };
    const onMoveEvent = (move: PointerEvent) => {
      if (move.pointerId !== current.pointerId) return;
      if (!current.active) {
        if (Math.abs(move.clientX - current.startX) < THRESHOLD) return;
        if (!begin(current)) return stop();
      }
      move.preventDefault();
      follow(current, move.clientX);
    };
    const onUp = (up: PointerEvent) => {
      if (up.pointerId !== current.pointerId) return;
      stop();
      if (!current.active) return;
      swallowClick();
      finish(current, true);
    };
    const onCancel = (cancel: PointerEvent) => {
      if (cancel.pointerId !== current.pointerId) return;
      stop();
      if (current.active) finish(current, false);
    };
    const onKey = (key: KeyboardEvent) => {
      if (key.key !== "Escape" || !current.active) return;
      key.preventDefault();
      key.stopPropagation();
      stop();
      finish(current, false);
    };
    window.addEventListener("pointermove", onMoveEvent);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey, { capture: true });
  };

  return { onPointerDown };
};
