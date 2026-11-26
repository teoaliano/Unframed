import { screenLoadQueue, type ScreenLoadQueue, type ScreenLoadRank } from "@unframed/domain";
import type { Editor, TLShapeId } from "tldraw";
const queues = new Map<string, ScreenLoadQueue>();

const timers = {
  after: (ms: number, run: () => void) => {
    const timer = setTimeout(run, ms);
    return () => clearTimeout(timer);
  },
};

export const loadQueueOf = (project: string): ScreenLoadQueue => {
  let queue = queues.get(project);
  if (queue === undefined) {
    queue = screenLoadQueue(timers);
    queues.set(project, queue);
  }
  return queue;
};

export const forgetLoadQueue = (project: string): void => {
  queues.delete(project);
};

export const screenLoadRank = (editor: Editor, id: TLShapeId): ScreenLoadRank => {
  const bounds = editor.getShapePageBounds(id);
  const viewport = editor.getViewportPageBounds();
  const distance = bounds === undefined ? Number.POSITIVE_INFINITY : Math.hypot(bounds.midX - viewport.midX, bounds.midY - viewport.midY);
  return { selected: editor.getSelectedShapeIds().includes(id), distance };
};
