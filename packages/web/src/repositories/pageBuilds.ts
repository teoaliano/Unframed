import type { Editor } from "tldraw";

export const BUILD_BUDGET_MS = 6;

interface Build {
  readonly rank: () => number;
  readonly run: () => void;
}

interface Queue {
  readonly waiting: Set<Build>;
  frame: number | undefined;
}

const queues = new WeakMap<Editor, Queue>();

const queueOf = (editor: Editor): Queue => {
  let found = queues.get(editor);
  if (found === undefined) {
    found = { waiting: new Set(), frame: undefined };
    queues.set(editor, found);
  }
  return found;
};

const drain = (queue: Queue) => {
  queue.frame = undefined;
  const started = performance.now();
  while (queue.waiting.size > 0) {
    let best: Build | undefined;
    let bestRank = Number.POSITIVE_INFINITY;
    for (const build of queue.waiting) {
      const rank = build.rank();
      if (best === undefined || rank < bestRank) {
        best = build;
        bestRank = rank;
      }
    }
    queue.waiting.delete(best!);
    best!.run();
    if (performance.now() - started >= BUILD_BUDGET_MS) break;
  }
  if (queue.waiting.size > 0) queue.frame = requestAnimationFrame(() => drain(queue));
};

export const schedulePageBuild = (editor: Editor, rank: () => number, run: () => void): (() => void) => {
  const queue = queueOf(editor);
  const build: Build = { rank, run };
  queue.waiting.add(build);
  queue.frame ??= requestAnimationFrame(() => drain(queue));
  return () => {
    queue.waiting.delete(build);
  };
};
