export const SCREEN_LOAD_CAP_MS = 4000;

export interface ScreenLoadRank {
  readonly selected: boolean;
  readonly distance: number;
}

export interface ScreenLoadTimers {
  readonly after: (ms: number, run: () => void) => () => void;
}

export interface ScreenLoadQueue {
  readonly enter: (id: string, rank: () => ScreenLoadRank, start: () => void) => () => void;
  readonly done: (id: string) => void;
}

interface Entry {
  readonly id: string;
  readonly rank: () => ScreenLoadRank;
  readonly start: () => void;
}

const ahead = (a: ScreenLoadRank, b: ScreenLoadRank): boolean => (a.selected !== b.selected ? a.selected : a.distance < b.distance);

export const screenLoadQueue = (timers: ScreenLoadTimers): ScreenLoadQueue => {
  const waiting: Entry[] = [];
  let active: { readonly entry: Entry; readonly stop: () => void } | undefined;
  let scheduled: (() => void) | undefined;

  const pick = () => {
    scheduled = undefined;
    if (active !== undefined || waiting.length === 0) return;
    let best = 0;
    let bestRank = waiting[0]!.rank();
    for (let index = 1; index < waiting.length; index++) {
      const rank = waiting[index]!.rank();
      if (ahead(rank, bestRank)) {
        best = index;
        bestRank = rank;
      }
    }
    const [entry] = waiting.splice(best, 1);
    const turn = { entry: entry!, stop: timers.after(SCREEN_LOAD_CAP_MS, () => finish(turn.entry)) };
    active = turn;
    entry!.start();
  };

  const schedule = () => {
    if (scheduled === undefined && active === undefined && waiting.length > 0) scheduled = timers.after(0, pick);
  };

  const finish = (entry: Entry) => {
    if (active?.entry !== entry) return;
    active.stop();
    active = undefined;
    schedule();
  };

  const leave = (entry: Entry) => {
    const at = waiting.indexOf(entry);
    if (at !== -1) waiting.splice(at, 1);
    finish(entry);
  };

  const enter = (id: string, rank: () => ScreenLoadRank, start: () => void) => {
    const entry: Entry = { id, rank, start };
    waiting.push(entry);
    schedule();
    return () => leave(entry);
  };

  const done = (id: string) => {
    if (active?.entry.id === id) finish(active.entry);
  };

  return { enter, done };
};
