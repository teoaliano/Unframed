import { describe, expect, it } from "vitest";
import { SCREEN_LOAD_CAP_MS, screenLoadQueue, type ScreenLoadRank } from "../src/index.ts";

const fakeTimers = () => {
  let now = 0;
  let pending: { at: number; run: () => void; live: boolean }[] = [];
  return {
    after: (ms: number, run: () => void) => {
      const timer = { at: now + ms, run, live: true };
      pending.push(timer);
      return () => {
        timer.live = false;
      };
    },
    advance: (ms: number) => {
      const until = now + ms;
      for (;;) {
        const next = pending.filter((timer) => timer.live && timer.at <= until).sort((a, b) => a.at - b.at)[0];
        if (next === undefined) break;
        next.live = false;
        now = next.at;
        next.run();
      }
      now = until;
      pending = pending.filter((timer) => timer.live);
    },
  };
};

const board = () => {
  const timers = fakeTimers();
  const queue = screenLoadQueue(timers);
  const started: string[] = [];
  const ranks = new Map<string, ScreenLoadRank>();
  const enter = (id: string, rank: ScreenLoadRank) => {
    ranks.set(id, rank);
    return queue.enter(id, () => ranks.get(id)!, () => started.push(id));
  };
  return { timers, queue, started, ranks, enter };
};

describe("the Screen load queue", () => {
  it("starts one Screen at a time, nearest to the viewport centre first, the next once the last is done", () => {
    const { timers, queue, started, enter } = board();
    enter("far", { selected: false, distance: 900 });
    enter("near", { selected: false, distance: 10 });
    enter("middle", { selected: false, distance: 300 });
    expect(started).toEqual([]);
    timers.advance(0);
    expect(started).toEqual(["near"]);
    queue.done("near");
    timers.advance(0);
    expect(started).toEqual(["near", "middle"]);
    queue.done("middle");
    timers.advance(0);
    expect(started).toEqual(["near", "middle", "far"]);
    queue.done("far");
  });

  it("puts the selected Screen first, reading ranks when it picks, without interrupting the one loading", () => {
    const { timers, queue, started, ranks, enter } = board();
    enter("a", { selected: false, distance: 10 });
    timers.advance(0);
    enter("b", { selected: false, distance: 20 });
    enter("c", { selected: false, distance: 800 });
    ranks.set("c", { selected: true, distance: 800 });
    timers.advance(1000);
    expect(started).toEqual(["a"]);
    queue.done("a");
    timers.advance(0);
    expect(started).toEqual(["a", "c"]);
  });

  it("moves on after the cap when a Screen never says it is done, and ignores its late done", () => {
    const { timers, queue, started, enter } = board();
    enter("stuck", { selected: false, distance: 0 });
    enter("next", { selected: false, distance: 5 });
    timers.advance(SCREEN_LOAD_CAP_MS - 1);
    expect(started).toEqual(["stuck"]);
    timers.advance(1);
    expect(started).toEqual(["stuck", "next"]);
    queue.done("stuck");
    enter("last", { selected: false, distance: 1 });
    timers.advance(0);
    expect(started).toEqual(["stuck", "next"]);
  });

  it("lets a Screen that leaves give up its place or its turn", () => {
    const { timers, started, enter } = board();
    const leaveA = enter("a", { selected: false, distance: 0 });
    const leaveB = enter("b", { selected: false, distance: 1 });
    enter("c", { selected: false, distance: 2 });
    timers.advance(0);
    leaveB();
    leaveA();
    timers.advance(0);
    expect(started).toEqual(["a", "c"]);
  });

  it("forgets a Screen that is done, so entering again waits a new turn", () => {
    const { timers, queue, started, enter } = board();
    enter("a", { selected: false, distance: 0 });
    timers.advance(0);
    queue.done("a");
    enter("a", { selected: false, distance: 0 });
    timers.advance(0);
    expect(started).toEqual(["a", "a"]);
  });
});
