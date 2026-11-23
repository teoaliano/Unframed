import { describe, expect, it } from "vitest";
import { INSTANCE_IDLE_MS, countsAsChange, evictionsOverBudget, idleToStop, instanceMemoryBudget, parseProcessTable, processTreeRss } from "../src/index.ts";

const GB = 1024 ** 3;

describe("the memory budget", () => {
  it("is a quarter of the machine's memory", () => {
    expect(instanceMemoryBudget(16 * GB)).toBe(4 * GB);
    expect(instanceMemoryBudget(36 * GB)).toBe(9 * GB);
  });

  const running = (id: string, rss: number, lastDemandedAt: number, demanded = false) => ({ id, rss, lastDemandedAt, demanded });

  it("stops nothing while the sum fits", () => {
    expect(evictionsOverBudget([running("a", 1 * GB, 10), running("b", 2 * GB, 20)], 3 * GB)).toEqual([]);
  });

  it("stops the least recently demanded until the rest fits", () => {
    const instances = [running("a", 1 * GB, 30), running("b", 1 * GB, 10), running("c", 1 * GB, 20), running("d", 1 * GB, 40)];
    expect(evictionsOverBudget(instances, 3 * GB)).toEqual(["b"]);
    expect(evictionsOverBudget(instances, 2.5 * GB)).toEqual(["b", "c"]);
  });

  it("stops Instances nobody wants before demanded ones, however recent", () => {
    const instances = [running("seen", 1 * GB, 5, true), running("old", 1 * GB, 50), running("older", 1 * GB, 40)];
    expect(evictionsOverBudget(instances, 1.5 * GB)).toEqual(["older", "old"]);
  });

  it("stops demanded ones too when that is not enough, but always keeps the most recently demanded", () => {
    const instances = [running("a", 2 * GB, 10, true), running("b", 2 * GB, 20, true), running("c", 2 * GB, 30, true)];
    expect(evictionsOverBudget(instances, 3 * GB)).toEqual(["a", "b"]);
    expect(evictionsOverBudget([running("only", 8 * GB, 1, true)], 1 * GB)).toEqual([]);
  });
});

describe("idle stop", () => {
  const now = 1_000_000_000;

  it("waits ten minutes after the last demand and the last file change", () => {
    expect(INSTANCE_IDLE_MS).toBe(10 * 60 * 1000);
    expect(idleToStop({ demanded: false, lastDemandedAt: now - INSTANCE_IDLE_MS, lastChangeAt: now - INSTANCE_IDLE_MS - 1, now, idleMs: INSTANCE_IDLE_MS })).toBe(true);
    expect(idleToStop({ demanded: false, lastDemandedAt: now - INSTANCE_IDLE_MS + 1, lastChangeAt: 0, now, idleMs: INSTANCE_IDLE_MS })).toBe(false);
    expect(idleToStop({ demanded: false, lastDemandedAt: 0, lastChangeAt: now - 1000, now, idleMs: INSTANCE_IDLE_MS })).toBe(false);
  });

  it.each([
    ["src/App.tsx", true],
    [".env.local", true],
    ["node_modules/.vite/deps/react.js", false],
    [".next/cache/webpack/x.pack", false],
    ["packages/web/node_modules/x.js", false],
    [".git/index", false],
    ["apps/site/dist/index.html", false],
    ["", false],
  ])("counts a change to %j as a file change: %j", (path, counts) => {
    expect(countsAsChange(path)).toBe(counts);
  });

  it("never stops a demanded Instance", () => {
    expect(idleToStop({ demanded: true, lastDemandedAt: 0, lastChangeAt: 0, now, idleMs: INSTANCE_IDLE_MS })).toBe(false);
  });
});

describe("process tree memory", () => {
  const table = parseProcessTable(["  PID  PPID  PGID   RSS", "  100     1   100  1000", "  101   100   100  2000", "  102   101   102   500", "  103     1   100   250", "  200     1   200  9999", "garbage"].join("\n"));

  it("parses ps output, skipping lines that are not rows", () => {
    expect(table).toHaveLength(5);
    expect(table[0]).toEqual({ pid: 100, ppid: 1, pgid: 100, rssKb: 1000 });
  });

  it("sums the RSS of the process, its descendants and its process group, in bytes", () => {
    expect(processTreeRss(table, 100)).toBe((1000 + 2000 + 500 + 250) * 1024);
    expect(processTreeRss(table, 200)).toBe(9999 * 1024);
    expect(processTreeRss(table, 999)).toBe(0);
  });
});
