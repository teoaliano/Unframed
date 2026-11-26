import { describe, expect, it } from "vitest";
import { QUIET_CAP_MS, QUIET_IDLE_MS, quietWatch, STEP_TIMEOUT_MS, stepExpired } from "../src/index.ts";

const watch = () => quietWatch({ idle: QUIET_IDLE_MS, cap: QUIET_CAP_MS }, 0);

describe("a Screen page going quiet", () => {
  it("goes quiet half a second after its load event when nothing else happens", () => {
    const page = watch();
    expect(page.check(9000)).toBeUndefined();
    page.load(9000);
    expect(page.check(9000 + QUIET_IDLE_MS - 1)).toBeUndefined();
    expect(page.check(9000 + QUIET_IDLE_MS)).toBe(9000 + QUIET_IDLE_MS);
    expect(page.check(20_000)).toBe(9000 + QUIET_IDLE_MS);
  });

  it("waits for requests and long tasks after the load event to stop for half a second", () => {
    const page = watch();
    page.load(1000);
    page.busy(1300);
    page.busy(1700);
    expect(page.check(2100)).toBeUndefined();
    expect(page.check(1700 + QUIET_IDLE_MS)).toBe(1700 + QUIET_IDLE_MS);
  });

  it("counts requests before the load event as part of loading", () => {
    const page = watch();
    page.busy(4000);
    page.load(3000);
    expect(page.check(3000 + QUIET_IDLE_MS)).toBeUndefined();
    expect(page.check(4000 + QUIET_IDLE_MS)).toBe(4000 + QUIET_IDLE_MS);
  });

  it("is taken as quiet at the cap when the page never stops", () => {
    const page = watch();
    page.load(100);
    for (let at = 200; at < QUIET_CAP_MS + 1000; at += 100) page.busy(at);
    expect(page.check(QUIET_CAP_MS - 1)).toBeUndefined();
    expect(page.check(QUIET_CAP_MS)).toBe(QUIET_CAP_MS);
  });
});

describe("a step's deadline", () => {
  it("never passes before the page is quiet, however long the step has looked", () => {
    expect(stepExpired(0, undefined, 60_000, STEP_TIMEOUT_MS)).toBe(false);
  });

  it("runs from quiet for a step that started before it, and from its own start after", () => {
    expect(stepExpired(1000, 9000, 9000 + STEP_TIMEOUT_MS, STEP_TIMEOUT_MS)).toBe(false);
    expect(stepExpired(1000, 9000, 9001 + STEP_TIMEOUT_MS, STEP_TIMEOUT_MS)).toBe(true);
    expect(stepExpired(12_000, 9000, 12_000 + STEP_TIMEOUT_MS, STEP_TIMEOUT_MS)).toBe(false);
    expect(stepExpired(12_000, 9000, 12_001 + STEP_TIMEOUT_MS, STEP_TIMEOUT_MS)).toBe(true);
  });
});
