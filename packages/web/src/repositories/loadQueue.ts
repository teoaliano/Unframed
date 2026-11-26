import { screenLoadQueue, type ScreenLoadQueue, type ScreenLoadRank } from "@unframed/domain";
import type { Editor, TLShapeId } from "tldraw";
import type { StoreOwner } from "../canvas/doc.ts";

const queues = new WeakMap<StoreOwner, ScreenLoadQueue>();

const timers = {
  after: (ms: number, run: () => void) => {
    const timer = setTimeout(run, ms);
    return () => clearTimeout(timer);
  },
};

export const loadQueueOf = (owner: StoreOwner): ScreenLoadQueue => {
  let queue = queues.get(owner);
  if (queue === undefined) {
    queue = screenLoadQueue(timers);
    queues.set(owner, queue);
  }
  return queue;
};

export const screenLoadRank = (editor: Editor, id: TLShapeId): ScreenLoadRank => {
  const bounds = editor.getShapePageBounds(id);
  const viewport = editor.getViewportPageBounds();
  const distance = bounds === undefined ? Number.POSITIVE_INFINITY : Math.hypot(bounds.midX - viewport.midX, bounds.midY - viewport.midY);
  return { selected: editor.getSelectedShapeIds().includes(id), distance };
};
