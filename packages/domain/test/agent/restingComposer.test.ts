import { describe, expect, it } from "vitest";
import {
  COMPOSER_SCROLL_COLLAPSE_THRESHOLD_PX,
  createComposerScrollGesture,
  recordComposerScrollGesture,
  resetComposerScrollGesture,
  restingImagePreviewCounts,
  shouldAnimateRestingTransition,
  shouldCollapseComposerForScrollKey,
  shouldRestComposer,
  suppressComposerScrollGesture,
} from "../../src/index.ts";

const resting = {
  isExistingChat: true,
  isNarrowViewport: false,
  isScrollCollapsed: true,
  hasExpandedChrome: false,
  hasMultilinePrompt: false,
  transcriptOverflows: true,
};

describe("when the composer rests", () => {
  it("rests in a chat whose transcript overflows, after a scroll away from the end", () => {
    expect(shouldRestComposer(resting)).toBe(true);
  });

  it("stays expanded for a new chat, a phone-wide window, a short transcript, a multiline prompt or open chrome", () => {
    expect(shouldRestComposer({ ...resting, isExistingChat: false })).toBe(false);
    expect(shouldRestComposer({ ...resting, isNarrowViewport: true })).toBe(false);
    expect(shouldRestComposer({ ...resting, transcriptOverflows: false })).toBe(false);
    expect(shouldRestComposer({ ...resting, isScrollCollapsed: false })).toBe(false);
    expect(shouldRestComposer({ ...resting, hasMultilinePrompt: true })).toBe(false);
    expect(shouldRestComposer({ ...resting, hasExpandedChrome: true })).toBe(false);
  });
});

describe("the scroll gesture that rests the composer", () => {
  const event = (now: number, deltaPx: number, overrides: Partial<Parameters<typeof recordComposerScrollGesture>[1]> = {}) => ({
    now,
    deltaPx,
    collapseEligible: true,
    canScrollInGestureDirection: true,
    scrollsTowardEnd: false,
    ...overrides,
  });

  it("collapses once a gesture away from the end adds up to 24 px, and starts counting again after", () => {
    expect(COMPOSER_SCROLL_COLLAPSE_THRESHOLD_PX).toBe(24);
    const state = createComposerScrollGesture();
    expect(recordComposerScrollGesture(state, event(0, 10))).toBe(false);
    expect(recordComposerScrollGesture(state, event(16, 10))).toBe(false);
    expect(recordComposerScrollGesture(state, event(32, 4))).toBe(true);
    expect(recordComposerScrollGesture(state, event(48, 10))).toBe(false);
  });

  it("never collapses toward the end, when the transcript cannot move that way, or when not eligible; each resets the count", () => {
    const state = createComposerScrollGesture();
    expect(recordComposerScrollGesture(state, event(0, 20))).toBe(false);
    expect(recordComposerScrollGesture(state, event(10, 20, { scrollsTowardEnd: true }))).toBe(false);
    expect(recordComposerScrollGesture(state, event(20, 20))).toBe(false);
    expect(recordComposerScrollGesture(state, event(30, 20, { canScrollInGestureDirection: false }))).toBe(false);
    expect(recordComposerScrollGesture(state, event(40, 20, { collapseEligible: false }))).toBe(false);
    expect(recordComposerScrollGesture(state, event(50, 20))).toBe(false);
  });

  it("a gesture still going when the person types is suppressed until it ends", () => {
    const state = createComposerScrollGesture();
    recordComposerScrollGesture(state, event(0, 10));
    suppressComposerScrollGesture(state, 100, 120);
    expect(recordComposerScrollGesture(state, event(110, 100))).toBe(false);
    resetComposerScrollGesture(state);
    expect(recordComposerScrollGesture(state, event(500, 30))).toBe(true);
  });

  it("typing after the gesture ended suppresses nothing", () => {
    const state = createComposerScrollGesture();
    recordComposerScrollGesture(state, event(0, 10));
    suppressComposerScrollGesture(state, 500, 120);
    expect(recordComposerScrollGesture(state, event(510, 30))).toBe(true);
  });
});

describe("scroll keys", () => {
  const at = { scrollTop: 300, scrollHeight: 2000, clientHeight: 500, isAtEnd: false };
  it("PageUp and Home rest it unless already at the top; PageDown and End only when not at the end", () => {
    expect(shouldCollapseComposerForScrollKey({ ...at, key: "PageUp" })).toBe(true);
    expect(shouldCollapseComposerForScrollKey({ ...at, key: "Home", scrollTop: 0 })).toBe(false);
    expect(shouldCollapseComposerForScrollKey({ ...at, key: "PageDown" })).toBe(true);
    expect(shouldCollapseComposerForScrollKey({ ...at, key: "End", isAtEnd: true })).toBe(false);
    expect(shouldCollapseComposerForScrollKey({ ...at, key: "End", scrollTop: 1500 })).toBe(false);
    expect(shouldCollapseComposerForScrollKey({ ...at, key: "ArrowUp" })).toBe(false);
  });
});

describe("the resting transition", () => {
  it("animates a change of state after the first layout, or one that interrupts a running transition", () => {
    expect(shouldAnimateRestingTransition({ hasCompletedInitialLayout: false, stateChanged: true, hasInterruptedAnimation: false })).toBe(false);
    expect(shouldAnimateRestingTransition({ hasCompletedInitialLayout: true, stateChanged: true, hasInterruptedAnimation: false })).toBe(true);
    expect(shouldAnimateRestingTransition({ hasCompletedInitialLayout: true, stateChanged: false, hasInterruptedAnimation: false })).toBe(false);
    expect(shouldAnimateRestingTransition({ hasCompletedInitialLayout: true, stateChanged: false, hasInterruptedAnimation: true })).toBe(true);
  });

  it("a resting composer shows three image thumbnails at most, and counts the rest", () => {
    expect(restingImagePreviewCounts(0)).toEqual({ visibleCount: 0, overflowCount: 0 });
    expect(restingImagePreviewCounts(3)).toEqual({ visibleCount: 3, overflowCount: 0 });
    expect(restingImagePreviewCounts(5)).toEqual({ visibleCount: 3, overflowCount: 2 });
  });
});
